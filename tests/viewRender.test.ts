// @vitest-environment happy-dom
//
// View-render smoke tests (engineering-review #125).
//
// These mount the REAL PythiaSidebarView against a mocked `obsidian` module and
// a real (headless) plugin, then assert that the major surfaces of a conversation
// actually appear in the DOM when it is opened. They deliberately test *presence
// of surface*, not pixels or interactions — the cheapest check that would have
// caught the 2.1.2 regression (#124), where `renderMessages` stopped populating
// the summary cards and the context inspector after the ADR-103 controller split
// while every unit test stayed green (the view render path had no coverage).
//
// Add a scenario here whenever a new surface must render on open/switch. The
// mount fixture lives in `tests/helpers/viewHarness.ts`.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { makePlugin, mountView, seedConversation, userMsg, aiMsg, now } from "./helpers/viewHarness";
import PythiaPlugin from "../main";
import { PythiaSidebarView } from "../sidebar";
import type { Conversation } from "../models/types";
import type { ComposerField } from "../ui/ComposerField";

describe("view render — surfaces present on open (#124/#125)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;

	beforeEach(async () => {
		// Fresh plugin per test: a shared store would leave prior conversations
		// around, so onOpen would render once before the test's own render and the
		// second pass would mask a missing-first-render regression (exactly #124).
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	it("renders the summary card when the conversation has a summary (the #124 regression)", async () => {
		await seedConversation(plugin, {
			name: "With summary",
			messages: [userMsg("m1", "what is the answer"), aiMsg("m2", "The answer is 42.")],
			summaryText: "This conversation covered the answer.",
			summaryUpdatedAt: now(),
			favoritesSummary: { text: "Key learning: 42.", updatedAt: now() },
		} as Partial<Conversation>);

		const { pane } = await mountView(plugin);

		expect(pane().querySelector(".p-summary-cards")).not.toBeNull(); // container exists
		expect(pane().querySelector(".p-summary-card")).not.toBeNull();  // and is populated
	});

	it("renders the context-inspector card when the conversation has context notes (the #124 regression)", async () => {
		await seedConversation(plugin, {
			name: "With notes",
			messages: [userMsg("m1", "summarise the note")],
			contextNotes: ["SomeNote.md"],
		} as Partial<Conversation>);

		const { pane } = await mountView(plugin);

		expect(pane().querySelector(".p-inspector-wrap")).not.toBeNull(); // container exists
		expect(pane().querySelector(".p-inspector")).not.toBeNull();      // and is populated
	});

	it("renders the fork banner for a forked conversation", async () => {
		const source = await seedConversation(plugin, {
			name: "Source",
			messages: [userMsg("s1", "q"), aiMsg("s2", "the answer is 42")],
		} as Partial<Conversation>);
		// Seeded last, so onOpen opens the fork.
		await seedConversation(plugin, {
			name: "Fork",
			messages: [userMsg("f1", "follow-up")],
			forkedFromId: source.id,
			forkedFromMessageId: "s2",
			forkedFromSelection: "answer is 42",
			forkedFromOccurrenceIndex: 0,
		} as Partial<Conversation>);

		const { pane } = await mountView(plugin);

		expect(pane().querySelector(".pythia-fork-banner")).not.toBeNull();
	});

	it("renders message bubbles for a conversation with messages", async () => {
		await seedConversation(plugin, {
			name: "With messages",
			messages: [userMsg("m1", "hello"), aiMsg("m2", "hi there")],
		} as Partial<Conversation>);

		const { pane } = await mountView(plugin);

		expect(pane().querySelector(".p-bubble")).not.toBeNull();   // user bubble
		expect(pane().querySelector(".p-ai-body")).not.toBeNull();  // AI message body
	});

	it("renders the welcome state for an empty conversation", async () => {
		await seedConversation(plugin, { name: "Empty", messages: [] } as Partial<Conversation>);

		const { pane } = await mountView(plugin);

		expect(pane().querySelector(".p-welcome")).not.toBeNull();
	});

	it("swaps rendered surfaces when switching conversations (no stale leak)", async () => {
		// A has a summary → its summary card should show. B has none → no card.
		const withSummary = await seedConversation(plugin, {
			name: "Has summary",
			messages: [userMsg("a1", "question A"), aiMsg("a2", "answer A")],
			summaryText: "Summary of A.",
			summaryUpdatedAt: now(),
			favoritesSummary: { text: "Key point of A.", updatedAt: now() },
		} as Partial<Conversation>);
		// Seeded last → onOpen opens the no-summary conversation first.
		const noSummary = await seedConversation(plugin, {
			name: "No summary",
			messages: [userMsg("b1", "question B"), aiMsg("b2", "answer B")],
		} as Partial<Conversation>);

		const { view, pane } = await mountView(plugin);

		// Opened on the no-summary conversation: bubbles present, no summary card.
		expect(pane().querySelector(".p-bubble")).not.toBeNull();
		expect(pane().querySelector(".p-summary-card")).toBeNull();

		// Switch to the summarised conversation → its card must appear (full rebuild).
		await view.setActiveConversation(withSummary);
		expect(pane().querySelector(".p-summary-card")).not.toBeNull();

		// Switch back → the card must NOT leak from the previous render.
		await view.setActiveConversation(noSummary);
		expect(pane().querySelector(".p-summary-card")).toBeNull();
		expect(pane().querySelector(".p-bubble")).not.toBeNull();
	});
});

// ── Send / stream path (Tier 1 — the sendMessage coordinator) ─────────────────
//
// sendMessage() is the sibling coordinator to renderMessages(): it appends the
// user turn, opens a streaming bubble, and routes the provider result to one of
// three outcomes — completed-with-text, completed-empty, or errored. That routing
// is exactly what the 2.1.1 "answer streams then vanishes" bug lived in, and it
// had no view-level coverage. These stub the provider seam
// (`plugin.llmRouter.streamMessage`) and assert each outcome lands correctly.

interface StreamMessageFake {
	(conv: unknown, text: string, notes: string[],
		appendToken: (t: string) => void,
		onComplete: (fullText: string, usage?: { inputTokens: number; outputTokens: number }) => Promise<void> | void,
		onError: (err: Error) => void,
		onToolCall: unknown): Promise<void>;
}

function stubStream(plugin: InstanceType<typeof PythiaPlugin>, fake: StreamMessageFake): void {
	const router = (plugin as unknown as { llmRouter: { streamMessage: StreamMessageFake } }).llmRouter;
	router.streamMessage = fake;
}

function setInput(view: PythiaSidebarView, text: string): void {
	(view as unknown as { composer: ComposerField }).composer.value = text;
}

const isStreaming = (view: PythiaSidebarView): boolean =>
	(view as unknown as { isStreaming: boolean }).isStreaming;

describe("send / stream — sendMessage outcomes (#125 Tier 1)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;

	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	async function openBlank(): Promise<{ view: PythiaSidebarView; pane: () => Element; conv: Conversation }> {
		const conv = await seedConversation(plugin, { name: "Chat", messages: [], contextNotes: [] } as Partial<Conversation>);
		const { view, pane } = await mountView(plugin);
		return { view, pane, conv };
	}

	// ADR-175: Enter is a line break in the composer; Cmd/Ctrl+Enter sends.
	it("does not send on a bare Enter, and leaves the key to the composer", async () => {
		const { view, pane } = await openBlank();
		const send = vi.spyOn(view, "sendMessage").mockResolvedValue(undefined);
		const input = pane().querySelector<HTMLElement>(".p-composer")!;

		const plain = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
		input.dispatchEvent(plain);

		expect(send).not.toHaveBeenCalled();
		// Not prevented, so the browser inserts the newline itself.
		expect(plain.defaultPrevented).toBe(false);
		send.mockRestore();
	});

	it("sends on Cmd+Enter and on Ctrl+Enter", async () => {
		const { view, pane } = await openBlank();
		const send = vi.spyOn(view, "sendMessage").mockResolvedValue(undefined);
		const input = pane().querySelector<HTMLElement>(".p-composer")!;

		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }));
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));

		expect(send).toHaveBeenCalledTimes(2);
		send.mockRestore();
	});

	// Obsidian's keymap sees Cmd+Enter before the composer, and a core hotkey on
	// Mod+Enter can consume it — the view's own scope sends first.
	it("sends Cmd+Enter through the view scope, once, when the composer has focus", async () => {
		const { view, pane } = await openBlank();
		const send = vi.spyOn(view, "sendMessage").mockResolvedValue(undefined);
		const input = pane().querySelector<HTMLElement>(".p-composer")!;
		const scope = view.scope as unknown as { trigger(e: KeyboardEvent): unknown };
		input.focus();

		const e = new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true });
		expect(scope.trigger(e)).toBe(false);        // false = handled, Obsidian stops here
		input.dispatchEvent(e);                      // the same event then reaches the composer
		expect(send).toHaveBeenCalledTimes(1);
		expect(e.defaultPrevented).toBe(true);
		send.mockRestore();
	});

	it("leaves Cmd+Enter to Obsidian when the composer does not have focus", async () => {
		const { view } = await openBlank();
		const send = vi.spyOn(view, "sendMessage").mockResolvedValue(undefined);
		(document.activeElement as HTMLElement | null)?.blur();
		const scope = view.scope as unknown as { trigger(e: KeyboardEvent): unknown };

		expect(scope.trigger(new KeyboardEvent("keydown", { key: "Enter", metaKey: true }))).toBe(true);
		expect(send).not.toHaveBeenCalled();
		send.mockRestore();
	});

	it("completes: renders and persists the assistant reply", async () => {
		const { view, pane, conv } = await openBlank();
		stubStream(plugin, async (_c, _t, _n, appendToken, onComplete) => {
			appendToken("Hello ");
			appendToken("world");
			await onComplete("Hello world", { inputTokens: 3, outputTokens: 2 });
		});

		setInput(view, "hi there");
		await view.sendMessage();

		// Persisted: user turn + assistant turn on the conversation.
		expect(conv.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(conv.messages[1].content).toBe("Hello world");
		// Rendered: a finalized (non-streaming) AI body carrying the text.
		const body = pane().querySelector(".p-ai-body:not(.pythia-streaming)");
		expect(body?.textContent).toContain("Hello world");
		// Streaming state released.
		expect(isStreaming(view)).toBe(false);
	});

	it("completes empty: drops the streaming bubble, keeps only the user turn", async () => {
		const { view, pane, conv } = await openBlank();
		stubStream(plugin, async (_c, _t, _n, _appendToken, onComplete) => {
			await onComplete("", undefined);
		});

		setInput(view, "hi");
		await view.sendMessage();

		expect(conv.messages.map((m) => m.role)).toEqual(["user"]); // no assistant turn
		expect(pane().querySelector(".p-msg-ai")).toBeNull();        // streaming row removed
		expect(pane().querySelector(".p-bubble")).not.toBeNull();    // user bubble stays
		expect(isStreaming(view)).toBe(false);
	});

	it("errors: drops the partial but keeps the user turn persisted (regression: failed send once lost it)", async () => {
		const { view, pane, conv } = await openBlank();
		stubStream(plugin, async (_c, _t, _n, appendToken, _onComplete, onError) => {
			appendToken("partial repl");   // a partial arrived…
			onError(new Error("stream boom")); // …then the stream failed
		});

		setInput(view, "hi");
		await view.sendMessage();

		// The user's own message must survive a failed send (persisted before streaming).
		expect(conv.messages.map((m) => m.role)).toEqual(["user"]);
		expect(pane().querySelector(".p-msg-ai")).toBeNull();     // partial discarded
		expect(pane().querySelector(".p-bubble")).not.toBeNull(); // user bubble stays
		expect(isStreaming(view)).toBe(false);                    // not stuck streaming
	});
});

