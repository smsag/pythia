import { describe, it, expect } from "vitest";
import { mergeSettings, parseConversations } from "../services/persistence";
import { DEFAULT_SETTINGS } from "../models/settings";

// ── mergeSettings — sanitization ─────────────────────────────────────────────

describe("mergeSettings — sanitization", () => {
	it("falls back to the default when a saved value has the wrong type", () => {
		const result = mergeSettings({ maxConversations: "lots", debugMode: "yes", vaultContextFolders: null });
		expect(result.maxConversations).toBe(DEFAULT_SETTINGS.maxConversations);
		expect(result.debugMode).toBe(DEFAULT_SETTINGS.debugMode);
		expect(result.vaultContextFolders).toEqual([]);
	});

	it("rejects an unknown enum value rather than letting it reach an exhaustive switch", () => {
		const result = mergeSettings({ defaultProvider: "gemini", outputLanguage: "klingon", defaultResumeMode: "x" });
		expect(result.defaultProvider).toBe("anthropic");
		expect(result.outputLanguage).toBe(DEFAULT_SETTINGS.outputLanguage);
		expect(result.defaultResumeMode).toBe("full");
	});

	it("drops non-string entries from a saved string list", () => {
		expect(mergeSettings({ vaultContextFolders: ["A", 3, null, "B"] }).vaultContextFolders).toEqual(["A", "B"]);
	});

	it("keeps an explicit null for an optional key as 'unset'", () => {
		const result = mergeSettings({ maxTokens: null, temperature: null });
		expect(result.maxTokens).toBeUndefined();
		expect(result.temperature).toBeUndefined();
	});

	it("drops keys that are not settings", () => {
		const result = mergeSettings({ apiKeyLeak: "sk-…" }) as unknown as Record<string, unknown>;
		expect("apiKeyLeak" in result).toBe(false);
	});

	it("rejects NaN and non-finite numbers", () => {
		expect(mergeSettings({ maxConversations: NaN }).maxConversations).toBe(DEFAULT_SETTINGS.maxConversations);
		expect(mergeSettings({ temperature: Infinity }).temperature).toBe(DEFAULT_SETTINGS.temperature);
	});
});

// ── parseConversations — field repair ────────────────────────────────────────

describe("parseConversations — field repair", () => {
	it("repairs a missing contextNotes list and an unknown provider", () => {
		const { conversations } = parseConversations([
			{ id: "a", messages: [], contextNotes: null, provider: "gemini", resumeMode: "weird" },
		]);
		expect(conversations[0].contextNotes).toEqual([]);
		expect(conversations[0].provider).toBe("anthropic");
		expect(conversations[0].resumeMode).toBe("full");
	});

	it("gives a nameless conversation a readable name", () => {
		const { conversations } = parseConversations([{ id: "a", messages: [], name: 42 }]);
		expect(conversations[0].name).toBe("Conversation");
	});

	it("drops messages that have no usable role or id", () => {
		const { conversations } = parseConversations([
			{ id: "a", messages: [
				{ id: "m1", role: "user", content: "hi" },
				{ id: "m2", role: "system", content: "no" },
				{ role: "assistant", content: "no id" },
			] },
		]);
		expect(conversations[0].messages.map((m) => m.id)).toEqual(["m1"]);
	});

	it("drops an invalid writeMode but keeps a valid one", () => {
		const { conversations } = parseConversations([
			{ id: "a", messages: [], writeMode: "yolo" },
			{ id: "b", messages: [], writeMode: "create" },
		]);
		expect(conversations[0].writeMode).toBeUndefined();
		expect(conversations[1].writeMode).toBe("create");
	});
});

describe("sanitizeMessages — truncated flag (ADR-162)", () => {
	it("keeps a true flag and drops anything else", () => {
		const { conversations: [conv] } = parseConversations([{
			id: "c", messages: [
				{ id: "a", role: "assistant", content: "x", timestamp: "", truncated: true },
				{ id: "b", role: "assistant", content: "y", timestamp: "", truncated: "yes" },
				{ id: "c", role: "assistant", content: "z", timestamp: "", truncated: false },
			],
		}]);
		expect(conv.messages[0].truncated).toBe(true);
		expect("truncated" in conv.messages[1]).toBe(false);
		expect("truncated" in conv.messages[2]).toBe(false);
	});
});
