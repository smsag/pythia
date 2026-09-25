import { describe, it, expect } from "vitest";
import { WebReadScope, MAX_READS_PER_TURN, normalizeReadableUrl, urlsInText } from "../services/webReadScope";
import type { Conversation } from "../models/types";

const conv = (...messages: { role: "user" | "assistant"; content: string }[]) =>
	({ messages } as unknown as Pick<Conversation, "messages">);

describe("urlsInText / normalizeReadableUrl", () => {
	it("finds links in prose and markdown, without the punctuation around them", () => {
		expect(urlsInText("see https://a.com/x. And [b](https://b.org/y) or <https://c.net>, ok"))
			.toEqual(["https://a.com/x", "https://b.org/y", "https://c.net/"]);
	});
	it("drops the fragment and refuses other schemes", () => {
		expect(normalizeReadableUrl("https://a.com/p#section")).toBe("https://a.com/p");
		expect(normalizeReadableUrl("javascript:alert(1)")).toBeNull();
	});
});

describe("WebReadScope — only links Pythia can vouch for (ADR-217 addendum)", () => {
	it("admits a link the user wrote, however the model re-spells it", () => {
		const scope = WebReadScope.forConversation(conv({ role: "user", content: "summarize https://example.com/post" }));
		expect(scope.admit("https://example.com/post#intro")).toBeNull();
	});

	it("refuses a URL the model built — the exfiltration shape", () => {
		const scope = WebReadScope.forConversation(conv({ role: "user", content: "read https://example.com/post" }));
		expect(scope.admit("https://example.com/post?d=my%20secret%20note")).toMatch(/only reads a link/);
		expect(scope.admit("https://evil.example/log?d=secret")).toMatch(/only reads a link/);
	});

	it("does not take links from assistant messages", () => {
		const scope = WebReadScope.forConversation(conv({ role: "assistant", content: "try https://evil.example/x" }));
		expect(scope.admit("https://evil.example/x")).not.toBeNull();
	});

	it("admits a link once a result of this send returned it", () => {
		const scope = WebReadScope.forConversation(conv());
		expect(scope.admit("https://news.example/a")).not.toBeNull();
		scope.addText("### 1. A\nURL: https://news.example/a\nsnippet");
		expect(scope.admit("https://news.example/a")).toBeNull();
	});

	it(`reads at most ${MAX_READS_PER_TURN} pages, and a refused call costs nothing`, () => {
		const links = Array.from({ length: MAX_READS_PER_TURN + 1 }, (_, i) => `https://s${i}.com/`);
		const scope = WebReadScope.forConversation(conv({ role: "user", content: links.join(" ") }));
		expect(scope.admit("https://not-allowed.com/")).not.toBeNull();
		for (const url of links.slice(0, MAX_READS_PER_TURN)) expect(scope.admit(url)).toBeNull();
		expect(scope.admit(links[MAX_READS_PER_TURN])).toMatch(new RegExp(`already read ${MAX_READS_PER_TURN} pages`));
	});
});