// ── renderMessages sub-paths (Tier 2) ─────────────────────────────────────────
//
// renderMessages() has three modes; the open/switch tests above cover the full
// rebuild. These cover the other two:
//   • incremental append — a new turn on the SAME conversation appends only the
//     new bubble(s) without tearing down the existing DOM (the hot path during a
//     live conversation);
//   • delete-last-exchange — removes the last turn(s) from model + DOM, and its
//     full-rebuild fallback when the tracked tail message is gone.

const rows = (pane: () => Element, sel: string): HTMLElement[] =>
	Array.from(pane().querySelectorAll<HTMLElement>(sel));

function deleteLastExchange(view: PythiaSidebarView, pane: () => Element): Promise<void> {
	const userRows = rows(pane, ".p-msg-user");
	const aiRows = rows(pane, ".p-msg-ai");
	const lastUser = userRows[userRows.length - 1];
	const lastAi = aiRows[aiRows.length - 1];
	// The gesture and its bar live in ExchangeActionsController since ADR-160.
	return (view as unknown as { exchangeActions: { confirmDelete(u: HTMLElement, a: HTMLElement): Promise<void> } })
		.exchangeActions.confirmDelete(lastUser, lastAi);
}

type ComparisonHandle = { start(u: string, a: string): void; keep(id: string): Promise<void>; discard(): Promise<void> };
const comparisonOf = (view: PythiaSidebarView): ComparisonHandle =>
	(view as unknown as { comparisonController: ComparisonHandle }).comparisonController;

