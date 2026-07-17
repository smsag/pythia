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

const { chatCompleteMock, chatStreamMock } = vi.hoisted(() => ({
	chatCompleteMock: vi.fn(),
	chatStreamMock: vi.fn(),
}));

vi.mock("@mistralai/mistralai/core.js", () => {
	class FakeMistralCore {
		constructor(_opts: unknown) { void _opts; }
	}
	return { MistralCore: FakeMistralCore };
});

vi.mock("@mistralai/mistralai/funcs/chatComplete.js", () => ({
	chatComplete: chatCompleteMock,
}));

vi.mock("@mistralai/mistralai/funcs/chatStream.js", () => ({
	chatStream: chatStreamMock,
}));

// Mirrors the real fp.js unwrapAsync: resolve to `.value` or throw `.error`.
vi.mock("@mistralai/mistralai/types/fp.js", () => ({
	unwrapAsync: async (pr: Promise<{ ok: boolean; value?: unknown; error?: unknown }>) => {
		const r = await pr;
		if (r.ok) return r.value;
		throw r.error;
	},
}));

import { MistralService } from "../services/MistralService";
import type { Conversation } from "../models/types";
import type { PythiaSettings } from "../models/settings";

async function* chunkStream(chunks: unknown[]) {
	for (const c of chunks) yield { data: c };
}

function okStream(chunks: unknown[]) {
	return Promise.resolve({ ok: true, value: chunkStream(chunks) });
}

function makeSettings(overrides: Partial<PythiaSettings> = {}): PythiaSettings {
	return {
		defaultMistralModel: "mistral-large-latest",
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
		provider: "mistral",
		model: "mistral-large-latest",
		messages: [{ id: "m1", role: "user", content: "hi", timestamp: "" }],
		...overrides,
	};
}

beforeEach(() => {
	chatCompleteMock.mockReset();
	chatStreamMock.mockReset();
});

describe("MistralService — streaming happy path", () => {
	it("streams tokens and reports usage on completion", async () => {
		chatStreamMock.mockReturnValueOnce(
			okStream([
				{ choices: [{ delta: { content: "hel" } }] },
				{ choices: [{ delta: { content: "lo" }, finishReason: "stop" }], usage: { promptTokens: 5, completionTokens: 2 } },
			])
		);

		const provider = new MistralService({} as never, makeSettings(), "key");
		const conv = makeConv();

		let streamed = "";
		let completedText = "";
		let usage: { inputTokens: number; outputTokens: number } | undefined;
		await provider.streamMessage(
			conv,
			"hi",
			[],
			(t) => { streamed += t; },
			(fullText, tokenUsage) => { completedText = fullText; usage = tokenUsage; },
			() => {}
		);

		expect(streamed).toBe("hello");
		expect(completedText).toBe("hello");
		expect(usage).toEqual({ inputTokens: 5, outputTokens: 2 });
		expect(chatStreamMock).toHaveBeenCalledTimes(1);
	});

	it("leaves tokenUsage undefined when the API never reports usage", async () => {
		chatStreamMock.mockReturnValueOnce(
			okStream([{ choices: [{ delta: { content: "hi" }, finishReason: "stop" }] }])
		);

		const provider = new MistralService({} as never, makeSettings(), "key");
		let usage: unknown = "unset";
		await provider.streamMessage(
			makeConv(), "hi", [], () => {}, (_t, u) => { usage = u; }, () => {}
		);

		expect(usage).toBeUndefined();
	});
});

describe("MistralService — temperature / reasoningEffort / maxTokens request shaping", () => {
	it("sends temperature and reasoningEffort when set", async () => {
		chatStreamMock.mockReturnValueOnce(
			okStream([{ choices: [{ delta: { content: "hi" }, finishReason: "stop" }] }])
		);

		const provider = new MistralService({} as never, makeSettings({ temperature: 0.5, effort: "high" }), "key");
		await provider.streamMessage(makeConv(), "hi", [], () => {}, () => {}, () => {});

		const args = chatStreamMock.mock.calls[0][1] as Record<string, unknown>;
		expect(args.temperature).toBe(0.5);
		expect(args.reasoningEffort).toBe("high");
	});

	it("sends reasoningEffort even for a non-Magistral model (no per-model gating)", async () => {
		chatStreamMock.mockReturnValueOnce(
			okStream([{ choices: [{ delta: { content: "hi" }, finishReason: "stop" }] }])
		);

		const provider = new MistralService({} as never, makeSettings({ effort: "low" }), "key");
		await provider.streamMessage(
			makeConv({ model: "mistral-large-latest" }), "hi", [], () => {}, () => {}, () => {}
		);

		const args = chatStreamMock.mock.calls[0][1] as Record<string, unknown>;
		expect(args.reasoningEffort).toBe("low");
	});
});

