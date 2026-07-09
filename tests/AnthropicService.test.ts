import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	TFile: class {},
	Notice: class { constructor(public message?: string) {} },
}));

vi.mock("../i18n", () => ({
	t: (key: string) => key,
}));

const streamMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
	class FakeAnthropic {
		messages = { stream: streamMock, create: vi.fn() };
		constructor(_opts: unknown) { void _opts; }
	}
	return { default: FakeAnthropic };
});

import { AnthropicService } from "../services/AnthropicService";
import type { Conversation } from "../models/types";
import type { PythiaSettings } from "../models/settings";

function makeFakeStream(textChunks: string[], finalMessage: unknown) {
	return {
		on(event: string, cb: (text: string) => void) {
			if (event === "text") {
				for (const t of textChunks) cb(t);
			}
			return this;
		},
		finalMessage: () => Promise.resolve(finalMessage),
	};
}

function makeSettings(overrides: Partial<PythiaSettings> = {}): PythiaSettings {
	return {
		defaultAnthropicModel: "claude-sonnet-4-6",
		maxAttachedNotesTokens: 0,
		outputLanguage: "auto",
		debugMode: false,
		...overrides,
	} as PythiaSettings;
}

function makeConv(overrides: Partial<Conversation> = {}): Conversation {
	return {
		id: "c1",
		name: "Test",
		createdAt: "",
		updatedAt: "",
		systemPrompt: "Be nice.",
		contextNotes: [],
		resumeMode: "full",
		provider: "anthropic",
		model: "claude-sonnet-4-6",
		messages: [{ id: "m1", role: "user", content: "hi", timestamp: "" }],
		...overrides,
	};
}

beforeEach(() => {
	streamMock.mockReset();
});

describe("AnthropicService — token/cache usage across tool-call rounds", () => {
	it("sums input/output/cache tokens across every round", async () => {
		streamMock
			.mockReturnValueOnce(
				makeFakeStream([], {
					content: [{ type: "tool_use", id: "t1", name: "create_note", input: {} }],
					stop_reason: "tool_use",
					usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 0 },
				})
			)
			.mockReturnValueOnce(
				makeFakeStream(["done"], {
					content: [{ type: "text", text: "done" }],
					stop_reason: "end_turn",
					usage: { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
				})
			);

		const provider = new AnthropicService({} as never, makeSettings(), "key");
		const conv = makeConv();

		let usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number } | undefined;
		await provider.streamMessage(
			conv,
			"hi",
			[],
			() => {},
			(_text, tokenUsage) => { usage = tokenUsage; },
			() => {},
			async () => "tool result"
		);

		expect(streamMock).toHaveBeenCalledTimes(2);
		expect(usage?.inputTokens).toBe(150);
		expect(usage?.outputTokens).toBe(30);
		expect(usage?.cacheReadTokens).toBe(50);
		expect(usage?.cacheCreationTokens).toBe(5);
	});

	it("omits cache fields when the API reports none", async () => {
		streamMock.mockReturnValueOnce(
			makeFakeStream(["hi"], {
				content: [{ type: "text", text: "hi" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 5, output_tokens: 2 },
			})
		);

		const provider = new AnthropicService({} as never, makeSettings(), "key");
		let usage: { cacheReadTokens?: number; cacheCreationTokens?: number } | undefined;
		await provider.streamMessage(
			makeConv(), "hi", [], () => {}, (_t, u) => { usage = u; }, () => {}
		);

		expect(usage?.cacheReadTokens).toBeUndefined();
		expect(usage?.cacheCreationTokens).toBeUndefined();
	});
});
