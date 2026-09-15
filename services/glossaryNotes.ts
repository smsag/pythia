import type { EntryKind, GlossaryEntry, Translation } from "./glossary";
import type { Conversation } from "../models/types";

/**
 * The glossary as a folder of notes (ADR-150).
 *
 * Everything here is pure — paths, frontmatter mapping, body rendering and the
 * merge rule — so the storage format can be tested without a vault. The vault
 * I/O lives in `services/GlossaryService.ts`.
 *
 * **Why one note per term.** Obsidian's own query surfaces — Bases and Dataview
 * alike — treat a *file* as a row: "each row is a file, and each column is a
 * property of that file". Headings are not a scope in either. So a single
 * glossary note can never produce a per-term view, which is what a theme-filtered
 * deck is. One note per term is not a preference here; it is the precondition for
 * the feature.
 *
 * What that buys beyond decks: `aliases` becomes Obsidian's **native** property,
 * so search, autocomplete and linking work with no code of ours; backlinks answer
 * "where did I meet this term"; and two people enriching different terms touch
 * different files instead of conflicting on one.
 */

export const TERMS_SUBFOLDER = "Terms";
export const THEMES_SUBFOLDER = "Themes";
export const PEOPLE_SUBFOLDER = "People";

/** Frontmatter `type`, so one Base can separate terms from the person entities
 *  that follow in ADR-151 without a second folder convention. */
export const TERM_TYPE = "term";
export const THEME_TYPE = "theme";
export const PERSON_TYPE = "person";

/** Characters no vault can carry in a file name, plus the ones Obsidian reserves
 *  for links. The true term survives in the `aliases` property, so a sanitized
 *  file name never loses it. */
export function sanitizeFileName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]/g, "-")
		.replace(/\s+/g, " ")
		.replace(/^\.+/, "")
		.trim()
		.slice(0, 120);
}

/** The folder part of a vault path — what `NoteWriter.ensureFolder` expects. */
export function folderOf(path: string): string {
	const cut = path.lastIndexOf("/");
	return cut === -1 ? "" : path.slice(0, cut);
}

/** Vault path of the note holding `term`. */
export function termPath(root: string, term: string, kind: EntryKind = "term"): string {
	const folder = kind === "person" ? PEOPLE_SUBFOLDER : TERMS_SUBFOLDER;
	return `${root}/${folder}/${sanitizeFileName(term)}.md`;
}

/** The folder an entry of this kind is filed in, relative to the glossary root. */
export function subfolderFor(kind: EntryKind): string {
	return kind === "person" ? PEOPLE_SUBFOLDER : TERMS_SUBFOLDER;
}

/** Vault path of the note for `theme`. */
export function themePath(root: string, theme: string): string {
	return `${root}/${THEMES_SUBFOLDER}/${sanitizeFileName(theme)}.md`;
}

/** `term_en`, `term_it` — one property per language rather than a nested object.
 *  Obsidian properties have no object type, and a flat key becomes a column in a
 *  Base, which a list of "en: counter" strings cannot. The set is finite: the six
 *  languages of ADR-148. */
export function translationKey(lang: string): string {
	return `term_${lang.toLowerCase()}`;
}

/** A wikilink to a theme note, as stored in a term's `theme` property. */
export function themeLink(theme: string): string {
	return `[[${sanitizeFileName(theme)}]]`;
}

/** The theme name inside a `[[…]]` link, or the value unchanged if it is bare. */
export function themeName(link: string): string {
	return /^\[\[(.+?)\]\]$/.exec(link.trim())?.[1]?.trim() ?? link.trim();
}

/** Coerce a frontmatter value that may be a scalar, a list, or absent. */
function toList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
	if (typeof value === "string" && value.trim()) return [value.trim()];
	return [];
}

/**
 * The frontmatter an entry writes.
 *
 * Returned as a plain object for `fileManager.processFrontMatter` to merge, so a
 * property a user added by hand is never dropped by our write.
 */
export function entryFrontmatter(entry: GlossaryEntry): Record<string, unknown> {
	const fm: Record<string, unknown> = { type: entry.kind === "person" ? PERSON_TYPE : TERM_TYPE };
	fm.aliases = entry.aliases ?? [];
	fm.theme = (entry.theme ?? []).map(themeLink);
	for (const t of entry.translations ?? []) fm[translationKey(t.lang)] = t.term;
	fm.source = entry.source;
	if (entry.updatedAt) fm.updated = entry.updatedAt;
	if (entry.model) fm.model = entry.model;
	return fm;
}

/** Rebuild an entry from a note's frontmatter. `definition` and `contexts` come
 *  from the body, which the caller reads separately — the index only needs the
 *  frontmatter, and reading every body to paint one message would not scale. */
