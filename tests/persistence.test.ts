import { describe, it, expect } from "vitest";
import {
	applySettingsMigrations,
	mergeSettings,
	parseConversations,
	sanitizeMessages,
	normalizeFavorites,
	normalizeMerges,
	shouldRefuseLoad,
} from "../services/persistence";
import { DEFAULT_SETTINGS } from "../models/settings";
import type { Conversation } from "../models/types";

// ── helpers ───────────────────────────────────────────────────────────────────

const makeConv = (
	id: string,
	updatedAt = "2026-01-01T00:00:00.000Z",
	favorites: unknown[] = [],
): Conversation => ({
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
	favorites: favorites as Conversation["favorites"],
});

// ── applySettingsMigrations ───────────────────────────────────────────────────

describe("applySettingsMigrations", () => {
	it("returns needsSave: false and no ciphertexts for clean data", () => {
		const saved = { defaultProvider: "anthropic" };
		const result = applySettingsMigrations(saved);
		expect(result).toEqual({ needsSave: false, legacyAnthropicCiphertext: null, legacyOpenAICiphertext: null });
	});

	it("removes legacy apiKey field and sets needsSave", () => {
		const saved: Record<string, unknown> = { apiKey: "sk-old" };
		const { needsSave } = applySettingsMigrations(saved);
		expect(needsSave).toBe(true);
		expect(saved).not.toHaveProperty("apiKey");
	});

	it("migrates defaultModel → defaultAnthropicModel", () => {
		const saved: Record<string, unknown> = { defaultModel: "claude-opus-4-8" };
		const { needsSave } = applySettingsMigrations(saved);
		expect(needsSave).toBe(true);
		expect(saved.defaultAnthropicModel).toBe("claude-opus-4-8");
		expect(saved).not.toHaveProperty("defaultModel");
	});

	it("does not overwrite existing defaultAnthropicModel when defaultModel is present", () => {
		const saved: Record<string, unknown> = {
			defaultModel: "claude-old",
			defaultAnthropicModel: "claude-sonnet-4-6",
		};
		applySettingsMigrations(saved);
		expect(saved.defaultAnthropicModel).toBe("claude-sonnet-4-6");
		expect(saved.defaultModel).toBe("claude-old");
	});

	it("extracts encryptedApiKey and removes the field", () => {
		const saved: Record<string, unknown> = { encryptedApiKey: "plain:sk-test" };
		const { needsSave, legacyAnthropicCiphertext } = applySettingsMigrations(saved);
		expect(needsSave).toBe(true);
		expect(legacyAnthropicCiphertext).toBe("plain:sk-test");
		expect(saved).not.toHaveProperty("encryptedApiKey");
	});

	it("extracts encryptedOpenAIKey and removes the field", () => {
		const saved: Record<string, unknown> = { encryptedOpenAIKey: "plain:sk-openai" };
		const { needsSave, legacyOpenAICiphertext } = applySettingsMigrations(saved);
		expect(needsSave).toBe(true);
		expect(legacyOpenAICiphertext).toBe("plain:sk-openai");
		expect(saved).not.toHaveProperty("encryptedOpenAIKey");
	});

	it('migrates outputLanguage "English" → "en"', () => {
		const saved: Record<string, unknown> = { outputLanguage: "English" };
		const { needsSave } = applySettingsMigrations(saved);
		expect(needsSave).toBe(true);
		expect(saved.outputLanguage).toBe("en");
	});

	it('migrates outputLanguage "German" → "de"', () => {
		const saved: Record<string, unknown> = { outputLanguage: "German" };
		const { needsSave } = applySettingsMigrations(saved);
		expect(needsSave).toBe(true);
		expect(saved.outputLanguage).toBe("de");
	});

	it("handles multiple migrations in a single call", () => {
		const saved: Record<string, unknown> = {
			apiKey: "old",
			defaultModel: "old-model",
			outputLanguage: "German",
		};
		const { needsSave } = applySettingsMigrations(saved);
		expect(needsSave).toBe(true);
		expect(saved).not.toHaveProperty("apiKey");
		expect(saved.defaultAnthropicModel).toBe("old-model");
		expect(saved.outputLanguage).toBe("de");
	});
});

// ── mergeSettings ─────────────────────────────────────────────────────────────