describe("render paths — incremental append & delete (#125 Tier 2)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;

	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	it("incrementally appends a new turn without rebuilding existing bubbles", async () => {
		const conv = await seedConversation(plugin, {
			name: "Live",
			messages: [userMsg("m1", "first"), aiMsg("m2", "reply")],
		} as Partial<Conversation>);

		const { view, pane } = await mountView(plugin);
		const originalUserRow = pane().querySelector<HTMLElement>(".p-msg-user");
		expect(originalUserRow).not.toBeNull();
		expect(rows(pane, ".p-msg-user")).toHaveLength(1);

		// A new turn arrives on the same conversation → append path.
		conv.messages.push(userMsg("m3", "second"));
		await view.setActiveConversation(conv);

		// Incremental, not full rebuild: the original row is the SAME node, still
		// mounted — a full rebuild (messagesEl.empty()) would have detached it.
		expect(originalUserRow!.isConnected).toBe(true);
		expect(pane().contains(originalUserRow)).toBe(true);
		expect(rows(pane, ".p-msg-user")).toHaveLength(2); // new turn appended
	});

	it("delete-last-exchange removes the last turn from model and DOM", async () => {
		const conv = await seedConversation(plugin, {
			name: "Two exchanges",
			messages: [userMsg("u1", "q1"), aiMsg("a1", "r1"), userMsg("u2", "q2"), aiMsg("a2", "r2")],
		} as Partial<Conversation>);

		const { view, pane } = await mountView(plugin);
		expect(rows(pane, ".p-msg-user")).toHaveLength(2);

		await deleteLastExchange(view, pane);

		expect(conv.messages.map((m) => m.id)).toEqual(["u1", "a1"]); // last pair spliced
		expect(rows(pane, ".p-msg-user")).toHaveLength(1);            // DOM rows removed
		expect(rows(pane, ".p-msg-ai")).toHaveLength(1);
	});

	it("delete-last-exchange shows the welcome state when the conversation empties", async () => {
		await seedConversation(plugin, {
			name: "Single exchange",
			messages: [userMsg("u1", "q1"), aiMsg("a1", "r1")],
		} as Partial<Conversation>);

		const { view, pane } = await mountView(plugin);
		await deleteLastExchange(view, pane);

		expect(rows(pane, ".p-msg-user")).toHaveLength(0);
		expect(pane().querySelector(".p-welcome")).not.toBeNull();
	});

	it("falls back to a full rebuild when the tracked tail message is gone (stale anchor)", async () => {
		const conv = await seedConversation(plugin, {
			name: "Stale anchor",
			messages: [userMsg("u1", "q1"), aiMsg("a1", "r1"), userMsg("u2", "q2"), aiMsg("a2", "r2")],
		} as Partial<Conversation>);

		const { view, pane } = await mountView(plugin);
		expect(rows(pane, ".p-msg-user")).toHaveLength(2);

		// Remove the last exchange from the model WITHOUT going through
		// confirmDeleteLastExchange, so lastRenderedMsgId still points at a2 (now
		// absent). The next render can't find the anchor → full-rebuild fallback.
		conv.messages.splice(2, 2);
		await view.setActiveConversation(conv);

		// Clean rebuild reflecting the current model — no stale u2/a2 rows leak.
		expect(rows(pane, ".p-msg-user")).toHaveLength(1);
		expect(rows(pane, ".p-msg-ai")).toHaveLength(1);
		expect(pane().querySelector('[data-msg-id="a2"]')).toBeNull();
	});
});

