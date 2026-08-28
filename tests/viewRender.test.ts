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
// The recipe (mock obsidian, polyfill Obsidian's Element helpers onto happy-dom,
// instantiate the plugin headlessly) is the fixture; add a scenario here whenever
// a new surface must render on open/switch.

import { describe, it, expect, beforeEach } from "vitest";

// ── Obsidian extends Element.prototype with DOM helpers at runtime; happy-dom
//    gives us bare elements, so we install the subset the view actually calls.
//    Must run before any view code — invoked at module top level below. ──────────
function installObsidianDomHelpers(): void {
	const proto = (globalThis as unknown as { Element: { prototype: Record<string, unknown> } }).Element.prototype;
	type Opts = { cls?: string | string[]; text?: string; attr?: Record<string, string>; type?: string; value?: string; href?: string; placeholder?: string };
	function applyOpts(el: Element, o?: Opts): void {
		if (!o) return;
		if (o.cls) (el as HTMLElement).className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
		if (o.text != null) el.textContent = o.text;
		if (o.attr) for (const k in o.attr) el.setAttribute(k, o.attr[k]);
		for (const k of ["type", "value", "href", "placeholder"] as const) {
			if (o[k] != null) el.setAttribute(k, o[k] as string);
		}
	}
	const p = proto as Record<string, unknown>;
	p.createEl = function (this: Element, tag: string, o?: Opts): Element {
		const e = document.createElement(tag);
		applyOpts(e, o);
		this.appendChild(e);
		return e;
	};
	p.createDiv = function (this: Element, o?: Opts): Element { return (this as unknown as { createEl: (t: string, o?: Opts) => Element }).createEl("div", o); };
	p.createSpan = function (this: Element, o?: Opts): Element { return (this as unknown as { createEl: (t: string, o?: Opts) => Element }).createEl("span", o); };
	p.createSvg = function (this: Element, tag?: string, o?: Opts): Element {
		const e = document.createElementNS("http://www.w3.org/2000/svg", tag || "svg");
		applyOpts(e, o);
		this.appendChild(e);
		return e;
	};
	p.empty = function (this: Element): void { while (this.firstChild) this.removeChild(this.firstChild); };
	p.setText = function (this: Element, t: string): void { this.textContent = t; };
	p.appendText = function (this: Element, t: string): void { this.appendChild(document.createTextNode(t)); };
	p.addClass = function (this: Element, ...c: string[]): void { this.classList.add(...c); };
	p.removeClass = function (this: Element, ...c: string[]): void { this.classList.remove(...c); };
	p.toggleClass = function (this: Element, c: string, b?: boolean): void { this.classList.toggle(c, b); };
	p.hasClass = function (this: Element, c: string): boolean { return this.classList.contains(c); };
	p.setAttr = function (this: Element, k: string, v: string): void { this.setAttribute(k, v); };
	p.setCssStyles = function (this: Element, s: Record<string, string>): void { Object.assign((this as HTMLElement).style, s || {}); };

	// Obsidian also exposes createDiv/createEl/createSpan as GLOBALS that return a
	// detached element (used e.g. by HistoryController.rowSub). happy-dom has none.
	const G = globalThis as unknown as Record<string, unknown>;
	G.createEl = (tag: string, o?: Opts): Element => { const e = document.createElement(tag); applyOpts(e, o); return e; };
	G.createDiv = (o?: Opts): Element => (G.createEl as (t: string, o?: Opts) => Element)("div", o);
	G.createSpan = (o?: Opts): Element => (G.createEl as (t: string, o?: Opts) => Element)("span", o);

	// Globals the render path may touch under happy-dom.
	(globalThis as unknown as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame = (f: () => void) => { f(); return 0; };
	if (typeof (globalThis as unknown as { matchMedia?: unknown }).matchMedia !== "function") {
		(globalThis as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
	}
	// sendMessage() mints message ids with crypto.randomUUID().
	const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
	if (!g.crypto) g.crypto = {};
	if (typeof g.crypto.randomUUID !== "function") {
		let n = 0;
		g.crypto.randomUUID = () => `test-uuid-${++n}`;
	}
}
installObsidianDomHelpers();

// `obsidian` resolves to tests/mocks/obsidian.ts via the Vitest `resolve.alias`
// (see vitest.config.ts) — the package is types-only and cannot load at runtime.
import PythiaPlugin from "../main";
import { PythiaSidebarView } from "../sidebar";
import type { Conversation } from "../models/types";

function makeApp(): unknown {
	const noop = (): void => {};
	const anoop = async (): Promise<void> => {};
	return {
		workspace: {
			onLayoutReady: (cb: () => void) => cb(), getLeavesOfType: () => [], on: () => ({}),
			getActiveViewOfType: () => null, getActiveFile: () => null, revealLeaf: noop,
			getRightLeaf: () => ({ setViewState: anoop }), getLeaf: () => ({ setViewState: anoop }),
			iterateAllLeaves: noop, trigger: noop,
		},
		vault: { adapter: { stat: async () => null }, getName: () => "vault", getAbstractFileByPath: () => null, on: () => ({}), getMarkdownFiles: () => [] },
		metadataCache: { getFileCache: () => null, on: () => ({}) },
		secretStorage: { getSecret: async () => "", setSecret: async () => {} },
		fileManager: { renameFile: anoop, generateMarkdownLink: () => "" },
	};
}

async function makePlugin(): Promise<InstanceType<typeof PythiaPlugin>> {
	const app = makeApp();
	const PluginCtor = PythiaPlugin as unknown as new (app: unknown, manifest: unknown) => InstanceType<typeof PythiaPlugin>;
	const plugin = new PluginCtor(app, { id: "pythia", name: "Pythia", version: "2.1.2", minAppVersion: "1.0.0" });
	await plugin.onload();
	return plugin;
}

/** Mount the view and open it. `onOpen` auto-selects the most recent conversation
 *  (sidebar.ts) — the real "open the sidebar on an existing conversation" flow, a
 *  single full-rebuild render. Seed exactly one conversation before calling this so
 *  that conversation is the one opened. This single-render path is what the #124
 *  regression broke; a second render would mask it via the reference-pills refresh. */
async function mountView(plugin: InstanceType<typeof PythiaPlugin>): Promise<{ view: PythiaSidebarView; pane: () => Element }> {
	const app = (plugin as unknown as { app: unknown }).app;
	const leaf = { app, view: null, getViewState: () => ({ type: "pythia" }) } as unknown;
	const view = new PythiaSidebarView(leaf as never, plugin);
	await view.onOpen();
	const pane = () => (view as unknown as { containerEl: { children: Element[] } }).containerEl.children[1];
	return { view, pane };
}

/** Create a conversation through the real service, then apply overrides so the
 *  seeded state (summary, notes, fork) drives the render path exactly as production would. */
async function seedConversation(
	plugin: InstanceType<typeof PythiaPlugin>,
	over: Partial<Conversation> = {}
): Promise<Conversation> {
	const svc = (plugin as unknown as { conversationService: { createConversation(o: { name: string }): Promise<Conversation> } }).conversationService;
	const conv = await svc.createConversation({ name: over.name ?? "Test" });
	Object.assign(conv, over);
	return conv;
}

const now = () => new Date().toISOString();
const userMsg = (id: string, content: string) => ({ id, role: "user" as const, content, timestamp: now() });
const aiMsg = (id: string, content: string) => ({ id, role: "assistant" as const, content, timestamp: now(), model: "claude-sonnet-4-6", tokenUsage: { inputTokens: 5, outputTokens: 9 } });

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
	(view as unknown as { inputEl: HTMLTextAreaElement }).inputEl.value = text;
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
	return (view as unknown as { confirmDeleteLastExchange(u: HTMLElement, a: HTMLElement): Promise<void> })
		.confirmDeleteLastExchange(lastUser, lastAi);
}

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

// ── Conversation search / history panel (ADR-107) ─────────────────────────────
//
// The panel folded in the former quick switcher: the header loupe opens it with
// the search input focused; ↑/↓ move the selection and Enter opens it; an empty
// box browses (date groups) while a query searches (flat TF-IDF list + snippets).
// This is the DOM path ADR-107 introduced, which otherwise has no coverage.

/** Far-left header button — created first, so it's the search loupe (HeaderController). */
const loupeBtn = (pane: () => Element): HTMLElement =>
	pane().querySelector<HTMLElement>(".p-header .p-hdr-btn")!;
const panelEl = (pane: () => Element): HTMLElement | null =>
	pane().querySelector<HTMLElement>(".p-history");
const panelInput = (pane: () => Element): HTMLInputElement =>
	pane().querySelector<HTMLInputElement>(".p-history .p-switcher-input")!;
const historyRows = (pane: () => Element): HTMLElement[] =>
	Array.from(pane().querySelectorAll<HTMLElement>(".p-history-row"));
/** openHistoryView() focuses the input inside a 0 ms timeout — let it run. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("conversation search panel (ADR-107)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;

	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	// Three independent conversations; the last seeded ("Quartz watches") is the one
	// mountView auto-opens. "seiko" appears only in its message body, not any title.
	async function seedThree(): Promise<void> {
		await seedConversation(plugin, { name: "Kayak trip planning", messages: [userMsg("k1", "we rented a kayak on the lake")] } as Partial<Conversation>);
		await seedConversation(plugin, { name: "Tax filing", messages: [userMsg("t1", "quarterly filing deadlines")] } as Partial<Conversation>);
		await seedConversation(plugin, { name: "Quartz watches", messages: [userMsg("q1", "the seiko astron was the first quartz wristwatch")] } as Partial<Conversation>);
	}

	it("header shows the search loupe and an inert, chevron-free title", async () => {
		await seedConversation(plugin, { name: "Solo", messages: [userMsg("m1", "hi")] } as Partial<Conversation>);
		const { pane } = await mountView(plugin);

		expect(loupeBtn(pane)).not.toBeNull();             // far-left search button present
		const title = pane().querySelector<HTMLElement>(".p-title")!;
		expect(title.tagName).toBe("DIV");                 // no longer a <button>
		expect(title.textContent ?? "").not.toContain("▾"); // dropdown chevron removed
	});

	it("the loupe opens the panel with the search input focused", async () => {
		await seedThree();
		const { pane } = await mountView(plugin);

		expect(panelEl(pane)).toBeNull();                  // closed initially
		loupeBtn(pane).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(panelEl(pane)).not.toBeNull();              // opened by the click wiring
		await tick();
		expect(document.activeElement).toBe(panelInput(pane)); // search input focused
	});

	it("empty box browses (date groups); a query switches to a flat ranked list with a snippet", async () => {
		await seedThree();
		const { view, pane } = await mountView(plugin);
		(view as unknown as { historyController: { openHistoryView(): void } }).historyController.openHistoryView();

		// Empty query → the date-grouped browse listing, all conversations, no snippets.
		expect(pane().querySelector(".p-history-group")).not.toBeNull();
		expect(historyRows(pane)).toHaveLength(3);
		expect(pane().querySelector(".p-history-snippet")).toBeNull();

		// Query a word that lives only in one conversation's message body → flat list,
		// that one result, with a snippet of the matching line (content search, not title).
		const input = panelInput(pane);
		input.value = "seiko";
		input.dispatchEvent(new Event("input"));

		expect(pane().querySelector(".p-history-group")).toBeNull(); // flat — no date buckets
		expect(historyRows(pane)).toHaveLength(1);
		expect(pane().querySelector(".p-history-snippet")?.textContent).toContain("seiko");
	});

	it("↑/↓ move the selection and Enter opens the selected conversation", async () => {
		await seedThree();
		const { view, pane } = await mountView(plugin);
		(view as unknown as { historyController: { openHistoryView(): void } }).historyController.openHistoryView();
		const input = panelInput(pane);

		// First row selected by default.
		expect(historyRows(pane)[0].classList.contains("selected")).toBe(true);

		// ArrowDown → second row selected, first deselected.
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
		expect(historyRows(pane)[0].classList.contains("selected")).toBe(false);
		expect(historyRows(pane)[1].classList.contains("selected")).toBe(true);

		// ArrowUp → back to the first.
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
		expect(historyRows(pane)[0].classList.contains("selected")).toBe(true);

		// Enter opens the selected conversation → the panel closes.
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		expect(panelEl(pane)).toBeNull();
	});
});

// ── Related conversations (ADR-109 M3) ────────────────────────────────────────
//
// The relate icon (hover/long-press) switches the panel into "related mode": a
// "Related to X" chip and only the conversations getRelated() returned. The
// embedding runtime is stubbed via plugin.getRelatedConversations so these tests
// never touch the real model/iframe.

const openPanel = (view: PythiaSidebarView): void =>
	(view as unknown as { historyController: { openHistoryView(): void } }).historyController.openHistoryView();
const stubRelated = (plugin: InstanceType<typeof PythiaPlugin>, fn: (id: string) => Promise<{ id: string; score: number }[]>): void => {
	(plugin as unknown as { getRelatedConversations: typeof fn }).getRelatedConversations = fn;
};
const rowTitles = (pane: () => Element): string[] =>
	Array.from(pane().querySelectorAll<HTMLElement>(".p-history-row-title")).map((e) => e.textContent ?? "");

describe("related conversations (ADR-109 M3)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;

	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	async function seedPair(): Promise<void> {
		await seedConversation(plugin, { id: "src", name: "Source topic", messages: [userMsg("m1", "hello")] } as Partial<Conversation>);
		await seedConversation(plugin, { id: "rel", name: "Related topic", messages: [userMsg("m2", "world")] } as Partial<Conversation>);
	}

	it("shows a relate icon on rows", async () => {
		await seedPair();
		const { view, pane } = await mountView(plugin);
		openPanel(view);
		expect(pane().querySelector(".p-history-relate")).not.toBeNull();
	});

	it("clicking relate opens related mode: a chip plus only the returned conversations", async () => {
		await seedPair();
		stubRelated(plugin, async () => [{ id: "rel", score: 0.9 }]);
		const { view, pane } = await mountView(plugin);
		openPanel(view);

		pane().querySelector<HTMLElement>(".p-history-relate")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await tick(); await tick();

		expect(pane().querySelector(".p-history-chip")).not.toBeNull(); // "Related to …" chip
		expect(pane().querySelector(".p-history-group")).toBeNull();      // flat, no date buckets
		expect(rowTitles(pane)).toEqual(["Related topic"]);              // only the related result
	});

	it("clearing the chip returns to the normal browse list", async () => {
		await seedPair();
		stubRelated(plugin, async () => [{ id: "rel", score: 0.9 }]);
		const { view, pane } = await mountView(plugin);
		openPanel(view);
		pane().querySelector<HTMLElement>(".p-history-relate")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await tick(); await tick();

		pane().querySelector<HTMLElement>(".p-history-chip-clear")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(pane().querySelector(".p-history-chip")).toBeNull();  // chip gone
		expect(pane().querySelector(".p-history-group")).not.toBeNull(); // browse view restored
		expect(rowTitles(pane).length).toBeGreaterThanOrEqual(2);
	});

	it("typing exits related mode", async () => {
		await seedPair();
		stubRelated(plugin, async () => [{ id: "rel", score: 0.9 }]);
		const { view, pane } = await mountView(plugin);
		openPanel(view);
		pane().querySelector<HTMLElement>(".p-history-relate")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await tick(); await tick();
		expect(pane().querySelector(".p-history-chip")).not.toBeNull();

		const input = panelInput(pane);
		input.value = "source";
		input.dispatchEvent(new Event("input"));
		expect(pane().querySelector(".p-history-chip")).toBeNull(); // typing cleared related mode
	});

	it("long-press offers both show-similar and delete on a non-active conversation", async () => {
		await seedPair();
		stubRelated(plugin, async () => []);
		const { view, pane } = await mountView(plugin);
		openPanel(view);
		(globalThis as unknown as { __lastMenu?: unknown }).__lastMenu = undefined;

		// A non-active row (delete is offered only for non-active conversations).
		const nonActive = pane().querySelector<HTMLElement>(".p-history-row:not(.active)")!;
		const ev = new Event("touchstart");
		(ev as unknown as { touches: { clientX: number; clientY: number }[] }).touches = [{ clientX: 5, clientY: 5 }];
		nonActive.dispatchEvent(ev);
		await new Promise((r) => setTimeout(r, 560)); // past the 500 ms long-press threshold

		const menu = (globalThis as unknown as { __lastMenu?: { items: { icon?: string }[] } }).__lastMenu;
		expect(menu).toBeDefined();
		expect(menu!.items.map((i) => i.icon)).toEqual(["git-compare", "trash"]); // show similar + delete
	});
});
