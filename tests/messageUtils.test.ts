import { describe, it, expect } from "vitest";
import {
	parseTitleAndSummary,
	formatDate,
	formatMonthYear,
	formatSummaryTimestamp,
	normalizeMessages,
	selectHistoryForSend,
	resumeBoundary,
	omittedByResume,
	trimHistoryToBudget,
	estimateTokensFromText,
	arrayBufferToBase64,
	buildFavoritesDigest,
	formatClockTime,
	lastTokenUsageMessage,
	unwrapCodeFence,
} from "../services/messageUtils";
import type { Conversation, Message, Favorite } from "../models/types";

// ── parseTitleAndSummary ──────────────────────────────────────────────────────

describe("parseTitleAndSummary", () => {
	it("parses title and summary on separate lines", () => {
		const raw = "TITLE: My Great Title\nSUMMARY:\nThe conversation covered X and Y.";
		const { title, summary } = parseTitleAndSummary(raw);
		expect(title).toBe("My Great Title");
		expect(summary).toBe("The conversation covered X and Y.");
	});

	it("parses inline SUMMARY: content on the same line", () => {
		const raw = "TITLE: Inline Test\nSUMMARY: Content starts here.";
		const { title, summary } = parseTitleAndSummary(raw);
		expect(title).toBe("Inline Test");
		expect(summary).toBe("Content starts here.");
	});

	it("is case-insensitive for markers", () => {
		const raw = "title: Lower Case\nsummary:\nSome body.";
		const { title, summary } = parseTitleAndSummary(raw);
		expect(title).toBe("Lower Case");
		expect(summary).toBe("Some body.");
	});

	it("trims whitespace from title and summary", () => {
		const raw = "TITLE:   Padded Title   \nSUMMARY:\n  Padded body.  ";
		const { title, summary } = parseTitleAndSummary(raw);
		expect(title).toBe("Padded Title");
		expect(summary).toBe("Padded body.");
	});

	it("preserves multi-paragraph summary", () => {
		const raw = "TITLE: Multi\nSUMMARY:\nParagraph one.\n\nParagraph two.";
		const { summary } = parseTitleAndSummary(raw);
		expect(summary).toBe("Paragraph one.\n\nParagraph two.");
	});

	it("falls back gracefully when TITLE marker is absent", () => {
		const raw = "SUMMARY:\nOrphan summary.";
		const { title, summary } = parseTitleAndSummary(raw);
		expect(title).toBe("");
		expect(summary).toBe("Orphan summary.");
	});

	it("falls back gracefully when SUMMARY marker is absent", () => {
		const raw = "TITLE: Title Only";
		const { title, summary } = parseTitleAndSummary(raw);
		expect(title).toBe("Title Only");
		// Fallback strips the TITLE line; remaining content is empty
		expect(summary).toBe("");
	});

	it("returns empty strings for completely empty input", () => {
		const { title, summary } = parseTitleAndSummary("");
		expect(title).toBe("");
		expect(summary).toBe("");
	});

	it("handles LLM output with leading blank line before TITLE", () => {
		const raw = "\nTITLE: Late Title\nSUMMARY:\nBody here.";
		const { title, summary } = parseTitleAndSummary(raw);
		expect(title).toBe("Late Title");
		expect(summary).toBe("Body here.");
	});
});

// ── normalizeMessages ─────────────────────────────────────────────────────────

type Msg = { role: string; content: string };
const anthropicPred = (role: string) => role !== "user";
const openaiPred    = (role: string) => role === "assistant";

describe("normalizeMessages — coalescing", () => {
	it("merges consecutive messages with the same role", () => {
		const msgs: Msg[] = [
			{ role: "user", content: "Hello" },
			{ role: "user", content: "World" },
		];
		const result = normalizeMessages(msgs, anthropicPred);
		expect(result).toHaveLength(1);
		expect(result[0].content).toBe("Hello\n\nWorld");
	});

	it("does not merge messages with alternating roles", () => {
		const msgs: Msg[] = [
			{ role: "user",      content: "Hi" },
			{ role: "assistant", content: "Hello" },
			{ role: "user",      content: "Bye" },
		];
		const result = normalizeMessages(msgs, anthropicPred);
		expect(result).toHaveLength(3);
	});

	it("does not mutate the original array", () => {
		const msgs: Msg[] = [
			{ role: "user", content: "A" },
			{ role: "user", content: "B" },
		];
		const copy = msgs.map(m => ({ ...m }));
		normalizeMessages(msgs, anthropicPred);
		expect(msgs).toEqual(copy);
	});
});

