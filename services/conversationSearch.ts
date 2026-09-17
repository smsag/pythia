import type { Conversation, Message } from "../models/types";
import { tokenize } from "./noteRelevance";
import { applyRelevanceFloor, matchStrength } from "./tokenMatch";
import { parseScope, shouldWiden, type SearchScope } from "./searchScope";

/** A message's textual content as a plain string, tolerating malformed records.
 *  Persistence only guarantees `messages` is an array (parseConversations) — not
 *  that each element is an object or that `content` is a string. An interrupted
 *  stream or a legacy entry can leave a null element or a non-string `content`;
 *  since the fields are built for every conversation up front, a single such
 *  record would otherwise throw and take the entire search down with it. */
function messageText(m: Message | null | undefined): string {
	return typeof m?.content === "string" ? m.content : "";
}

/** One message line with its tokens, for the match snippet. Tokenizing lines is
 *  the expensive half and lines never change between keystrokes, so the array is
 *  built once per conversation and reused (see `snippetLines`). */
export interface SnippetLine {
	text: string;
	tokens: string[];
}

/** One vault note this conversation touched, with its path tokenized once. */
export interface NoteRef {
	/** The vault path, for display and for telling the user WHY a row surfaced. */
	ref: string;
	tokens: string[];
}

/**
 * The searchable text of one conversation, split into the fields that carry
 * different amounts of signal (ADR-168). Splitting is what lets `note:` search
 * one dimension without a second index, and what replaces the old "title hit ×3"
 * special case with a weight per field.
 */
export interface ConversationFields {
	title: string[];
	/** The LLM-generated summary. The cheap half of "semantic" recall — the
	 *  model's own paraphrasing ("automobile", "Fahrzeug") already lives here, so
	 *  a lexical match can surface a conversation whose messages never used the
	 *  exact query word. */
	summary: string[];
	body: string[];
	notes: NoteRef[];
	/** Filled on the FIRST snippet request for this conversation, not up front.
	 *
	 *  Line tokens are the single most expensive thing this module produces — far
	 *  larger than the deduped field arrays, because every line keeps its own
	 *  array plus its text. Building them for the whole corpus on panel open
	 *  would trade a per-keystroke cost for a permanent memory one, on a device
	 *  that may be a phone. Only conversations that actually render as a result
	 *  ever pay, and the panel shows at most `SEARCH_RESULT_LIMIT` of them. */
	lines: SnippetLine[] | null;
}

/** Search results rendered at once.
 *
 *  A cap, not a filter — the same rule ADR-169 applied to related conversations:
 *  the number of conversations matching a short query grows with the corpus, so
 *  an uncapped list makes the render cost (and the snippet scan behind every
 *  row) a function of vault size rather than of relevance. Measured before the
 *  cap: 398ms per keystroke at 500 conversations, 99% of it snippets. */
export const SEARCH_RESULT_LIMIT = 20;

/** The fields that are SCORED, as opposed to `lines`, which is a render cache.
 *  Naming them separately is what stops a cache slot from silently becoming a
 *  weighted field — the compiler now refuses the confusion. */
export type ScoredField = "title" | "summary" | "body" | "notes";

/** How much a hit in each field is worth, as a multiplier on the token's IDF.
 *
 *  `title` keeps the ×3 it has always had. `notes` is high for the same reason
 *  a title is: a note name is a deliberate, curated label, not prose — and
 *  unlike prose it was chosen by the user, not generated. */
export const FIELD_WEIGHTS: Record<ScoredField, number> = {
	title: 3,
	notes: 2,
	summary: 1,
	body: 1,
};

/** Which fields a scope scores. `notes` alone is the `note:` query; `all` is
 *  everything; the default is what search has always looked at. */
export function scopeFields(scope: SearchScope): ScoredField[] {
	if (scope === "notes") return ["notes"];
	if (scope === "all") return ["title", "summary", "body", "notes"];
	return ["title", "summary", "body"];
}

/**
 * Every vault note this conversation touched: attached to a turn, cited by the
 * model, or used as its template.
 *
 * All three are already persisted per message, so the note dimension costs no
 * vault I/O at all — the paths are in `data.json`. Attachments and citations
 * are weighted the same: a citation is at least as strong evidence that the
 * conversation was ABOUT that note, since the model reached for it while
 * answering rather than merely being handed it.
 *
 * Deduped: a note attached to thirty turns is one signal, not thirty.
 */
export function noteRefs(conv: Conversation): string[] {
	const out = new Set<string>();
	const messages = Array.isArray(conv.messages) ? conv.messages : [];
	for (const m of messages) {
		for (const p of m?.attachedNotes ?? []) if (typeof p === "string" && p) out.add(p);
		for (const s of m?.sources ?? []) {
			if (s?.kind === "vault" && typeof s.ref === "string" && s.ref) out.add(s.ref);
		}
		if (typeof m?.templateId === "string" && m.templateId) out.add(m.templateId);
	}
	return [...out];
}

