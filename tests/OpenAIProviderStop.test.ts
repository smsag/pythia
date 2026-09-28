// Split from OpenAIProvider.test.ts (file-size ratchet): utility calls on a
// reasoning model, a missing key, and Stop during a tool call.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	TFile: class {},
	Notice: class { constructor(public message?: string) {} },
}));

vi.mock("../i18n", () => ({
	t: (key: string) => key,
	getObsidianLocale: () => "en",
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

describe("OpenAIProvider — utility calls on a reasoning model", () => {
	it("asks a reasoning model for low effort, and a chat model for none", async () => {
		createMock.mockResolvedValue({ choices: [{ message: { content: "Title" }, finish_reason: "stop" }] });
		const provider = new OpenAIProvider({} as never, makeSettings(), "key");
		await provider.optimizePrompt("", "x", "o3");
		await provider.optimizePrompt("", "x", "gpt-4o");
		const [reasoning, chat] = createMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
		expect(reasoning.reasoning_effort).toBe("low");
		expect(reasoning.max_completion_tokens).toBeDefined();
		expect(chat).not.toHaveProperty("reasoning_effort");
	});

	it("logs when the budget ran out before any text, instead of returning \"\" silently", async () => {
		createMock.mockResolvedValue({ choices: [{ message: { content: "" }, finish_reason: "length" }], usage: { completion_tokens_details: { reasoning_tokens: 20 } } });
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const provider = new OpenAIProvider({} as never, makeSettings(), "key");
		expect(await provider.optimizePrompt("", "x", "o3")).toBe("");
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("token limit"), expect.objectContaining({ model: "o3" }));
		warn.mockRestore();
	});
});

describe("OpenAIProvider — a missing key is not a network error", () => {
	it("fails once with the key message, without a retry", async () => {
		const provider = new OpenAIProvider({} as never, makeSettings(), "");
		let errored: Error | undefined;
		const started = Date.now();
		await provider.streamMessage(makeConv(), "hi", [], () => {}, () => {}, (e) => { errored = e; });
		expect(errored?.message).toBe("openaiKeyNotConfigured");
		expect(Date.now() - started).toBeLessThan(400); // a retry sleeps 500 ms first
		expect(createMock).not.toHaveBeenCalled();
	});
});

describe("OpenAIProvider — Stop during a pending tool call", () => {
	it("runs no second tool call and passes the send's signal to the handler", async () => {
		createMock.mockImplementationOnce(async () =>
			chunkStream([
				{ choices: [{ delta: { tool_calls: [
					{ index: 0, id: "call_1", function: { name: "create_note", arguments: "{}" } },
					{ index: 1, id: "call_2", function: { name: "create_note", arguments: "{}" } },
				] } }] },
				{ choices: [{ finish_reason: "tool_calls" }] },
			])
		);
		const provider = new OpenAIProvider({} as never, makeSettings(), "key");
		const seen: string[] = [];
		let errored: Error | undefined;
		await provider.streamMessage(makeConv(), "hi", [], () => {}, () => {}, (e) => { errored = e; }, async (call, signal) => {
			seen.push(call.id);
			expect(signal?.aborted).toBe(false);
			provider.abort();
			return "User declined.";
		});
		expect(seen).toEqual(["call_1"]);
		expect(createMock).toHaveBeenCalledTimes(1);
		expect(errored).toBeUndefined();
	});
});
