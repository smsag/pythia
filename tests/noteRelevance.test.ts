import { describe, it, expect } from "vitest";
import { tokenize, scoreRelevanceWeighted, scoreRelevanceTokensWeighted } from "../services/noteRelevance";

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

	it("keeps umlaut/accented words whole instead of fragmenting them (German-first plugin)", () => {
		// The old ASCII-only class split these on the umlaut ("Ernährung" -> ern,hrung),
		// which cross-matched unrelated text on the stray pieces and broke IDF weights.
		expect(tokenize("Ernährung")).toEqual(["ernährung"]);
		expect(tokenize("Größe der Straße")).toEqual(["größe", "der", "straße"]);
	});

	it("tokenizes non-Latin scripts instead of yielding nothing", () => {
		// Previously these produced [] → the empty-query branch listed EVERY
		// conversation instead of searching. Whole-run tokens per script is correct.
		expect(tokenize("日本語")).toEqual(["日本語"]);
		expect(tokenize("Привет мир")).toEqual(["привет", "мир"]);
	});

	it("normalizes decomposed (NFD) umlauts so they match the precomposed form", () => {
		// macOS stores filenames in NFD ("u" + combining diaeresis); an in-app
		// precomposed "u\u0308ber" must still match a note titled the NFD way.
		const nfd = "u\u0308ber"; // u + combining diaeresis (U+0308)
		const nfc = "\u00FCber"; // precomposed u-umlaut (U+00FC)
		expect(tokenize(nfd)).toEqual(tokenize(nfc));
		expect(tokenize(nfd)).toEqual([nfc]);
	});

	it("leaves ASCII tokenization byte-identical (no regression)", () => {
		expect(tokenize("Project Plan: Q3-Budget!")).toEqual(["project", "plan", "q3", "budget"]);
		expect(tokenize("don't stop")).toEqual(["don", "t", "stop"]);
	});
});

describe("scoreRelevanceWeighted", () => {
	it("returns an empty array for an empty haystack list", () => {
		expect(scoreRelevanceWeighted("budget", [])).toEqual([]);
	});

	it("returns 0 for every haystack when the query has no tokens", () => {
		expect(scoreRelevanceWeighted("", ["Project Plan", "Budget"])).toEqual([0, 0]);
		expect(scoreRelevanceWeighted("   ", ["Project Plan"])).toEqual([0]);
	});

	it("returns 0 for a haystack with no token overlap", () => {
		const [score] = scoreRelevanceWeighted("weather forecast", ["Budget Plan"]);
		expect(score).toBe(0);
	});

	it("is case-insensitive", () => {
		const [score] = scoreRelevanceWeighted("BUDGET", ["budget plan"]);
		expect(score).toBeGreaterThan(0);
	});

	it("does not double-count repeated query tokens beyond the haystack's distinct terms", () => {
		const [oneMatch] = scoreRelevanceWeighted("budget", ["budget plan"]);
		const [repeatedQuery] = scoreRelevanceWeighted("budget budget budget", ["budget plan"]);
		expect(repeatedQuery).toBe(oneMatch);
	});

	it("weights a token unique to one haystack higher than tokens shared by every haystack", () => {
		const haystacks = [
			"story map user story",              // holds the rare, distinctive token "story"
			"opportunity user problem solution",  // shares "user" but not "story"
			"roadmap user product solution",      // shares "user" but not "story"
		];
		const scores = scoreRelevanceWeighted("user story", haystacks);
		expect(scores[0]).toBeGreaterThan(scores[1]);
		expect(scores[0]).toBeGreaterThan(scores[2]);
	});

	it("gives a token present in every haystack no discriminating power between them", () => {
		const haystacks = ["canvas block type", "canvas block type framework", "canvas block type reference"];
		const scores = scoreRelevanceWeighted("canvas", haystacks);
		// "canvas" appears in all three — it can't distinguish between them, so
		// their scores (driven only by that one shared token) are identical.
		expect(scores[0]).toBe(scores[1]);
		expect(scores[1]).toBe(scores[2]);
	});
});

describe("scoreRelevanceTokensWeighted", () => {
	it("produces the same result as scoreRelevanceWeighted for a pre-tokenized query", () => {
		const query = "Q3 budget review";
		const haystacks = ["Budget Plan Q3", "Weather Forecast"];
		expect(scoreRelevanceTokensWeighted(tokenize(query), haystacks)).toEqual(
			scoreRelevanceWeighted(query, haystacks)
		);
	});

	it("returns all zeros for an empty token list", () => {
		expect(scoreRelevanceTokensWeighted([], ["Project Plan", "Other"])).toEqual([0, 0]);
	});

	it("lets a caller reuse the same tokenized query across multiple haystack batches", () => {
		const tokens = tokenize("budget review");
		const first = scoreRelevanceTokensWeighted(tokens, ["Budget Plan", "Weather Forecast"]);
		const second = scoreRelevanceTokensWeighted(tokens, ["Quarterly Review"]);
		expect(first[0]).toBeGreaterThan(first[1]);
		expect(second[0]).toBeGreaterThan(0);
	});
});
