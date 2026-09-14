import { describe, it, expect, vi } from "vitest";

// MergeController imports `obsidian` for its view code; the function under test
// is pure, so a stub is enough to let the module load headlessly.
vi.mock("obsidian", () => ({ Notice: class {}, setIcon: () => {} }));

import { incomingMergeLinks } from "../ui/MergeController";
import type { Conversation, MergeLink } from "../models/types";

const link = (over: Partial<MergeLink> = {}): MergeLink => ({
	id: "m1",
	conversationId: "target",
	messageId: "msg1",
	text: "a passage",
	createdAt: "2026-01-01T00:00:00.000Z",
	...over,
});

const conv = (id: string, merges?: MergeLink[]): Conversation => ({
	id,
	name: `Conversation ${id}`,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	systemPrompt: "",
	contextNotes: [],
	resumeMode: "full",
	provider: "anthropic",
	model: "claude-sonnet-4-6",
	messages: [],
	...(merges ? { merges } : {}),
});

describe("incomingMergeLinks", () => {
	it("finds every link pointing at the target, with its source", () => {
		const all = [
			conv("a", [link({ id: "m1" })]),
			conv("b", [link({ id: "m2" }), link({ id: "m3", conversationId: "elsewhere" })]),
			conv("target"),
		];
		const incoming = incomingMergeLinks(all, "target");
		expect(incoming.map((i) => i.link.id)).toEqual(["m1", "m2"]);
		expect(incoming.map((i) => i.source.id)).toEqual(["a", "b"]);
	});

	it("returns several links from the same source conversation", () => {
		const all = [conv("a", [link({ id: "m1" }), link({ id: "m2", messageId: "msg2" })])];
		expect(incomingMergeLinks(all, "target")).toHaveLength(2);
	});

	it("returns nothing when no conversation points at the target", () => {
		const all = [conv("a", [link({ conversationId: "elsewhere" })]), conv("b")];
		expect(incomingMergeLinks(all, "target")).toEqual([]);
	});

	it("excludes a self-link, so a conversation never lists itself as its own source", () => {
		const all = [conv("target", [link({ conversationId: "target" })])];
		expect(incomingMergeLinks(all, "target")).toEqual([]);
	});

	it("tolerates conversations with no merges field at all", () => {
		expect(incomingMergeLinks([conv("a"), conv("b")], "target")).toEqual([]);
	});
});
