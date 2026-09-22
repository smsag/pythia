import { describe, it, expect } from "vitest";
import { mergeSettings, parseConversations, sanitizeConversationFields } from "../services/persistence";
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

describe("sanitizeMessages — cost snapshot (ADR-163)", () => {
	it("keeps a well-formed snapshot and drops a malformed one", () => {
		const { conversations: [conv] } = parseConversations([{
			id: "c", messages: [
				{ id: "a", role: "assistant", content: "x", timestamp: "", cost: { usd: 0.01, asOf: "2026-09-16" } },
				{ id: "b", role: "assistant", content: "y", timestamp: "", cost: { usd: NaN, asOf: "2026-09-16" } },
				{ id: "c", role: "assistant", content: "z", timestamp: "", cost: "cheap" },
			],
		}]);
		expect(conv.messages[0].cost).toEqual({ usd: 0.01, asOf: "2026-09-16" });
		expect("cost" in conv.messages[1]).toBe(false);
		expect("cost" in conv.messages[2]).toBe(false);
	});
});

// ── the one-shot template on the read path (ADR-177) ──────────────────────────
//
// It reaches the send path directly: its systemPrompt becomes the prompt and
// its writeMode decides which tools the model gets. So it validates where it
// enters, and anything malformed is dropped rather than repaired.

describe("sanitizeConversationFields — pendingTemplate", () => {
	const base = () => ({
		id: "c1", name: "Chat", createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z", systemPrompt: "", contextNotes: [],
		resumeMode: "full", provider: "anthropic", model: "m", messages: [],
	}) as unknown as Parameters<typeof sanitizeConversationFields>[0];

	const sanitize = (pendingTemplate: unknown) => {
		const conv = Object.assign(base(), { pendingTemplate });
		sanitizeConversationFields(conv);
		return (conv as unknown as Record<string, unknown>).pendingTemplate as Record<string, unknown> | undefined;
	};

	it("keeps a well-formed one", () => {
		const kept = sanitize({ id: "T.md", name: "Term Note", systemPrompt: "Write terms.", model: "claude-haiku-4-5" });
		expect(kept).toMatchObject({ id: "T.md", name: "Term Note", model: "claude-haiku-4-5" });
	});

	it("drops one without the two fields a send cannot do without", () => {
		expect(sanitize({ name: "No id", systemPrompt: "x" })).toBeUndefined();
		expect(sanitize({ id: "T.md", name: "No prompt" })).toBeUndefined();
		expect(sanitize("a string")).toBeUndefined();
		expect(sanitize(null)).toBeUndefined();
	});

	it("drops individual fields that are the wrong shape, keeping the rest", () => {
		const kept = sanitize({
			id: "T.md", systemPrompt: "x",
			provider: "wrongProvider", effort: "extreme", writeMode: "destroy",
			maxTokens: -5, temperature: "warm", outputFolder: 42,
		});
		expect(kept).toBeDefined();
		expect(kept?.provider).toBeUndefined();
		expect(kept?.effort).toBeUndefined();
		expect(kept?.writeMode).toBeUndefined();
		expect(kept?.maxTokens).toBeUndefined();
		expect(kept?.temperature).toBeUndefined();
		expect(kept?.outputFolder).toBeUndefined();
	});

	it("falls back to the path when the name is missing, and filters the note list", () => {
		const kept = sanitize({ id: "T.md", systemPrompt: "x", contextNotes: ["A.md", "", 7, null] });
		expect(kept?.name).toBe("T.md");
		expect(kept?.contextNotes).toEqual(["A.md"]);
	});

	it("leaves a conversation with none alone", () => {
		expect(sanitize(undefined)).toBeUndefined();
	});
});

// ── ADR-208: the term a conversation was opened from ────────────────────────

describe("sanitizeConversationFields — glossaryTerm", () => {
	const field = (value: unknown): unknown => {
		const conv = { name: "c", systemPrompt: "", glossaryTerm: value } as never;
		sanitizeConversationFields(conv);
		return (conv as Record<string, unknown>).glossaryTerm;
	};

	it("keeps a real term", () => {
		expect(field("Kartellrecht")).toBe("Kartellrecht");
	});

	it("drops anything that is not one, so the header cannot offer to write nowhere", () => {
		for (const bad of [7, null, {}, [], "", "   ", true]) expect(field(bad)).toBeUndefined();
	});

	it("leaves an ordinary conversation without one alone", () => {
		const conv = { name: "c", systemPrompt: "" } as never;
		sanitizeConversationFields(conv);
		expect("glossaryTerm" in (conv as object)).toBe(false);
	});
});
