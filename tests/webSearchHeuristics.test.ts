import { describe, it, expect } from "vitest";
import { looksTimeSensitive } from "../services/webSearchHeuristics";

const YEAR = 2026;

describe("looksTimeSensitive", () => {
	it("fires on explicit recency words", () => {
		for (const q of [
			"what is the latest iPhone",
			"current CEO of Twitter",
			"who's the prime minister now",
			"news about the election",
			"today's weather in Berlin",
		]) {
			expect(looksTimeSensitive(q, YEAR), q).toBe(true);
		}
	});

	it("fires on changeable-fact words", () => {
		for (const q of [
			"price of bitcoin",
			"latest Node version",
			"the current exchange rate",
			"stock market today",
		]) {
			expect(looksTimeSensitive(q, YEAR), q).toBe(true);
		}
	});

	it("fires on the current or a future year", () => {
		expect(looksTimeSensitive("best laptops of 2026", YEAR)).toBe(true);
		expect(looksTimeSensitive("what happens in 2030", YEAR)).toBe(true);
	});

	it("does not fire on a past year alone", () => {
		expect(looksTimeSensitive("the 2019 world cup final", YEAR)).toBe(false);
	});

	it("does not fire on timeless questions", () => {
		for (const q of [
			"explain recursion",
			"write a haiku about the sea",
			"how does a for loop work",
			"summarize this note",
		]) {
			expect(looksTimeSensitive(q, YEAR), q).toBe(false);
		}
	});

	it("respects word boundaries (no substring false positives)", () => {
		// "now" inside "nowhere", "release" not present, "news" inside "newser"
		expect(looksTimeSensitive("there is nowhere to go", YEAR)).toBe(false);
		expect(looksTimeSensitive("a newser is not a word", YEAR)).toBe(false);
	});

	it("is case-insensitive", () => {
		expect(looksTimeSensitive("LATEST release NEWS", YEAR)).toBe(true);
	});

	it("handles empty input", () => {
		expect(looksTimeSensitive("", YEAR)).toBe(false);
	});
});
