import type { Conversation } from "../models/types";
import { tokenize } from "./noteRelevance";
import { matchStrength } from "./tokenMatch";

/**
 * Finding a conversation from the search box (ADR-223).
 *
 * Two parts. The title search is Pythia's own and always there: every typed
 * word must be found in the conversation's title, the closer the match the
 * higher the row, newest first among equals.
 * The search by meaning is Schreibstube's, and only there when Schreibstube is
 * installed, switched on and allowed to run on this device: it finds the chat
 * about the kitchen whose title never said "Küche". Its answers come after a
 * pause in typing and join the title hits below them, each once.
 *
 * Pure: the panel and the palette hand over the conversations and the ids
 * meaning found, and draw what comes back.
 */

/** Rows a search draws at most. Past a screenful the answer is a narrower query. */
export const SEARCH_RESULT_LIMIT = 20;

/** Shorter than this, the query is a prefix being typed, not something with a meaning. */
export const MEANING_MIN_CHARS = 3;

/** How long the typing must pause before meaning is asked: it embeds the query once. */
export const MEANING_DEBOUNCE_MS = 300;

export interface TitleSearch {
	/** What was typed, as the words the snippets highlight. */
	queryTokens: string[];
	hits: Conversation[];
}

/**
 * How well one title answers the typed words; 0 when a word is missing. The
 * word matching is the one the snippets use (`matchStrength`): exact, then a
 * word the title starts with, then one inside a German compound — so a row a
 * title search shows is a row its snippet can explain.
 */
export function titleScore(queryTokens: string[], title: string): number {
	const words = tokenize(title);
	let score = 0;
	for (const q of queryTokens) {
		const strength = matchStrength(words, q);
		if (strength === 0) return 0;
		score += strength;
	}
	return score;
}

/** Conversations whose title holds every typed word, best first, capped. */
export function searchTitles(
	query: string,
	conversations: readonly Conversation[],
	limit = SEARCH_RESULT_LIMIT
): TitleSearch {
	const queryTokens = tokenize(query);
	if (queryTokens.length === 0) return { queryTokens, hits: [] };
	const hits = conversations
		.map((conversation) => ({
			conversation,
			score: titleScore(queryTokens, typeof conversation.name === "string" ? conversation.name : ""),
		}))
		.filter((r) => r.score > 0)
		.sort(
			(a, b) =>
				b.score - a.score ||
				(b.conversation.updatedAt ?? "").localeCompare(a.conversation.updatedAt ?? "")
		)
		.slice(0, limit)
		.map((r) => r.conversation);
	return { queryTokens, hits };
}

/** The text to ask meaning for, or null when it is too short to mean anything. */
export function meaningQuery(query: string): string | null {
	const text = query.trim();
	return text.length >= MEANING_MIN_CHARS ? text : null;
}

/**
 * The conversations meaning found that the titles did not, in meaning's order,
 * each once, only those that still exist — an id can name a conversation
 * deleted since Schreibstube last listed them.
 */
export function meaningOnly(
	titleHits: readonly Conversation[],
	meaningIds: readonly string[],
	byId: ReadonlyMap<string, Conversation>,
	limit = SEARCH_RESULT_LIMIT
): Conversation[] {
	const shown = new Set(titleHits.map((c) => c.id));
	const out: Conversation[] = [];
	for (const id of meaningIds) {
		const conversation = byId.get(id);
		if (!conversation || shown.has(id)) continue;
		shown.add(id);
		out.push(conversation);
		if (out.length >= limit) break;
	}
	return out;
}
