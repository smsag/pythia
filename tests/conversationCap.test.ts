import { describe, it, expect } from "vitest";
import {
	partitionEvictions,
	countEvictions,
} from "../services/persistence";
import type { Conversation } from "../models/types";

// The conversation cap: which conversations an eviction keeps (ADR-088/130),
// how many it would remove (ADR-171)
// Split out of tests/persistence.test.ts under the ADR-097 ratchet.

const makeConv = (
	id: string,
	updatedAt = "2026-01-01T00:00:00.000Z",
	favorites: unknown[] = [],
): Conversation => ({
	id,
	name: id,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt,
	systemPrompt: "",
	contextNotes: [],
	resumeMode: "full",
	provider: "anthropic",
	model: "claude-sonnet-4-6",
	messages: [],
	favorites: favorites as Conversation["favorites"],
});

// ── partitionEvictions(…).kept ────────────────────────────────────────────────────────

const keptBy = (...args: Parameters<typeof partitionEvictions>) => partitionEvictions(...args).kept;

describe("partitionEvictions — kept", () => {
	it("returns the input unchanged when under cap", () => {
		const convs = [makeConv("a"), makeConv("b")];
		expect(keptBy(convs, 5, [])).toHaveLength(2);
	});

	it("protects a conversation another conversation has merged with (ADR-130)", () => {
		// "old" is the stalest and would normally be evicted first; a merge link
		// pointing at it must keep it alive, or the link silently stops painting.
		const old = makeConv("old", "2020-01-01T00:00:00.000Z");
		const mid = makeConv("mid", "2026-02-01T00:00:00.000Z");
		const recent = makeConv("recent", "2026-03-01T00:00:00.000Z");
		recent.merges = [
			{ id: "m1", conversationId: "old", messageId: "msg1", text: "passage", createdAt: "2026-03-01T00:00:00.000Z" },
		];
		const kept = keptBy([old, mid, recent], 2, []).map((c) => c.id);
		expect(kept).toContain("old");
		expect(kept).toContain("recent");
		expect(kept).not.toContain("mid");
	});

	it("protects a conversation a note links to (ADR-249)", () => {
		// The link lives in the note, where the cap cannot see it; the record on
		// the conversation is what keeps the note from pointing at nothing.
		const old = makeConv("old", "2020-01-01T00:00:00.000Z");
		old.noteAnchors = [{ path: "Notes/Rent.md", messageId: "u1", createdAt: "2026-03-01T00:00:00.000Z" }];
		const mid = makeConv("mid", "2026-02-01T00:00:00.000Z");
		const recent = makeConv("recent", "2026-03-01T00:00:00.000Z");
		const kept = keptBy([old, mid, recent], 2, []).map((c) => c.id);
		expect(kept).toEqual(["old", "recent"]);
		expect(countEvictions([old, mid, recent], 2, [])).toBe(1);
	});

	it("returns the input unchanged when at exactly the cap", () => {
		const convs = [makeConv("a"), makeConv("b"), makeConv("c")];
		expect(keptBy(convs, 3, [])).toHaveLength(3);
	});

	it("returns all conversations when cap is 0 (unlimited)", () => {
		const convs = Array.from({ length: 10 }, (_, i) => makeConv(String(i)));
		expect(keptBy(convs, 0, [])).toHaveLength(10);
	});

	it("evicts down to cap, keeping the newest conversations", () => {
		const convs = [
			makeConv("old", "2026-01-01T00:00:00.000Z"),
			makeConv("mid", "2026-06-01T00:00:00.000Z"),
			makeConv("new", "2026-12-01T00:00:00.000Z"),
		];
		const result = keptBy(convs, 2, []);
		expect(result).toHaveLength(2);
		const ids = result.map((c) => c.id);
		expect(ids).toContain("new");
		expect(ids).toContain("mid");
		expect(ids).not.toContain("old");
	});

	it("always keeps the active conversation even if it is the oldest", () => {
		const convs = [
			makeConv("oldest", "2026-01-01T00:00:00.000Z"),
			makeConv("newer",  "2026-06-01T00:00:00.000Z"),
			makeConv("newest", "2026-12-01T00:00:00.000Z"),
		];
		const result = keptBy(convs, 2, ["oldest"]);
		const ids = result.map((c) => c.id);
		expect(ids).toContain("oldest");
		expect(ids).toContain("newest");
		expect(ids).not.toContain("newer");
	});

	it("always keeps starred conversations even if they are the oldest", () => {
		const convs = [
			makeConv("starred-old", "2026-01-01T00:00:00.000Z", [{ messageId: "m1", name: "fav" }]),
			makeConv("newer",       "2026-06-01T00:00:00.000Z"),
			makeConv("newest",      "2026-12-01T00:00:00.000Z"),
		];
		const result = keptBy(convs, 2, []);
		const ids = result.map((c) => c.id);
		expect(ids).toContain("starred-old");
		expect(ids).toContain("newest");
		expect(ids).not.toContain("newer");
	});

	it("handles more protected conversations than cap without crashing", () => {
		const starred = Array.from({ length: 5 }, (_, i) =>
			makeConv(`s${i}`, "2026-01-01T00:00:00.000Z", [{ messageId: "m", name: "f" }])
		);
		const result = keptBy(starred, 3, []);
		// all starred must survive — result may exceed cap
		expect(result.length).toBe(5);
	});

	it("preserves the input order of survivors (does not re-sort by updatedAt)", () => {
		// updatedAt: a=Jan, b=Mar, c=Dec, d=Jun. cap 3 → the oldest plain ("a")
		// is evicted; b, c, d survive in their original relative order.
		const convs = [
			makeConv("a", "2026-01-01T00:00:00.000Z"),
			makeConv("b", "2026-03-01T00:00:00.000Z"),
			makeConv("c", "2026-12-01T00:00:00.000Z"),
			makeConv("d", "2026-06-01T00:00:00.000Z"),
		];
		const result = keptBy(convs, 3, []);
		expect(result.map((c) => c.id)).toEqual(["b", "c", "d"]);
	});

	it("keeps the most recent conversation reachable as the last array element", () => {
		// Regression for the post-eviction reorder bug: onOpen / delete fall back to
		// conversations[length - 1] as "most recent", which must stay the newest
		// survivor by insertion order after an eviction.
		const convs = [
			makeConv("old",    "2026-01-01T00:00:00.000Z"),
			makeConv("mid",    "2026-06-01T00:00:00.000Z"),
			makeConv("newest", "2026-12-01T00:00:00.000Z"),
		];
		const result = keptBy(convs, 2, []);
		expect(result.at(-1)?.id).toBe("newest");
	});

	it("protects both the active conversation and starred conversations simultaneously", () => {
		const convs = [
			makeConv("active-old", "2026-01-01T00:00:00.000Z"),
			makeConv("starred-old", "2026-01-02T00:00:00.000Z", [{ messageId: "m", name: "f" }]),
			makeConv("plain-new",   "2026-12-01T00:00:00.000Z"),
			makeConv("plain-old",   "2026-06-01T00:00:00.000Z"),
		];
		const result = keptBy(convs, 3, ["active-old"]);
		const ids = result.map((c) => c.id);
		expect(ids).toContain("active-old");
		expect(ids).toContain("starred-old");
		expect(ids).toContain("plain-new");
		expect(ids).not.toContain("plain-old");
	});

	it("does not throw when a conversation has a malformed/missing updatedAt", () => {
		const convs = [
			makeConv("good", "2026-06-01T00:00:00.000Z"),
			{ ...makeConv("bad"), updatedAt: undefined as unknown as string },
			makeConv("newest", "2026-12-01T00:00:00.000Z"),
		];
		expect(() => keptBy(convs, 2, [])).not.toThrow();
	});

	it("protects the active conversation from every open leaf, not just one", () => {
		const convs = [
			makeConv("leaf1-active", "2026-01-01T00:00:00.000Z"),
			makeConv("leaf2-active", "2026-01-02T00:00:00.000Z"),
			makeConv("plain-new",    "2026-12-01T00:00:00.000Z"),
			makeConv("plain-old",    "2026-06-01T00:00:00.000Z"),
		];
		const result = keptBy(convs, 2, ["leaf1-active", "leaf2-active"]);
		const ids = result.map((c) => c.id);
		expect(ids).toContain("leaf1-active");
		expect(ids).toContain("leaf2-active");
		expect(ids).not.toContain("plain-old");
	});
});

