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

const createMock = vi.fn();

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = { completions: { create: createMock } };
		constructor(_opts: unknown) { void _opts; }
	}
	return { default: FakeOpenAI };
});

import { OpenAIProvider } from "../services/OpenAIProvider";
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

async function* chunkStream(chunks: unknown[]) {
	for (const c of chunks) yield c;
}

function makeSettings(overrides: Partial<PythiaSettings> = {}): PythiaSettings {
	return {
		defaultOpenAIModel: "gpt-4o",
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
		provider: "openai",
		model: "gpt-4o",
		messages: [{ id: "m1", role: "user", content: "hi", timestamp: "" }],
		...overrides,
	};
}

beforeEach(() => {
	createMock.mockReset();
});

describe("OpenAIProvider — reasoning-model request shaping (regression for the o4-mini bug)", () => {
	it("omits temperature, uses max_completion_tokens, and injects the system prompt as a user message for o4-mini", async () => {
		createMock.mockImplementation(async () =>
			chunkStream([
				{ choices: [{ delta: { content: "hello" }, finish_reason: "stop" }] },
				{ choices: [{}], usage: { prompt_tokens: 5, completion_tokens: 2 } },
			])
		);

		const provider = new OpenAIProvider({} as never, makeSettings({ defaultOpenAIModel: "o4-mini" }), "key");
		const conv = makeConv({ model: "o4-mini", temperature: 0.7 });

		let completed = false;
		await provider.streamMessage(
			conv,
			"hi",
			[],
			() => {},
			() => { completed = true; },
			() => {}
		);

		expect(completed).toBe(true);
		expect(createMock).toHaveBeenCalledTimes(1);
		const args = createMock.mock.calls[0][0] as Record<string, unknown>;
		expect(args.temperature).toBeUndefined();
		expect(args.max_tokens).toBeUndefined();
		expect(args.max_completion_tokens).toBeDefined();
		expect(JSON.stringify(args.messages)).toContain("[System instructions]");
	});

	it("keeps temperature and max_tokens (not max_completion_tokens) for a non-reasoning model", async () => {
		createMock.mockImplementation(async () =>
			chunkStream([
				{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] },
				{ choices: [{}], usage: { prompt_tokens: 5, completion_tokens: 2 } },
			])
		);

		const provider = new OpenAIProvider({} as never, makeSettings(), "key");
		const conv = makeConv({ model: "gpt-4o", temperature: 0.5 });

		await provider.streamMessage(conv, "hi", [], () => {}, () => {}, () => {});

		const args = createMock.mock.calls[0][0] as Record<string, unknown>;
		expect(args.temperature).toBe(0.5);
		expect(args.max_tokens).toBeDefined();
		expect(args.max_completion_tokens).toBeUndefined();
	});
});

describe("OpenAIProvider — effort gating", () => {
	it("sends reasoning_effort for reasoning models", async () => {
		createMock.mockImplementation(async () =>
			chunkStream([
				{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] },
				{ choices: [{}], usage: { prompt_tokens: 5, completion_tokens: 2 } },
			])
		);

		const provider = new OpenAIProvider({} as never, makeSettings({ effort: "high" }), "key");
		const conv = makeConv({ model: "o4-mini" });

		await provider.streamMessage(conv, "hi", [], () => {}, () => {}, () => {});

		const args = createMock.mock.calls[0][0] as Record<string, unknown>;
		expect(args.reasoning_effort).toBe("high");
	});

	it("omits reasoning_effort for non-reasoning models", async () => {
		createMock.mockImplementation(async () =>
			chunkStream([
				{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] },
				{ choices: [{}], usage: { prompt_tokens: 5, completion_tokens: 2 } },
			])
		);

		const provider = new OpenAIProvider({} as never, makeSettings({ effort: "high" }), "key");
		const conv = makeConv({ model: "gpt-4o" });

		await provider.streamMessage(conv, "hi", [], () => {}, () => {}, () => {});

		const args = createMock.mock.calls[0][0] as Record<string, unknown>;
		expect(args).not.toHaveProperty("reasoning_effort");
	});
});

