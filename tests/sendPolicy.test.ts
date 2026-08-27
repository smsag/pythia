import { describe, it, expect } from "vitest";
import { shouldGenerateTitle, shouldGenerateChapterName } from "../services/sendPolicy";
import type { Conversation, Message } from "../models/types";

/**
 * Characterization tests for the pure send-flow predicates extracted from
 * `PythiaSidebarView.sendMessage` (ADR-097 / engineering-review #119). These pin
 * the current behaviour so the upcoming SendController extraction cannot silently
 * change when a title or chapter name is generated.
 */

function makeMessage(overrides: Partial<Message> = {}): Message {
	return {
		id: "m",
		role: "user",
		content: "hi",
		timestamp: "2026-08-27T00:00:00.000Z",
		...overrides,
	};
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
	return {
		id: "c",
		name: "2026-08-27",
		provider: "anthropic",
		messages: [],
		contextNotes: [],
		createdAt: "2026-08-27T00:00:00.000Z",
		updatedAt: "2026-08-27T00:00:00.000Z",
		...overrides,
	} as Conversation;
}

describe("shouldGenerateTitle", () => {
	it("fires after the first exchange while the name is still a date", () => {
		const conv = makeConversation({
			name: "2026-08-27",
			messages: [makeMessage(), makeMessage({ role: "assistant" })],
		});
		expect(shouldGenerateTitle(conv)).toBe(true);
	});

	it("does not fire before the first exchange completes (only the user turn)", () => {
		const conv = makeConversation({ messages: [makeMessage()] });
		expect(shouldGenerateTitle(conv)).toBe(false);
	});

	it("does not fire once the conversation has more than two messages", () => {
		const conv = makeConversation({
			messages: [makeMessage(), makeMessage({ role: "assistant" }), makeMessage()],
		});
		expect(shouldGenerateTitle(conv)).toBe(false);
	});

	it("does not fire once the conversation has a real (non-date) name", () => {
		const conv = makeConversation({
			name: "Migrating the auth service",
			messages: [makeMessage(), makeMessage({ role: "assistant" })],
		});
		expect(shouldGenerateTitle(conv)).toBe(false);
	});

	it("matches a date suffix even with a prefix, and rejects a non-date name", () => {
		expect(
			shouldGenerateTitle(
				makeConversation({
					name: "Notes 2026-08-27",
					messages: [makeMessage(), makeMessage({ role: "assistant" })],
				}),
			),
		).toBe(true);
		expect(
			shouldGenerateTitle(
				makeConversation({
					name: "2026-08",
					messages: [makeMessage(), makeMessage({ role: "assistant" })],
				}),
			),
		).toBe(false);
	});
});

describe("shouldGenerateChapterName", () => {
	it("fires when the user message has no chapter name", () => {
		expect(shouldGenerateChapterName(makeMessage())).toBe(true);
		expect(shouldGenerateChapterName(makeMessage({ chapterName: "" }))).toBe(true);
	});

	it("does not fire once a chapter name exists", () => {
		expect(shouldGenerateChapterName(makeMessage({ chapterName: "Auth work" }))).toBe(false);
	});
});
