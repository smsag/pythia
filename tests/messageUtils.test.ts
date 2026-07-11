import { describe, it, expect } from "vitest";
import {
	parseTitleAndSummary,
	normalizeMessages,
	selectHistoryForSend,
	langInstruction,
	langSuffix,
	LANG_LABELS,
	arrayBufferToBase64,
} from "../services/messageUtils";

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
