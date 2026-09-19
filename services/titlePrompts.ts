/**
 * The title prompts: a chapter name for one user message, the automatic title
 * after the first exchange, and the on-demand rename from the header menu (↻).
 * Pure strings, so the three share one reply rule and none of them grows
 * `BaseProvider` (ADR-097 file-size ratchet).
 */
import type { Conversation } from "../models/types";
import { langInstruction } from "./messageUtils";

/** Shared verbatim by every title prompt below. */
export const REPLY_TITLE_ONLY_INSTRUCTION = "Reply with ONLY the title, no punctuation, no quotes.";

export function chapterNamePrompt(content: string, languageLabel: string): string {
	return `Summarize this user message in 3-5 words as a chapter title. ${REPLY_TITLE_ONLY_INSTRUCTION}${langInstruction(languageLabel)}\n\nMessage:\n${content.slice(0, 500)}`;
}

export function conversationTitlePrompt(userMessage: string, assistantMessage: string, languageLabel: string): string {
	return `Give this conversation a concise 3-5 word title. ${REPLY_TITLE_ONLY_INSTRUCTION}${langInstruction(languageLabel)}\n\nUser: ${userMessage.slice(0, 300)}\n\nAssistant: ${assistantMessage.slice(0, 300)}`;
}

/** The header ↻ rename: `digest` comes from `buildRetitleDigest`. */
export function retitlePrompt(digest: string, languageLabel: string): string {
	return `Give this conversation a concise 3-5 word title that names what it is about now. ${REPLY_TITLE_ONLY_INSTRUCTION}${langInstruction(languageLabel)}\n\n${digest}`;
}

/** Per-part excerpt caps for `buildRetitleDigest` — a title needs the gist, not the text. */
export const RETITLE_SUMMARY_CHARS = 600;
export const RETITLE_TURN_CHARS = 300;

/**
 * What the on-demand rename (header menu ↻) shows the model: the conversation's
 * summary when it has one, then the LAST exchange — so the title names what the
 * conversation became, not only where it started. The automatic first-turn
 * title keeps `generateConversationTitle`, which has only the first exchange to
 * go on. Returns "" when there is nothing to name; the caller says so rather
 * than spending a call on an empty prompt (ADR-158).
 */
export function buildRetitleDigest(conversation: Conversation): string {
	const clip = (s: string, n: number): string => s.replace(/\s+/g, " ").trim().slice(0, n);
	const parts: string[] = [];
	const summary = typeof conversation.summaryText === "string" ? clip(conversation.summaryText, RETITLE_SUMMARY_CHARS) : "";
	if (summary) parts.push(`Summary: ${summary}`);
	const msgs = conversation.messages;
	let lastUser = -1;
	for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user") { lastUser = i; break; }
	if (lastUser >= 0) {
		const user = clip(msgs[lastUser].content, RETITLE_TURN_CHARS);
		if (user) parts.push(`Latest user message: ${user}`);
		const answer = msgs.slice(lastUser + 1).find((m) => m.role === "assistant");
		const assistant = answer ? clip(answer.content, RETITLE_TURN_CHARS) : "";
		if (assistant) parts.push(`Latest assistant answer: ${assistant}`);
	}
	return parts.join("\n\n");
}
