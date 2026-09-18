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

describe("LLMRouter — provider resolution", () => {
	it("falls back to anthropic for an unknown provider string instead of throwing", async () => {
		const { router, a } = makeRouter();
		const odd = { id: "c2", provider: "gemini" } as unknown as Conversation;
		await router.streamMessage(odd, "q", [], noop, noop, noop);
		expect(a.provider.streamMessage).toHaveBeenCalledTimes(1);
	});
});

// ── ADR-180: the provider must be told which notes RAG added ─────────────────
describe("LLMRouter — marking auto-retrieved notes", () => {
	const conv = { id: "c", provider: "anthropic", messages: [] } as unknown as Conversation;
	const noop = () => {};

	/** Records the 8th argument (autoNotes) alongside the notes list. */
	function trackingRouter() {
		const seen: { notes: string[]; auto: string[] }[] = [];
		const provider = {
			streamMessage: vi.fn(async (
				_c: unknown, _m: unknown, notes: string[],
				_t: unknown, _co: unknown, _e: unknown, _tc: unknown,
				auto?: ReadonlySet<string>,
			) => { seen.push({ notes, auto: [...(auto ?? [])] }); }),
			updateSettings() {}, updateApiKey() {}, abort() {},
		};
		const router = new LLMRouter(
			provider as unknown as AnthropicService,
			provider as unknown as OpenAIProvider,
			provider as unknown as MistralService,
		);
		return { router, seen };
	}

	it("names exactly the paths RAG added, not the ones the user attached", async () => {
		const { router, seen } = trackingRouter();
		router.setVaultRetriever(async () => ["Auto/one.md", "Auto/two.md"]);
		await router.streamMessage(conv, "hi", ["Manual/mine.md"], noop, noop, noop);
		expect(seen[0].notes).toEqual(["Manual/mine.md", "Auto/one.md", "Auto/two.md"]);
		expect(seen[0].auto.sort()).toEqual(["Auto/one.md", "Auto/two.md"]);
	});

	it("does not mark a path the user had already attached", async () => {
		// It is deduped out of the merge, so it stays a manual note and keeps the
		// full excerpt budget and the missing-note warning.
		const { router, seen } = trackingRouter();
		router.setVaultRetriever(async () => ["Manual/mine.md", "Auto/new.md"]);
		await router.streamMessage(conv, "hi", ["Manual/mine.md"], noop, noop, noop);
		expect(seen[0].auto).toEqual(["Auto/new.md"]);
	});

	it("marks nothing when retrieval returns nothing or fails", async () => {
		const { router, seen } = trackingRouter();
		router.setVaultRetriever(async () => []);
		await router.streamMessage(conv, "hi", ["Manual/mine.md"], noop, noop, noop);
		router.setVaultRetriever(async () => { throw new Error("boom"); });
		await router.streamMessage(conv, "hi", ["Manual/mine.md"], noop, noop, noop);
		expect(seen[0].auto).toEqual([]);
		expect(seen[1].auto).toEqual([]);
	});

	it("marks nothing when no retriever is installed at all", async () => {
		const { router, seen } = trackingRouter();
		await router.streamMessage(conv, "hi", ["Manual/mine.md"], noop, noop, noop);
		expect(seen[0].auto).toEqual([]);
	});
});
