import { describe, it, expect } from "vitest";
import {
	anchorStatus, anchorSummary, chapterFingerprint, chapterOf, chapterSummaryPrompt, cleanChapterSummary,
	firstSentences, normalizeChapterSummary,
} from "../services/chapterSummary";
import type { Conversation, Message } from "../models/types";

const msg = (id: string, role: Message["role"], content: string, over: Partial<Message> = {}): Message =>
	({ id, role, content, timestamp: "2026-09-29T10:00:00.000Z", ...over });

function conv(over: Partial<Conversation> = {}): Conversation {
	return {
		id: "c1", name: "Rent cap scenarios",
		messages: [msg("u1", "user", "What about the index clause?", { chapterName: "Index clause" }), msg("a1", "assistant", "It lags a year.")],
		...over,
	} as unknown as Conversation;
}

describe("a chapter is a question and the answer it got (ADR-249)", () => {
	it("finds the answer after the user message, and nothing for an unknown id", () => {
		const c = conv();
		expect(chapterOf(c, "u1")).toMatchObject({ user: { id: "u1" }, answer: { id: "a1" } });
		expect(chapterOf(c, "nope")).toBeNull();
	});

	it("an answer id names its own chapter — a comparison tab too (ADR-250)", () => {
		const c = conv();
		expect(chapterOf(c, "a1")).toMatchObject({ user: { id: "u1" }, answer: { id: "a1" } });
		c.messages[1].alternatives = [{ id: "t1", provider: "openai", model: "m", content: "Tab.", timestamp: "t" }];
		expect(chapterOf(c, "t1")).toMatchObject({ user: { id: "u1" }, answer: { id: "t1", content: "Tab." } });
		expect(anchorSummary(c, { id: "c1", msg: "a1" })).toMatchObject({ state: "none", chapterName: "Index clause" });
	});

	it("its fingerprint changes with the answer, so a retry makes a summary outdated", () => {
		const c = conv();
		const before = chapterFingerprint(chapterOf(c, "u1")!);
		c.messages[1].content = "It follows the CPI.";
		expect(chapterFingerprint(chapterOf(c, "u1")!)).not.toBe(before);
	});
});

describe("anchorStatus", () => {
	it("walks missing → ok → outdated → deleted for a chapter", () => {
		const c = conv();
		expect(anchorStatus(c, { id: "c1", msg: "u1" })).toBe("missing");
		c.messages[0].chapterSummary = { text: "S.", fingerprint: chapterFingerprint(chapterOf(c, "u1")!), createdAt: "t" };
		expect(anchorStatus(c, { id: "c1", msg: "u1" })).toBe("ok");
		c.messages[1].content = "changed";
		expect(anchorStatus(c, { id: "c1", msg: "u1" })).toBe("outdated");
		expect(anchorStatus(c, { id: "c1", msg: "gone" })).toBe("deleted");
		expect(anchorStatus(undefined, { id: "c1", msg: "u1" })).toBe("deleted");
	});

	it("a chapter without an answer has nothing to summarize", () => {
		const c = conv({ messages: [msg("u1", "user", "q")] });
		expect(anchorStatus(c, { id: "c1", msg: "u1" })).toBe("unanswered");
	});

	it("a link to the whole conversation follows the conversation summary's age", () => {
		const c = conv();
		expect(anchorStatus(c, { id: "c1" })).toBe("missing");
		c.summaryText = "S.";
		c.summaryUpdatedAt = "2026-09-29T11:00:00.000Z";
		expect(anchorStatus(c, { id: "c1" })).toBe("ok");
		c.summaryUpdatedAt = "2026-09-29T09:00:00.000Z";
		expect(anchorStatus(c, { id: "c1" })).toBe("outdated");
		expect(anchorStatus(conv({ messages: [] }), { id: "c1" })).toBe("unanswered");
	});
});

describe("anchorSummary — what the footnote and the card say", () => {
	it("names the conversation and the chapter, and carries the summary's date and language", () => {
		const c = conv();
		c.messages[0].chapterSummary = { text: "Es hinkt ein Jahr.", fingerprint: "x", language: "de", createdAt: "2026-09-29T12:00:00.000Z" };
		expect(anchorSummary(c, { id: "c1", msg: "u1" })).toEqual({
			state: "ok", conversationName: "Rent cap scenarios", chapterName: "Index clause",
			summary: "Es hinkt ein Jahr.", date: "2026-09-29T12:00:00.000Z", language: "de",
		});
	});

	it("an unnamed chapter is named by its first words, as in the navigator", () => {
		const c = conv({ messages: [msg("u1", "user", "What   about\nthe clause?")] });
		expect(anchorSummary(c, { id: "c1", msg: "u1" }).chapterName).toBe("What about the clause?");
	});

	it("a whole-conversation link shows the conversation summary's first two sentences", () => {
		const c = conv({ summaryText: "One. Two! Three? Four.", summaryUpdatedAt: "t" });
		expect(anchorSummary(c, { id: "c1" })).toMatchObject({ state: "ok", summary: "One. Two!" });
	});

	it("says none and deleted rather than inventing anything", () => {
		expect(anchorSummary(conv(), { id: "c1", msg: "u1" }).state).toBe("none");
		expect(anchorSummary(conv(), { id: "c1", msg: "gone" })).toEqual({ state: "deleted", conversationName: "Rent cap scenarios" });
		expect(anchorSummary(undefined, { id: "c1" })).toEqual({ state: "deleted" });
	});
});

describe("the chapter-summary prompt and its reply", () => {
	it("asks for substance in the conversation's language, and caps what it sends", () => {
		const p = chapterSummaryPrompt("q".repeat(5000), "a".repeat(9000), "German");
		expect(p).toContain("Respond in German.");
		expect(p).toContain("never narrate the exchange");
		expect(p.length).toBeLessThan(6000);
	});

	it("an empty reply is no summary, never an empty one (ADR-158)", () => {
		expect(cleanChapterSummary("  \n ")).toBeNull();
		expect(cleanChapterSummary("Summary: The cap\n applies.")).toBe("The cap applies.");
	});

	it("firstSentences keeps closing quotes and works on one sentence", () => {
		expect(firstSentences("He said “yes.” Then left. Later more.")).toBe("He said “yes.” Then left.");
		expect(firstSentences("No full stop")).toBe("No full stop");
	});
});

describe("chapterSummary read back from data.json", () => {
	it("keeps a well-formed one on a user message only", () => {
		const good = msg("u", "user", "q", { chapterSummary: { text: "S", fingerprint: "f", createdAt: "t", language: "de" } });
		normalizeChapterSummary(good);
		expect(good.chapterSummary).toEqual({ text: "S", fingerprint: "f", createdAt: "t", language: "de" });
		const onAnswer = msg("a", "assistant", "x", { chapterSummary: { text: "S", fingerprint: "f", createdAt: "t" } });
		normalizeChapterSummary(onAnswer);
		expect(onAnswer.chapterSummary).toBeUndefined();
		const bad = msg("u", "user", "q", { chapterSummary: { text: "", fingerprint: "f", createdAt: "t" } });
		normalizeChapterSummary(bad);
		expect(bad.chapterSummary).toBeUndefined();
		const badLang = msg("u", "user", "q", { chapterSummary: { text: "S", fingerprint: "f", createdAt: "t", language: "German" } });
		normalizeChapterSummary(badLang);
		expect(badLang.chapterSummary).toEqual({ text: "S", fingerprint: "f", createdAt: "t" });
	});
});
