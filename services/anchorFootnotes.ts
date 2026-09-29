import type { AnchorStatus, AnchorSummary } from "./chapterSummary";
import { formatDate } from "./messageUtils";
import { anchorLabel, findAnchors, maskCode, PYTHIA_FOOTNOTE_PREFIX, type AnchorRef } from "./noteAnchors";

/**
 * The footnote a note anchor carries (ADR-249) — in the note, and in the copy
 * a print or export makes of it. Pure: a string in, a string out.
 *
 *   „Rent cap scenarios › Index clause“ (Pythia, 29 Sep 2026) — The cap …
 *
 * Two operations, deliberately apart:
 *
 *  • `updateNoteFootnotes` edits the NOTE. It touches only what is Pythia's —
 *    a `[^pythia-…]` reference directly after an anchor, and the definitions
 *    with that prefix — found by that literal label, never by a pattern over
 *    the user's prose. The author's own footnotes, orphans included, are
 *    never touched.
 *  • `withExportFootnotes` makes a COPY for print or export and never writes.
 *    The link becomes plain highlighted text (an `obsidian://` address is
 *    useless on paper), and every footnote — the author's and Pythia's — is
 *    renumbered 1…n in order of first reference, the order a Markdown renderer
 *    numbers them in. So the copy reads the same whichever renderer prints it.
 */

/** Quote marks by the summary's language; English marks for any other. */
export function quoteMarks(language: string | undefined): [string, string, string, string] {
	switch (language) {
		case "de": return ["„", "“", "‚", "‘"];
		case "it":
		case "es":
		case "fr": return ["«", "»", "‹", "›"];
		default: return ["“", "”", "‘", "’"];
	}
}

/** The footnote's fixed words, in the languages a summary is written in. */
const WORDS: Record<string, { none: string; deleted: string }> = {
	en: { none: "No summary yet.", deleted: "Conversation deleted." },
	de: { none: "Noch keine Zusammenfassung.", deleted: "Unterhaltung gelöscht." },
	it: { none: "Ancora nessun riassunto.", deleted: "Conversazione eliminata." },
	es: { none: "Todavía no hay resumen.", deleted: "Conversación eliminada." },
};

/** Where a conversation name is shortened; the chapter name is kept whole. */
export const FOOTNOTE_NAME_CHARS = 60;

/** A name made safe inside the footnote: one line, its own quote marks swapped
 *  for the inner pair, and nothing that Markdown would read as markup. */
