/**
 * The glossary: terms the user has looked up, stored as a note in the vault
 * (ADR-136).
 *
 * Everything here is pure — parsing, upserting and matching — so the format and
 * the matching rules can be tested without a vault or a rendered DOM. The vault
 * I/O and the model lookup live in `services/GlossaryService.ts`.
 *
 * **Why a vault note and not conversation state.** A term explained once should
 * be known everywhere afterwards, including in conversations that do not exist
 * yet, and should be correctable by hand when the model gets it wrong. Neither
 * is possible if the definition lives on the conversation that happened to ask.
 * The note is also a surface other tools can read.
 *
 * **Format: `## Term` followed by its definition.** Headings rather than a list
 * because Obsidian can link to `[[Glossary#Term]]`, and because a definition is
 * allowed to be several paragraphs. The file stays ordinary markdown that reads
 * correctly with no plugin installed.
 */

/** One glossary entry. `term` is stored as written; matching is case-insensitive. */
export interface GlossaryEntry {
	term: string;
	definition: string;
	/** Where the definition came from, for display and for re-lookup decisions. */
	source: "model" | "manual";
	/** ISO 8601. Absent on entries a human wrote by hand without one. */
	updatedAt?: string;
}

/** Marker line placed under a heading to record provenance without cluttering the prose. */
const META_PREFIX = "%% pythia:";

/** Case-folded key for lookup and de-duplication. */
export function normalizeTerm(term: string): string {
	return term.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/**
 * Parse a glossary note into entries.
 *
 * Tolerant by design: the file is meant to be hand-edited, so anything that is
 * not a recognised heading is treated as part of the preceding definition, and a
 * heading with no body yields an entry with an empty definition rather than
 * being dropped. Losing a user's hand-written entry to a strict parser would be
 * far worse than carrying an odd one through.
 */
export function parseGlossary(markdown: string): GlossaryEntry[] {
	const entries: GlossaryEntry[] = [];
	let current: GlossaryEntry | null = null;
	let body: string[] = [];

	const flush = () => {
		if (!current) return;
		current.definition = body.join("\n").trim();
		entries.push(current);
		body = [];
	};

	for (const line of markdown.split("\n")) {
		const heading = /^##\s+(.+?)\s*$/.exec(line);
		if (heading) {
			flush();
			current = { term: heading[1].trim(), definition: "", source: "manual" };
			continue;
		}
		if (!current) continue; // preamble above the first heading: title, frontmatter, notes
		const meta = line.trim().startsWith(META_PREFIX) ? line.trim() : null;
		if (meta) {
			// `%% pythia: source=model updatedAt=... %%` — an Obsidian comment, so it
			// stays invisible when the note is read normally.
			if (/\bsource=model\b/.test(meta)) current.source = "model";
			const at = /\bupdatedAt=(\S+?)(?:\s|%%|$)/.exec(meta);
			if (at) current.updatedAt = at[1];
			continue;
		}
		body.push(line);
	}
	flush();
	return entries.filter((e) => e.term.length > 0);
}

/** Render one entry back to markdown, including its provenance comment. */
function renderEntry(entry: GlossaryEntry): string {
	const meta = `${META_PREFIX} source=${entry.source}` +
		(entry.updatedAt ? ` updatedAt=${entry.updatedAt}` : "") + " %%";
	return `## ${entry.term}\n${meta}\n\n${entry.definition.trim()}\n`;
}

/**
 * Insert or replace one entry, returning the whole note.
 *
 * Replacing rewrites only the matched entry and leaves every other byte of the
 * file alone, including the preamble and the user's ordering, because this note
 * is expected to be edited by hand between writes.
 *
 * New entries are appended rather than sorted in: re-sorting a file someone
 * has arranged themselves is a destructive surprise, and ordering is something
 * they can do in the editor if they want it.
 */
export function upsertGlossaryEntry(markdown: string, entry: GlossaryEntry): string {
	const key = normalizeTerm(entry.term);
	const lines = markdown.split("\n");
	const headingAt: number[] = [];
	lines.forEach((line, i) => { if (/^##\s+.+/.test(line)) headingAt.push(i); });

	for (let h = 0; h < headingAt.length; h++) {
		const start = headingAt[h];
		const term = /^##\s+(.+?)\s*$/.exec(lines[start])?.[1] ?? "";
		if (normalizeTerm(term) !== key) continue;
		const end = h + 1 < headingAt.length ? headingAt[h + 1] : lines.length;
		const before = lines.slice(0, start).join("\n");
		const after = lines.slice(end).join("\n");
		return `${before}${before ? "\n" : ""}${renderEntry(entry)}${after ? "\n" + after.replace(/^\n+/, "") : ""}`;
	}

	const base = markdown.trimEnd();
	return `${base}${base ? "\n\n" : ""}${renderEntry(entry)}`;
}

/** Characters that must be escaped before a term goes into a RegExp. */
function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build one regular expression that matches any known term.
 *
 * One alternation rather than a pass per term, because with a large glossary the
 * painter runs this against every text node of every rendered message; N passes
 * would be N times the work for the same result.
 *
 * Longest first, so "Sparse Coding" wins over "Coding" when both are defined.
 * Sorting by length is what makes the alternation behave like longest-match,
 * since JavaScript alternation is first-match, not longest-match.
 *
 * Boundaries are handled with lookarounds over a letter class rather than `\b`,
 * because `\b` is ASCII-only: it would happily match inside "Schrödinger" and
 * fail to bound German, Greek or Cyrillic terms correctly.
 *
 * Returns null for an empty glossary so callers can skip the walk entirely.
 */
export function buildTermMatcher(terms: string[]): RegExp | null {
	const seen = new Set<string>();
	const usable = terms
		.map((t) => t.trim())
		.filter((t) => {
			// One-character terms match far too much to be useful as a reading aid.
			if (t.length < 2) return false;
			const key = normalizeTerm(t);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort((a, b) => b.length - a.length);
	if (usable.length === 0) return null;

	const L = "\\p{L}\\p{N}_";
	const body = usable.map(escapeRegExp).join("|");
	return new RegExp(`(?<![${L}])(?:${body})(?![${L}])`, "giu");
}
