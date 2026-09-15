import { Notice, TFile } from "obsidian";
import type PythiaPlugin from "../main";
import { t } from "../i18n";
import {
	parseGlossary,
	upsertGlossaryEntry,
	normalizeTerm,
	buildTermIndex,
	type GlossaryEntry,
	type TermIndex,
} from "./glossary";
import { parseDefinitionAndVariants } from "./messageUtils";

/**
 * Owns the glossary note: reads it, looks terms up, writes new ones back
 * (ADR-136).
 *
 * The lookup chain is vault first, then the model. The vault tier is what makes
 * the feature compound rather than repeat work: the second time a term appears
 * anywhere, in any conversation, it is already known and costs nothing. The
 * model tier only runs for terms the glossary has never seen, and defines them
 * *as used in the passage*, which a dictionary cannot do.
 *
 * There is deliberately no web tier. It would need a key, send the passage
 * off-device, and answer a question the model with the passage in hand answers
 * better.
 *
 * Entries are cached in memory because the painter asks for the matcher on every
 * rendered message. The cache is invalidated by our own writes and by any vault
 * change to the note, so editing the glossary by hand takes effect without a
 * reload.
 */
export class GlossaryService {
	private entries: GlossaryEntry[] | null = null;
	private index: TermIndex | null = null;
	private indexBuiltFor = -1;
	/** In-flight lookups, so tapping the same term twice does not call twice. */
	private pending = new Map<string, Promise<GlossaryEntry | null>>();

	constructor(private readonly plugin: PythiaPlugin) {}

	private get path(): string {
		return this.plugin.settings.glossaryNote || "Pythia/Glossary.md";
	}

	/** Drop the cache. Called on our own writes and on external edits to the note. */
	invalidate(): void {
		this.entries = null;
		this.index = null;
		this.indexBuiltFor = -1;
	}

	/** True when `filePath` is the glossary note, so the caller can invalidate. */
	isGlossaryNote(filePath: string): boolean {
		return filePath === this.path;
	}

	/** Every known entry, reading the note on first use after an invalidation. */
	async all(): Promise<GlossaryEntry[]> {
		if (this.entries) return this.entries;
		const file = this.plugin.app.vault.getAbstractFileByPath(this.path);
		if (!(file instanceof TFile)) {
			this.entries = [];
			return this.entries;
		}
		try {
			this.entries = parseGlossary(await this.plugin.app.vault.read(file));
		} catch (e) {
			console.error("[Pythia] glossary read failed:", e);
			this.entries = [];
		}
		return this.entries;
	}

	/**
	 * The surface-form index for every known term, or null when the glossary is
	 * empty.
	 *
	 * Cached against the entry count so the painter can call this per message
	 * without rebuilding the alternation each time. The count is a sufficient key
	 * because every write path — ours and the vault's — invalidates the cache
	 * outright, so an entry that gains an alias without changing the count still
	 * rebuilds.
	 */
	indexFor(entries: GlossaryEntry[]): TermIndex | null {
		if (this.indexBuiltFor !== entries.length) {
			this.index = buildTermIndex(entries);
			this.indexBuiltFor = entries.length;
		}
		return this.index;
	}

	/**
	 * The entry for `term`, or undefined. Case-insensitive, and matches aliases as
	 * well as the canonical term: the user may select "Zählern" in the text, and
	 * looking that up again would otherwise re-ask the model for a term the
	 * glossary already knows.
	 */
	find(entries: GlossaryEntry[], term: string): GlossaryEntry | undefined {
		const key = normalizeTerm(term);
		return entries.find((e) => normalizeTerm(e.term) === key)
			?? entries.find((e) => (e.aliases ?? []).some((a) => normalizeTerm(a) === key));
	}

	/**
	 * Resolve a term: return the stored entry, or ask the model and store the
	 * answer. `passage` is the text the term appeared in.
	 *
	 * `force` re-asks the model for a term that is already known, for the
	 * anchor's regenerate control.
	 */
	async lookup(term: string, passage: string, force = false): Promise<GlossaryEntry | null> {
		const clean = term.trim();
		if (!clean) return null;
		const key = normalizeTerm(clean);

		if (!force) {
			const known = this.find(await this.all(), clean);
			if (known) return known;
			const inFlight = this.pending.get(key);
			if (inFlight) return inFlight;
		}

		const run = this.defineAndStore(clean, passage);
		this.pending.set(key, run);
		try {
			return await run;
		} finally {
			this.pending.delete(key);
		}
	}

	private async defineAndStore(term: string, passage: string): Promise<GlossaryEntry | null> {
		const notice = new Notice(t("glossaryLookingUp", { term }), 0);
		try {
			const raw = await this.plugin.llmRouter.defineTerm(term, passage);
			const { definition, variants } = parseDefinitionAndVariants(raw);
			if (!definition) return null;
			const entry: GlossaryEntry = {
				term,
				definition,
				source: "model",
				updatedAt: new Date().toISOString(),
				aliases: dedupeAliases(term, variants),
			};
			await this.save(entry);
			return entry;
		} catch (e) {
			new Notice(t("glossaryLookupFailed", { error: e instanceof Error ? e.message : String(e) }));
			return null;
		} finally {
			notice.hide();
		}
	}

	/**
	 * Write one entry into the note, creating it if needed.
	 *
	 * Read-modify-write against the file each time rather than against the cache,
	 * so a hand edit made between two lookups is never clobbered by a stale copy.
	 */
	async save(entry: GlossaryEntry): Promise<void> {
		const existing = this.plugin.app.vault.getAbstractFileByPath(this.path);
		const current = existing instanceof TFile ? await this.plugin.app.vault.read(existing) : "";
		const next = upsertGlossaryEntry(current || `# ${t("glossaryNoteTitle")}\n`, entry);
		await this.plugin.noteWriter.writeNote(next, this.path);
		this.invalidate();
	}

	/** Remove a term from the note. Used by the anchor's delete control. */
	async remove(term: string): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.path);
		if (!(file instanceof TFile)) return;
		const key = normalizeTerm(term);
		const isTarget = (e: GlossaryEntry) =>
			normalizeTerm(e.term) === key || (e.aliases ?? []).some((a) => normalizeTerm(a) === key);
		const kept = parseGlossary(await this.plugin.app.vault.read(file)).filter((e) => !isTarget(e));
		// Rebuild from the surviving entries. The preamble is not preserved here,
		// unlike upsert: removal is rare and explicit, and keeping the two paths
		// symmetrical would mean a second delete-aware renderer for little gain.
		const body = kept.reduce((md, e) => upsertGlossaryEntry(md, e), `# ${t("glossaryNoteTitle")}\n`);
		await this.plugin.noteWriter.writeNote(body, this.path);
		this.invalidate();
	}
}

/**
 * Keep only the variants worth storing: drop the canonical term itself (it is
 * already matched) and any repeat, case-insensitively.
 *
 * Returns undefined rather than an empty array so an entry with no variants
 * renders no `aliases=` field at all, leaving the note as it was before this
 * existed.
 */
function dedupeAliases(term: string, variants: string[]): string[] | undefined {
	const seen = new Set<string>([normalizeTerm(term)]);
	const kept: string[] = [];
	for (const variant of variants) {
		const key = normalizeTerm(variant);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		kept.push(variant.trim());
	}
	return kept.length > 0 ? kept : undefined;
}
