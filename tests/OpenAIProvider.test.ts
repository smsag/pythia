import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	TFile: class {},
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
