import { describe, it, expect } from "vitest";
import { tokenize, scoreRelevance } from "../services/noteRelevance";

describe("tokenize", () => {
	it("lowercases and splits on non-alphanumeric characters", () => {
		expect(tokenize("Project Plan: Q3-Budget!")).toEqual(
			expect.arrayContaining(["project", "plan", "q3", "budget"])
		);
	});

	it("dedupes repeated tokens", () => {
		expect(tokenize("cat cat CAT")).toEqual(["cat"]);
	});

	it("returns an empty array for empty or symbol-only input", () => {
		expect(tokenize("")).toEqual([]);
		expect(tokenize("!!! ---")).toEqual([]);
	});
});

describe("scoreRelevance", () => {
	it("returns 0 when the query has no tokens", () => {
		expect(scoreRelevance("", "Project Plan")).toBe(0);
		expect(scoreRelevance("   ", "Project Plan")).toBe(0);
	});

	it("returns 0 when there is no token overlap", () => {
		expect(scoreRelevance("weather forecast", "Budget Plan")).toBe(0);
	});

	it("counts the number of shared tokens", () => {
		expect(scoreRelevance("Q3 budget review", "Budget Plan Q3")).toBe(2);
	});

	it("is case-insensitive", () => {
		expect(scoreRelevance("BUDGET", "budget plan")).toBe(1);
	});

	it("does not double-count repeated query tokens beyond the haystack's distinct terms", () => {
		expect(scoreRelevance("budget budget budget", "budget plan")).toBe(1);
	});
});
