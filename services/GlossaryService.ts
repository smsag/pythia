import { Notice, TFile, TFolder, normalizePath } from "obsidian";
import type PythiaPlugin from "../main";
import { t } from "../i18n";
import {
	parseGlossary,
	normalizeTerm,
	buildTermIndex,
	type GlossaryEntry,
	type TermIndex,
	type Translation,
} from "./glossary";
import {
	TERMS_SUBFOLDER,
	PEOPLE_SUBFOLDER,
	entryFrontmatter,
	folderOf,
	entryFromFrontmatter,
	mergeEntry,
	parseBody,
	renderBody,
	stripFrontmatter,
	termPath,
	themePath,
	THEME_TYPE,
	effectiveTheme,
	applyTranslation,
	cachedTranslation,
	definitionHash,
	definitionLanguageOf,
} from "./glossaryNotes";
import { LANG_LABELS, parseDefinitionReply } from "./messageUtils";
import { detectLanguage } from "./languageDetect";
import type { Conversation } from "../models/types";

/**
 * Owns the glossary folder: reads it, looks terms up, writes new terms back
 * (ADR-136, storage rewritten in ADR-150).
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
	/** In-flight translations, so reopening an anchor mid-call does not call twice. */
	private pendingTranslations = new Map<string, Promise<string | null>>();
	/** Translations made this session, until the metadata cache has caught up with the note. */
	private recentTranslations = new Map<string, string>();

	constructor(private readonly plugin: PythiaPlugin) {}

	/** Root of the glossary folder; `Terms/`, `Themes/` and (ADR-151) `People/`
	 *  live under it. */
	private get root(): string {
		return normalizePath(this.plugin.settings.glossaryFolder || "Glossary");
	}

	private get termsFolder(): string {
		return `${this.root}/${TERMS_SUBFOLDER}`;
	}

	private get peopleFolder(): string {
		return `${this.root}/${PEOPLE_SUBFOLDER}`;
	}

	/** Vault path of an entry's note. */
	pathFor(entry: Pick<GlossaryEntry, "term" | "kind">): string {
		return termPath(this.root, entry.term, entry.kind);
	}

	/** The single-note glossary written by builds up to 2.13.x — read only, by
	 *  the migration command. */
	get legacyNotePath(): string {
		return this.plugin.settings.glossaryNote || "Pythia/Glossary.md";
	}

	/** Drop the cache. Called on our own writes and on external edits to the note. */
	invalidate(): void {
		this.entries = null;
		this.index = null;
		this.indexBuiltFor = -1;
	}

	/** True when `filePath` is inside the glossary folder, so the caller can
	 *  invalidate. Broader than the old single-note check by necessity: any term
	 *  note can now change the index. */
	isGlossaryNote(filePath: string): boolean {
		return filePath.startsWith(`${this.termsFolder}/`)
			|| filePath.startsWith(`${this.peopleFolder}/`)
			|| filePath === this.legacyNotePath;
	}

	/**
	 * Every known term, from Obsidian's own metadata cache.
	 *
	 * **Frontmatter only — no file is read here.** The painter asks for the index
	 * on every rendered message, and reading N note bodies to paint one message
	 * would not scale. Everything the matcher needs (term, aliases, translations)
	 * is a property, and Obsidian already parses and caches properties for us; the
	 * definition is fetched for the one term whose anchor is actually opened, by
	 * `hydrate`. This is also why ADR-150 could delete the glossary parser: the
	 * format we read is Obsidian's, not ours.
	 */
	async all(): Promise<GlossaryEntry[]> {
		if (this.entries) return this.entries;
		const entries: GlossaryEntry[] = [];
		for (const path of [this.termsFolder, this.peopleFolder]) {
			const folder = this.plugin.app.vault.getAbstractFileByPath(path);
			if (!(folder instanceof TFolder)) continue;
			for (const child of folder.children) {
				if (!(child instanceof TFile) || child.extension !== "md") continue;
				const fm = this.plugin.app.metadataCache.getFileCache(child)?.frontmatter;
				entries.push(entryFromFrontmatter(child.basename, fm));
			}
		}
		this.entries = entries;
		return this.entries;
	}

	/**
	 * Load an entry's definition and contexts, which `all()` deliberately leaves
	 * empty. Reads exactly one file — the term whose anchor is being opened.
	 */
	async hydrate(entry: GlossaryEntry): Promise<GlossaryEntry> {
		if (entry.definition) return entry;
		const file = this.plugin.app.vault.getAbstractFileByPath(termPath(this.root, entry.term, entry.kind));
		if (!(file instanceof TFile)) return entry;
		try {
			const body = parseBody(stripFrontmatter(await this.plugin.app.vault.read(file)));
			return { ...entry, definition: body.definition, contexts: body.contexts.length > 0 ? body.contexts : undefined };
		} catch (e) {
			console.error("[Pythia] glossary term read failed:", e);
			return entry;
		}
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
	async lookup(
		term: string,
		passage: string,
		force = false,
		/** Conversation the term was selected in — carries the language override
		 *  the definition is written in (ADR-148). */
		conversation?: Conversation
	): Promise<GlossaryEntry | null> {
		const clean = term.trim();
		if (!clean) return null;
		const key = normalizeTerm(clean);

		if (!force) {
			const known = this.find(await this.all(), clean);
			if (known) return known;
			const inFlight = this.pending.get(key);
			if (inFlight) return inFlight;
		}

		const run = this.defineAndStore(clean, passage, conversation, force);
		this.pending.set(key, run);
		try {
			return await run;
		} finally {
			this.pending.delete(key);
		}
	}

	/**
	 * Resolve a person: return the stored note, or ask the model and store one
	 * (ADR-151).
	 *
	 * **Vault first is not an optimization here.** A person note the user has
	 * already written is the authoritative record; the model tier only runs when
	 * the vault has nothing, and what it produces is marked `source: model` in the
	 * note so a reader can always tell a recorded fact from a generated one. That
	 * distinction is the whole safeguard: model text about a named person may be
	 * confidently wrong, and the note is where someone will later act on it.
	 */
	async lookupPerson(name: string, passage: string, force = false, conversation?: Conversation): Promise<GlossaryEntry | null> {
		const clean = name.trim();
		if (!clean) return null;
		const key = `person:${normalizeTerm(clean)}`;

		if (!force) {
			const known = this.find(await this.all(), clean);
			if (known) return known;
			const inFlight = this.pending.get(key);
			if (inFlight) return inFlight;
		}

		const run = this.describeAndStore(clean, passage, conversation, force);
		this.pending.set(key, run);
		try {
			return await run;
		} finally {
			this.pending.delete(key);
		}
	}

	private async describeAndStore(
		name: string,
		passage: string,
		conversation?: Conversation,
		force = false
	): Promise<GlossaryEntry | null> {
		const notice = new Notice(t("personLookingUp", { name }), 0);
		try {
			const raw = await this.plugin.llmRouter.describePerson(name, passage, undefined, conversation);
			const { definition, variants, context } = parseDefinitionReply(raw);
			if (!definition) return null;
			const entry: GlossaryEntry = {
				term: name,
				kind: "person",
				definition,
				source: "model",
				updatedAt: new Date().toISOString(),
				model: this.plugin.llmRouter.fastModelFor(),
				// Name variants only — a person has no translations.
				aliases: dedupeAliases(name, variants),
				contexts: context ? [context] : undefined,
				theme: conversation ? [effectiveTheme(conversation)] : undefined,
				language: detectLanguage(definition) ?? undefined,
			};
			return await this.save(entry, force);
		} catch (e) {
			new Notice(t("personLookupFailed", { error: e instanceof Error ? e.message : String(e) }));
			return null;
		} finally {
			notice.hide();
		}
	}

	private async defineAndStore(
		term: string,
		passage: string,
		conversation?: Conversation,
		force = false
	): Promise<GlossaryEntry | null> {
		const notice = new Notice(t("glossaryLookingUp", { term }), 0);
		try {
			// Provider stays unset on purpose: a lookup runs on the default
			// provider's fast model regardless of which conversation it was
			// triggered from (the stored entry records that model). The
			// conversation is passed for its language override only (ADR-148).
			const raw = await this.plugin.llmRouter.defineTerm(term, passage, undefined, conversation);
			const { definition, variants, translations, context } = parseDefinitionReply(raw);
			if (!definition) return null;
			const entry: GlossaryEntry = {
				term,
				definition,
				source: "model",
				updatedAt: new Date().toISOString(),
				// The model that answered, not the conversation's chat model: lookups
				// run on the provider's fast model, and the anchor used to name the
				// default Anthropic model even on an OpenAI vault (ADR-144).
				model: this.plugin.llmRouter.fastModelFor(),
				aliases: dedupeAliases(term, variants),
				translations: dedupeTranslations(term, variants, translations),
				contexts: context ? [context] : undefined,
				theme: conversation ? [effectiveTheme(conversation)] : undefined,
				language: detectLanguage(definition) ?? undefined,
			};
			return await this.save(entry, force);
		} catch (e) {
			new Notice(t("glossaryLookupFailed", { error: e instanceof Error ? e.message : String(e) }));
			return null;
		} finally {
			notice.hide();
		}
	}

	/**
	 * Write one term note, merging into what is already there.
	 *
	 * Read-modify-write against the file rather than the cache, so a hand edit
	 * made between two lookups is never clobbered by a stale copy — and `merge`
	 * rather than replace, so a term met in a second conversation gains a theme
	 * and a context instead of losing the first one's.
	 *
	 * Frontmatter is written through `processFrontMatter`, which merges into the
	 * existing block: a property the user added by hand survives our write.
	 */
	async save(entry: GlossaryEntry, force = false): Promise<GlossaryEntry> {
		const app = this.plugin.app;
		const path = termPath(this.root, entry.term, entry.kind);
		await this.plugin.noteWriter.ensureFolder(folderOf(path));

		const existingFile = app.vault.getAbstractFileByPath(path);
		let merged = entry;
		if (existingFile instanceof TFile) {
			const raw = await app.vault.read(existingFile);
			const body = parseBody(stripFrontmatter(raw));
			const current = entryFromFrontmatter(existingFile.basename, app.metadataCache.getFileCache(existingFile)?.frontmatter, body);
			merged = mergeEntry(current, entry, force);
			await app.vault.modify(existingFile, renderBody(merged));
		} else {
			await app.vault.create(path, renderBody(merged));
		}

		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				Object.assign(fm, entryFrontmatter(merged));
			});
		}
		for (const theme of merged.theme ?? []) await this.ensureThemeNote(theme);
		this.invalidate();
		return merged;
	}

	/**
	 * The definition in `lang`, from the note's cache or translated now and cached
	 * (ADR-166). Null when it cannot be had — the caller shows the stored text.
	 *
	 * The cache is the note itself (`definition_<lang>` + `translated_from`), so it
	 * syncs, is a Base column, and can be corrected by hand. A translation made
	 * from an older definition is stale by its hash; the first new translation
	 * clears every stale language at once rather than leaving them to mislead.
	 */
	async translate(entry: GlossaryEntry, lang: string): Promise<string | null> {
		const cached = cachedTranslation(entry, lang);
		if (cached) return cached;
		const key = `translate:${entry.kind ?? "term"}:${normalizeTerm(entry.term)}:${lang}:${definitionHash(entry.definition)}`;
		// Obsidian re-parses the frontmatter we just wrote asynchronously; until it
		// has, the note still reads as untranslated. Keyed by the definition's hash,
		// so an edit is never answered from here.
		const recent = this.recentTranslations.get(key);
		if (recent) return recent;
		const inFlight = this.pendingTranslations.get(key);
		if (inFlight) return inFlight;
		const run = this.translateAndStore(entry, lang);
		this.pendingTranslations.set(key, run);
		try {
			const text = await run;
			if (text) this.recentTranslations.set(key, text);
			return text;
		} finally {
			this.pendingTranslations.delete(key);
		}
	}

	private async translateAndStore(entry: GlossaryEntry, lang: string): Promise<string | null> {
		try {
			const text = (await this.plugin.llmRouter.translateDefinition(entry.definition, LANG_LABELS[lang] ?? lang)).trim();
			// "" is not a translation (ADR-158): say so, and let the anchor keep the original.
			if (!text) { new Notice(t("glossaryTranslateEmpty", { term: entry.term })); return null; }
			const file = this.plugin.app.vault.getAbstractFileByPath(termPath(this.root, entry.term, entry.kind));
			if (file instanceof TFile) {
				const source = definitionLanguageOf(entry);
				await this.plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) =>
					applyTranslation(fm, lang, text, entry.definition, source));
				this.invalidate();
			}
			return text;
		} catch (e) {
			new Notice(t("glossaryTranslateFailed", { error: e instanceof Error ? e.message : String(e) }));
			return null;
		}
	}

	/**
	 * Create the note a theme's terms link to, if it does not exist yet.
	 *
	 * It carries an embedded base filtered to itself, so the theme note *is* the
	 * deck rather than pointing at one. Never rewritten once created: the user
	 * owns it from then on, and a regenerating write would discard whatever they
	 * added underneath.
	 */
	async ensureThemeNote(theme: string): Promise<void> {
		const path = themePath(this.root, theme);
		if (this.plugin.app.vault.getAbstractFileByPath(path)) return;
		await this.plugin.noteWriter.ensureFolder(folderOf(path));
		const body =
			`---\ntype: ${THEME_TYPE}\n---\n\n` +
			"```base\n" +
			"filters:\n  and:\n    - 'type == \"term\"'\n    - 'theme.contains(this.file.link)'\n" +
			"views:\n  - type: cards\n    name: Deck\n  - type: table\n    name: All terms\n" +
			"```\n";
		try {
			await this.plugin.app.vault.create(path, body);
		} catch (e) {
			console.warn("[Pythia] theme note create failed:", e);
		}
	}

	/** Rename a theme note and let Obsidian rewrite every term's link to it.
	 *  Used when a conversation whose theme follows its name is renamed. */
	async renameTheme(from: string, to: string): Promise<void> {
		if (!from || !to || from === to) return;
		const file = this.plugin.app.vault.getAbstractFileByPath(themePath(this.root, from));
		if (!(file instanceof TFile)) return;
		const target = themePath(this.root, to);
		if (this.plugin.app.vault.getAbstractFileByPath(target)) return;
		try {
			// fileManager, not vault: this is the call that updates the [[links]] in
			// every term note pointing at the theme.
			await this.plugin.app.fileManager.renameFile(file, target);
			this.invalidate();
		} catch (e) {
			console.warn("[Pythia] theme rename failed:", e);
		}
	}

	/** Delete a term note. Used by the anchor's delete control. */
	async remove(term: string): Promise<void> {
		const entries = await this.all();
		const target = this.find(entries, term);
		const file = this.plugin.app.vault.getAbstractFileByPath(termPath(this.root, target?.term ?? term, target?.kind));
		if (!(file instanceof TFile)) return;
		// Trash rather than delete: a definition the user spent a lookup on should
		// be recoverable from the system trash like any other note.
		await this.plugin.app.vault.trash(file, true);
		this.invalidate();
	}

	/**
	 * Migrate the single-note glossary written by builds up to 2.13.x into one
	 * note per term (ADR-150).
	 *
	 * Non-destructive by design: the old note is left exactly as it is, and a term
	 * that already has a note is merged into rather than replaced. Running it
	 * twice is therefore safe, which matters because the only way a user finds out
	 * it worked is by looking.
	 */
	async migrateLegacyNote(): Promise<{ migrated: number; total: number }> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.legacyNotePath);
		if (!(file instanceof TFile)) return { migrated: 0, total: 0 };
		const legacy = parseGlossary(await this.plugin.app.vault.read(file));
		let migrated = 0;
		for (const entry of legacy) {
			try {
				await this.save(entry);
				migrated++;
			} catch (e) {
				console.error(`[Pythia] migrating "${entry.term}" failed:`, e);
			}
		}
		this.invalidate();
		return { migrated, total: legacy.length };
	}
}

/**
 * Keep only the variants worth storing: drop the canonical term itself (it is
 * already matched) and any repeat, case-insensitively.
 *
 * Returns undefined rather than an empty array so an entry with no variants
 * renders no `Forms:` line at all, leaving the note as it was before this
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

/**
 * Keep only the translations worth storing (ADR-149).
 *
 * Drops the term itself and anything already kept as a same-language form: the
 * model is asked to separate the two lists, and when it fails to, the form list
 * wins. A word appearing in both would otherwise be registered twice in the term
 * index — harmless for matching, but it would render in the note as if the term
 * were its own translation, which is what the split exists to prevent.
 */
function dedupeTranslations(
	term: string,
	variants: string[],
	translations: { lang: string; term: string }[]
): Translation[] | undefined {
	const taken = new Set<string>([normalizeTerm(term), ...variants.map(normalizeTerm)]);
	const kept: Translation[] = [];
	for (const t of translations) {
		const key = normalizeTerm(t.term);
		if (!key || taken.has(key)) continue;
		taken.add(key);
		kept.push({ lang: t.lang, term: t.term.trim() });
	}
	return kept.length > 0 ? kept : undefined;
}