export function entryFromFrontmatter(
	term: string,
	fm: Record<string, unknown> | undefined,
	body?: { definition: string; contexts: string[] }
): GlossaryEntry {
	const f = fm ?? {};
	const translations: Translation[] = [];
	for (const [key, value] of Object.entries(f)) {
		const lang = /^term_([a-z]{2,3})$/i.exec(key)?.[1];
		if (lang && typeof value === "string" && value.trim()) {
			translations.push({ lang: lang.toLowerCase(), term: value.trim() });
		}
	}
	const aliases = toList(f.aliases);
	const theme = toList(f.theme).map(themeName);
	return {
		term,
		definition: body?.definition ?? "",
		kind: f.type === PERSON_TYPE ? "person" : "term",
		source: f.source === "model" ? "model" : "manual",
		updatedAt: typeof f.updated === "string" ? f.updated : undefined,
		model: typeof f.model === "string" ? f.model : undefined,
		aliases: aliases.length > 0 ? aliases : undefined,
		translations: translations.length > 0 ? translations : undefined,
		theme: theme.length > 0 ? theme : undefined,
		contexts: body && body.contexts.length > 0 ? body.contexts : undefined,
	};
}

/**
 * Render a term note's body: the definition, then one blockquote per context.
 *
 * Contexts are blockquotes rather than a property because they are prose, there
 * can be several — a term met in three conversations has three — and a property
 * that grows without bound makes a useless Base column.
 */
export function renderBody(entry: GlossaryEntry): string {
	const definition = entry.definition.trim();
	const quotes = (entry.contexts ?? [])
		.map((c) => c.replace(/[\r\n]+/g, " ").trim())
		.filter(Boolean)
		.map((c) => `> ${c}`);
	return quotes.length > 0 ? `${definition}\n\n${quotes.join("\n\n")}\n` : `${definition}\n`;
}

/** Split a term note's body back into its definition and its context quotes.
 *  Frontmatter must already be stripped by the caller. */
export function parseBody(body: string): { definition: string; contexts: string[] } {
	const definition: string[] = [];
	const contexts: string[] = [];
	for (const line of body.split("\n")) {
		const quote = /^>\s?(.*)$/.exec(line);
		if (quote) {
			const text = quote[1].trim();
			if (text) contexts.push(text);
			continue;
		}
		definition.push(line);
	}
	return { definition: definition.join("\n").trim(), contexts };
}

/** Strip a leading YAML frontmatter block, returning the body alone. */
export function stripFrontmatter(markdown: string): string {
	return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/**
 * Merge a freshly looked-up entry into the one already on disk.
 *
 * **Merge, never overwrite** is the rule that makes a term met in several
 * conversations one note rather than several, and it is also what protects a
 * hand-corrected definition: a re-lookup adds themes and contexts but keeps a
 * `manual` definition as written. `force` (the anchor's regenerate control) is
 * the one path allowed to replace it, because the user asked for exactly that.
 */
export function mergeEntry(
	existing: GlossaryEntry | null,
	incoming: GlossaryEntry,
	force = false
): GlossaryEntry {
	if (!existing) return incoming;
	const keepDefinition = existing.source === "manual" && !force;
	const union = (a: string[] = [], b: string[] = []): string[] | undefined => {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const v of [...a, ...b]) {
			const key = v.trim().toLocaleLowerCase();
			if (!key || seen.has(key)) continue;
			seen.add(key);
			out.push(v.trim());
		}
		return out.length > 0 ? out : undefined;
	};
	const translations = [...(existing.translations ?? [])];
	for (const t of incoming.translations ?? []) {
		if (!translations.some((x) => x.lang === t.lang)) translations.push(t);
	}
	return {
		term: existing.term,
		definition: keepDefinition ? existing.definition : incoming.definition,
		source: keepDefinition ? existing.source : incoming.source,
		updatedAt: keepDefinition ? existing.updatedAt : incoming.updatedAt,
		model: keepDefinition ? existing.model : incoming.model,
		aliases: union(existing.aliases, incoming.aliases),
		translations: translations.length > 0 ? translations : undefined,
		theme: union(existing.theme, incoming.theme),
		contexts: union(existing.contexts, incoming.contexts),
	};
}

/**
 * The theme a conversation files its terms under (ADR-150).
 *
 * `undefined` means **follow the conversation name**, and is resolved here rather
 * than written onto the conversation at creation: a stored copy would stop
 * following the name the moment the title is generated after the first exchange,
 * which is precisely when the name stops being "New Conversation".
 */
export function effectiveTheme(conversation: Conversation): string {
	return (conversation.theme ?? conversation.name ?? "").trim();
}