// ── countEvictions ────────────────────────────────────────────────────────────

describe("countEvictions", () => {
	it("counts nothing for the unlimited cap, whatever the corpus", () => {
		const convs = Array.from({ length: 10 }, (_, i) => makeConv(String(i)));
		expect(countEvictions(convs, 0, [])).toBe(0);
	});

	it("counts nothing while the corpus fits under the cap", () => {
		expect(countEvictions([makeConv("a"), makeConv("b")], 5, [])).toBe(0);
	});

	it("counts what a lower cap would delete", () => {
		const convs = Array.from({ length: 10 }, (_, i) => makeConv(String(i)));
		expect(countEvictions(convs, 3, [])).toBe(7);
	});

	it("does not count the protected conversations the eviction keeps", () => {
		// A cap of 1 against three conversations looks like two deletions until the
		// star and the open conversation are accounted for — the dialog must name
		// the number the write will actually perform, so the count comes from the
		// eviction itself.
		const convs = [
			makeConv("starred", "2026-01-01T00:00:00.000Z", [{ messageId: "m1", name: "fav" }]),
			makeConv("open",    "2026-06-01T00:00:00.000Z"),
			makeConv("plain",   "2026-12-01T00:00:00.000Z"),
		];
		expect(countEvictions(convs, 1, ["open"])).toBe(1);
	});
});

