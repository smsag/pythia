import type { ChapterSummary, Conversation, Message } from "../models/types";
import { langInstruction } from "./messageUtils";
import { fnv1a, type AnchorRef } from "./noteAnchors";

/**
 * What a note anchor's footnote and hover card say about the chapter it points
 * at (ADR-249). Pure: no Obsidian, no model.
 *
 * A chapter is one user message and the answer it got. Its summary is a
 * SNAPSHOT (like `Message.cost`), written with the chapter's fingerprint, so a
 * retry, a kept comparison or an edit makes it outdated — shown with its old
 * date, refreshed only when asked — rather than silently describing an answer
 * that is no longer there. A link to a whole conversation uses the
 * conversation's own summary, cut to its first two sentences.
 */

/** A chapter: the user message a link names, and the answer after it. */
export interface Chapter {
	user: Message;
	answer?: Message;
}

export function chapterOf(conv: Conversation, userMessageId: string): Chapter | null {
	const i = conv.messages.findIndex((m) => m.id === userMessageId);
	if (i < 0 || conv.messages[i].role !== "user") return null;
	const next = conv.messages[i + 1];
	return { user: conv.messages[i], ...(next?.role === "assistant" ? { answer: next } : {}) };
}

/** The ONE fingerprint of a chapter: what was asked and what was kept as the answer. */
export function chapterFingerprint(chapter: Chapter): string {
	return fnv1a(`${chapter.user.content}\u0000${chapter.answer?.content ?? ""}`);
}

/**
 * - `ok`: a summary of what the chapter holds now
 * - `outdated`: a summary of what it held before
 * - `missing`: no summary yet, and one can be written
 * - `unanswered`: nothing to summarize yet (no answer, no messages)
 * - `deleted`: the conversation or the chapter is gone
 */
export type AnchorStatus = "ok" | "outdated" | "missing" | "unanswered" | "deleted";

export function anchorStatus(conv: Conversation | undefined, ref: AnchorRef): AnchorStatus {
	if (!conv) return "deleted";
	if (ref.msg) {
		const chapter = chapterOf(conv, ref.msg);
		if (!chapter) return "deleted";
		if (!chapter.answer) return "unanswered";
		const summary = chapter.user.chapterSummary;
		if (!summary) return "missing";
		return summary.fingerprint === chapterFingerprint(chapter) ? "ok" : "outdated";
	}
	if (conv.messages.length === 0) return "unanswered";
	if (!conv.summaryText?.trim()) return "missing";
	const last = conv.messages[conv.messages.length - 1].timestamp;
	return conv.summaryUpdatedAt && Date.parse(conv.summaryUpdatedAt) >= Date.parse(last) ? "ok" : "outdated";
}

/** Whether a refresh would change anything — what `refreshSummaries` works on. */
export const needsRefresh = (s: AnchorStatus): boolean => s === "missing" || s === "outdated";

/** The first `n` sentences of prose, on one line. */
export function firstSentences(text: string, n = 2): string {
	const flat = text.replace(/\s+/g, " ").trim();
	const parts = flat.match(/[^.!?…]+(?:[.!?…]+["'”»)]*\s*|$)/g) ?? [flat];
	return parts.slice(0, n).join("").trim();
}

/** What a footnote or the hover card needs to say about one anchor. */
export interface AnchorSummary {
	state: "ok" | "none" | "deleted";
	conversationName?: string;
	chapterName?: string;
	summary?: string;
	/** ISO date the summary was written. */
	date?: string;
	/** ISO 639-1 code of the summary, when known. */
	language?: string;
}

/** A chapter's label where no name was generated: the navigator's own fallback. */
export function chapterLabel(msg: Message): string {
	return msg.chapterName ?? msg.content.slice(0, 60).replace(/\s+/g, " ").trim();
}

export function anchorSummary(conv: Conversation | undefined, ref: AnchorRef): AnchorSummary {
	const status = anchorStatus(conv, ref);
	if (!conv || status === "deleted") return { state: "deleted", ...(conv ? { conversationName: conv.name } : {}) };
	const chapter = ref.msg ? chapterOf(conv, ref.msg) : null;
	const base = { conversationName: conv.name, ...(chapter ? { chapterName: chapterLabel(chapter.user) } : {}) };
	if (chapter) {
		const s = chapter.user.chapterSummary;
		if (!s) return { state: "none", ...base };
		return { state: "ok", ...base, summary: s.text, date: s.createdAt, ...(s.language ? { language: s.language } : {}) };
	}
	if (!conv.summaryText?.trim()) return { state: "none", ...base };
	return { state: "ok", ...base, summary: firstSentences(conv.summaryText), ...(conv.summaryUpdatedAt ? { date: conv.summaryUpdatedAt } : {}) };
}

/** Per-part caps: a footnote needs the gist of a chapter, not its text. */
export const CHAPTER_QUESTION_CHARS = 1500;
export const CHAPTER_ANSWER_CHARS = 4000;

/**
 * The chapter-summary prompt. Substance, never the session (ADR-141's rule,
 * shortened for a footnote): one or two sentences a reader of the printed note
 * can take as the point of the exchange.
 */
export function chapterSummaryPrompt(question: string, answer: string, languageLabel: string): string {
	return "Summarize what this exchange settled in one or two sentences, at most 40 words. " +
		"State the substance directly, as a fact — never narrate the exchange (no \"The user asked\", no \"The answer explains\"). " +
		"Plain prose only: no heading, list, bold, quotes or code." +
		`${langInstruction(languageLabel)}\n\nQuestion:\n${question.slice(0, CHAPTER_QUESTION_CHARS)}\n\nAnswer:\n${answer.slice(0, CHAPTER_ANSWER_CHARS)}`;
}

/** A summary as the model returned it, made safe to store: one line, or null
 *  when the reply said nothing (ADR-158: "" is never "nothing happened"). */
export function cleanChapterSummary(raw: string): string | null {
	const text = raw.replace(/^\s*(summary|zusammenfassung)\s*:\s*/i, "").replace(/\s+/g, " ").trim();
	return text ? text : null;
}

/** `chapterSummary` read back from data.json: a user message's, well-formed, or none. */
export function normalizeChapterSummary(m: Message): void {
	const raw = (m as { chapterSummary?: unknown }).chapterSummary as Record<string, unknown> | undefined;
	if (raw === undefined) return;
	const ok = m.role === "user" && !!raw && typeof raw === "object"
		&& typeof raw.text === "string" && raw.text.trim() !== ""
		&& typeof raw.fingerprint === "string" && typeof raw.createdAt === "string";
	if (!ok) { delete m.chapterSummary; return; }
	const summary: ChapterSummary = { text: raw.text as string, fingerprint: raw.fingerprint as string, createdAt: raw.createdAt as string };
	if (typeof raw.language === "string" && /^[a-z]{2}$/.test(raw.language)) summary.language = raw.language;
	m.chapterSummary = summary;
}
