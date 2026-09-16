// @vitest-environment happy-dom
//
// ADR-162: a reply that stopped at the token cap gets a recovery card under it,
// and the warning beside Send reads the same rule as the settings modal.
import { describe, it, expect, beforeEach } from "vitest";
import { makePlugin, mountView, seedConversation, userMsg, aiMsg } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { PythiaSidebarView } from "../sidebar";
import type { Conversation, StreamFinish } from "../models/types";
import { DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS_REASONING } from "../services/promptConstants";
import en from "../locales/en";

interface StreamCall { text: string }
interface StreamFake {
	(conv: unknown, text: string, notes: string[],
		appendToken: (t: string) => void,
		onComplete: (fullText: string, usage?: { inputTokens: number; outputTokens: number }, finish?: StreamFinish) => Promise<void> | void,
		onError: (err: Error) => void,
		onToolCall: unknown): Promise<void>;
}

/** Stub the router: every call is recorded and answered with `reply` and `finish`. */
function stubStream(plugin: InstanceType<typeof PythiaPlugin>, reply: string, finish: StreamFinish): StreamCall[] {
	const calls: StreamCall[] = [];
	const fake: StreamFake = async (_c, text, _n, appendToken, onComplete) => {
		calls.push({ text });
		if (reply) appendToken(reply);
		await onComplete(reply, reply ? { inputTokens: 3, outputTokens: 2 } : undefined, finish);
	};
	(plugin as unknown as { llmRouter: { streamMessage: StreamFake } }).llmRouter.streamMessage = fake;
	return calls;
}

const input = (view: PythiaSidebarView): HTMLTextAreaElement => (view as unknown as { inputEl: HTMLTextAreaElement }).inputEl;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("cut-off answer card (ADR-162)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;
	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	it("marks the message and paints the card with its three actions when the stream stopped at max_tokens", async () => {
		const conv = await seedConversation(plugin, { name: "Chat", messages: [], contextNotes: [], model: "claude-sonnet-4-6" } as Partial<Conversation>);
		const { view, pane } = await mountView(plugin);
		stubStream(plugin, "half an ans", { truncated: true });

		input(view).value = "write a chapter";
		await view.sendMessage();

		expect(conv.messages[1].truncated).toBe(true);
		const card = pane().querySelector(".p-msg-ai .p-trunc");
		expect(card).not.toBeNull();
		expect(card?.querySelector(".p-trunc-label")?.textContent).toBe(en.truncLabel);
		expect(card?.querySelector(".p-trunc-meta")?.textContent).toContain(String(DEFAULT_MAX_TOKENS));
		const labels = Array.from(card!.querySelectorAll(".p-trunc-btn")).map((b) => b.textContent);
		expect(labels).toEqual([en.truncContinueBtn, `↑ Retry with ${DEFAULT_MAX_TOKENS * 2}`, en.compareBtn]);
	});

	it("paints nothing under a finished answer", async () => {
		await seedConversation(plugin, { name: "Chat", messages: [], contextNotes: [] } as Partial<Conversation>);
		const { view, pane } = await mountView(plugin);
		stubStream(plugin, "done", { truncated: false });
		input(view).value = "hi";
		await view.sendMessage();
		expect(pane().querySelector(".p-trunc")).toBeNull();
	});

	it("Continue sends the continuation prompt as a new turn and keeps the user's draft", async () => {
		await seedConversation(plugin, { name: "Chat", messages: [], contextNotes: [] } as Partial<Conversation>);
		const { view, pane } = await mountView(plugin);
		const calls = stubStream(plugin, "half", { truncated: true });
		input(view).value = "go";
		await view.sendMessage();

		input(view).value = "my draft";
		(pane().querySelector(".p-trunc-btn") as HTMLElement).click();
		await flush();

		expect(calls.map((c) => c.text)).toEqual(["go", en.truncContinuePrompt]);
		expect(input(view).value).toBe("my draft");
	});

	it("Retry raises the conversation's limit, removes the cut-off exchange and re-sends the prompt", async () => {
		const conv = await seedConversation(plugin, { name: "Chat", messages: [], contextNotes: [] } as Partial<Conversation>);
		const { view, pane } = await mountView(plugin);
		const calls = stubStream(plugin, "half", { truncated: true });
		input(view).value = "the prompt";
		await view.sendMessage();

		const retry = Array.from(pane().querySelectorAll<HTMLElement>(".p-trunc-btn")).find((b) => b.textContent?.startsWith("↑"));
		retry!.click();
		await flush();

		expect(conv.maxTokens).toBe(DEFAULT_MAX_TOKENS * 2);
		expect(calls.map((c) => c.text)).toEqual(["the prompt", "the prompt"]);
		// One user turn and one (new) answer — the cut-off exchange is gone.
		expect(conv.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
	});

	it("withholds Retry when a star sits on the cut-off answer (it would go with it)", async () => {
		const conv = await seedConversation(plugin, {
			name: "Chat", contextNotes: [],
			messages: [userMsg("u1", "q"), { ...aiMsg("a1", "half"), truncated: true as const }],
			favorites: [{ id: "f1", messageId: "a1", name: "keep" }],
		} as Partial<Conversation>);
		const { pane } = await mountView(plugin);
		expect(conv.messages[1].truncated).toBe(true);
		const labels = Array.from(pane().querySelectorAll(".p-trunc-btn")).map((b) => b.textContent);
		expect(labels).toEqual([en.truncContinueBtn, en.compareBtn]);
	});

	it("an earlier cut-off answer keeps the note but not the actions", async () => {
		await seedConversation(plugin, {
			name: "Chat", contextNotes: [],
			messages: [userMsg("u1", "q"), { ...aiMsg("a1", "half"), truncated: true as const }, userMsg("u2", "continue"), aiMsg("a2", "rest")],
		} as Partial<Conversation>);
		const { pane } = await mountView(plugin);
		const cards = pane().querySelectorAll(".p-trunc");
		expect(cards).toHaveLength(1);
		expect(cards[0].querySelector(".p-trunc-actions")).toBeNull();
	});

	it("an empty truncated reply leaves only the user turn and does not throw", async () => {
		const conv = await seedConversation(plugin, { name: "Chat", messages: [], contextNotes: [], model: "o3" } as Partial<Conversation>);
		const { view, pane } = await mountView(plugin);
		stubStream(plugin, "", { truncated: true });
		input(view).value = "think hard";
		await view.sendMessage();
		expect(conv.messages.map((m) => m.role)).toEqual(["user"]);
		expect(pane().querySelector(".p-msg-ai")).toBeNull();
	});
});

describe("warning beside Send (ADR-162: same rule as the modal)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;
	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	const hint = (pane: () => Element): HTMLElement => pane().querySelector(".p-send-hint") as HTMLElement;

	it("shows for a reasoning model pinned below the recommended budget", async () => {
		await seedConversation(plugin, { name: "R", messages: [], contextNotes: [], provider: "openai", model: "o3", maxTokens: 2000 } as Partial<Conversation>);
		const { pane } = await mountView(plugin);
		expect(hint(pane).style.display).toBe("");
		expect(hint(pane).getAttribute("title")).toContain(String(DEFAULT_MAX_TOKENS_REASONING));
	});

	it("stays hidden for a plain model with the same pin, and for a reasoning model at its default", async () => {
		await seedConversation(plugin, { name: "P", messages: [], contextNotes: [], model: "claude-sonnet-4-6", maxTokens: 2000 } as Partial<Conversation>);
		const { pane } = await mountView(plugin);
		expect(hint(pane).style.display).toBe("none");
	});
});
