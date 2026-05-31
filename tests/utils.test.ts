import { describe, it, expect } from "vitest";
import { estimateTokensFromBytes, estimateTokensFromText } from "../services/messageUtils";

describe("estimateTokensFromBytes", () => {
	it("returns ~N for small byte counts", () => {
		expect(estimateTokensFromBytes(40)).toBe("~10");
	});

	it("rounds to nearest token", () => {
		expect(estimateTokensFromBytes(5)).toBe("~1");
		expect(estimateTokensFromBytes(6)).toBe("~2");
	});

	it("formats counts >= 1000 as ~Xk with one decimal", () => {
		expect(estimateTokensFromBytes(4000)).toBe("~1.0k");
		expect(estimateTokensFromBytes(6000)).toBe("~1.5k");
		expect(estimateTokensFromBytes(40000)).toBe("~10.0k");
	});

	it("handles zero bytes", () => {
		expect(estimateTokensFromBytes(0)).toBe("~0");
	});
});

describe("estimateTokensFromText", () => {
	it("returns character count divided by 4, rounded", () => {
		expect(estimateTokensFromText("abcd")).toBe(1);       // 4 chars = 1 token
		expect(estimateTokensFromText("abcdefgh")).toBe(2);    // 8 chars = 2 tokens
	});

	it("rounds half up", () => {
		expect(estimateTokensFromText("ab")).toBe(1);          // 2 chars → 0.5 → rounds to 1
		expect(estimateTokensFromText("a")).toBe(0);           // 1 char → 0.25 → rounds to 0
	});

	it("returns 0 for empty string", () => {
		expect(estimateTokensFromText("")).toBe(0);
	});

	it("returns a number (not a formatted string)", () => {
		expect(typeof estimateTokensFromText("hello world")).toBe("number");
	});
});