describe("model comparison on the last exchange (ADR-160)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;

	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	it("starting a comparison removes the answer row and paints a card with one tab", async () => {
		const conv = await seedConversation(plugin, {
			name: "Compare me",
			messages: [userMsg("u1", "q1"), aiMsg("a1", "r1")],
		} as Partial<Conversation>);
		const { view, pane } = await mountView(plugin);

		comparisonOf(view).start("u1", "a1");

		expect(conv.messages.map((m) => m.id)).toEqual(["u1"]);
		expect(conv.comparison?.candidates.map((c) => c.id)).toEqual(["a1"]);
		expect(pane().querySelector('[data-msg-id="a1"]')).toBeNull();
		const card = pane().querySelector(".p-compare");
		expect(card).not.toBeNull();
		expect(card!.querySelectorAll(".p-compare-tab")).toHaveLength(1);
		expect(card!.querySelector(".p-compare-tab.is-active")?.textContent).toBe("Sonnet 4.6");
	});

	it("blocks sending while a comparison is pending", async () => {
		const conv = await seedConversation(plugin, {
			name: "Blocked",
			messages: [userMsg("u1", "q1"), aiMsg("a1", "r1")],
		} as Partial<Conversation>);
		const { view } = await mountView(plugin);
		comparisonOf(view).start("u1", "a1");

		const input = (view as unknown as { composer: ComposerField }).composer;
		input.value = "another question";
		await view.sendMessage();

		expect(conv.messages.map((m) => m.id)).toEqual(["u1"]); // nothing appended
		expect(input.value).toBe("another question");           // draft untouched
	});

	it("keeping a candidate makes it the answer and keeps the others as tabs on it — no fork (ADR-219)", async () => {
		const conv = await seedConversation(plugin, {
			name: "Keep B",
			messages: [userMsg("u1", "q1"), aiMsg("a1", "r1")],
		} as Partial<Conversation>);
		const { view, pane } = await mountView(plugin);
		comparisonOf(view).start("u1", "a1");
		conv.comparison!.candidates.push({ id: "b1", provider: "openai", model: "gpt-4o", content: "r1 by B", timestamp: now() });

		await comparisonOf(view).keep("b1");
		await new Promise((r) => setTimeout(r, 0)); // rerender is fire-and-forget

		expect(conv.comparison).toBeUndefined();
		expect(conv.messages.map((m) => m.id)).toEqual(["u1", "b1"]);
		expect(conv.messages[1].alternatives?.map((c) => c.id)).toEqual(["a1"]);
		expect(plugin.conversations.filter((c) => c.forkedFromId === conv.id)).toHaveLength(0);
		expect(pane().querySelector(".p-compare")).toBeNull();
		const row = pane().querySelector('[data-msg-id="b1"]');
		expect(row).not.toBeNull();
		const tabs = [...row!.querySelectorAll(".p-answer-tab")].map((t) => t.textContent);
		expect(tabs).toEqual(["GPT-4o", "Sonnet 4.6"]);
	});

	it("discarding restores the original answer", async () => {
		const conv = await seedConversation(plugin, {
			name: "Discard",
			messages: [userMsg("u1", "q1"), aiMsg("a1", "r1")],
		} as Partial<Conversation>);
		const { view, pane } = await mountView(plugin);
		comparisonOf(view).start("u1", "a1");
		await comparisonOf(view).discard();
		await new Promise((r) => setTimeout(r, 0));

		expect(conv.comparison).toBeUndefined();
		expect(conv.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
		expect(pane().querySelector('[data-msg-id="a1"]')).not.toBeNull();
		expect(plugin.conversations.filter((c) => c.forkedFromId === conv.id)).toHaveLength(0);
	});
});
