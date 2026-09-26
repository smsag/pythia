import type { Conversation, Message } from "../models/types";
import { tokenize } from "./noteRelevance";
import { matchStrength } from "./tokenMatch";

/**
 * Why a conversation is in the search results: the message line that best
 * matches what was typed. The ranking that used to live here — TF-IDF over
 * title, summary, messages and attached notes — gave way to the title search
 * and Schreibstube's search by meaning (ADR-223); the snippet stays, because a
 * row still has to say why it is there.
 */

/** A message's textual content as a plain string, tolerating malformed records.
 *  Persistence only guarantees `messages` is an array (parseConversations) — not
 *  that each element is an object or that `content` is a string. */
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

/** The per-conversation cache the snippet reads. Filled on the FIRST snippet
 *  request, not up front: only conversations that actually render as a result
 *  ever pay, and a search shows at most a screenful of them. */
export interface ConversationFields {
	lines: SnippetLine[] | null;
}

/** An empty cache for one conversation. */
export function buildConversationFields(_conv: Conversation): ConversationFields {
	return { lines: null };
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