describe("normalizeMessages — Anthropic predicate (must start with user)", () => {
	it("drops leading assistant turns", () => {
		const msgs: Msg[] = [
			{ role: "assistant", content: "Stray" },
			{ role: "user",      content: "Hi" },
		];
		const result = normalizeMessages(msgs, anthropicPred);
		expect(result[0].role).toBe("user");
		expect(result).toHaveLength(1);
	});

	it("drops all messages when no user turn exists", () => {
		const msgs: Msg[] = [{ role: "assistant", content: "Lone" }];
		expect(normalizeMessages(msgs, anthropicPred)).toHaveLength(0);
	});

	it("returns empty array for empty input", () => {
		expect(normalizeMessages([], anthropicPred)).toHaveLength(0);
	});
});

describe("normalizeMessages — OpenAI predicate (system allowed at position 0)", () => {
	it("keeps leading system message", () => {
		const msgs: Msg[] = [
			{ role: "system",    content: "You are helpful." },
			{ role: "user",      content: "Hello" },
		];
		const result = normalizeMessages(msgs, openaiPred);
		expect(result[0].role).toBe("system");
		expect(result).toHaveLength(2);
	});

	it("drops leading assistant but keeps leading system", () => {
		const msgs: Msg[] = [
			{ role: "assistant", content: "Stray" },
			{ role: "user",      content: "Hello" },
		];
		const result = normalizeMessages(msgs, openaiPred);
		expect(result[0].role).toBe("user");
	});
});

// ── selectHistoryForSend ──────────────────────────────────────────────────────

describe("selectHistoryForSend (ADR-231: only what came before the resume)", () => {
	const msgs: Msg[] = [
		{ role: "user", content: "Hi" },
		{ role: "assistant", content: "Hello" },
	];
	const many = (n: number): Msg[] => Array.from({ length: n }, (_, i) => ({
		role: i % 2 === 0 ? "user" as const : "assistant" as const,
		content: `msg-${i}`,
	}));

	it("returns full history unchanged when resumeMode is 'full' or undefined", () => {
		expect(selectHistoryForSend(msgs, "full", 2)).toBe(msgs);
		expect(selectHistoryForSend(msgs, undefined, 2)).toBe(msgs);
	});

	it("a mode with no resume point reduces nothing — a template's or the setting's mode alone", () => {
		expect(selectHistoryForSend(msgs, "summary", 0)).toBe(msgs);
		expect(selectHistoryForSend(many(12), "hybrid", 0)).toHaveLength(12);
	});

	it("'summary' drops the messages before the resume and keeps every one after it", () => {
		const result = selectHistoryForSend(many(10), "summary", 6);
		expect(result.map((m) => m.content)).toEqual(["msg-6", "msg-7", "msg-8", "msg-9"]);
		expect(selectHistoryForSend(msgs, "summary", 2)).toEqual([]);
	});

	it("'hybrid' keeps the last 6 before the resume, and everything after it", () => {
		const result = selectHistoryForSend(many(16), "hybrid", 12);
		expect(result).toHaveLength(10);
		expect(result[0].content).toBe("msg-6");
		expect(result[9].content).toBe("msg-15");
		expect(selectHistoryForSend(msgs, "hybrid", 2)).toEqual(msgs);
	});

	it("does not mutate the input, and clamps a boundary past the end", () => {
		const copy = msgs.map(m => ({ ...m }));
		expect(selectHistoryForSend(msgs, "summary", 99)).toEqual([]);
		expect(msgs).toEqual(copy);
	});
});

