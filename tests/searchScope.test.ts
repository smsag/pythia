import { describe, it, expect } from "vitest";
import { parseScope, shouldWiden, WIDEN_MIN_RESULTS } from "../services/searchScope";

describe("parseScope", () => {
	it("defaults to conversations, with the query untouched", () => {
		expect(parseScope("mietvertrag")).toEqual({
			scope: "conversations",
			query: "mietvertrag",
			explicit: false,
		});
	});

	it("reads the note scope and strips the prefix", () => {
		expect(parseScope("note: mietvertrag")).toEqual({
			scope: "notes",
			query: "mietvertrag",
			explicit: true,
		});
	});

	it("accepts the German aliases — this is a German-first plugin", () => {
		expect(parseScope("notiz: miete").scope).toBe("notes");
		expect(parseScope("alle: miete").scope).toBe("all");
		expect(parseScope("gespräch: miete").scope).toBe("conversations");
	});

	it("ignores case and tolerates no space after the colon", () => {
		expect(parseScope("NOTE:miete")).toEqual({ scope: "notes", query: "miete", explicit: true });
	});

	it("treats an unknown prefix as literal text, never as a failed command", () => {
		// A colon in ordinary search text must not become a silent filter.
		expect(parseScope("todo: rewrite the intro")).toEqual({
			scope: "conversations",
			query: "todo: rewrite the intro",
			explicit: false,
		});
		expect(parseScope("https://example.com").scope).toBe("conversations");
	});

	it("only reads a prefix at the start", () => {
		expect(parseScope("see note: over there").query).toBe("see note: over there");
	});

	it("reports an explicit scope with an empty query for a bare prefix", () => {
		expect(parseScope("note:")).toEqual({ scope: "notes", query: "", explicit: true });
	});

	it("tolerates empty and whitespace input", () => {
		expect(parseScope("")).toEqual({ scope: "conversations", query: "", explicit: false });
		expect(parseScope("   ").query).toBe("");
		expect(parseScope(undefined as unknown as string).query).toBe("");
	});
});

describe("shouldWiden", () => {
	const base = { explicit: false, queryTokenCount: 1, narrowCount: 0, picking: false };

	it("widens when the conversation-text search comes back thin", () => {
		expect(shouldWiden(base)).toBe(true);
		expect(shouldWiden({ ...base, narrowCount: WIDEN_MIN_RESULTS - 1 })).toBe(true);
	});

	it("does not widen once there are enough hits", () => {
		expect(shouldWiden({ ...base, narrowCount: WIDEN_MIN_RESULTS })).toBe(false);
	});

	it("does not widen on an empty query — that is the browse listing", () => {
		expect(shouldWiden({ ...base, queryTokenCount: 0 })).toBe(false);
	});

	it("does not widen when the user named a scope", () => {
		expect(shouldWiden({ ...base, explicit: true })).toBe(false);
	});

	it("does not widen while picking a conversation (ADR-143)", () => {
		expect(shouldWiden({ ...base, picking: true })).toBe(false);
	});
});