describe("mergeSettings", () => {
	it("fills all fields with defaults for empty input", () => {
		const result = mergeSettings({});
		expect(result).toEqual(DEFAULT_SETTINGS);
	});

	it("preserves explicitly set values over defaults", () => {
		const result = mergeSettings({ defaultProvider: "openai", maxConversations: 50 });
		expect(result.defaultProvider).toBe("openai");
		expect(result.maxConversations).toBe(50);
	});

	it("fills missing fields with defaults while keeping overrides", () => {
		const result = mergeSettings({ debugMode: true });
		expect(result.debugMode).toBe(true);
		expect(result.defaultAnthropicModel).toBe(DEFAULT_SETTINGS.defaultAnthropicModel);
		expect(result.templatesFolder).toBe(DEFAULT_SETTINGS.templatesFolder);
	});

	it("does not mutate DEFAULT_SETTINGS", () => {
		const before = { ...DEFAULT_SETTINGS };
		mergeSettings({ defaultProvider: "openai" });
		expect(DEFAULT_SETTINGS).toEqual(before);
	});

	it("defaults temperature to 0.7 when absent from old saved data", () => {
		const result = mergeSettings({ defaultProvider: "anthropic" });
		expect(result.temperature).toBe(0.7);
	});

	it("preserves an explicitly saved temperature", () => {
		const result = mergeSettings({ temperature: 0.4 });
		expect(result.temperature).toBe(0.4);
	});

	it("defaults maxAttachedNotesTokens for old saved data (pre-B3 data.json)", () => {
		const result = mergeSettings({ defaultProvider: "anthropic" });
		expect(result.maxAttachedNotesTokens).toBe(DEFAULT_SETTINGS.maxAttachedNotesTokens);
	});
});

// ── parseConversations ────────────────────────────────────────────────────────

describe("parseConversations", () => {
	it("accepts a valid conversation object", () => {
		const raw = [{ id: "abc", messages: [] }];
		const { conversations, dropped } = parseConversations(raw);
		expect(conversations).toHaveLength(1);
		expect(conversations[0].id).toBe("abc");
		expect(dropped).toBe(0);
	});

	it("returns empty array for empty input", () => {
		const { conversations, dropped } = parseConversations([]);
		expect(conversations).toHaveLength(0);
		expect(dropped).toBe(0);
	});

	it("drops null entries", () => {
		const raw = [null, { id: "ok", messages: [] }];
		const { conversations, dropped } = parseConversations(raw);
		expect(conversations).toHaveLength(1);
		expect(dropped).toBe(1);
	});

	it("drops entries missing the id string", () => {
		const raw = [{ messages: [] }, { id: 42, messages: [] }];
		const { conversations, dropped } = parseConversations(raw);
		expect(conversations).toHaveLength(0);
		expect(dropped).toBe(2);
	});

	it("drops entries where messages is not an array", () => {
		const raw = [{ id: "x", messages: "not-array" }, { id: "y", messages: null }];
		const { conversations, dropped } = parseConversations(raw);
		expect(conversations).toHaveLength(0);
		expect(dropped).toBe(2);
	});

	it("counts dropped entries correctly across mixed input", () => {
		const raw = [
			{ id: "good", messages: [] },
			null,
			{ messages: [] },           // missing id
			{ id: "also-good", messages: [{ role: "user" }] },
			{ id: "bad", messages: "x" }, // wrong messages type
		];
		const { conversations, dropped } = parseConversations(raw);
		expect(conversations).toHaveLength(2);
		expect(dropped).toBe(3);
	});
});

// ── sanitizeMessages (load-time message hardening) ─────────────────────────────

describe("sanitizeMessages", () => {
	const conv = (messages: unknown): Conversation =>
		({ id: "c", name: "n", messages } as unknown as Conversation);

	it("drops null and non-object message elements", () => {
		const c = conv([null, "oops", 42, { id: "m", role: "user", content: "keep", timestamp: "" }]);
		sanitizeMessages(c);
		expect(c.messages).toHaveLength(1);
		expect(c.messages[0].content).toBe("keep");
	});

	it("coerces a non-string content to a string, preserving message position", () => {
		const c = conv([
			{ id: "a", role: "user", content: undefined, timestamp: "" },
			{ id: "b", role: "assistant", content: 123, timestamp: "" },
			{ id: "c", role: "user", content: "real", timestamp: "" },
		]);
		sanitizeMessages(c);
		expect(c.messages).toHaveLength(3); // count/position preserved (send-path relies on it)
		expect(c.messages.map((m) => m.content)).toEqual(["", "123", "real"]);
		expect(c.messages.every((m) => typeof m.content === "string")).toBe(true);
	});

	it("replaces a non-array messages with an empty array", () => {
		const c = conv(undefined);
		sanitizeMessages(c);
		expect(c.messages).toEqual([]);
	});

	it("runs automatically via parseConversations so loaded data is always clean", () => {
		const raw = [
			{ id: "x", name: "SSIG", summaryText: "about SSIG", messages: [null, { id: "m", role: "user", content: undefined, timestamp: "" }] },
		];
		const { conversations } = parseConversations(raw);
		expect(conversations[0].messages).toHaveLength(1);
		expect(conversations[0].messages[0].content).toBe("");
	});
});

// ── normalizeMerges (merge links, ADR-130) ────────────────────────────────────

