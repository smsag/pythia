import { describe, it, expect } from "vitest";
import { conversationChunks } from "../services/embedding/conversationText";
import type { Conversation, Message } from "../models/types";

let seq = 0;
const msg = (content: string): Message => ({
	id: `m${seq++}`, role: "user", content, timestamp: "2026-01-01T00:00:00.000Z",
});
const conv = (over: Partial<Conversation> & { name: string }): Conversation => ({
	id: over.id ?? `c${seq++}`, createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z", systemPrompt: "", contextNotes: [], resumeMode: "full",
	provider: "anthropic", model: "claude", messages: over.messages ?? [], ...over,
} as Conversation);

describe("conversationChunks", () => {
	it("leads with a title + summary chunk", () => {
		const c = conv({ name: "Quartz crisis", summaryText: "How quartz disrupted Swiss watches.", messages: [msg("hi")] });
		const chunks = conversationChunks(c);
		expect(chunks[0]).toContain("Quartz crisis");
		expect(chunks[0]).toContain("disrupted");
	});

	it("includes message content", () => {
		const c = conv({ name: "x", messages: [msg("the seiko astron was first")] });
		expect(conversationChunks(c).join(" ")).toContain("seiko astron");
	});

	it("packs short messages together and stays within the char budget", () => {
		const c = conv({ name: "x", messages: [msg("a".repeat(200)), msg("b".repeat(200)), msg("c".repeat(200))] });
		const chunks = conversationChunks(c, 300);
		for (const ch of chunks) expect(ch.length).toBeLessThanOrEqual(300);
		expect(chunks.length).toBeGreaterThan(1);
	});

	it("hard-splits a single over-long message", () => {
		const c = conv({ name: "x", messages: [msg("z".repeat(1200))] });
		const chunks = conversationChunks(c, 500);
		for (const ch of chunks) expect(ch.length).toBeLessThanOrEqual(500);
		expect(chunks.join("").replace(/[^z]/g, "").length).toBe(1200); // no content lost
	});

	it("always yields at least one chunk, even for an empty conversation", () => {
		const c = conv({ name: "Solo", messages: [] });
		expect(conversationChunks(c).length).toBeGreaterThanOrEqual(1);
	});

	it("survives malformed records so one bad conversation can't break the index sync", () => {
		// The index is rebuilt for the whole corpus on every sync; a throw here would
		// reject getRelated() and blank out related-conversations for everyone. Guard
		// against the shapes persistence doesn't validate: null message elements,
		// non-string content, a non-array messages, and a non-string name.
		const nullMsg = conv({ name: "SSIG", messages: [null as unknown as Message] });
		const noContent = conv({ name: "SSIG", messages: [{ id: "x", role: "user", timestamp: "" } as unknown as Message] });
		const noMessages = conv({ name: "SSIG", messages: undefined as unknown as Message[] });
		const noName = conv({ name: undefined as unknown as string, messages: [msg("body")] });
		for (const c of [nullMsg, noContent, noMessages, noName]) {
			expect(() => conversationChunks(c)).not.toThrow();
			expect(conversationChunks(c).length).toBeGreaterThanOrEqual(1); // still indexable
		}
		expect(conversationChunks(nullMsg)[0]).toContain("SSIG"); // lead chunk still built
	});

	it("is deterministic for identical content", () => {
		const a = conv({ name: "same", messages: [msg("hello world")] });
		const b = conv({ name: "same", messages: [msg("hello world")] });
		expect(conversationChunks(a)).toEqual(conversationChunks(b));
	});
});
