import { describe, it, expect } from "vitest";
import {
	parseTitleAndSummary,
	normalizeMessages,
	selectHistoryForSend,
	trimHistoryToBudget,
	estimateTokensFromText,
	langInstruction,
	langSuffix,
	LANG_LABELS,
	arrayBufferToBase64,
	buildFavoritesDigest,
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

describe("selectHistoryForSend", () => {
	const msgs: Msg[] = [
		{ role: "user", content: "Hi" },
		{ role: "assistant", content: "Hello" },
	];

	it("returns full history unchanged when resumeMode is 'full'", () => {
		expect(selectHistoryForSend(msgs, "full")).toBe(msgs);
	});

	it("returns full history unchanged when resumeMode is undefined", () => {
		expect(selectHistoryForSend(msgs, undefined)).toBe(msgs);
	});

	it("returns an empty array when resumeMode is 'summary'", () => {
		expect(selectHistoryForSend(msgs, "summary")).toEqual([]);
	});

	it("does not mutate the input array in 'summary' mode", () => {
		const copy = msgs.map(m => ({ ...m }));
		selectHistoryForSend(msgs, "summary");
		expect(msgs).toEqual(copy);
	});

	it("returns only the last 6 messages in 'hybrid' mode", () => {
		const longHistory: Msg[] = Array.from({ length: 12 }, (_, i) => ({
			role: i % 2 === 0 ? "user" as const : "assistant" as const,
			content: `msg-${i}`,
		}));
		const result = selectHistoryForSend(longHistory, "hybrid");
		expect(result).toHaveLength(6);
		expect(result[0].content).toBe("msg-6");
		expect(result[5].content).toBe("msg-11");
	});

	it("returns all messages in 'hybrid' mode when history is shorter than the tail count", () => {
		expect(selectHistoryForSend(msgs, "hybrid")).toEqual(msgs);
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

// ── langInstruction / langSuffix ──────────────────────────────────────────────

describe("langInstruction", () => {
	it("returns empty string for 'auto'", () => {
		expect(langInstruction("auto")).toBe("");
	});

	it("returns empty string for unknown locale", () => {
		expect(langInstruction("fr")).toBe("");
	});

	it("returns correct instruction for English", () => {
		expect(langInstruction("en")).toBe("\n\nRespond in English.");
	});

	it("returns correct instruction for German", () => {
		expect(langInstruction("de")).toBe("\n\nRespond in German.");
	});
});

describe("langSuffix", () => {
	it("returns empty string for 'auto'", () => {
		expect(langSuffix("auto")).toBe("");
	});

	it("returns empty string for unknown locale", () => {
		expect(langSuffix("zz")).toBe("");
	});

	it("returns ' in English' for 'en'", () => {
		expect(langSuffix("en")).toBe(" in English");
	});

	it("returns ' in German' for 'de'", () => {
		expect(langSuffix("de")).toBe(" in German");
	});
});

describe("LANG_LABELS", () => {
	it("maps 'en' to 'English'", () => {
		expect(LANG_LABELS["en"]).toBe("English");
	});

	it("maps 'de' to 'German'", () => {
		expect(LANG_LABELS["de"]).toBe("German");
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