describe("OpenAIProvider — PDF attachments", () => {
	it("splices a file content part onto the final user message when a PDF is attached", async () => {
		createMock.mockImplementation(async () =>
			chunkStream([
				{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] },
				{ choices: [{}], usage: { prompt_tokens: 5, completion_tokens: 2 } },
			])
		);

		const bytes = new Uint8Array([1, 2, 3, 4]);
		const app = makeAppWithPdf("Papers/paper.pdf", bytes.length, bytes);

		const provider = new OpenAIProvider(app, makeSettings(), "key");
		await provider.streamMessage(
			makeConv(), "Summarize this", ["Papers/paper.pdf"], () => {}, () => {}, () => {}
		);

		const args = createMock.mock.calls[0][0] as { messages: Array<{ role: string; content: unknown }> };
		const last = args.messages[args.messages.length - 1];
		expect(Array.isArray(last.content)).toBe(true);
		const parts = last.content as Array<{ type: string; file?: { filename: string; file_data: string } }>;
		expect(parts[0].type).toBe("file");
		expect(parts[0].file?.filename).toBe("paper.pdf");
		expect(parts[0].file?.file_data.startsWith("data:application/pdf;base64,")).toBe(true);
		expect(parts[parts.length - 1]).toMatchObject({ type: "text", text: "Summarize this" });
	});

	it("skips PDFs over the size limit and does not add a content part for them", async () => {
		createMock.mockImplementation(async () =>
			chunkStream([
				{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] },
				{ choices: [{}], usage: { prompt_tokens: 5, completion_tokens: 2 } },
			])
		);

		const bytes = new Uint8Array([1, 2, 3]);
		const app = makeAppWithPdf("Papers/huge.pdf", 21 * 1024 * 1024, bytes);

		const provider = new OpenAIProvider(app, makeSettings(), "key");
		await provider.streamMessage(
			makeConv(), "Summarize this", ["Papers/huge.pdf"], () => {}, () => {}, () => {}
		);

		const args = createMock.mock.calls[0][0] as { messages: Array<{ role: string; content: unknown }> };
		const last = args.messages[args.messages.length - 1];
		expect(typeof last.content).toBe("string");
	});

	it("keeps message content a plain string when no PDFs are attached", async () => {
		createMock.mockImplementation(async () =>
			chunkStream([
				{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] },
				{ choices: [{}], usage: { prompt_tokens: 5, completion_tokens: 2 } },
			])
		);

		const provider = new OpenAIProvider({} as never, makeSettings(), "key");
		await provider.streamMessage(makeConv(), "hi", [], () => {}, () => {}, () => {});

		const args = createMock.mock.calls[0][0] as { messages: Array<{ role: string; content: unknown }> };
		expect(typeof args.messages[args.messages.length - 1].content).toBe("string");
	});
});

describe("OpenAIProvider — token usage across tool-call rounds (regression for undercounting)", () => {
	it("sums input/output tokens across every round instead of keeping only the last", async () => {
		createMock
			.mockImplementationOnce(async () =>
				chunkStream([
					{
						choices: [
							{
								delta: {
									tool_calls: [
										{ index: 0, id: "call_1", function: { name: "create_note", arguments: "{}" } },
									],
								},
							},
						],
					},
					{ choices: [{ finish_reason: "tool_calls" }] },
					{ choices: [{}], usage: { prompt_tokens: 100, completion_tokens: 20 } },
				])
			)
			.mockImplementationOnce(async () =>
				chunkStream([
					{ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] },
					{ choices: [{}], usage: { prompt_tokens: 50, completion_tokens: 10 } },
				])
			);

		const provider = new OpenAIProvider({} as never, makeSettings(), "key");
		const conv = makeConv();

		let usage: { inputTokens: number; outputTokens: number } | undefined;
		await provider.streamMessage(
			conv,
			"hi",
			[],
			() => {},
			(_text, tokenUsage) => { usage = tokenUsage; },
			() => {},
			async () => "tool result"
		);

		expect(createMock).toHaveBeenCalledTimes(2);
		expect(usage?.inputTokens).toBe(150);
		expect(usage?.outputTokens).toBe(30);
	});

	it("leaves tokenUsage undefined when the API never reports usage", async () => {
		createMock.mockImplementation(async () =>
			chunkStream([{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] }])
		);

		const provider = new OpenAIProvider({} as never, makeSettings(), "key");
		let usage: unknown = "unset";
		await provider.streamMessage(
			makeConv(), "hi", [], () => {}, (_t, u) => { usage = u; }, () => {}
		);

		expect(usage).toBeUndefined();
	});
});

describe("OpenAIProvider — abort during a pending tool confirmation (regression for the null-pointer crash)", () => {
	it("completes cleanly instead of throwing when abort() is called while onToolCall is pending", async () => {
		createMock
			.mockImplementationOnce(async () =>
				chunkStream([
					{
						choices: [
							{
								delta: {
									tool_calls: [
										{ index: 0, id: "call_1", function: { name: "create_note", arguments: "{}" } },
									],
								},
							},
						],
					},
					{ choices: [{ finish_reason: "tool_calls" }] },
				])
			)
			.mockImplementationOnce(async () =>
				chunkStream([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }])
			);

		const provider = new OpenAIProvider({} as never, makeSettings(), "key");

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

describe("OpenAIProvider — bounded tool-call loop", () => {
	it("surfaces a ToolLoopLimitError via onError instead of looping forever", async () => {
		// Every round reports a tool call and never stops — simulates a confused model.
		createMock.mockImplementation(async () =>
			chunkStream([
				{
					choices: [
						{ delta: { tool_calls: [{ index: 0, id: "call_x", function: { name: "create_note", arguments: "{}" } }] } },
					],
				},
				{ choices: [{ finish_reason: "tool_calls" }] },
			])
		);

		const provider = new OpenAIProvider({} as never, makeSettings(), "key");

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
		expect(createMock.mock.calls.length).toBeLessThanOrEqual(26);
	});
});
