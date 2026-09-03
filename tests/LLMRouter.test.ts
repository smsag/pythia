import { describe, it, expect, vi } from "vitest";
import { LLMRouter } from "../services/LLMRouter";
import type { AnthropicService } from "../services/AnthropicService";
import type { OpenAIProvider } from "../services/OpenAIProvider";
import type { MistralService } from "../services/MistralService";
import type { Conversation } from "../models/types";

/** Minimal fake provider that records the attachedNotes it was called with. */
function makeProvider() {
	const calls: string[][] = [];
	const provider = {
		streamMessage: vi.fn(async (_c, _m, attachedNotes: string[]) => {
			calls.push(attachedNotes);
		}),
		updateSettings() {},
		updateApiKey() {},
		abort() {},
	};
	return { provider, calls };
}

function makeRouter() {
	const a = makeProvider();
	const o = makeProvider();
	const m = makeProvider();
	const router = new LLMRouter(
		a.provider as unknown as AnthropicService,
		o.provider as unknown as OpenAIProvider,
		m.provider as unknown as MistralService,
	);
	return { router, a, o, m };
}

const conv = { id: "c1", provider: "anthropic" } as unknown as Conversation;
const noop = () => {};
const stream = (router: LLMRouter, attached: string[]) =>
	router.streamMessage(conv, "the question", attached, noop, noop, noop);

describe("LLMRouter — vault-retriever hook", () => {
	it("passes attached notes unchanged when no retriever is installed", async () => {
		const { router, a } = makeRouter();
		await stream(router, ["Manual.md"]);
		expect(a.calls[0]).toEqual(["Manual.md"]);
	});

	it("merges retrieved notes after the manually-attached ones", async () => {
		const { router, a } = makeRouter();
		router.setVaultRetriever(async () => ["Auto1.md", "Auto2.md"]);
		await stream(router, ["Manual.md"]);
		expect(a.calls[0]).toEqual(["Manual.md", "Auto1.md", "Auto2.md"]);
	});

	it("dedups a retrieved note that is already attached", async () => {
		const { router, a } = makeRouter();
		router.setVaultRetriever(async () => ["Manual.md", "Auto.md"]);
		await stream(router, ["Manual.md"]);
		expect(a.calls[0]).toEqual(["Manual.md", "Auto.md"]);
	});

	it("passes the query and exclude list to the retriever", async () => {
		const { router } = makeRouter();
		const retriever = vi.fn(async () => [] as string[]);
		router.setVaultRetriever(retriever);
		await stream(router, ["Manual.md"]);
		expect(retriever).toHaveBeenCalledWith(conv, "the question", ["Manual.md"]);
	});

	it("fails open: a retriever error leaves the turn with just the manual notes", async () => {
		const { router, a } = makeRouter();
		router.setVaultRetriever(async () => { throw new Error("index unavailable"); });
		await stream(router, ["Manual.md"]);
		expect(a.calls[0]).toEqual(["Manual.md"]);
	});

	it("can be cleared with setVaultRetriever()", async () => {
		const { router, a } = makeRouter();
		router.setVaultRetriever(async () => ["Auto.md"]);
		router.setVaultRetriever(undefined);
		await stream(router, ["Manual.md"]);
		expect(a.calls[0]).toEqual(["Manual.md"]);
	});
});
