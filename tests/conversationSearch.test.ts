import { describe, it, expect } from "vitest";
import type { Conversation, Message } from "../models/types";
import {
	buildConversationHaystack,
	rankConversations,
	bestMatchSnippet,
} from "../services/conversationSearch";
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

/** Score a single conversation against a query, isolated from any competing
 *  candidates, to assert "matches / doesn't match" without cross-doc IDF. */
function scoreOne(query: string, c: Conversation): number {
	const [ranked] = rankConversations(tokenize(query), [c], [buildConversationHaystack(c)]);
	return ranked?.score ?? 0;
}

describe("buildConversationHaystack", () => {
	it("weights the title above a single body mention", () => {
		const c = conv({ name: "budget planning", messages: [msg("hello world")] });
		const haystack = buildConversationHaystack(c);
		const occurrences = haystack.split("budget").length - 1;
		expect(occurrences).toBeGreaterThan(1);
	});

	it("includes message content", () => {
		const c = conv({ name: "chat", messages: [msg("the mitochondria is the powerhouse")] });
		expect(buildConversationHaystack(c)).toContain("mitochondria");
	});

	it("includes the LLM summary, enabling synonym recall the messages lack", () => {
		// Messages only ever say "Auto"; the summary paraphrases it as "car".
		const c = conv({
			name: "session",
			summaryText: "A discussion about buying a car.",
			messages: [msg("Welches Auto soll ich kaufen?")],
		});
		expect(scoreOne("car", c)).toBeGreaterThan(0);
	});
});

describe("rankConversations", () => {
	const recent = conv({ name: "recent", updatedAt: "2026-08-01T00:00:00.000Z" });
	const older = conv({ name: "older", updatedAt: "2026-01-01T00:00:00.000Z" });

	it("returns recency order for an empty query, keeping every conversation", () => {
		const items = [older, recent];
		const ranked = rankConversations([], items, items.map(buildConversationHaystack));
		expect(ranked.map((r) => r.conversation.name)).toEqual(["recent", "older"]);
	});

	it("ranks a content hit above a non-match and drops the non-match", () => {
		const hit = conv({ name: "trip", messages: [msg("we rented a kayak on the lake")] });
		const miss = conv({ name: "taxes", messages: [msg("quarterly filing deadlines")] });
		const items = [hit, miss];
		const ranked = rankConversations(
			tokenize("kayak"),
			items,
			items.map(buildConversationHaystack)
		);
		expect(ranked).toHaveLength(1);
		expect(ranked[0].conversation.name).toBe("trip");
	});

	it("matches conversation titles, not just message bodies", () => {
		const c = conv({ name: "onboarding checklist", messages: [msg("unrelated body")] });
		expect(scoreOne("onboarding", c)).toBeGreaterThan(0);
	});

	it("survives malformed records so one bad conversation can't blank out search", () => {
		// Persistence only guarantees `messages` is an array — not that each element
		// is an object or that `content` is a string. An interrupted stream or a
		// legacy entry can leave a null element or undefined content. Because the
		// haystack is built for the whole corpus on every query, a throw here would
		// take down search for ALL conversations (the "search returns nothing" bug).
		const good = conv({ name: "SSIG rollout", summaryText: "notes on SSIG", messages: [msg("kickoff")] });
		const nullMsg = conv({ name: "broken A", messages: [null as unknown as Message] });
		const noContent = conv({ name: "broken B", messages: [{ id: "x", role: "user", timestamp: "" } as unknown as Message] });
		const noMessages = conv({ name: "broken C", messages: undefined as unknown as Message[] });
		const items = [nullMsg, good, noContent, noMessages];

		const ranked = rankConversations(
			tokenize("ssig"),
			items,
			items.map(buildConversationHaystack)
		);
		expect(ranked.map((r) => r.conversation.name)).toEqual(["SSIG rollout"]);
		expect(() => bestMatchSnippet(tokenize("ssig"), nullMsg)).not.toThrow();
		expect(() => bestMatchSnippet(tokenize("ssig"), noMessages)).not.toThrow();
	});

	it("returns nothing when no conversation matches", () => {
		const items = [conv({ name: "alpha", messages: [msg("beta gamma")] })];
		const ranked = rankConversations(
			tokenize("nonexistentword"),
			items,
			items.map(buildConversationHaystack)
		);
		expect(ranked).toEqual([]);
	});
});

describe("bestMatchSnippet", () => {
	it("returns the best-matching message line", () => {
		const c = conv({
			name: "notes",
			messages: [msg("first line about nothing\nthe kayak trip was great\nfinal line")],
		});
		expect(bestMatchSnippet(tokenize("kayak"), c)).toBe("the kayak trip was great");
	});

	it("returns null when the hit is only in the title or summary", () => {
		const c = conv({
			name: "kayak",
			summaryText: "about a kayak",
			messages: [msg("no body match here")],
		});
		expect(bestMatchSnippet(tokenize("kayak"), c)).toBeNull();
	});

	it("returns null for an empty query", () => {
		const c = conv({ name: "x", messages: [msg("anything")] });
		expect(bestMatchSnippet([], c)).toBeNull();
	});

	it("truncates a long matching line with an ellipsis", () => {
		const long = `kayak ${"word ".repeat(60)}`.trim();
		const c = conv({ name: "x", messages: [msg(long)] });
		const snippet = bestMatchSnippet(tokenize("kayak"), c, 40)!;
		expect(snippet.length).toBeLessThanOrEqual(41);
		expect(snippet.endsWith("…")).toBe(true);
	});
});