function cleanName(name: string, language: string | undefined, max?: number): string {
	const [open, close, innerOpen, innerClose] = quoteMarks(language);
	let flat = name.replace(/\s+/g, " ").trim();
	if (max !== undefined && flat.length > max) flat = `${flat.slice(0, max - 1).trimEnd()}…`;
	return flat
		.split(open).join(innerOpen)
		.split(close).join(innerClose)
		.replace(/([[\]\\*_`])/g, "\\$1")
		.replace(/==/g, "=\\=");
}

/** Prose on one line, with nothing that would open a footnote or a link. */
function cleanProse(text: string): string {
	return text.replace(/\s+/g, " ").trim().replace(/([[\]\\])/g, "\\$1");
}

/**
 * THE footnote text — the only place its format is written. `fallbackLanguage`
 * words a footnote that has no summary to take the language from.
 */
export function footnoteText(info: AnchorSummary, fallbackLanguage = "en"): string {
	const language = info.state === "ok" ? info.language ?? fallbackLanguage : fallbackLanguage;
	const [open, close] = quoteMarks(language);
	const name = info.conversationName ? cleanName(info.conversationName, language, FOOTNOTE_NAME_CHARS) : "";
	const chapter = info.chapterName ? cleanName(info.chapterName, language) : "";
	const title = name ? (chapter ? `${name} › ${chapter}` : name) : "";
	const date = info.state === "ok" && info.date ? formatDate(info.date) : "";
	const head = `${title ? `${open}${title}${close} ` : ""}(Pythia${date ? `, ${date}` : ""})`;
	const words = WORDS[language] ?? WORDS.en;
	const body = info.state === "ok" && info.summary ? cleanProse(info.summary) : info.state === "deleted" ? words.deleted : words.none;
	return `${head} — ${body}`;
}

/** Resolves an anchor to what its footnote says. */
export type AnchorResolver = (ref: AnchorRef) => AnchorSummary;

const DEF_RE = /^ {0,3}\[\^([^\]\s]+)\]:/;
const pythiaLabel = (label: string): boolean => label.startsWith(PYTHIA_FOOTNOTE_PREFIX);

/** `markdown` without Pythia's definitions and without any Pythia reference
 *  that no longer follows an anchor — the parts Pythia owns and rewrites. */
function stripPythiaFootnotes(markdown: string): string {
	const masked = maskCode(markdown).split("\n");
	const kept = markdown.split("\n").filter((_line, i) => {
		const m = masked[i].match(DEF_RE);
		return !(m && pythiaLabel(m[1]));
	});
	return kept.join("\n");
}

/** Every `[^pythia-…]` reference that is not attached to an anchor, removed. */
function stripStrayReferences(markdown: string): string {
	const attached = new Set(findAnchors(markdown).filter((a) => a.footnoteLabel).map((a) => a.end));
	const masked = maskCode(markdown);
	let out = "";
	let last = 0;
	for (const m of masked.matchAll(/\[\^(pythia-[a-z0-9]+)\]/g)) {
		const end = (m.index ?? 0) + m[0].length;
		if (attached.has(end)) continue;
		out += markdown.slice(last, m.index);
		last = end;
	}
	return out + markdown.slice(last);
}

/** `body` with `definitions` appended as the last block of the note. */
function appendDefinitions(body: string, definitions: string[]): string {
	const trimmed = body.replace(/\s+$/, "");
	if (definitions.length === 0) return trimmed === "" ? "" : `${trimmed}\n`;
	return `${trimmed}${trimmed ? "\n\n" : ""}${definitions.join("\n")}\n`;
}

/** One change to a note, in offsets into the text as it was read. */
export interface TextEdit {
	start: number;
	end: number;
	text: string;
}

/** `markdown` with non-overlapping `edits` applied. */
export function applyEdits(markdown: string, edits: TextEdit[]): string {
	let out = "";
	let last = 0;
	for (const e of [...edits].sort((x, y) => x.start - y.start)) {
		out += markdown.slice(last, e.start) + e.text;
		last = e.end;
	}
	return out + markdown.slice(last);
}

/**
 * The changes that put every anchor's footnote in place and make it current —
 * as EDITS, so an open editor can apply them as one transaction without
 * replacing the text around them (the cursor stays where the user left it).
 *
 * Touches only what is Pythia's: the `[^pythia-…]` reference after an anchor,
 * a `[^pythia-…]` reference no anchor owns any more, and the `[^pythia-…]:`
 * definitions, which live as the note's last block. Empty when nothing is to
 * change — a second run after the first always is.
 */
export function noteFootnoteEdits(markdown: string, resolve: AnchorResolver, fallbackLanguage = "en"): TextEdit[] {
	const masked = maskCode(markdown);
	const anchors = findAnchors(markdown);
	if (anchors.length === 0 && !/\[\^pythia-[a-z0-9]+\]/.test(masked)) return [];

	// Pythia's definition lines, as [start, end-including-newline).
	const lines = masked.split("\n");
	const defLines: { start: number; end: number }[] = [];
	let at = 0;
	for (const line of lines) {
		const m = line.match(DEF_RE);
		if (m && pythiaLabel(m[1])) defLines.push({ start: at, end: Math.min(at + line.length + 1, markdown.length) });
		at += line.length + 1;
	}
	const inDefLine = (i: number): boolean => defLines.some((d) => i >= d.start && i < d.end);

	const edits: TextEdit[] = [];
	const labels = new Map<string, AnchorRef>();
	const owned = new Set<number>();
	for (const a of anchors) {
		if (inDefLine(a.start)) continue;
		const label = anchorLabel(a.ref);
		if (!labels.has(label)) labels.set(label, a.ref);
		const ref = `[^${label}]`;
		if (markdown.slice(a.markupEnd, a.end) !== ref) edits.push({ start: a.markupEnd, end: a.end, text: ref });
		if (a.footnoteLabel) owned.add(a.markupEnd);
	}
	for (const m of masked.matchAll(/\[\^(pythia-[a-z0-9]+)\](?!:)/g)) {
		const i = m.index ?? 0;
		if (owned.has(i) || inDefLine(i)) continue;
		edits.push({ start: i, end: i + m[0].length, text: "" });
	}

	// The tail: the trailing run of Pythia definitions and blank lines. It is
	// rewritten as a whole; a Pythia definition anywhere else is removed.
	let tailStart = markdown.length;
	for (let i = lines.length - 1, end = markdown.length; i >= 0; i--) {
		const start = end - lines[i].length;
		const own = defLines.some((d) => d.start === start);
		if (lines[i].trim() !== "" && !own) break;
		tailStart = start;
		end = start - 1;
	}
	// Keep the newline that ends the last line of the body.
	if (tailStart > 0 && markdown[tailStart - 1] === "\n") tailStart -= 1;
	for (const d of defLines) if (d.start < tailStart) edits.push({ start: d.start, end: d.end, text: "" });

	const definitions = [...labels].map(([label, ref]) => `[^${label}]: ${footnoteText(resolve(ref), fallbackLanguage)}`);
	const bodyEmpty = markdown.slice(0, tailStart).trim() === "";
	const tail = definitions.length === 0
		? (bodyEmpty ? "" : "\n")
		: `${bodyEmpty ? "" : "\n\n"}${definitions.join("\n")}\n`;
	if (markdown.slice(tailStart) !== tail) edits.push({ start: tailStart, end: markdown.length, text: tail });
	return edits;
}

/** The note with every anchor's footnote in place and current — the edits
 *  applied. Idempotent, and a note Pythia has nothing in is returned unchanged. */
export function updateNoteFootnotes(markdown: string, resolve: AnchorResolver, fallbackLanguage = "en"): string {
	const edits = noteFootnoteEdits(markdown, resolve, fallbackLanguage);
	return edits.length === 0 ? markdown : applyEdits(markdown, edits);
}

/** Counts for a print preview. `links` counts anchors; `outdated` and `missing`
 *  count targets (a chapter linked twice is one summary to refresh). `missing`
 *  is every footnote that will say "no summary" or "deleted". */
export interface ExportInspection {
	links: number;
	outdated: number;
	missing: number;
}

/** What a print preview shows before anything is refreshed: no model, no write. */
export function inspectAnchors(markdown: string, status: (ref: AnchorRef) => AnchorStatus): ExportInspection {
	const refs = uniqueRefs(markdown);
	const states = refs.map(status);
	return {
		links: findAnchors(markdown).length,
		outdated: states.filter((s) => s === "outdated").length,
		missing: states.filter((s) => s !== "ok" && s !== "outdated").length,
	};
}

/** Each target named in `markdown` once, in order of first appearance. */
export function uniqueRefs(markdown: string): AnchorRef[] {
	const seen = new Map<string, AnchorRef>();
	for (const a of findAnchors(markdown)) {
		const label = anchorLabel(a.ref);
		if (!seen.has(label)) seen.set(label, a.ref);
	}
	return [...seen.values()];
}

/**
 * A copy of the note for print or export: anchors as `==text==` with their
 * footnote, every footnote renumbered 1…n by first reference. Never writes.
 */
export function withExportFootnotes(markdown: string, resolve: AnchorResolver, fallbackLanguage = "en"): string {
	// Pythia's own footnotes out first — what stays is the author's and the anchors.
	const clean = stripStrayReferences(stripPythiaFootnotes(markdown));
	let body = "";
	let last = 0;
	const labels = new Map<string, AnchorRef>();
	for (const a of findAnchors(clean)) {
		const label = anchorLabel(a.ref);
		if (!labels.has(label)) labels.set(label, a.ref);
		body += clean.slice(last, a.start) + `==${a.text}==[^${label}]`;
		last = a.end;
	}
	body += clean.slice(last);
	const definitions = [...labels].map(([label, ref]) => `[^${label}]: ${footnoteText(resolve(ref), fallbackLanguage)}`);
	return renumberFootnotes(definitions.length > 0 ? appendDefinitions(body, definitions) : body);
}

/**
 * Every labelled footnote relabelled 1…n in order of first reference. An inline
 * footnote (`^[…]`) takes its number in the same sequence and stays inline; a
 * definition nothing references is numbered after the rest. Code is text.
 */
export function renumberFootnotes(markdown: string): string {
	const masked = maskCode(markdown);
	const lines = masked.split("\n");
	const defLines = new Set<number>();
	lines.forEach((line, i) => { if (DEF_RE.test(line)) defLines.add(i); });

	// Pass 1: numbers in order of first reference; definitions are not references.
	const numberOf = new Map<string, number>();
	let next = 1;
	lines.forEach((line, i) => {
		const scan = defLines.has(i) ? line.replace(DEF_RE, (m) => " ".repeat(m.length)) : line;
		for (const m of scan.matchAll(/\[\^([^\]\s]+)\]|(?<!\[)\^\[/g)) {
			if (m[1] === undefined) { next++; continue; }
			if (!numberOf.has(m[1])) numberOf.set(m[1], next++);
		}
	});
	for (const line of lines) {
		const d = line.match(DEF_RE);
		if (d && !numberOf.has(d[1])) numberOf.set(d[1], next++);
	}

	// Pass 2: relabel, at the masked positions, in the original text.
	let out = "";
	let last = 0;
	for (const m of masked.matchAll(/\[\^([^\]\s]+)\]/g)) {
		const n = numberOf.get(m[1]);
		if (n === undefined) continue;
		out += markdown.slice(last, m.index) + `[^${n}]`;
		last = (m.index ?? 0) + m[0].length;
	}
	return out + markdown.slice(last);
}
