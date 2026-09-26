import { describe, it, expect } from "vitest";
import { spliceExchange } from "../services/conversationEdits";
import type { Conversation, Message } from "../models/types";

const msg = (id: string, role: Message["role"]): Message => ({ id, role, content: id, timestamp: "" });

function conv(): Conversation {
	return {
		id: "c", name: "C", createdAt: "", updatedAt: "", provider: "anthropic", model: "m",
		systemPrompt: "", contextNotes: [], resumeMode: "full",
		messages: [msg("u1", "user"), msg("a1", "assistant"), msg("u2", "user"), msg("a2", "assistant")],
		lastSavedMessageCount: 4,
		favorites: [{ id: "f", messageId: "a2", name: "x" }],
		merges: [{ id: "l", conversationId: "other", messageId: "a2", text: "t", createdAt: "" }],
	} as unknown as Conversation;
}

describe("spliceExchange", () => {
	it("removes the user turn and its answer, with the favorites and merge links on that answer", () => {
		const c = conv();
		const removed = spliceExchange(c, "u2", "a2");
		expect(removed?.user.id).toBe("u2");
		expect(removed?.assistant?.id).toBe("a2");
		expect(c.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
		expect(c.favorites).toEqual([]);
		expect(c.merges).toEqual([]);
		expect(c.lastSavedMessageCount).toBe(2);
	});

	it("removes only the user turn when the answer id does not follow it", () => {
		const c = conv();
		const removed = spliceExchange(c, "u2", "a1");
		expect(removed?.assistant).toBeNull();
		expect(c.messages.map((m) => m.id)).toEqual(["u1", "a1", "a2"]);
		// The favorite on a2 survives: a2 was not removed.
		expect(c.favorites).toHaveLength(1);
	});

	it("is a no-op for an unknown user id", () => {
		const c = conv();
		expect(spliceExchange(c, "nope", "a2")).toBeNull();
		expect(c.messages).toHaveLength(4);
	});

	it("keeps the save boundary consistent when the exchange sits below it", () => {
		const c = conv();
		c.lastSavedMessageCount = 1;
		spliceExchange(c, "u2", "a2");
		expect(c.lastSavedMessageCount).toBe(1);
	});
});

describe("spliceExchange — an answer with comparison tabs (ADR-223)", () => {
	it("removes the favorites and merge links made on its tabs as well", () => {
		const c = conv();
		c.messages[3].alternatives = [{ id: "b2", provider: "openai", model: "gpt-4o", content: "B", timestamp: "" }];
		c.favorites = [{ id: "f", messageId: "a2", name: "x" }, { id: "g", messageId: "b2", name: "y" }, { id: "h", messageId: "a1", name: "z" }] as Conversation["favorites"];
		c.merges = [{ id: "l", conversationId: "o", messageId: "b2", text: "t", createdAt: "" }] as Conversation["merges"];
		spliceExchange(c, "u2", "a2");
		expect(c.favorites?.map((f) => f.id)).toEqual(["h"]);
		expect(c.merges).toEqual([]);
	});
});

