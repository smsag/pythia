import type { EntryKind, GlossaryEntry, Translation } from "./glossary";
import { normalizeTerm } from "./glossary";
import type { Conversation } from "../models/types";
import { detectLanguage } from "./languageDetect";

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

/** `definition_de`, `definition_it` — a translated definition cached in the note
 *  (ADR-166). Flat for the same reason as `term_<lang>`: a flat key is a column in
 *  a Base. */
export function definitionKey(lang: string): string {
	return `definition_${lang.toLowerCase()}`;
}

/** The property recording which definition the cached translations were made from. */
export const TRANSLATED_FROM_KEY = "translated_from";

/**
 * A short fingerprint of a definition (FNV-1a, 32 bit, hex). Stored beside the
 * cached translations so an edit to the definition — by regenerate or by hand —
 * makes them stale without anyone having to remember to clear them.
 */
export function definitionHash(definition: string): string {
	let h = 0x811c9dc5;
	for (const ch of definition.trim()) {
		h ^= ch.codePointAt(0)!;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

/** The cached translation of `entry`'s definition into `lang`, or null when there
 *  is none or it was made from a definition that has since changed. */
export function cachedTranslation(entry: GlossaryEntry, lang: string): string | null {
	const text = entry.definitionTranslations?.[lang];
	if (!text || !entry.definition.trim()) return null;
	return entry.translatedFrom === definitionHash(entry.definition) ? text : null;
}

/**
 * Write one translation into a note's frontmatter (ADR-166), for
 * `processFrontMatter`. When the stored hash is not this definition's, every
 * `definition_<lang>` there was made from an older text: all are dropped before
 * the new one is set, so a stale language cannot survive beside a fresh one.
 *
 * `term` is the term's own equivalent in that language (ADR-206), recorded so
 * the index marks it from then on. It is **not** cleared by the staleness sweep
 * above and never overwrites a value already in the file: a surface form does
 * not expire when the definition is reworded, and the one in the note may have
 * been corrected by hand — which is the whole promise of a property.
 */
export function applyTranslation(
	fm: Record<string, unknown>,
	lang: string,
	text: string,
	definition: string,
	sourceLanguage: string | null,
	term?: string | null,
): void {
	const hash = definitionHash(definition);
	if (fm[TRANSLATED_FROM_KEY] !== hash) {
		for (const k of Object.keys(fm)) if (/^definition_[a-z]{2,3}$/i.test(k)) delete fm[k];
	}
	fm[definitionKey(lang)] = text;
	fm[TRANSLATED_FROM_KEY] = hash;
	if (!fm.language && sourceLanguage) fm.language = sourceLanguage;
	if (term && !fm[translationKey(lang)]) fm[translationKey(lang)] = term;
}

/**
 * Whether a term the translation call came back with is a surface form worth
 * recording — and null whenever it is not (ADR-206).
 *
 * Every rejection here is a mark the reader would otherwise meet in the wrong
 * place. A form equal to the term itself says only that the word travels
 * unchanged; one that repeats an alias is already in the index; and a language
 * the entry already answers for is settled, possibly by hand, so a model's
 * second opinion must not quietly replace it.
 *
 * A person is excluded at the call site rather than here: a name is not
 * translated, so the question never arises.
 */
export function newTranslation(
	entry: GlossaryEntry,
	lang: string,
	term: string,
): Translation | null {
	const form = term.trim();
	if (!form) return null;
	const key = normalizeTerm(form);
	if (key === normalizeTerm(entry.term)) return null;
	if (entry.translations?.some((t) => t.lang === lang)) return null;
	if ((entry.aliases ?? []).some((a) => normalizeTerm(a) === key)) return null;
	if (entry.translations?.some((t) => normalizeTerm(t.term) === key)) return null;
	return { lang, term: form };
}

/** The language `entry`'s definition is written in: recorded, else detected. */
export function definitionLanguageOf(entry: GlossaryEntry): string | null {
	return entry.language ?? detectLanguage(entry.definition);
}

/**
 * The language an anchor should show a definition in (ADR-166): the language
 * the conversation instructs, or — under AUTO, which names none — the language
 * of the passage the term was tapped in. Null when neither can be told.
 */
export function displayLanguage(state: { instructed: boolean; code: string }, passage: string): string | null {
	return state.instructed ? state.code.toLowerCase() : detectLanguage(passage);
}

/** Whether showing `entry` in `target` needs a translation at all. An unknown
 *  source language translates: the model returns the text as it is if it
 *  already matches, and that answer is cached like any other. */
export function needsTranslation(entry: GlossaryEntry, target: string | null): target is string {
	if (!target || !entry.definition.trim()) return false;
	return definitionLanguageOf(entry) !== target;
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
	// The file name is the term — except when the term holds a character no file
	// name can ("C#", "A/B testing"). Then the note carries the real term as a
	// property, or the sanitized name would become the term everywhere: in the
	// index, the anchor title and the next lookup's miss.
	if (sanitizeFileName(entry.term) !== entry.term) fm.term = entry.term;
	fm.aliases = entry.aliases ?? [];
	fm.theme = (entry.theme ?? []).map(themeLink);
	for (const t of entry.translations ?? []) fm[translationKey(t.lang)] = t.term;
	fm.source = entry.source;
	// Translations are written by `GlossaryService.saveTranslation` alone; this
	// merge leaves them in place, and the hash marks them stale (ADR-166).
	if (entry.language) fm.language = entry.language;
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
	const definitionTranslations: Record<string, string> = {};
	for (const [key, value] of Object.entries(f)) {
		if (typeof value !== "string" || !value.trim()) continue;
		const lang = /^term_([a-z]{2,3})$/i.exec(key)?.[1];
		if (lang) translations.push({ lang: lang.toLowerCase(), term: value.trim() });
		const defLang = /^definition_([a-z]{2,3})$/i.exec(key)?.[1];
		if (defLang) definitionTranslations[defLang.toLowerCase()] = value.trim();
	}
	const language = typeof f.language === "string" && /^[a-z]{2,3}$/i.test(f.language.trim())
		? f.language.trim().toLowerCase()
		: undefined;
	const aliases = toList(f.aliases);
	const theme = toList(f.theme).map(themeName);
	const realTerm = typeof f.term === "string" && f.term.trim() ? f.term.trim() : term;
	return {
		term: realTerm,
		definition: body?.definition ?? "",
		kind: f.type === PERSON_TYPE ? "person" : "term",
		source: f.source === "model" ? "model" : "manual",
		updatedAt: typeof f.updated === "string" ? f.updated : undefined,
		model: typeof f.model === "string" ? f.model : undefined,
		aliases: aliases.length > 0 ? aliases : undefined,
		translations: translations.length > 0 ? translations : undefined,
		theme: theme.length > 0 ? theme : undefined,
		contexts: body && body.contexts.length > 0 ? body.contexts : undefined,
		language,
		definitionTranslations: Object.keys(definitionTranslations).length > 0 ? definitionTranslations : undefined,
		translatedFrom: typeof f[TRANSLATED_FROM_KEY] === "string" ? f[TRANSLATED_FROM_KEY] : undefined,
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
		// The language travels with the definition it describes.
		language: keepDefinition ? existing.language : incoming.language,
		definitionTranslations: existing.definitionTranslations,
		translatedFrom: existing.translatedFrom,
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
