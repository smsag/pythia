import { describe, it, expect } from "vitest";
import { matchStrength, tokenMatches, applyRelevanceFloor, RELEVANCE_FLOOR } from "../services/tokenMatch";

describe("matchStrength", () => {
	it("scores an exact hit highest", () => {
		expect(matchStrength(["kayak"], "kayak")).toBe(1);
	});

	it("scores the as-you-type prefix below an exact hit but well above zero", () => {
		const prefix = matchStrength(["kayaking"], "kayak");
		expect(prefix).toBeGreaterThan(0);
		expect(prefix).toBeLessThan(1);
	});

	// The two misses ADR-168 exists to fix.
	it("finds a German compound from the word at its end ('Vertrag' → 'Mietvertrag')", () => {
		expect(matchStrength(["mietvertrag"], "vertrag")).toBeGreaterThan(0);
	});

	it("finds a shorter stored form from a longer typed word ('boundaries' → 'bound')", () => {
		expect(matchStrength(["bound"], "boundaries")).toBeGreaterThan(0);
	});

	it("orders the tiers: exact > prefix > infix > reverse", () => {
		const exact = matchStrength(["vertrag"], "vertrag");
		const prefix = matchStrength(["vertraglich"], "vertrag");
		const infix = matchStrength(["mietvertrag"], "vertrag");
		const reverse = matchStrength(["bound"], "boundaries");
		expect(exact).toBeGreaterThan(prefix);
		expect(prefix).toBeGreaterThan(infix);
		expect(infix).toBeGreaterThan(reverse);
	});

	it("returns the BEST match across the candidate set, not the first", () => {
		expect(matchStrength(["mietvertrag", "vertrag"], "vertrag")).toBe(1);
	});

	// The length floors. Without them the looser rules match everything, and a
	// search that returns the whole corpus is the same as no search at all.
	it("does not let a short stopword reverse-match a long query", () => {
		expect(matchStrength(["in"], "integration")).toBe(0);
		expect(matchStrength(["der"], "derivative")).toBe(0);
	});

	it("does not look inside a word for a short query", () => {
		expect(matchStrength(["mietvertrag"], "ver")).toBe(0);
		expect(matchStrength(["straße"], "aße")).toBe(0);
	});

	it("does not match an unanchored short tail of a compound", () => {
		// "Mietvertrag" ends with "trag" as well as with "vertrag" — the tail floor
		// keeps a conversation about "tragen" out of a Mietvertrag search.
		expect(matchStrength(["trag"], "mietvertrag")).toBe(0);
	});

	it("returns 0 for an empty query token and an empty candidate set", () => {
		expect(matchStrength(["anything"], "")).toBe(0);
		expect(matchStrength([], "anything")).toBe(0);
	});

	it("tokenMatches is the boolean view of the same rule", () => {
		expect(tokenMatches(["mietvertrag"], "vertrag")).toBe(true);
		expect(tokenMatches(["in"], "integration")).toBe(false);
	});
});

describe("applyRelevanceFloor", () => {
	it("keeps results within the floor of the best one", () => {
		const kept = applyRelevanceFloor([{ score: 10 }, { score: 5 }, { score: 2 }]);
		expect(kept).toHaveLength(3);
	});

	it("drops results far below the best one", () => {
		// Graded matching makes "score > 0" too weak a filter on its own: without
		// the floor, one weak reverse hit puts the whole corpus in the list.
		const kept = applyRelevanceFloor([{ score: 10 }, { score: 10 * RELEVANCE_FLOOR * 0.5 }]);
		expect(kept).toHaveLength(1);
	});

	it("returns nothing when the best score is zero", () => {
		expect(applyRelevanceFloor([{ score: 0 }])).toEqual([]);
		expect(applyRelevanceFloor([])).toEqual([]);
	});
});