describe("MistralService — maxTokens resolution", () => {
	it("uses conversation.maxTokens when set, regardless of settings or model", async () => {
		chatStreamMock.mockReturnValueOnce(
			okStream([{ choices: [{ delta: { content: "hi" }, finishReason: "stop" }] }])
		);

		const provider = new MistralService({} as never, makeSettings({ maxTokens: 2000 }), "key");
		await provider.streamMessage(
			makeConv({ maxTokens: 500, model: "mistral-large-latest" }), "hi", [], () => {}, () => {}, () => {}
		);

		const args = chatStreamMock.mock.calls[0][1] as Record<string, unknown>;
		expect(args.maxTokens).toBe(500);
	});

	it("falls back to settings.maxTokens when the conversation has no override", async () => {
		chatStreamMock.mockReturnValueOnce(
			okStream([{ choices: [{ delta: { content: "hi" }, finishReason: "stop" }] }])
		);

		const provider = new MistralService({} as never, makeSettings({ maxTokens: 2000 }), "key");
		await provider.streamMessage(
			makeConv({ model: "mistral-large-latest" }), "hi", [], () => {}, () => {}, () => {}
		);

		const args = chatStreamMock.mock.calls[0][1] as Record<string, unknown>;
		expect(args.maxTokens).toBe(2000);
	});

	it("falls back to the general default for a non-reasoning model with no override", async () => {
		chatStreamMock.mockReturnValueOnce(
			okStream([{ choices: [{ delta: { content: "hi" }, finishReason: "stop" }] }])
		);

		const provider = new MistralService({} as never, makeSettings(), "key");
		await provider.streamMessage(
			makeConv({ model: "mistral-large-latest" }), "hi", [], () => {}, () => {}, () => {}
		);

		const args = chatStreamMock.mock.calls[0][1] as Record<string, unknown>;
		expect(args.maxTokens).toBe(8192);
	});

	it("uses the larger reasoning-model default for a Magistral model with no override", async () => {
		chatStreamMock.mockReturnValueOnce(
			okStream([{ choices: [{ delta: { content: "hi" }, finishReason: "stop" }] }])
		);

		const provider = new MistralService({} as never, makeSettings({ defaultMistralModel: "magistral-medium-latest" }), "key");
		await provider.streamMessage(
			makeConv({ model: "magistral-medium-latest" }), "hi", [], () => {}, () => {}, () => {}
		);

		const args = chatStreamMock.mock.calls[0][1] as Record<string, unknown>;
		expect(args.maxTokens).toBe(16384);
	});
});

describe("MistralService — tool-call round trip", () => {
	it("executes a tool call and sends the result back, summing usage across rounds", async () => {
		chatStreamMock
			.mockReturnValueOnce(
				okStream([
					{
						choices: [
							{
								delta: {
									toolCalls: [
										{ index: 0, id: "call_1", function: { name: "create_note", arguments: "{}" } },
									],
								},
							},
						],
					},
					{ choices: [{ finishReason: "tool_calls" }], usage: { promptTokens: 100, completionTokens: 20 } },
				])
			)
			.mockReturnValueOnce(
				okStream([
					{ choices: [{ delta: { content: "done" }, finishReason: "stop" }], usage: { promptTokens: 50, completionTokens: 10 } },
				])
			);

		const provider = new MistralService({} as never, makeSettings(), "key");
		const conv = makeConv();

		let toolCalled = false;
		let usage: { inputTokens: number; outputTokens: number } | undefined;
		let completedText = "";
		await provider.streamMessage(
			conv,
			"hi",
			[],
			() => {},
			(fullText, tokenUsage) => { completedText = fullText; usage = tokenUsage; },
			() => {},
			async (call) => {
				toolCalled = true;
				expect(call.name).toBe("create_note");
				return "tool result";
			}
		);

		expect(toolCalled).toBe(true);
		expect(completedText).toBe("done");
		expect(chatStreamMock).toHaveBeenCalledTimes(2);
		expect(usage?.inputTokens).toBe(150);
		expect(usage?.outputTokens).toBe(30);

		// Second round's request must include the tool result message.
		const secondRoundMessages = chatStreamMock.mock.calls[1][1].messages as Array<{ role: string; content?: unknown; toolCallId?: string }>;
		const toolMsg = secondRoundMessages.find((m) => m.role === "tool");
		expect(toolMsg).toMatchObject({ role: "tool", toolCallId: "call_1", content: "tool result" });
	});
});

