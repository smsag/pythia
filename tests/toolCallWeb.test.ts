// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import "./helpers/viewHarness"; // Obsidian's DOM helpers (createDiv, empty, …)
import { Notice } from "obsidian";
import { ToolCallController, type ToolCallDeps } from "../ui/ToolCallController";
import type { WebToolResult } from "../services/WebSearchService";
import type { Conversation, ToolCall } from "../models/types";
import en from "../locales/en";

const shown = (): string[] => (Notice as unknown as { shown: string[] }).shown;

/** A controller whose tool handler answers each web call with the next reply. */
function controller(replies: ((firstN: number) => WebToolResult)[]) {
	const messages = document.createElement("div");
	const firstNs: number[] = [];
	const calls = new ToolCallController({
		app: {} as ToolCallDeps["app"],
		plugin: {
			settings: { debugMode: false },
			toolHandler: {
				executeWeb: async (_c: ToolCall, _a: unknown, _s: unknown, firstN: number) => {
					firstNs.push(firstN);
					const reply = replies.shift();
					if (!reply) throw new Error("no reply");
					return reply(firstN);
				},
			},
		} as unknown as ToolCallDeps["plugin"],
		messagesEl: () => messages,
		registerDomEvent: (el, type, cb) => el.addEventListener(type, cb),
		reveal: () => {},
	});
	calls.begin(() => {});
	const run = calls.handler({ contextNotes: [], messages: [] } as unknown as Conversation, true);
	const search = (q: string) => run({ id: q, name: "web_search", input: { query: q } } as ToolCall);
	return { calls, messages, firstNs, search };
}

const results = (...urls: string[]) => (firstN: number): WebToolResult => ({
	text: "ok",
	sources: urls.map((url, i) => ({ n: firstN + i, title: url, url })),
});

beforeEach(() => { shown().length = 0; });

describe("ToolCallController — web results across one answer (ADR-226)", () => {
	it("numbers every call on from the results before it, and cites resolve to those pages", async () => {
		const { calls, firstNs, search } = controller([results("https://a.com/1", "https://a.com/2"), results("https://b.com/1")]);
		await search("one");
		await search("two");
		expect(firstNs).toEqual([1, 3]);
		const sources = calls.resolveSources("X⟦cite:web:3⟧ Y⟦cite:web:2⟧");
		expect(sources.map((s) => s.ref)).toEqual(["https://b.com/1", "https://a.com/2", "https://a.com/1"]);
	});

	it("tells the user once per send when the key is rejected or the credits are gone", async () => {
		const auth = (): WebToolResult => ({ text: "Error: key", sources: [], error: "auth" });
		const quota = (): WebToolResult => ({ text: "Error: quota", sources: [], error: "quota" });
		const rate = (): WebToolResult => ({ text: "Error: rate", sources: [], error: "rate" });
		const { search } = controller([auth, auth, quota, rate]);
		for (const q of ["1", "2", "3", "4"]) await search(q);
		expect(shown()).toEqual([en.webSearchKeyRejected, en.webSearchQuotaReached]);
	});

	it("settles the chip as failed when the call throws, instead of leaving it on 'Searching…'", async () => {
		const { messages, search } = controller([]);
		await expect(search("q")).rejects.toThrow("no reply");
		const chip = messages.querySelector(".pythia-tool-call")!;
		expect(chip.classList.contains("pythia-tool-call--error")).toBe(true);
	});
});