describe("resumeBoundary / omittedByResume (ADR-231)", () => {
	const messages = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}` }));

	it("counts up to and including the message the conversation was resumed after", () => {
		expect(resumeBoundary({ resumeMode: "summary", resumedAfterId: "m3", messages })).toBe(4);
		expect(omittedByResume({ resumeMode: "summary", resumedAfterId: "m3", messages })).toBe(4);
		expect(omittedByResume({ resumeMode: "hybrid", resumedAfterId: "m7", messages })).toBe(2);
		expect(omittedByResume({ resumeMode: "hybrid", resumedAfterId: "m3", messages })).toBe(0);
	});

	it("is 0 for full, for no resume point, and for a resume point that is gone", () => {
		expect(resumeBoundary({ resumeMode: "full", resumedAfterId: "m3", messages })).toBe(0);
		expect(resumeBoundary({ resumeMode: "summary", messages })).toBe(0);
		expect(resumeBoundary({ resumeMode: "summary", resumedAfterId: "deleted", messages })).toBe(0);
	});
});

// ── trimHistoryToBudget ──────────────────────────────────────────────────────

describe("trimHistoryToBudget", () => {
	const mkMsg = (content: string) => ({ role: "user", content });

	it("returns history unchanged when within budget", () => {
		const history = [mkMsg("short")];
		const result = trimHistoryToBudget(history, 100_000, 4096, 500);
		expect(result).toBe(history);
	});

	it("trims oldest messages when history exceeds budget", () => {
		const big = "x".repeat(4000);
		const history = [mkMsg(big), mkMsg(big), mkMsg("keep")];
		const result = trimHistoryToBudget(history, 3000, 1000, 500);
		expect(result.length).toBeLessThan(history.length);
		expect(result[result.length - 1].content).toBe("keep");
	});

	it("never trims below one message", () => {
		const history = [mkMsg("x".repeat(100_000))];
		const result = trimHistoryToBudget(history, 1000, 500, 500);
		expect(result).toHaveLength(1);
	});

	it("does not mutate the input array", () => {
		const big = "x".repeat(4000);
		const history = [mkMsg(big), mkMsg(big), mkMsg("last")];
		const copy = [...history];
		trimHistoryToBudget(history, 4000, 1000, 500);
		expect(history).toEqual(copy);
	});

	it("returns history unchanged when available budget is zero or negative", () => {
		const history = [mkMsg("hello")];
		const result = trimHistoryToBudget(history, 1000, 900, 200);
		expect(result).toBe(history);
	});
});

// ── estimateTokensFromText ──────────────────────────────────────────────────

describe("estimateTokensFromText", () => {
	it("returns 0 for empty string", () => {
		expect(estimateTokensFromText("")).toBe(0);
	});

	it("estimates ~1 token per 4 ASCII characters", () => {
		const tokens = estimateTokensFromText("a".repeat(400));
		expect(tokens).toBe(100);
	});

	it("estimates more tokens for non-ASCII text", () => {
		const ascii = estimateTokensFromText("a".repeat(300));
		const cjk = estimateTokensFromText("一".repeat(300));
		expect(cjk).toBeGreaterThan(ascii);
	});
});

// ── arrayBufferToBase64 ────────────────────────────────────────────────────────

describe("arrayBufferToBase64", () => {
	it("round-trips arbitrary bytes through base64", () => {
		const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 42, 7]);
		const b64 = arrayBufferToBase64(bytes.buffer);
		expect(b64).toBe(Buffer.from(bytes).toString("base64"));
	});

	it("handles a buffer larger than one 0x8000-byte chunk", () => {
		const size = 0x8000 * 2 + 17;
		const bytes = new Uint8Array(size);
		for (let i = 0; i < size; i++) bytes[i] = i % 256;
		const b64 = arrayBufferToBase64(bytes.buffer);
		expect(b64).toBe(Buffer.from(bytes).toString("base64"));
	});

	it("returns an empty string for an empty buffer", () => {
		expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
	});
});

// ── buildFavoritesDigest ───────────────────────────────────────────────────────

describe("buildFavoritesDigest", () => {
	const msg = (id: string, role: "user" | "assistant", content: string, chapterName?: string): Message =>
		({ id, role, content, timestamp: "2026-01-01T00:00:00.000Z", ...(chapterName ? { chapterName } : {}) });

	const fav = (messageId: string, extra: Partial<Favorite> = {}): Favorite =>
		({ id: `f-${messageId}-${extra.text ?? "x"}`, messageId, name: "n", ...extra });

	const makeConv = (messages: Message[], favorites: Favorite[]): Conversation =>
		({
			id: "c", name: "c", createdAt: "", updatedAt: "", systemPrompt: "",
			contextNotes: [], resumeMode: "full", provider: "anthropic",
			model: "m", messages, favorites,
		});

	it("returns empty string when there are no favorites", () => {
		const conv = makeConv([msg("m1", "user", "hi")], []);
		expect(buildFavoritesDigest(conv)).toBe("");
	});

	it("uses fav.text as the insight and includes the preceding user question", () => {
		const conv = makeConv(
			[msg("u1", "user", "What is X?", "About X"), msg("a1", "assistant", "X is a long answer about many things.")],
			[fav("a1", { text: "X is a long answer" })],
		);
		const digest = buildFavoritesDigest(conv);
		expect(digest).toContain("Insight: X is a long answer");
		expect(digest).toContain("Context (question): About X");
	});

	it("falls back to full message content for legacy favorites with no text", () => {
		const conv = makeConv(
			[msg("u1", "user", "Q?"), msg("a1", "assistant", "Full assistant content.")],
			[fav("a1")], // no text → legacy
		);
		const digest = buildFavoritesDigest(conv);
		expect(digest).toContain("Insight: Full assistant content.");
	});

	it("orders favorites by their message position in the conversation", () => {
		const conv = makeConv(
			[
				msg("u1", "user", "first"), msg("a1", "assistant", "answer one"),
				msg("u2", "user", "second"), msg("a2", "assistant", "answer two"),
			],
			// Provided out of order — should be reordered a1 before a2.
			[fav("a2", { text: "answer two" }), fav("a1", { text: "answer one" })],
		);
		const digest = buildFavoritesDigest(conv);
		expect(digest.indexOf("answer one")).toBeLessThan(digest.indexOf("answer two"));
	});

	it("skips favorites whose messageId no longer resolves", () => {
		const conv = makeConv(
			[msg("a1", "assistant", "kept")],
			[fav("a1", { text: "kept" }), fav("deleted", { text: "gone" })],
		);
		const digest = buildFavoritesDigest(conv);
		expect(digest).toContain("kept");
		expect(digest).not.toContain("gone");
	});

	it("returns empty string when every favorite references a missing message", () => {
		const conv = makeConv([msg("a1", "assistant", "x")], [fav("ghost", { text: "y" })]);
		expect(buildFavoritesDigest(conv)).toBe("");
	});
});

describe("formatClockTime", () => {
	it("formats an ISO timestamp as zero-padded 24h HH:MM", () => {
		// Local-time based; construct via a Date so the assertion is offset-agnostic.
		const d = new Date(2026, 7, 24, 9, 5);
		expect(formatClockTime(d.toISOString())).toBe("09:05");
	});
	it("pads afternoon hours and minutes", () => {
		const d = new Date(2026, 0, 1, 14, 31);
		expect(formatClockTime(d.toISOString())).toBe("14:31");
	});
	it("returns empty string for undefined or unparseable input", () => {
		expect(formatClockTime(undefined)).toBe("");
		expect(formatClockTime("not-a-date")).toBe("");
	});
});

// ── lastTokenUsageMessage ─────────────────────────────────────────────────────

describe("lastTokenUsageMessage", () => {
	const msg = (id: string, usage?: { inputTokens: number; outputTokens: number }) =>
		({ id, tokenUsage: usage }) as unknown as Message;

	it("returns the last message carrying usage, not the last message", () => {
		const messages = [
			msg("a", { inputTokens: 10, outputTokens: 20 }),
			msg("b", { inputTokens: 30, outputTokens: 40 }),
			msg("c"),
		];
		expect(lastTokenUsageMessage(messages)?.id).toBe("b");
	});

	it("returns undefined when no message carries usage", () => {
		expect(lastTokenUsageMessage([msg("a"), msg("b")])).toBeUndefined();
	});

	it("returns undefined for an empty conversation", () => {
		expect(lastTokenUsageMessage([])).toBeUndefined();
	});
});

// ── unwrapCodeFence (moved out of sidebar.ts, ADR-130 session) ────────────────

describe("unwrapCodeFence", () => {
	it("strips a plain outer fence wrapping a single labelled fence", () => {
		const input = "```\n```ts\nconst a = 1;\n```\n```";
		expect(unwrapCodeFence(input)).toBe("```ts\nconst a = 1;\n```");
	});

	it("leaves a normal labelled fence untouched", () => {
		const input = "```ts\nconst a = 1;\n```";
		expect(unwrapCodeFence(input)).toBe(input);
	});

	it("leaves an unlabelled fence with ordinary content untouched", () => {
		const input = "```\nplain text\n```";
		expect(unwrapCodeFence(input)).toBe(input);
	});

	it("unwraps every occurrence, not just the first", () => {
		const input = "```\n```ts\na\n```\n```\n\ntext\n\n```\n```js\nb\n```\n```";
		expect(unwrapCodeFence(input)).toBe("```ts\na\n```\n\ntext\n\n```js\nb\n```");
	});

	it("is a no-op on text with no fences", () => {
		expect(unwrapCodeFence("just prose")).toBe("just prose");
	});
});

describe("formatDate", () => {
	it("renders the one Pythia date format, day-month-year", () => {
		expect(formatDate("2026-09-15T04:39:00")).toBe("15 Sep 2026");
		expect(formatDate("2026-01-01T12:00:00")).toBe("1 Jan 2026");
		expect(formatDate("2026-12-31T23:59:00")).toBe("31 Dec 2026");
	});

	it("does not follow the runtime locale, so the label cannot shift under a user", () => {
		// The whole reason this is not toLocaleDateString: German would render
		// "15. Sept. 2026" and US English "Sep 15, 2026" — different order, width
		// and punctuation, in a fixed-width mono label.
		const out = formatDate("2026-09-15T04:39:00");
		expect(out).not.toContain(".");
		expect(out).not.toContain(",");
	});

	it("returns empty for a missing or unparseable input", () => {
		expect(formatDate(undefined)).toBe("");
		expect(formatDate("not a date")).toBe("");
	});
});

describe("formatMonthYear", () => {
	it("renders the history group header", () => {
		expect(formatMonthYear("2026-09-15T04:39:00")).toBe("SEP 2026");
		expect(formatMonthYear("")).toBe("");
	});
});

describe("formatSummaryTimestamp", () => {
	it("joins the shared date and 24-hour clock formats", () => {
		expect(formatSummaryTimestamp("2026-09-15T04:39:00")).toBe("15 Sep 2026 · 04:39");
	});
});

// ── parseToolArguments ───────────────────────────────────────────────────────

import { parseToolArguments, cleanGeneratedTitle } from "../services/messageUtils";

describe("parseToolArguments", () => {
	it("parses a JSON object", () => {
		expect(parseToolArguments('{"path":"a.md"}')).toEqual({ ok: true, input: { path: "a.md" } });
	});

	it("treats an empty argument string as no arguments", () => {
		expect(parseToolArguments("  ")).toEqual({ ok: true, input: {} });
	});

	it("returns an Error tool result for malformed JSON instead of an empty object", () => {
		const r = parseToolArguments('{"path": "a.md"');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/^Error: tool arguments were not valid JSON/);
	});

	it("rejects a JSON value that is not an object", () => {
		expect(parseToolArguments("[1,2]").ok).toBe(false);
		expect(parseToolArguments("null").ok).toBe(false);
	});
});

describe("cleanGeneratedTitle", () => {
	it("strips surrounding quotes and a trailing period", () => {
		expect(cleanGeneratedTitle('"Kapitel über Zähler."')).toBe("Kapitel über Zähler");
		expect(cleanGeneratedTitle("“Smart Quotes”")).toBe("Smart Quotes");
	});

	it("keeps only the first non-empty line and drops a Title: label", () => {
		expect(cleanGeneratedTitle("\nTitle: Energy Markets\nSecond line")).toBe("Energy Markets");
	});

	it("removes markdown decoration a model adds despite instructions", () => {
		expect(cleanGeneratedTitle("**Bold Title**")).toBe("Bold Title");
		expect(cleanGeneratedTitle("# Heading")).toBe("Heading");
	});

	it("returns an empty string for an empty reply", () => {
		expect(cleanGeneratedTitle("")).toBe("");
		expect(cleanGeneratedTitle("  \n ")).toBe("");
	});
});