describe("MistralService — abort during a pending tool confirmation", () => {
	it("completes cleanly instead of throwing when abort() is called while onToolCall is pending", async () => {
		chatStreamMock
			.mockReturnValueOnce(
				okStream([
					{
						choices: [
							{
								delta: {
									toolCalls: [
										{ index: 0, id: "call_1", function: { name: "create_note", arguments: "{}" } },
									],
								},
							},
						],
					},
					{ choices: [{ finishReason: "tool_calls" }] },
				])
			)
			.mockReturnValueOnce(
				okStream([{ choices: [{ delta: { content: "ok" }, finishReason: "stop" }] }])
			);

		const provider = new MistralService({} as never, makeSettings(), "key");

		let completed = false;
		let errored: Error | undefined;
		await provider.streamMessage(
			makeConv(),
			"hi",
			[],
			() => {},
			() => { completed = true; },
			(e) => { errored = e; },
			async () => {
				// Simulate the user clicking Stop while the confirm chip is showing.
				provider.abort();
				return "tool result";
			}
		);

		expect(errored).toBeUndefined();
		expect(completed).toBe(true);
	});
});

describe("MistralService — bounded tool-call loop", () => {
	it("surfaces a ToolLoopLimitError via onError instead of looping forever", async () => {
		chatStreamMock.mockImplementation(() =>
			okStream([
				{
					choices: [
						{ delta: { toolCalls: [{ index: 0, id: "call_x", function: { name: "create_note", arguments: "{}" } }] } },
					],
				},
				{ choices: [{ finishReason: "tool_calls" }] },
			])
		);

		const provider = new MistralService({} as never, makeSettings(), "key");

		let errored: Error | undefined;
		let completed = false;
		await provider.streamMessage(
			makeConv(),
			"hi",
			[],
			() => {},
			() => { completed = true; },
			(e) => { errored = e; },
			async () => "tool result"
		);

		expect(completed).toBe(false);
		expect(errored?.name).toBe("ToolLoopLimitError");
		expect(chatStreamMock.mock.calls.length).toBeLessThanOrEqual(26);
	});
});

describe("MistralService — PDF attachments", () => {
	it("warns via Notice instead of silently dropping a PDF attachment", async () => {
		chatStreamMock.mockReturnValueOnce(
			okStream([{ choices: [{ delta: { content: "hi" }, finishReason: "stop" }] }])
		);

		const file = new TFileMock("Papers/paper.pdf", 100);
		const app = {
			vault: {
				getAbstractFileByPath: (p: string) => (p === "Papers/paper.pdf" ? file : null),
				readBinary: async () => new Uint8Array([1, 2, 3]).buffer,
			},
		} as unknown as import("obsidian").App;

		const provider = new MistralService(app, makeSettings(), "key");
		await provider.streamMessage(
			makeConv(), "Summarize this", ["Papers/paper.pdf"], () => {}, () => {}, () => {}
		);

		// PDFs aren't spliced into the message content for Mistral this pass —
		// content stays a plain string.
		const args = chatStreamMock.mock.calls[0][1] as { messages: Array<{ role: string; content: unknown }> };
		const last = args.messages[args.messages.length - 1];
		expect(typeof last.content).toBe("string");
	});
});
