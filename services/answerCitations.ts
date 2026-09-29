import type { Conversation, Message } from "../models/types";
import { stripAnswerLabels, type CitationSource } from "./citations";
import { chapterLabel, chapterOf } from "./chapterSummary";
import { answerFootnoteText } from "./anchorFootnotes";
import { detectLanguage } from "./languageDetect";
import type { AnswerResolver } from "./noteFootnotes";

/**
 * Answer citations (ADR-250): a document written from a long conversation
 * points back at the answers it rests on.
 *
 * Pythia numbers the answers, never the model. Each earlier answer goes out in
 * the history led by an `⟦answer:n⟧` label; the model cites one as
 * `⟦cite:answer:n⟧`; Pythia resolves n to that answer's message id. A number
 * nothing answers for is dropped — model output cannot point anywhere Pythia
 * did not offer (principle 9). Only a conversation whose template says
 * `cite_answers: true` is numbered, so every other send costs nothing extra.
 *
 * The numbers are the answers' order in the conversation: stable as the
 * conversation grows, and the same in every send, so the labelled history does
 * not break a provider's prompt cache. Pure: no Obsidian.
 */

/** The label an answer carries in the history the model reads. */
export const answerLabel = (n: number): string => `⟦answer:${n}⟧`;

/** Every answer's number: 1, 2, 3… in conversation order. Only `messages` —
 *  a comparison tab is not history and is never numbered (ADR-219). */
export function answerNumbers(messages: Pick<Message, "id" | "role">[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const m of messages) if (m.role === "assistant") out.set(m.id, out.size + 1);
	return out;
}

/** `content` led by its label, and never by a second one it copied. */
export function labelledAnswer(content: string, n: number): string {
	return `${answerLabel(n)}\n${stripAnswerLabels(content)}`;
}

/** The answer a number names, or null. */
export function answerByNumber(messages: Message[], n: number): Message | null {
	let seen = 0;
	for (const m of messages) {
		if (m.role !== "assistant") continue;
		if (++seen === n) return m;
	}
	return null;
}

/**
 * The answer half of a reply's sources: each `⟦cite:answer:n⟧` resolved to the
 * answer's id, titled by its chapter, `cite` keeping the number so the chip
 * finds it. A number that names no answer is dropped. Other sources pass
 * through; everything is renumbered in order.
 */
export function resolveAnswerCitations(
	cited: CitationSource[],
	messages: Message[],
): { sources: CitationSource[]; dropped: string[] } {
	const out: CitationSource[] = [];
	const dropped: string[] = [];
	for (const s of cited) {
		if (s.kind !== "answer") { out.push({ ...s, n: out.length + 1 }); continue; }
		const n = /^\d+$/.test(s.ref) ? Number(s.ref) : NaN;
		const answer = Number.isInteger(n) ? answerByNumber(messages, n) : null;
		if (!answer) { dropped.push(s.ref); continue; }
		const i = messages.indexOf(answer);
		const question = [...messages.slice(0, i)].reverse().find((m) => m.role === "user");
		out.push({ n: out.length + 1, kind: "answer", ref: answer.id, title: question ? chapterLabel(question) : `#${n}`, cite: s.ref });
	}
	return { sources: out, dropped };
}

/** Whether a note cites this answer — then removing it would break the note's
 *  link, so Retry and deleting the exchange are withheld (ADR-250). */
export function isAnswerCited(conv: Pick<Conversation, "noteAnchors">, answerId: string): boolean {
	return (conv.noteAnchors ?? []).some((a) => a.messageId === answerId);
}

/**
 * Footnote targets for one conversation's answers — by id (a stored source) or,
 * with `byNumber`, by the number the model cited (a note tool's content, before
 * the answer is committed). `link` builds the chapter link (`resumeDeepLink`).
 * The quote marks follow the language of the cited answer.
 */
export function answerResolver(
	conv: Conversation,
	/** null: name the answer without a link (an archive, whose conversation is being removed). */
	link: ((conversationId: string, messageId: string) => string) | null,
	fallbackLanguage = "en",
	byNumber = false,
): AnswerResolver {
	return (ref) => {
		const id = byNumber ? (/^\d+$/.test(ref) ? answerByNumber(conv.messages, Number(ref))?.id : undefined) : ref;
		const chapter = id ? chapterOf(conv, id) : null;
		if (!id || !chapter?.answer) return null;
		const text = answerFootnoteText({
			conversationName: conv.name,
			chapterName: chapterLabel(chapter.user),
			date: chapter.answer.timestamp,
			language: detectLanguage(chapter.answer.content) ?? fallbackLanguage,
		}, link ? link(conv.id, id) : null);
		return { kind: "answer", id, text };
	};
}
