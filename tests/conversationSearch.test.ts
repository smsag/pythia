import { describe, it, expect } from "vitest";
import type { Conversation, Message } from "../models/types";
import {
	buildConversationFields,
	noteRefs,
	rankConversations,
	searchConversations,
	bestMatchSnippet,
	snippetLines,
	SEARCH_RESULT_LIMIT,
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
	const [ranked] = rankConversations(tokenize(query), [c], [buildConversationFields(c)]);
	return ranked?.score ?? 0;
}

describe("buildConversationFields", () => {
	it("includes the conversation title", () => {
		const c = conv({ name: "budget planning", messages: [msg("hello world")] });
		expect(buildConversationFields(c).title).toContain("budget");
	});

	it("includes message content", () => {
		const c = conv({ name: "chat", messages: [msg("the mitochondria is the powerhouse")] });
		expect(buildConversationFields(c).body).toContain("mitochondria");
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
		const ranked = rankConversations([], items, items.map(buildConversationFields));
		expect(ranked.map((r) => r.conversation.name)).toEqual(["recent", "older"]);
	});

	it("ranks a content hit above a non-match and drops the non-match", () => {
		const hit = conv({ name: "trip", messages: [msg("we rented a kayak on the lake")] });
		const miss = conv({ name: "taxes", messages: [msg("quarterly filing deadlines")] });
		const items = [hit, miss];
		const ranked = rankConversations(
			tokenize("kayak"),
			items,
			items.map(buildConversationFields)
		);
		expect(ranked).toHaveLength(1);
		expect(ranked[0].conversation.name).toBe("trip");
	});

	it("matches conversation titles, not just message bodies", () => {
		const c = conv({ name: "onboarding checklist", messages: [msg("unrelated body")] });
		expect(scoreOne("onboarding", c)).toBeGreaterThan(0);
	});

	it("ranks a title match above a body-only match", () => {
		const titleHit = conv({ name: "budget review", messages: [msg("hello world")] });
		const bodyHit = conv({ name: "misc", messages: [msg("the budget was tight")] });
		const items = [bodyHit, titleHit];
		const ranked = rankConversations(tokenize("budget"), items, items.map(buildConversationFields));
		expect(ranked[0].conversation.name).toBe("budget review");
	});

	it("matches a partial word by prefix (search-as-you-type)", () => {
		// The regression: typing part of a visible title showed nothing (exact-token only).
		const c = conv({ name: "kayaking trip", messages: [msg("unrelated")] });
		expect(scoreOne("kayak", c)).toBeGreaterThan(0); // prefixes "kayaking"
		expect(scoreOne("kay", c)).toBeGreaterThan(0);
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
			items.map(buildConversationFields)
		);
		expect(ranked.map((r) => r.conversation.name)).toEqual(["SSIG rollout"]);
		expect(() => bestMatchSnippet(tokenize("ssig"), nullMsg, buildConversationFields(nullMsg))).not.toThrow();
		expect(() => bestMatchSnippet(tokenize("ssig"), noMessages, buildConversationFields(noMessages))).not.toThrow();
	});

	it("ranks a German umlaut query to the right conversation without umlaut cross-matches", () => {
		// Before Unicode tokenization, "Ernährung"/"Größe"/"Straße" all shed their
		// umlaut and shared stray fragments (e.g. "e"), so a query cross-matched
		// unrelated German titles. Now each word stays whole.
		const hit = conv({ name: "Ernährung und Sport", messages: [msg("gesunde Ernährung im Alltag")] });
		const miss = conv({ name: "Größe der Straße", messages: [msg("Verkehr und Bebauung")] });
		const items = [hit, miss];
		const ranked = rankConversations(tokenize("Ernährung"), items, items.map(buildConversationFields));
		expect(ranked).toHaveLength(1);
		expect(ranked[0].conversation.name).toBe("Ernährung und Sport");
	});

	it("returns nothing when no conversation matches", () => {
		const items = [conv({ name: "alpha", messages: [msg("beta gamma")] })];
		const ranked = rankConversations(
			tokenize("nonexistentword"),
			items,
			items.map(buildConversationFields)
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

describe("rankConversations — recency order tolerates a missing updatedAt", () => {
	it("keeps a deterministic order and sorts the undated conversation last", () => {
		const convs = [
			{ id: "old", name: "old", messages: [], updatedAt: "2026-01-01T00:00:00Z" },
			{ id: "none", name: "none", messages: [] },
			{ id: "new", name: "new", messages: [], updatedAt: "2026-02-01T00:00:00Z" },
		] as unknown as Conversation[];
		const ranked = rankConversations([], convs, convs.map(buildConversationFields));
		expect(ranked.map((r) => r.conversation.id)).toEqual(["new", "old", "none"]);
	});
});

describe("rankConversations — fields are reusable across queries", () => {
	it("ranks the same from a cached field set as from a freshly built one", () => {
		// The panel memoizes `buildConversationFields` for the life of the overlay,
		// so a cached field set must behave exactly like a fresh one.
		const convs = [
			{ id: "a", name: "Kayak", messages: [msg("we rented a kayak")], updatedAt: "" },
			{ id: "b", name: "Tax", messages: [msg("quarterly filing")], updatedAt: "" },
		] as unknown as Conversation[];
		const cached = convs.map(buildConversationFields);
		const q = tokenize("kayak");
		const fresh = rankConversations(q, convs, convs.map(buildConversationFields)).map((r) => r.conversation.id);
		const reused = rankConversations(q, convs, cached).map((r) => r.conversation.id);
		expect(reused).toEqual(fresh);
		expect(reused).toEqual(["a"]);
	});
});

describe("noteRefs — the note dimension (ADR-168)", () => {
	it("collects attached, cited and template notes, deduped", () => {
		const c = conv({
			name: "x",
			messages: [
				{ ...msg("q"), attachedNotes: ["Recht/Mietvertrag.md"], templateId: "Pythia/Templates/Brief.md" },
				{
					...msg("a", "assistant"),
					attachedNotes: ["Recht/Mietvertrag.md"], // same note, second turn
					sources: [{ n: 1, kind: "vault", ref: "Recht/Kündigung.md", title: "Kündigung" }],
				},
			],
		});
		expect(noteRefs(c).sort()).toEqual([
			"Pythia/Templates/Brief.md",
			"Recht/Kündigung.md",
			"Recht/Mietvertrag.md",
		]);
	});

	it("weights a cited note the same as an attached one", () => {
		const attached = conv({
			name: "A",
			messages: [{ ...msg("q"), attachedNotes: ["Recht/Mietvertrag.md"] }],
		});
		const cited = conv({
			name: "B",
			messages: [
				{
					...msg("a", "assistant"),
					sources: [{ n: 1, kind: "vault", ref: "Recht/Mietvertrag.md", title: "Mietvertrag" }],
				},
			],
		});
		const items = [attached, cited];
		const ranked = rankConversations(tokenize("mietvertrag"), items, items.map(buildConversationFields), "notes");
		expect(ranked).toHaveLength(2);
		expect(ranked[0].score).toBeCloseTo(ranked[1].score, 10);
	});

	it("survives malformed note records", () => {
		const c = conv({
			name: "broken",
			messages: [
				{ ...msg("q"), attachedNotes: [null, "", "ok.md"] as unknown as string[] },
				{ ...msg("a", "assistant"), sources: [null, { kind: "web", ref: "x.com" }] as never },
			],
		});
		expect(() => noteRefs(c)).not.toThrow();
		expect(noteRefs(c)).toEqual(["ok.md"]);
	});

	it("does not tokenize the .md extension into a searchable term", () => {
		const c = conv({ name: "x", messages: [{ ...msg("q"), attachedNotes: ["Notes/Thing.md"] }] });
		const [note] = buildConversationFields(c).notes;
		expect(note.tokens).toContain("thing");
		expect(note.tokens).not.toContain("md");
	});
});

describe("scope — conversations only by default", () => {
	const withNote = conv({
		name: "Tuesday chat",
		messages: [{ ...msg("what about this"), attachedNotes: ["Recht/Mietvertrag.md"] }],
	});

	it("does NOT match an attached note at the default scope", () => {
		const items = [withNote];
		expect(rankConversations(tokenize("mietvertrag"), items, items.map(buildConversationFields))).toEqual([]);
	});

	it("matches it under the notes scope, and reports which note did it", () => {
		const items = [withNote];
		const ranked = rankConversations(tokenize("mietvertrag"), items, items.map(buildConversationFields), "notes");
		expect(ranked).toHaveLength(1);
		expect(ranked[0].matchedNotes).toEqual(["Recht/Mietvertrag.md"]);
	});

	it("leaves matchedNotes empty for an ordinary text hit", () => {
		const items = [withNote];
		const ranked = rankConversations(tokenize("tuesday"), items, items.map(buildConversationFields));
		expect(ranked[0].matchedNotes).toEqual([]);
	});
});

describe("searchConversations — auto-widening", () => {
	const noteHit = conv({
		name: "Tuesday chat",
		messages: [{ ...msg("unrelated body"), attachedNotes: ["Recht/Mietvertrag.md"] }],
	});
	const textHit = (name: string) => conv({ name, messages: [msg("mietvertrag im text")] });

	it("widens when the conversation text comes back thin, and says which note did it", () => {
		const items = [noteHit];
		const out = searchConversations("mietvertrag", items, items.map(buildConversationFields));
		expect(out.primary).toEqual([]);
		expect(out.widened.map((r) => r.conversation.name)).toEqual(["Tuesday chat"]);
		// Every widened row must be explainable — that is the whole contract.
		expect(out.widened[0].matchedNotes).toEqual(["Recht/Mietvertrag.md"]);
	});

	it("does not widen once the narrow search has enough hits", () => {
		const items = [noteHit, textHit("a"), textHit("b"), textHit("c")];
		const out = searchConversations("mietvertrag", items, items.map(buildConversationFields));
		expect(out.primary.length).toBeGreaterThanOrEqual(3);
		expect(out.widened).toEqual([]);
	});

	it("never widens while picking a conversation (ADR-143)", () => {
		const items = [noteHit];
		const out = searchConversations("mietvertrag", items, items.map(buildConversationFields), { picking: true });
		expect(out.widened).toEqual([]);
	});

	it("never widens when the user named a scope — they are already in control", () => {
		const items = [noteHit];
		expect(searchConversations("conv: mietvertrag", items, items.map(buildConversationFields)).widened).toEqual([]);
		const explicit = searchConversations("note: mietvertrag", items, items.map(buildConversationFields));
		expect(explicit.widened).toEqual([]);
		expect(explicit.primary).toHaveLength(1); // it is in the primary list instead
	});

	it("never widens on an empty query — that is the browse listing", () => {
		const items = [noteHit];
		const out = searchConversations("   ", items, items.map(buildConversationFields));
		expect(out.queryTokens).toEqual([]);
		expect(out.widened).toEqual([]);
	});

	it("never duplicates a conversation across primary and widened", () => {
		const both = conv({
			name: "Mietvertrag",
			messages: [{ ...msg("mietvertrag"), attachedNotes: ["Recht/Mietvertrag.md"] }],
		});
		const items = [both];
		const out = searchConversations("mietvertrag", items, items.map(buildConversationFields));
		expect(out.primary).toHaveLength(1);
		expect(out.widened).toEqual([]);
	});
});

describe("graded matching in search (ADR-168)", () => {
	it("finds a German compound from its head ('Vertrag' → 'Mietvertrag')", () => {
		const c = conv({ name: "x", messages: [msg("der Mietvertrag läuft aus")] });
		expect(scoreOne("Vertrag", c)).toBeGreaterThan(0);
	});

	it("finds a shorter stored form from a longer typed word ('boundaries' → 'bound')", () => {
		const c = conv({ name: "x", messages: [msg("we agreed on a bound for the budget")] });
		expect(scoreOne("boundaries", c)).toBeGreaterThan(0);
	});

	it("ranks the exact hit above the compound hit", () => {
		const exact = conv({ name: "a", messages: [msg("vertrag vertrag")] });
		const compound = conv({ name: "b", messages: [msg("mietvertrag")] });
		const items = [compound, exact];
		const ranked = rankConversations(tokenize("vertrag"), items, items.map(buildConversationFields));
		expect(ranked[0].conversation.name).toBe("a");
	});

	it("keeps a stopword from dragging the whole corpus into the result list", () => {
		// "in" is 2 chars — below the reverse-match floor — so a query for a long
		// word must not match every conversation that merely contains it.
		const items = [
			conv({ name: "a", messages: [msg("in the house")] }),
			conv({ name: "b", messages: [msg("in the garden")] }),
			conv({ name: "c", messages: [msg("integration testing")] }),
		];
		const ranked = rankConversations(tokenize("integration"), items, items.map(buildConversationFields));
		expect(ranked.map((r) => r.conversation.name)).toEqual(["c"]);
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

describe("search results are capped (ADR-170)", () => {
	const many = (n: number) =>
		Array.from({ length: n }, (_, i) => conv({ id: `c${i}`, name: `kayak trip ${i}`, messages: [msg("we rented a kayak")] }));

	it("renders at most SEARCH_RESULT_LIMIT rows however many match", () => {
		const items = many(SEARCH_RESULT_LIMIT + 25);
		const out = searchConversations("kayak", items, items.map(buildConversationFields));
		expect(out.primary).toHaveLength(SEARCH_RESULT_LIMIT);
	});

	it("keeps the BEST rows, not the first N", () => {
		// The decoys match in the BODY only; the last one matches in the title,
		// which is worth 3x — so it must survive a cap that slices from the end.
		const decoys = Array.from({ length: SEARCH_RESULT_LIMIT + 5 }, (_, i) =>
			conv({ id: `d${i}`, name: `trip ${i}`, messages: [msg("we rented a kayak")] })
		);
		const items = [...decoys, conv({ id: "top", name: "kayak", messages: [msg("kayak kayak")] })];
		const out = searchConversations("kayak", items, items.map(buildConversationFields));
		// The cap slices an already-sorted list, so the top scorer must survive it.
		expect(out.primary[0].score).toBeGreaterThanOrEqual(out.primary[out.primary.length - 1].score);
		expect(out.primary.map((r) => r.conversation.id)).toContain("top");
	});

	it("does not let the cap change the auto-widen decision", () => {
		// Widening fires below WIDEN_MIN_RESULTS, far under the cap, so capping
		// after the decision can never alter it.
		const noteHit = conv({
			name: "Tuesday",
			messages: [{ ...msg("unrelated"), attachedNotes: ["Recht/Mietvertrag.md"] }],
		});
		const out = searchConversations("mietvertrag", [noteHit], [buildConversationFields(noteHit)]);
		expect(out.widened).toHaveLength(1);
	});
});
