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
 *
 * **Visible fields vs. machine state (ADR-149).** Everything a reader — human or
 * another tool — needs to understand the term is written as visible markdown:
 * the definition, its other surface forms, its equivalents in other languages,
 * and the sentence it was met in. Only provenance (who wrote it, when, with
 * which model) hides in the `%% pythia: … %%` comment.
 *
 * That split is the whole point: an Obsidian comment is invisible to every
 * external reader, so a field stored there does not exist as far as any other
 * tool is concerned. Pythia's job is to capture terms; browsing and drilling
 * them is a solved problem elsewhere, and the note can only reach those tools
 * through content they can actually see.
 *
 * Labels are English (`Forms:`, `Translations:`, `Context:`) even in a German
 * vault, and named after ISO 12620's data categories rather than invented. They
 * are keys, not prose: a reader has to find them without per-vault
 * configuration, which a localized label cannot offer.
 */

/** One glossary entry. `term` is stored as written; matching is case-insensitive. */
export interface GlossaryEntry {
	term: string;
	definition: string;
	/** Where the definition came from, for display and for re-lookup decisions. */
	source: "model" | "manual";
	/** ISO 8601. Absent on entries a human wrote by hand without one. */
	updatedAt?: string;
	/** The model that actually wrote this definition (ADR-144). Absent on
	 *  hand-written entries and on entries stored before this was recorded. */
	model?: string;
	/**
	 * Other surface forms of the same term **in its own language**: inflections,
	 * plurals, declined forms ("Zählers", "Zählern"). Each is matched and marked
	 * exactly like the canonical term and resolves back to this one entry
	 * (ADR-136).
	 *
	 * Stored rather than derived because stemming is language-specific and
	 * lossy — German compounds in particular — and because a stored list can be
	 * corrected by hand in the note, which a stemmer cannot.
	 *
	 * **Cross-language equivalents no longer live here** (ADR-149). Until then
	 * "counter" and "Zählern" sat in one flat list, which made it impossible to
	 * say which language a form belonged to — tolerable while the vault was
	 * effectively bilingual, wrong once ADR-148 shipped six output languages.
	 * They are `translations` now; this list is same-language only.
	 */
	aliases?: string[];
	/**
	 * The term's equivalents in other languages, each tagged with the language it
	 * belongs to — SKOS's distinction between an `altLabel` (same language) and a
	 * label in another language, which is a property of the label, not a separate
	 * concept.
	 *
	 * Matched and marked exactly like an alias, so an Italian answer still marks
	 * "contatore" and opens the entry filed under "Zähler".
	 */
	translations?: Translation[];
	/**
	 * One sentence from the passage where the term was met, kept verbatim.
	 *
	 * ISO 12620 calls this a *context*: an attested example of the term in use.
	 * `defineTerm` is deliberately prompted to explain "the sense that applies
	 * here", which makes the definition dependent on a passage the entry does not
	 * otherwise keep — so the entry reads as decontextualized the moment it is
	 * seen anywhere but next to the answer it came from.
	 */
	context?: string;
}

/** One cross-language equivalent: an ISO 639-1 code and the term in that language. */
export interface Translation {
	/** ISO 639-1 code, lowercased ("en", "it"). */
	lang: string;
	term: string;
}

/** Marker line placed under a heading to record provenance without cluttering the prose. */
const META_PREFIX = "%% pythia:";

/**
 * Labels for the visible fields (ADR-149), named after ISO 12620 data
 * categories. Written in bold so they read as labels rather than prose, and
 * parsed case-insensitively with the bold markers optional, because the note is
 * hand-edited and someone will type `Context:` without the asterisks.
 */
const FIELD_LABELS = { forms: "Forms", translations: "Translations", context: "Context" } as const;

/**
 * Read one labelled field off a line, or null if the line is not that field.
 *
 * Bold markers are stripped before matching rather than pattern-matched around
 * the label, because `**Forms:**` puts the colon *inside* the emphasis while a
 * hand-typed `Forms:` has none at all — two shapes one regex handles badly and
 * a strip handles exactly.
 */
