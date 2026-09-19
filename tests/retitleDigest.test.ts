import { describe, it, expect } from "vitest";
import { buildRetitleDigest, RETITLE_TURN_CHARS } from "../services/titlePrompts";
import type { Conversation, Message } from "../models/types";

const msg = (role: "user" | "assistant", content: string): Message =>
	({ id: `${role}-${content.slice(0, 8)}`, role, content, timestamp: "2026-09-19T10:00:00Z" } as Message);
const conv = (over: Partial<Conversation>): Conversation =>
	({ id: "c", name: "n", messages: [], ...over } as Conversation);

describe("buildRetitleDigest (header ↻ rename)", () => {
	it("names what the conversation became: the LAST exchange, not the first", () => {
		const d = buildRetitleDigest(conv({ messages: [
			msg("user", "first question"), msg("assistant", "first answer"),
			msg("user", "where it drifted"), msg("assistant", "the drifted answer"),
		] }));
		expect(d).toContain("where it drifted");
		expect(d).toContain("the drifted answer");
		expect(d).not.toContain("first question");
	});

	it("leads with the summary when there is one", () => {
		const d = buildRetitleDigest(conv({ summaryText: "A comparison of window switchers.", messages: [msg("user", "and Snap?")] }));
		expect(d.indexOf("Summary:")).toBe(0);
		expect(d).toContain("Latest user message: and Snap?");
		expect(d).not.toContain("Latest assistant answer");
	});

	it("clips each turn and collapses whitespace", () => {
		const d = buildRetitleDigest(conv({ messages: [msg("user", "a  \n b" + "x".repeat(1000))] }));
		const line = d.replace("Latest user message: ", "");
		expect(line.startsWith("a b")).toBe(true);
		expect(line.length).toBe(RETITLE_TURN_CHARS);
	});

	it("returns \"\" when there is nothing to name", () => {
		expect(buildRetitleDigest(conv({}))).toBe("");
		expect(buildRetitleDigest(conv({ summaryText: "   ", messages: [msg("user", "  ")] }))).toBe("");
	});
});
