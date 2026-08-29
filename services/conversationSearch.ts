import type { Conversation, Message } from "../models/types";
import { scoreRelevanceTokensWeighted, tokenize } from "./noteRelevance";

/** How many times the title is repeated into the haystack. A name hit should
 *  outrank a passing mention buried in message #40, so the title carries more
 *  weight than a single occurrence of body text. */
const TITLE_WEIGHT = 3;

/** A message's textual content as a plain string, tolerating malformed records.
 *  Persistence only guarantees `messages` is an array (parseConversations) — not
 *  that each element is an object or that `content` is a string. An interrupted
 *  stream or a legacy entry can leave a null element or a non-string `content`;
 *  since the haystack is built for every conversation up front, a single such
 *  record would otherwise throw and take the entire search down with it. */
function messageText(m: Message | null | undefined): string {
	return typeof m?.content === "string" ? m.content : "";
}

/**
 * The searchable text for one conversation: its title (weighted by repetition),
 * its LLM-generated summary if present, and every message body. Folding the
 * summary in is the cheap half of "semantic" recall — the model's own
 * paraphrasing ("automobile", "Fahrzeug") already lives in the summary, so a
 * lexical match can surface a conversation whose messages never used the exact
 * query word. No embeddings, no vector store, no persisted index.
 *
 * Defensive by design: it runs over the whole corpus on every query, so it must
 * never throw on a malformed conversation (missing name, absent/ragged messages,
 * non-string content) — one bad record must not blank out all search results.
 */
export function buildConversationHaystack(conv: Conversation): string {
	const title = `${conv.name ?? ""} `.repeat(TITLE_WEIGHT);
	const summary = typeof conv.summaryText === "string" ? conv.summaryText : "";
	const messages = Array.isArray(conv.messages) ? conv.messages : [];
	const body = messages.map(messageText).join(" ");
	return `${title} ${summary} ${body}`;
}

export interface RankedConversation {
	conversation: Conversation;
	score: number;
}

/**
 * Ranks conversations by lexical (TF-IDF) similarity to a free-text query.
 *
 * - Empty query → recency order (most recently updated first), all included —
 *   preserving the pre-search default listing.
 * - Non-empty query → only conversations with at least one matched query token,
 *   sorted by score descending.
 *
 * `haystacks` must be aligned by index to `conversations` (build once per modal
 * open via buildConversationHaystack). The scorer re-tokenizes the haystacks on
 * every call; that is fine for hundreds of conversations. If a vault ever holds
 * thousands, memoize the token sets keyed by conversation `updatedAt`.
 */
export function rankConversations(
	queryTokens: string[],
	conversations: Conversation[],
	haystacks: string[]
): RankedConversation[] {
	if (queryTokens.length === 0) {
		return [...conversations]
			.map((conversation) => ({ conversation, score: 0 }))
			.sort(
				(a, b) =>
					new Date(b.conversation.updatedAt).getTime() -
					new Date(a.conversation.updatedAt).getTime()
			);
	}

	const scores = scoreRelevanceTokensWeighted(queryTokens, haystacks);
	return conversations
		.map((conversation, i) => ({ conversation, score: scores[i] }))
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score);
}

/**
 * The single message line that best matches the query, trimmed for display, or
 * null when no message line matches (e.g. the hit was only in the title or
 * summary). Used to show the user *why* a conversation surfaced.
 */
export function bestMatchSnippet(
	queryTokens: string[],
	conv: Conversation,
	maxLen = 100
): string | null {
	if (queryTokens.length === 0) return null;
	const querySet = new Set(queryTokens);

	let bestLine = "";
	let bestHits = 0;
	const messages = Array.isArray(conv.messages) ? conv.messages : [];
	for (const msg of messages) {
		for (const rawLine of messageText(msg).split("\n")) {
			const line = rawLine.trim();
			if (!line) continue;
			const lineTokens = new Set(tokenize(line));
			let hits = 0;
			for (const tok of querySet) if (lineTokens.has(tok)) hits++;
			if (hits > bestHits) {
				bestHits = hits;
				bestLine = line;
			}
		}
	}

	if (bestHits === 0) return null;
	return bestLine.length > maxLen ? `${bestLine.slice(0, maxLen).trimEnd()}…` : bestLine;
}
