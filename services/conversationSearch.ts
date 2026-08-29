import type { Conversation } from "../models/types";
import { tokenize } from "./noteRelevance";

/**
 * The searchable text for one conversation: its title, its LLM-generated summary
 * if present, and every message body. Folding the summary in is the cheap half of
 * "semantic" recall — the model's own paraphrasing ("automobile", "Fahrzeug")
 * already lives in the summary, so a lexical match can surface a conversation
 * whose messages never used the exact query word. Title matches are ranked higher
 * in rankConversations (not by repeating the title here — the scorer dedupes
 * tokens, so repetition would be a no-op). No embeddings, no vector store.
 */
export function buildConversationHaystack(conv: Conversation): string {
	const summary = conv.summaryText ?? "";
	const body = conv.messages.map((m) => m.content).join(" ");
	return `${conv.name} ${summary} ${body}`;
}

export interface RankedConversation {
	conversation: Conversation;
	score: number;
}

/** Smoothed inverse document frequency (matches `noteRelevance`): a token present
 *  in every conversation still contributes ~1; a rare one dominates the score. */
function idf(df: number, n: number): number {
	return Math.log((n + 1) / (df + 1)) + 1;
}

/** A query token matches a candidate token by exact equality OR prefix, so a
 *  partial word typed as-you-type ("bound") still hits "boundaries". */
function tokenMatches(candidateTokens: string[], queryToken: string): boolean {
	return candidateTokens.some((t) => t === queryToken || t.startsWith(queryToken));
}

/**
 * Ranks conversations by lexical similarity to a free-text query.
 *
 * - Empty query → recency order (most recently updated first), all included.
 * - Non-empty query → only conversations with at least one matched query token,
 *   sorted by score descending. Matching is **prefix-aware** (typing part of a
 *   word surfaces the conversation), IDF-weighted (rare words dominate), and a
 *   title match is boosted so it outranks a passing mention in a message.
 *
 * `haystacks` must be aligned by index to `conversations` (build once per open
 * via buildConversationHaystack).
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

	const n = haystacks.length;
	const docTokens = haystacks.map((h) => tokenize(h));
	const nameTokens = conversations.map((c) => tokenize(c.name));

	// Document frequency by prefix-aware match, for IDF weighting.
	const df = new Map<string, number>();
	for (const qt of queryTokens) {
		let count = 0;
		for (const tokens of docTokens) if (tokenMatches(tokens, qt)) count++;
		df.set(qt, count);
	}

	return conversations
		.map((conversation, i) => {
			let score = 0;
			for (const qt of queryTokens) {
				if (!tokenMatches(docTokens[i], qt)) continue;
				let weight = idf(df.get(qt)!, n);
				if (tokenMatches(nameTokens[i], qt)) weight *= 3; // title hit ranks higher
				score += weight;
			}
			return { conversation, score };
		})
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
	for (const msg of conv.messages) {
		for (const rawLine of msg.content.split("\n")) {
			const line = rawLine.trim();
			if (!line) continue;
			const lineTokens = tokenize(line);
			let hits = 0;
			for (const tok of querySet) if (tokenMatches(lineTokens, tok)) hits++;
			if (hits > bestHits) {
				bestHits = hits;
				bestLine = line;
			}
		}
	}

	if (bestHits === 0) return null;
	return bestLine.length > maxLen ? `${bestLine.slice(0, maxLen).trimEnd()}…` : bestLine;
}
