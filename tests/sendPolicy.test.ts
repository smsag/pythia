import { describe, it, expect } from "vitest";
import { shouldGenerateTitle, shouldGenerateChapterName, shouldAutoArmSearch, wantsWeb, researchForSend } from "../services/sendPolicy";
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

describe("shouldAutoArmSearch", () => {
	const base = { researchMode: false, autoArmEnabled: true, hasApiKey: true, wantsWeb: true };

	it("arms only when all four conditions hold", () => {
		expect(shouldAutoArmSearch(base)).toBe(true);
	});

	it("never arms when the conversation already has search on — there is nothing to arm", () => {
		expect(shouldAutoArmSearch({ ...base, researchMode: true })).toBe(false);
	});

	it("respects the setting, the key and the heuristic independently", () => {
		expect(shouldAutoArmSearch({ ...base, autoArmEnabled: false })).toBe(false);
		expect(shouldAutoArmSearch({ ...base, hasApiKey: false })).toBe(false);
		expect(shouldAutoArmSearch({ ...base, wantsWeb: false })).toBe(false);
	});

	it("treats an unset researchMode as off", () => {
		expect(shouldAutoArmSearch({ ...base, researchMode: undefined })).toBe(true);
	});
});

describe("wantsWeb (ADR-217/229)", () => {
	it("is true for a link, and for a time-sensitive question", () => {
		expect(wantsWeb("what does https://example.com/essay argue?", 2026)).toBe(true);
		expect(wantsWeb("show me the current ecb rate", 2026)).toBe(true);
	});
	it("is false for a timeless question and for a dated note link", () => {
		for (const text of ["explain recursion", "[[2026-09-26 Daily]] summary"]) {
			expect(wantsWeb(text, 2026), text).toBe(false);
		}
	});
});

describe("researchForSend — never without a key (ADR-228)", () => {
	const base = { researchMode: true as boolean | undefined, autoArmEnabled: true, hasApiKey: true, wantsWeb: false };
	it("is on with the globe and a key", () => {
		expect(researchForSend(base)).toEqual({ active: true, autoArmed: false, missingKey: false });
	});
	it("is off, and says why, when the globe is on but there is no key", () => {
		expect(researchForSend({ ...base, hasApiKey: false })).toEqual({ active: false, autoArmed: false, missingKey: true });
	});
	it("is on for one message that carries a link, with the globe off", () => {
		expect(researchForSend({ ...base, researchMode: false, wantsWeb: true })).toEqual({ active: true, autoArmed: true, missingKey: false });
	});
	it("stays off and silent with the globe off and no key", () => {
		expect(researchForSend({ ...base, researchMode: undefined, hasApiKey: false, wantsWeb: true })).toEqual({ active: false, autoArmed: false, missingKey: false });
	});
});