/**
 * Tokenize one conversation into its searchable fields.
 *
 * Defensive by design: it runs over the whole corpus, so it must never throw on
 * a malformed conversation (missing name, absent/ragged messages, non-string
 * content) — one bad record must not blank out all search results.
 *
 * No embeddings, no vector store, no persisted index.
 */
export function buildConversationFields(conv: Conversation): ConversationFields {
	const messages = Array.isArray(conv.messages) ? conv.messages : [];
	return {
		title: tokenize(typeof conv.name === "string" ? conv.name : ""),
		summary: tokenize(typeof conv.summaryText === "string" ? conv.summaryText : ""),
		body: tokenize(messages.map(messageText).join(" ")),
		// The extension is stripped before tokenizing, or every note would carry
		// an "md" token and a search for "md" would return the whole vault. Folder
		// segments are kept: they are how people file things.
		notes: noteRefs(conv).map((ref) => ({ ref, tokens: tokenize(ref.replace(/\.md$/i, "")) })),
		lines: null,
	};
}

export interface RankedConversation {
	conversation: Conversation;
	score: number;
	/** The note paths that matched, when the hit came through the note dimension.
	 *  The UI shows these as the row's `via …` provenance: a conversation that
	 *  surfaced without visibly containing the query has to be able to say why. */
	matchedNotes: string[];
}

/** Smoothed inverse document frequency (matches `noteRelevance`): a token present
 *  in every conversation still contributes ~1; a rare one dominates the score. */
function idf(df: number, n: number): number {
	return Math.log((n + 1) / (df + 1)) + 1;
}

/** The best weighted strength for one query token across the active fields, and
 *  the note paths that produced a note-field hit. */
function tokenScore(
	fields: ConversationFields,
	active: ScoredField[],
	qt: string
): { weighted: number; notes: string[] | null } {
	let weighted = 0;
	// Allocated only once a note actually matches. This runs for every
	// (conversation × query token) on every keystroke, and the default scope does
	// not score notes at all, so an eager array is pure garbage in the common case.
	let notes: string[] | null = null;
	for (const field of active) {
		if (field === "notes") {
			for (const note of fields.notes) {
				const s = matchStrength(note.tokens, qt);
				if (s <= 0) continue;
				(notes ??= []).push(note.ref);
				weighted = Math.max(weighted, s * FIELD_WEIGHTS.notes);
			}
			continue;
		}
		const s = matchStrength(fields[field], qt);
		if (s > 0) weighted = Math.max(weighted, s * FIELD_WEIGHTS[field]);
	}
	return { weighted, notes };
}

/**
 * Ranks conversations by lexical similarity to a pre-tokenized query.
 *
 * - Empty query → recency order (most recently updated first), all included.
 * - Non-empty query → only conversations scoring within `RELEVANCE_FLOOR` of the
 *   best one, sorted by score descending. Matching is graded (`matchStrength`),
 *   IDF-weighted so rare words dominate, and weighted per field so a title or a
 *   note name outranks a passing mention in a message.
 *
 * `fields` must be aligned by index to `conversations` (build once per panel
 * open via `buildConversationFields` — the panel scores the whole corpus on
 * every keystroke, and tokenizing it each time was the expensive half).
 */
export function rankConversations(
	queryTokens: string[],
	conversations: Conversation[],
	fields: ConversationFields[],
	scope: SearchScope = "conversations"
): RankedConversation[] {
	if (queryTokens.length === 0) {
		return [...conversations]
			.map((conversation) => ({ conversation, score: 0, matchedNotes: [] }))
			// ISO 8601 compares as a string; `new Date(undefined).getTime()` is NaN,
			// and a NaN comparator makes the sort order undefined for the whole list.
			.sort((a, b) => (b.conversation.updatedAt ?? "").localeCompare(a.conversation.updatedAt ?? ""));
	}

	const n = fields.length;
	const active = scopeFields(scope);

	// Per (conversation, query token): the weighted strength and the notes behind
	// it. Computed once — the document-frequency pass below needs the same answer
	// the scoring pass does, and running `matchStrength` twice over the corpus is
	// the kind of per-keystroke waste this panel has paid for before.
	const cells = fields.map((f) => queryTokens.map((qt) => tokenScore(f, active, qt)));

	const df = queryTokens.map((_, qi) => cells.reduce((count, row) => count + (row[qi].weighted > 0 ? 1 : 0), 0));

	const scored = conversations
		.map((conversation, i) => {
			let score = 0;
			const matched = new Set<string>();
			queryTokens.forEach((_qt, qi) => {
				const cell = cells[i][qi];
				if (cell.weighted <= 0) return;
				score += idf(df[qi], n) * cell.weighted;
				if (cell.notes) for (const ref of cell.notes) matched.add(ref);
			});
			return { conversation, score, matchedNotes: [...matched] };
		})
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score);

	return applyRelevanceFloor(scored);
}

