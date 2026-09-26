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

describe("containsWebUrl — a link typed without its scheme (ADR-228)", () => {
	it("fires on www. hosts and on a host with a path", () => {
		for (const t of ["read www.example.com please", "summarize example.com/article", "see news.bbc.co.uk/world/x"]) {
			expect(containsWebUrl(t), t).toBe(true);
		}
	});
	it("does not fire on a bare domain in prose, an email, or a vault path", () => {
		for (const t of ["I like example.com a lot", "mail me at a@example.com", "see [[Projects/Q3.md]]", "version 2.5/3", "file Notes/report.md"]) {
			expect(containsWebUrl(t), t).toBe(false);
		}
	});
});