describe("normalizeMerges", () => {
	let counter = 0;
	const makeId = () => `merge-${counter++}`;
	const withMerges = (merges: unknown[]): Conversation => {
		const conv = makeConv("c");
		(conv as Conversation).merges = merges as Conversation["merges"];
		return conv;
	};

	it("keeps a well-formed link untouched", () => {
		const conv = withMerges([
			{ id: "keep", conversationId: "other", messageId: "m1", text: "passage", occurrenceIndex: 2, createdAt: "2026-01-01T00:00:00.000Z" },
		]);
		normalizeMerges(conv, makeId);
		expect(conv.merges).toHaveLength(1);
		expect(conv.merges![0].id).toBe("keep");
		expect(conv.merges![0].occurrenceIndex).toBe(2);
	});

	it("assigns an id when one is missing", () => {
		counter = 0;
		const conv = withMerges([
			{ conversationId: "other", messageId: "m1", text: "passage", createdAt: "x" },
		]);
		normalizeMerges(conv, makeId);
		expect(conv.merges![0].id).toBe("merge-0");
	});

	it("drops null entries and links missing the fields a mark needs", () => {
		const conv = withMerges([
			null,
			{ conversationId: "other", messageId: "m1" },            // no text → can never paint
			{ conversationId: "other", messageId: "m1", text: "   " }, // whitespace only
			{ messageId: "m1", text: "passage" },                    // no target
			{ id: "ok", conversationId: "other", messageId: "m1", text: "passage" },
		]);
		normalizeMerges(conv, makeId);
		expect(conv.merges).toHaveLength(1);
		expect(conv.merges![0].id).toBe("ok");
	});

	it("removes the field entirely when nothing survives, so the key never lingers", () => {
		const conv = withMerges([null, { text: "orphan" }]);
		normalizeMerges(conv, makeId);
		expect(conv.merges).toBeUndefined();
	});

	it("is a no-op when merges is absent", () => {
		const conv = makeConv("c");
		normalizeMerges(conv, makeId);
		expect(conv.merges).toBeUndefined();
	});

	it("runs automatically via parseConversations", () => {
		const raw = [
			{
				id: "c",
				messages: [],
				merges: [null, { conversationId: "other", messageId: "m1", text: "passage" }],
			},
		];
		const { conversations } = parseConversations(raw);
		expect(conversations[0].merges).toHaveLength(1);
		expect(typeof conversations[0].merges![0].id).toBe("string");
		expect(conversations[0].merges![0].id.length).toBeGreaterThan(0);
	});
});

// ── normalizeFavorites (highlight-favorites migration) ─────────────────────────

describe("normalizeFavorites", () => {
	let counter = 0;
	const makeId = () => `fav-${counter++}`;

	it("assigns ids to legacy message-level favorites and preserves them", () => {
		counter = 0;
		const conv = makeConv("c", undefined, [
			{ messageId: "m1", name: "Old favorite" },
		]);
		normalizeFavorites(conv, makeId);
		expect(conv.favorites).toHaveLength(1);
		const fav = conv.favorites![0];
		expect(fav.id).toBe("fav-0");
		expect(fav.messageId).toBe("m1");
		expect(fav.name).toBe("Old favorite");
		// Legacy favorites have no span to paint.
		expect(fav.text).toBeUndefined();
		expect(fav.occurrenceIndex).toBeUndefined();
	});

	it("keeps existing ids untouched", () => {
		const conv = makeConv("c", undefined, [
			{ id: "keep-me", messageId: "m1", name: "n", text: "hello", occurrenceIndex: 0 },
		]);
		normalizeFavorites(conv, makeId);
		expect(conv.favorites![0].id).toBe("keep-me");
		expect(conv.favorites![0].text).toBe("hello");
	});

	it("drops malformed favorites missing messageId", () => {
		const conv = makeConv("c", undefined, [
			{ name: "no message id" },
			null,
			{ messageId: "ok", name: "good" },
		]);
		normalizeFavorites(conv, makeId);
		expect(conv.favorites).toHaveLength(1);
		expect(conv.favorites![0].messageId).toBe("ok");
	});

	it("is a no-op when there are no favorites", () => {
		const conv = makeConv("c");
		conv.favorites = undefined;
		normalizeFavorites(conv, makeId);
		expect(conv.favorites).toBeUndefined();
	});

	it("runs automatically via parseConversations, ensuring every favorite has an id", () => {
		const raw = [
			{ id: "c", messages: [], favorites: [{ messageId: "m1", name: "legacy" }] },
		];
		const { conversations } = parseConversations(raw);
		const fav = conversations[0].favorites![0];
		expect(typeof fav.id).toBe("string");
		expect(fav.id.length).toBeGreaterThan(0);
	});
});

// ── shouldRefuseLoad ──────────────────────────────────────────────────────────

describe("shouldRefuseLoad", () => {
	it("returns true when loaded is empty and memory has conversations (iCloud eviction)", () => {
		expect(shouldRefuseLoad([], 3)).toBe(true);
	});

	it("returns false when loaded has conversations (normal case)", () => {
		const conv = makeConv("a");
		expect(shouldRefuseLoad([conv], 3)).toBe(false);
	});

	it("returns false when both loaded and existing are empty (fresh install)", () => {
		expect(shouldRefuseLoad([], 0)).toBe(false);
	});

	it("returns false when loaded has conversations even if existing is zero", () => {
		expect(shouldRefuseLoad([makeConv("a")], 0)).toBe(false);
	});
});