function readField(line: string, label: string): string | null {
	const bare = line.replace(/\*\*/g, "").trim();
	const m = new RegExp(`^${label}\\s*:\\s*(.+?)\\s*$`, "i").exec(bare);
	return m ? m[1] : null;
}

/** Separator between list items in a visible field. `·` is written; `|` and `,`
 *  are accepted because a hand-editing user will reach for them. */
function splitList(raw: string): string[] {
	const sep = raw.includes("\u00b7") ? "\u00b7" : raw.includes("|") ? "|" : ",";
	return raw.split(sep).map((x) => x.trim()).filter(Boolean);
}

/** Parse `en: counter · it: contatore` into language-tagged translations.
 *  An item with no `lang:` prefix is dropped rather than guessed at — a
 *  translation whose language is unknown cannot be used as one. */
function parseTranslations(raw: string): Translation[] {
	const out: Translation[] = [];
	for (const item of splitList(raw)) {
		const m = /^([A-Za-z]{2,3})\s*[:=]\s*(.+)$/.exec(item);
		if (!m) continue;
		const term = m[2].trim();
		if (term) out.push({ lang: m[1].toLowerCase(), term });
	}
	return out;
}

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
			const model = /\bmodel=(\S+?)(?:\s|%%|$)/.exec(meta);
			if (model) current.model = model[1];
			// `aliases=` runs to the closing `%%` because a surface form may contain
			// spaces, which is also why it is rendered last and separated by `|`.
			// Legacy: aliases used to live in this comment, invisible to every
			// external reader (ADR-149 moved them into the body). Still read, so a
			// glossary written by an earlier build keeps marking its variants; the
			// entry is rewritten into the new shape the next time it is defined.
			const aliases = /\baliases=(.*?)\s*%%\s*$/.exec(meta);
			if (aliases) {
				const list = aliases[1].split("|").map((a) => a.trim()).filter(Boolean);
				if (list.length > 0) current.aliases = [...(current.aliases ?? []), ...list];
			}
			continue;
		}
		if (current) {
			// Visible labelled fields (ADR-149). Matched before the line is treated
			// as definition prose, so they never end up inside the definition.
			const forms = readField(line, FIELD_LABELS.forms);
			if (forms !== null) {
				const list = splitList(forms);
				if (list.length > 0) current.aliases = [...(current.aliases ?? []), ...list];
				continue;
			}
			const translations = readField(line, FIELD_LABELS.translations);
			if (translations !== null) {
				const list = parseTranslations(translations);
				if (list.length > 0) current.translations = [...(current.translations ?? []), ...list];
				continue;
			}
			const context = readField(line, FIELD_LABELS.context);
			if (context !== null) {
				current.context = context.replace(/^[\u201c\u201e"']|[\u201d"']$/g, "").trim();
				continue;
			}
		}
		body.push(line);
	}
	flush();
	return entries.filter((e) => e.term.length > 0);
}

/**
 * Render one entry back to markdown.
 *
 * The comment carries provenance only; everything a reader needs is visible
 * markdown below the definition (ADR-149). Fields are omitted entirely when
 * empty rather than written as empty labels — a note full of `Forms:` lines with
 * nothing after them is worse than no label at all.
 */
