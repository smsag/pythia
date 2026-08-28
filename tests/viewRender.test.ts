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

	// Globals the render path may touch under happy-dom.
	(globalThis as unknown as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame = (f: () => void) => { f(); return 0; };
	if (typeof (globalThis as unknown as { matchMedia?: unknown }).matchMedia !== "function") {
		(globalThis as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
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
});
