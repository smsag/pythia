import { describe, it, expect } from "vitest";
import { containsWebUrl } from "../services/webSearchHeuristics";

describe("containsWebUrl (ADR-217)", () => {
	it("fires on a pasted http(s) link", () => {
		expect(containsWebUrl("summarize https://example.com/post please")).toBe(true);
		expect(containsWebUrl("http://sub.example.co.uk")).toBe(true);
	});
	it("does not fire on prose, a bare domain or another scheme", () => {
		expect(containsWebUrl("what is a url")).toBe(false);
		expect(containsWebUrl("see example.com")).toBe(false);
		expect(containsWebUrl("obsidian://open?vault=x")).toBe(false);
		expect(containsWebUrl("https://localhost")).toBe(false);
		expect(containsWebUrl("")).toBe(false);
	});
});
