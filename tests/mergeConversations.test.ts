import { describe, it, expect } from "vitest";
import { mergeConversations } from "../services/persistence";
import type { Conversation } from "../models/types";

const makeConv = (id: string, updatedAt = "2026-01-01T00:00:00.000Z"): Conversation => ({
	id,
	name: id,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt,
	systemPrompt: "",
	contextNotes: [],
	resumeMode: "full",
	provider: "anthropic",
	model: "claude-sonnet-4-6",
	messages: [],
});

// ── mergeConversations (reload reconciliation, ADR-133) ──────────────────────

describe("mergeConversations", () => {
	const at = (id: string, updatedAt: string, msgs = 0): Conversation => {
		const c = makeConv(id, updatedAt);
		c.messages = Array.from({ length: msgs }, (_, i) => ({
			id: `${id}-m${i}`, role: "user" as const, content: "x",
			timestamp: "2026-01-01T00:00:00.000Z",
		}));
		return c;
	};

	it("keeps the in-memory copy when disk is behind — the data-loss case", () => {
		// The reported bug: memory has the new assistant turn, a background sync
		// rewrites data.json with the older copy, the reload replaces memory, the
		// turn is gone. Memory is newer, so memory must win.
		const memory = [at("c", "2026-01-01T02:00:00.000Z", 4)];
		const disk   = [at("c", "2026-01-01T01:00:00.000Z", 3)];
		const out = mergeConversations(memory, disk);
		expect(out.conversations).toHaveLength(1);
		expect(out.conversations[0].messages).toHaveLength(4);
		expect(out.keptFromMemory).toBe(1);
	});

	it("takes the disk copy when it is genuinely newer, e.g. another device", () => {
		const memory = [at("c", "2026-01-01T01:00:00.000Z", 3)];
		const disk   = [at("c", "2026-01-01T02:00:00.000Z", 5)];
		const out = mergeConversations(memory, disk);
		expect(out.conversations[0].messages).toHaveLength(5);
		expect(out.keptFromMemory).toBe(0);
	});

	it("breaks ties in favour of memory, which may hold unflushed edits", () => {
		const memory = [at("c", "2026-01-01T01:00:00.000Z", 4)];
		const disk   = [at("c", "2026-01-01T01:00:00.000Z", 3)];
		expect(mergeConversations(memory, disk).conversations[0].messages).toHaveLength(4);
	});

	it("keeps a conversation that exists only in memory", () => {
		const out = mergeConversations([at("new", "2026-01-02T00:00:00.000Z")], [at("old", "2026-01-01T00:00:00.000Z")]);
		expect(out.conversations.map((c) => c.id)).toEqual(["old", "new"]);
		expect(out.keptFromMemory).toBe(1);
	});

	it("keeps a conversation that exists only on disk", () => {
		const out = mergeConversations([], [at("fromOtherDevice", "2026-01-01T00:00:00.000Z")]);
		expect(out.conversations.map((c) => c.id)).toEqual(["fromOtherDevice"]);
		expect(out.keptFromMemory).toBe(0);
	});

	it("is exactly the disk list on a first load, when memory is empty", () => {
		const disk = [at("a", "2026-01-01T00:00:00.000Z"), at("b", "2026-01-02T00:00:00.000Z")];
		const out = mergeConversations([], disk);
		expect(out.conversations).toEqual(disk);
		expect(out.keptFromMemory).toBe(0);
	});

	it("preserves disk order and appends memory-only conversations last", () => {
		// The app reads conversations[length - 1] as "most recent", so anything
		// unsaved has to land at the end rather than in the middle.
		const memory = [at("z", "2026-01-05T00:00:00.000Z"), at("b", "2026-01-01T00:00:00.000Z")];
		const disk   = [at("a", "2026-01-01T00:00:00.000Z"), at("b", "2026-01-01T00:00:00.000Z")];
		expect(mergeConversations(memory, disk).conversations.map((c) => c.id)).toEqual(["a", "b", "z"]);
	});

	it("treats a missing updatedAt as oldest without dropping the conversation", () => {
		const memory = [at("c", "")];
		const disk   = [at("c", "2026-01-01T00:00:00.000Z", 7)];
		const out = mergeConversations(memory, disk);
		expect(out.conversations).toHaveLength(1);
		expect(out.conversations[0].messages).toHaveLength(7);
	});

	it("counts every conversation taken from memory", () => {
		const memory = [at("a", "2026-01-09T00:00:00.000Z"), at("b", "2026-01-09T00:00:00.000Z")];
		const disk   = [at("a", "2026-01-01T00:00:00.000Z")];
		expect(mergeConversations(memory, disk).keptFromMemory).toBe(2);
	});
});
