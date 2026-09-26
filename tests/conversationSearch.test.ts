import { describe, it, expect } from "vitest";
import type { Conversation, Message } from "../models/types";
import { buildConversationFields, bestMatchSnippet, snippetLines } from "../services/conversationSearch";
import { tokenize } from "../services/noteRelevance";

let seq = 0;
function msg(content: string, role: Message["role"] = "user"): Message {
	return { id: `m${seq++}`, role, content, timestamp: "2026-01-01T00:00:00.000Z" };
}

function conv(partial: Partial<Conversation> & { name: string }): Conversation {
	return {
		id: partial.id ?? `c${seq++}`,
		createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
		updatedAt: partial.updatedAt ?? "2026-01-01T00:00:00.000Z",
		systemPrompt: "",
		contextNotes: [],
		resumeMode: "full",
		provider: "anthropic",
		model: "claude",
		messages: partial.messages ?? [],
		...partial,
	} as Conversation;
}

describe("bestMatchSnippet", () => {
	it("returns the best-matching message line", () => {
		const c = conv({
			name: "notes",
			messages: [msg("first line about nothing\nthe kayak trip was great\nfinal line")],
		});
		expect(bestMatchSnippet(tokenize("kayak"), c, buildConversationFields(c))).toBe("the kayak trip was great");
	});

	it("matches a message line by prefix", () => {
		const c = conv({ name: "x", messages: [msg("the kayaking was great")] });
		expect(bestMatchSnippet(tokenize("kayak"), c, buildConversationFields(c))).toBe("the kayaking was great");
	});

	it("returns null when the hit is only in the title or summary", () => {
		const c = conv({
			name: "kayak",
			summaryText: "about a kayak",
			messages: [msg("no body match here")],
		});
		expect(bestMatchSnippet(tokenize("kayak"), c, buildConversationFields(c))).toBeNull();
	});

	it("returns null for an empty query", () => {
		const c = conv({ name: "x", messages: [msg("anything")] });
		expect(bestMatchSnippet([], c, buildConversationFields(c))).toBeNull();
	});

	it("truncates a long matching line with an ellipsis", () => {
		const long = `kayak ${"word ".repeat(60)}`.trim();
		const c = conv({ name: "x", messages: [msg(long)] });
		const snippet = bestMatchSnippet(tokenize("kayak"), c, buildConversationFields(c), 40)!;
		expect(snippet.length).toBeLessThanOrEqual(41);
		expect(snippet.endsWith("…")).toBe(true);
	});
});

describe("snippet line cache", () => {
	it("tokenizes a conversation's lines once and reuses them", () => {
		// The panel calls bestMatchSnippet once per rendered row per keystroke.
		// Re-tokenizing every line each time was 99% of the typing cost.
		const c = conv({ name: "x", messages: [msg("first line\nthe kayak trip\nlast line")] });
		const fields = buildConversationFields(c);
		expect(fields.lines).toBeNull();                 // not built up front

		const first = snippetLines(c, fields);
		expect(first).toHaveLength(3);
		expect(fields.lines).toBe(first);                // cached on the fields
		expect(snippetLines(c, fields)).toBe(first);     // and reused, not rebuilt
	});

	it("drops blank lines and keeps the text for display", () => {
		const c = conv({ name: "x", messages: [msg("alpha\n\n   \nbeta")] });
		const lines = snippetLines(c, buildConversationFields(c));
		expect(lines.map((l) => l.text)).toEqual(["alpha", "beta"]);
	});

	it("survives a malformed conversation", () => {
		const broken = conv({ name: "b", messages: [null as unknown as Message] });
		expect(() => snippetLines(broken, buildConversationFields(broken))).not.toThrow();
	});
});
