import { describe, it, expect, vi, beforeEach } from "vitest";

const { TFileMock } = vi.hoisted(() => {
	class TFileMock {
		path: string;
		name: string;
		stat: { size: number };
		constructor(path: string, size = 0) {
			this.path = path;
			this.name = path.split("/").pop() ?? path;
			this.stat = { size };
		}
	}
	return { TFileMock };
});

vi.mock("obsidian", () => ({
	App: class {},
	TFile: TFileMock,
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

function makeAppWithPdf(path: string, size: number, bytes: Uint8Array): import("obsidian").App {
	const file = new TFileMock(path, size);
	return {
		vault: {
			getAbstractFileByPath: (p: string) => (p === path ? file : null),
			readBinary: async () => bytes.buffer,
		},
	} as unknown as import("obsidian").App;
}

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

describe("AnthropicService — temperature gating", () => {
	it("sends temperature for models that still accept sampling parameters", async () => {
		streamMock.mockReturnValueOnce(
			makeFakeStream(["hi"], {
				content: [{ type: "text", text: "hi" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 5, output_tokens: 2 },
			})
		);

		const provider = new AnthropicService({} as never, makeSettings({ temperature: 0.7 }), "key");
		await provider.streamMessage(
			makeConv({ model: "claude-sonnet-4-6" }), "hi", [], () => {}, () => {}, () => {}
		);

		expect(streamMock.mock.calls[0][0]).toMatchObject({ temperature: 0.7 });
	});

	// claude-fable-5, claude-opus-4-8, and claude-sonnet-5 return a 400
	// ("temperature is deprecated for this model") if `temperature` is sent
	// at all — regression coverage for that bug.
	it.each(["claude-fable-5", "claude-opus-4-8", "claude-sonnet-5"])(
		"omits temperature for %s, which rejects the parameter outright",
		async (model) => {
			streamMock.mockReturnValueOnce(
				makeFakeStream(["hi"], {
					content: [{ type: "text", text: "hi" }],
					stop_reason: "end_turn",
					usage: { input_tokens: 5, output_tokens: 2 },
				})
			);

			const provider = new AnthropicService({} as never, makeSettings({ temperature: 0.7 }), "key");
			await provider.streamMessage(
				makeConv({ model }), "hi", [], () => {}, () => {}, () => {}
			);

			expect(streamMock.mock.calls[0][0]).not.toHaveProperty("temperature");
		}
	);
});

describe("AnthropicService — effort gating", () => {
	it("sends output_config.effort for models that support it", async () => {
		streamMock.mockReturnValueOnce(
			makeFakeStream(["hi"], {
				content: [{ type: "text", text: "hi" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 5, output_tokens: 2 },
			})
		);

		const provider = new AnthropicService({} as never, makeSettings({ effort: "high" }), "key");
		await provider.streamMessage(
			makeConv({ model: "claude-sonnet-5" }), "hi", [], () => {}, () => {}, () => {}
		);

		expect(streamMock.mock.calls[0][0]).toMatchObject({ output_config: { effort: "high" } });
	});

	it("omits output_config.effort for models that don't support it", async () => {
		streamMock.mockReturnValueOnce(
			makeFakeStream(["hi"], {
				content: [{ type: "text", text: "hi" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 5, output_tokens: 2 },
			})
		);

		const provider = new AnthropicService({} as never, makeSettings({ effort: "high" }), "key");
		await provider.streamMessage(
			makeConv({ model: "claude-haiku-4-5" }), "hi", [], () => {}, () => {}, () => {}
		);

		expect(streamMock.mock.calls[0][0]).not.toHaveProperty("output_config");
	});
});

describe("AnthropicService — maxTokens resolution", () => {
	it("uses conversation.maxTokens when set, regardless of settings or model", async () => {
		streamMock.mockReturnValueOnce(
			makeFakeStream(["hi"], {
				content: [{ type: "text", text: "hi" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 5, output_tokens: 2 },
			})
		);

		const provider = new AnthropicService({} as never, makeSettings({ maxTokens: 2000 }), "key");
		await provider.streamMessage(
			makeConv({ maxTokens: 500, model: "claude-sonnet-5" }), "hi", [], () => {}, () => {}, () => {}
		);

		expect(streamMock.mock.calls[0][0]).toMatchObject({ max_tokens: 500 });
	});

	it("falls back to settings.maxTokens when the conversation has no override", async () => {
		streamMock.mockReturnValueOnce(
			makeFakeStream(["hi"], {
				content: [{ type: "text", text: "hi" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 5, output_tokens: 2 },
			})
		);

		const provider = new AnthropicService({} as never, makeSettings({ maxTokens: 2000 }), "key");
		await provider.streamMessage(
			makeConv({ model: "claude-sonnet-5" }), "hi", [], () => {}, () => {}, () => {}
		);

		expect(streamMock.mock.calls[0][0]).toMatchObject({ max_tokens: 2000 });
	});

	it("falls back to the model-aware default when neither conversation nor settings specify one", async () => {
		streamMock.mockReturnValueOnce(
			makeFakeStream(["hi"], {
				content: [{ type: "text", text: "hi" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 5, output_tokens: 2 },
			})
		);

		const provider = new AnthropicService({} as never, makeSettings(), "key");
		await provider.streamMessage(
			makeConv({ model: "claude-sonnet-5" }), "hi", [], () => {}, () => {}, () => {}
		);

		expect(streamMock.mock.calls[0][0]).toMatchObject({ max_tokens: 8192 });
	});
});

describe("AnthropicService — PDF attachments", () => {
	it("splices a document content block onto the final user message when a PDF is attached", async () => {
		streamMock.mockReturnValueOnce(
			makeFakeStream(["hi"], {
				content: [{ type: "text", text: "hi" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 5, output_tokens: 2 },
			})
		);

		const bytes = new Uint8Array([1, 2, 3, 4]);
		const app = makeAppWithPdf("Papers/paper.pdf", bytes.length, bytes);

		const provider = new AnthropicService(app, makeSettings(), "key");
		await provider.streamMessage(
			makeConv(), "Summarize this", ["Papers/paper.pdf"], () => {}, () => {}, () => {}
		);

		const params = streamMock.mock.calls[0][0] as { messages: Array<{ role: string; content: unknown }> };
		const last = params.messages[params.messages.length - 1];
		expect(Array.isArray(last.content)).toBe(true);
		const blocks = last.content as Array<{ type: string; title?: string; text?: string }>;
		expect(blocks[0]).toMatchObject({ type: "document", title: "paper.pdf" });
		expect(blocks[blocks.length - 1]).toMatchObject({ type: "text", text: "Summarize this" });
	});

	it("skips PDFs over the size limit and does not add a content block for them", async () => {
		streamMock.mockReturnValueOnce(
			makeFakeStream(["hi"], {
				content: [{ type: "text", text: "hi" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 5, output_tokens: 2 },
			})
		);

		const bytes = new Uint8Array([1, 2, 3]);
		const app = makeAppWithPdf("Papers/huge.pdf", 21 * 1024 * 1024, bytes);

		const provider = new AnthropicService(app, makeSettings(), "key");
		await provider.streamMessage(
			makeConv(), "Summarize this", ["Papers/huge.pdf"], () => {}, () => {}, () => {}
		);

		const params = streamMock.mock.calls[0][0] as { messages: Array<{ role: string; content: unknown }> };
		const last = params.messages[params.messages.length - 1];
		expect(typeof last.content).toBe("string");
	});

	it("keeps message content a plain string when no PDFs are attached", async () => {
		streamMock.mockReturnValueOnce(
			makeFakeStream(["hi"], {
				content: [{ type: "text", text: "hi" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 5, output_tokens: 2 },
			})
		);

		const provider = new AnthropicService({} as never, makeSettings(), "key");
		await provider.streamMessage(makeConv(), "hi", [], () => {}, () => {}, () => {});

		const params = streamMock.mock.calls[0][0] as { messages: Array<{ role: string; content: unknown }> };
		expect(typeof params.messages[params.messages.length - 1].content).toBe("string");
	});
});