function renderEntry(entry: GlossaryEntry): string {
	const meta = `${META_PREFIX} source=${entry.source}` +
		(entry.updatedAt ? ` updatedAt=${entry.updatedAt}` : "") +
		(entry.model ? ` model=${entry.model.replace(/\s+/g, "-")}` : "") + " %%";

	// Three classes of character cannot survive inside a visible field value:
	// a newline (a field is one line, so it would split the entry), the `·` and
	// `|` separators (they would split the item), and `%` (a stray `%%` in the
	// body opens an Obsidian comment and would swallow the rest of the note).
	const clean = (v: string) => v.replace(/[\r\n\u00b7|%]+/g, " ").trim();
	const forms = (entry.aliases ?? []).map(clean).filter(Boolean);
	const translations = (entry.translations ?? [])
		.filter((t) => t.lang && t.term)
		.map((t) => `${t.lang.toLowerCase()}: ${clean(t.term)}`);
	const context = entry.context ? clean(entry.context) : "";

	const fields = [
		forms.length > 0 ? `**${FIELD_LABELS.forms}:** ${forms.join(" \u00b7 ")}` : "",
		translations.length > 0 ? `**${FIELD_LABELS.translations}:** ${translations.join(" \u00b7 ")}` : "",
		context ? `**${FIELD_LABELS.context}:** ${context}` : "",
	].filter(Boolean);

	const tail = fields.length > 0 ? `\n\n${fields.join("\n")}` : "";
	return `## ${entry.term}\n${meta}\n\n${entry.definition.trim()}${tail}\n`;
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

/** The parts of an entry the matcher needs — so callers can index plain terms
 *  without constructing whole entries. */
export type TermSource = Pick<GlossaryEntry, "term"> & {
	aliases?: string[];
	translations?: Translation[];
};

/** Characters that must be escaped before a term goes into a RegExp. */
function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A surface-form index over the glossary: one matcher for every form of every
 * term, plus the map back from a matched form to the term that owns it.
 *
 * The map is the part aliases made necessary. Before them the matched text *was*
 * the term, so the painter could tag a mark with `match[0]` and the anchor could
 * look that up directly. With aliases the matched form is usually not the term
 * ("Zählern" → "Zähler"), so the resolution has to happen here, where both ends
 * are known, rather than at the two call sites.
 */
export interface TermIndex {
	/** One alternation over every surface form of every term. */
	matcher: RegExp;
	/** Normalized surface form → the canonical term it belongs to. */
	canonical: Map<string, string>;
}

/**
 * Build the index for a set of entries.
 *
 * One alternation rather than a pass per form, because with a large glossary the
 * painter runs this against every text node of every rendered message; N passes
 * would be N times the work for the same result.
 *
 * Longest first, so "Sparse Coding" wins over "Coding" when both are defined.
 * Sorting by length is what makes the alternation behave like longest-match,
 * since JavaScript alternation is first-match, not longest-match.
 *
 * Canonical terms are registered before any alias, so a term is never shadowed
 * by another entry's alias for it — order in the note must not decide which
 * definition a word opens.
 *
 * Boundaries are handled with lookarounds over a letter class rather than `\b`,
 * because `\b` is ASCII-only: it would happily match inside "Schrödinger" and
 * fail to bound German, Greek or Cyrillic terms correctly.
 *
 * Returns null for an empty glossary so callers can skip the walk entirely.
 */
export function buildTermIndex(entries: TermSource[]): TermIndex | null {
	const canonical = new Map<string, string>();
	const surfaces: string[] = [];

	const register = (form: string, term: string) => {
		const clean = form.trim();
		// One-character forms match far too much to be useful as a reading aid.
		if (clean.length < 2) return;
		const key = normalizeTerm(clean);
		if (canonical.has(key)) return;
		canonical.set(key, term);
		surfaces.push(clean);
	};

	for (const entry of entries) register(entry.term, entry.term.trim());
	for (const entry of entries) {
		const term = entry.term.trim();
		if (!term) continue;
		for (const alias of entry.aliases ?? []) register(alias, term);
		// A translation is a surface form like any other: an Italian answer should
		// mark "contatore" and open the entry filed under "Zähler" (ADR-149).
		for (const t of entry.translations ?? []) register(t.term, term);
	}

	if (surfaces.length === 0) return null;
	surfaces.sort((a, b) => b.length - a.length);

	const L = "\\p{L}\\p{N}_";
	const body = surfaces.map(escapeRegExp).join("|");
	return { matcher: new RegExp(`(?<![${L}])(?:${body})(?![${L}])`, "giu"), canonical };
}

/** Resolve a matched surface form back to the term that owns it. */
export function canonicalTerm(index: TermIndex, surface: string): string {
	return index.canonical.get(normalizeTerm(surface)) ?? surface;
}