/**
 * The result of one query typed into the panel's box: what matched, and whether
 * Pythia searched somewhere the user did not ask it to (ADR-168).
 *
 * The whole scope/widen decision lives here rather than in the controller, so
 * the rule is unit-testable and the panel only renders what it is handed.
 */
export interface SearchOutcome {
	scope: SearchScope;
	/** The query with any scope prefix stripped — what the snippets highlight. */
	queryTokens: string[];
	primary: RankedConversation[];
	/** Conversations that matched ONLY through the note dimension, found because
	 *  the conversation-text search came back thin. Empty unless auto-widening
	 *  fired — and when it is non-empty the user must be told (group header, a
	 *  `via …` line per row, and the chip). */
	widened: RankedConversation[];
}

/** Run one raw query string from the search box. */
export function searchConversations(
	raw: string,
	conversations: Conversation[],
	fields: ConversationFields[],
	opts: { picking?: boolean } = {}
): SearchOutcome {
	const { scope, query, explicit } = parseScope(raw);
	const queryTokens = tokenize(query);
	const primary = rankConversations(queryTokens, conversations, fields, scope);

	const cap = (rows: RankedConversation[]): RankedConversation[] =>
		rows.length > SEARCH_RESULT_LIMIT ? rows.slice(0, SEARCH_RESULT_LIMIT) : rows;

	if (
		!shouldWiden({
			explicit,
			queryTokenCount: queryTokens.length,
			narrowCount: primary.length,
			picking: opts.picking ?? false,
		})
	) {
		return { scope, queryTokens, primary: cap(primary), widened: [] };
	}

	const seen = new Set(primary.map((r) => r.conversation.id));
	// Only rows the narrow pass did not already have: by construction those
	// matched through the note dimension alone, which is exactly what the `via …`
	// provenance line claims about them.
	const widened = rankConversations(queryTokens, conversations, fields, "all").filter(
		(r) => !seen.has(r.conversation.id) && r.matchedNotes.length > 0
	);
	// The widen decision is made on the UNCAPPED count above; capping here cannot
	// change it, because widening only fires below WIDEN_MIN_RESULTS.
	return { scope, queryTokens, primary: cap(primary), widened: cap(widened) };
}

/**
 * The conversation's message lines, tokenized once and cached on its fields.
 *
 * Defensive in the same way as the field builder: it runs over persisted data
 * that only guarantees `messages` is an array.
 */
export function snippetLines(conv: Conversation, fields: ConversationFields): SnippetLine[] {
	if (fields.lines !== null) return fields.lines;
	const out: SnippetLine[] = [];
	const messages = Array.isArray(conv.messages) ? conv.messages : [];
	for (const msg of messages) {
		for (const rawLine of messageText(msg).split("\n")) {
			const text = rawLine.trim();
			if (text) out.push({ text, tokens: tokenize(text) });
		}
	}
	fields.lines = out;
	return out;
}

/**
 * The single message line that best matches the query, trimmed for display, or
 * null when no message line matches (e.g. the hit was only in the title, the
 * summary or an attached note). Used to show the user *why* a conversation
 * surfaced.
 *
 * Takes the conversation's `fields` because that is where the tokenized lines
 * are cached. It is not an optional convenience: this runs once per rendered
 * row per keystroke, and re-tokenizing every line each time was 99% of the
 * panel's typing cost (398ms per keystroke at 500 conversations, 1ms after).
 *
 * Uses the same `matchStrength` the ranking does — a row that surfaces on a
 * compound or reverse hit and then shows no snippet is the "silence is a bug"
 * shape, and it is what a second, stricter copy of the matching rule produces.
 */
export function bestMatchSnippet(
	queryTokens: string[],
	conv: Conversation,
	fields: ConversationFields,
	maxLen = 100
): string | null {
	if (queryTokens.length === 0) return null;

	let bestLine = "";
	let bestScore = 0;
	for (const line of snippetLines(conv, fields)) {
		let score = 0;
		for (const tok of queryTokens) score += matchStrength(line.tokens, tok);
		if (score > bestScore) {
			bestScore = score;
			bestLine = line.text;
		}
	}

	if (bestScore === 0) return null;
	return bestLine.length > maxLen ? `${bestLine.slice(0, maxLen).trimEnd()}…` : bestLine;
}
