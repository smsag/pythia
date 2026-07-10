import { describe, it, expect } from "vitest";
import {
	applySettingsMigrations,
	mergeSettings,
	parseConversations,
	shouldRefuseLoad,
	evictConversations,
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

	it("leaves temperature undefined when absent from old saved data (pre-B2 data.json)", () => {
		const result = mergeSettings({ defaultProvider: "anthropic" });
		expect(result.temperature).toBeUndefined();
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

// ── evictConversations ────────────────────────────────────────────────────────

describe("evictConversations", () => {
	it("returns the input unchanged when under cap", () => {
		const convs = [makeConv("a"), makeConv("b")];
		expect(evictConversations(convs, 5, [])).toHaveLength(2);
	});

	it("returns the input unchanged when at exactly the cap", () => {
		const convs = [makeConv("a"), makeConv("b"), makeConv("c")];
		expect(evictConversations(convs, 3, [])).toHaveLength(3);
	});

	it("returns all conversations when cap is 0 (unlimited)", () => {
		const convs = Array.from({ length: 10 }, (_, i) => makeConv(String(i)));
		expect(evictConversations(convs, 0, [])).toHaveLength(10);
	});

	it("evicts down to cap, keeping the newest conversations", () => {
		const convs = [
			makeConv("old", "2026-01-01T00:00:00.000Z"),
			makeConv("mid", "2026-06-01T00:00:00.000Z"),
			makeConv("new", "2026-12-01T00:00:00.000Z"),
		];
		const result = evictConversations(convs, 2, []);
		expect(result).toHaveLength(2);
		const ids = result.map((c) => c.id);
		expect(ids).toContain("new");
		expect(ids).toContain("mid");
		expect(ids).not.toContain("old");
	});

	it("always keeps the active conversation even if it is the oldest", () => {
		const convs = [
			makeConv("oldest", "2026-01-01T00:00:00.000Z"),
			makeConv("newer",  "2026-06-01T00:00:00.000Z"),
			makeConv("newest", "2026-12-01T00:00:00.000Z"),
		];
		const result = evictConversations(convs, 2, ["oldest"]);
		const ids = result.map((c) => c.id);
		expect(ids).toContain("oldest");
		expect(ids).toContain("newest");
		expect(ids).not.toContain("newer");
	});

	it("always keeps starred conversations even if they are the oldest", () => {
		const convs = [
			makeConv("starred-old", "2026-01-01T00:00:00.000Z", [{ messageId: "m1", name: "fav" }]),
			makeConv("newer",       "2026-06-01T00:00:00.000Z"),
			makeConv("newest",      "2026-12-01T00:00:00.000Z"),
		];
		const result = evictConversations(convs, 2, []);
		const ids = result.map((c) => c.id);
		expect(ids).toContain("starred-old");
		expect(ids).toContain("newest");
		expect(ids).not.toContain("newer");
	});

	it("handles more protected conversations than cap without crashing", () => {
		const starred = Array.from({ length: 5 }, (_, i) =>
			makeConv(`s${i}`, "2026-01-01T00:00:00.000Z", [{ messageId: "m", name: "f" }])
		);
		const result = evictConversations(starred, 3, []);
		// all starred must survive — result may exceed cap
		expect(result.length).toBe(5);
	});

	it("returns result sorted by updatedAt descending", () => {
		const convs = [
			makeConv("a", "2026-01-01T00:00:00.000Z"),
			makeConv("b", "2026-03-01T00:00:00.000Z"),
			makeConv("c", "2026-12-01T00:00:00.000Z"),
			makeConv("d", "2026-06-01T00:00:00.000Z"),
		];
		const result = evictConversations(convs, 3, []);
		const dates = result.map((c) => c.updatedAt);
		expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));
	});

	it("protects both the active conversation and starred conversations simultaneously", () => {
		const convs = [
			makeConv("active-old", "2026-01-01T00:00:00.000Z"),
			makeConv("starred-old", "2026-01-02T00:00:00.000Z", [{ messageId: "m", name: "f" }]),
			makeConv("plain-new",   "2026-12-01T00:00:00.000Z"),
			makeConv("plain-old",   "2026-06-01T00:00:00.000Z"),
		];
		const result = evictConversations(convs, 3, ["active-old"]);
		const ids = result.map((c) => c.id);
		expect(ids).toContain("active-old");
		expect(ids).toContain("starred-old");
		expect(ids).toContain("plain-new");
		expect(ids).not.toContain("plain-old");
	});

	it("does not throw when a conversation has a malformed/missing updatedAt", () => {
		const convs = [
			makeConv("good", "2026-06-01T00:00:00.000Z"),
			{ ...makeConv("bad"), updatedAt: undefined as unknown as string },
			makeConv("newest", "2026-12-01T00:00:00.000Z"),
		];
		expect(() => evictConversations(convs, 2, [])).not.toThrow();
	});

	it("protects the active conversation from every open leaf, not just one", () => {
		const convs = [
			makeConv("leaf1-active", "2026-01-01T00:00:00.000Z"),
			makeConv("leaf2-active", "2026-01-02T00:00:00.000Z"),
			makeConv("plain-new",    "2026-12-01T00:00:00.000Z"),
			makeConv("plain-old",    "2026-06-01T00:00:00.000Z"),
		];
		const result = evictConversations(convs, 2, ["leaf1-active", "leaf2-active"]);
		const ids = result.map((c) => c.id);
		expect(ids).toContain("leaf1-active");
		expect(ids).toContain("leaf2-active");
		expect(ids).not.toContain("plain-old");
	});
});
