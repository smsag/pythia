// Shared harness for the view-render tests (ADR-097 split).
//
// Mounting the REAL PythiaSidebarView needs three things that are pure setup and
// have nothing to do with any one feature: Obsidian's Element.prototype helpers
// polyfilled onto happy-dom, a headless plugin, and a mounted view. They lived
// at the top of `tests/viewRender.test.ts` until a second file needed them; a
// fixture copied into a second test file is a fixture that drifts.
//
// `obsidian` resolves to tests/mocks/obsidian.ts through the Vitest resolve
// alias, so no per-file vi.mock hoisting is involved here.

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
import PythiaPlugin from "../../main";
import { PythiaSidebarView } from "../../sidebar";
import type { Conversation } from "../../models/types";

export function makeApp(): unknown {
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

export async function makePlugin(): Promise<InstanceType<typeof PythiaPlugin>> {
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
export async function mountView(plugin: InstanceType<typeof PythiaPlugin>): Promise<{ view: PythiaSidebarView; pane: () => Element }> {
	const app = (plugin as unknown as { app: unknown }).app;
	const leaf = { app, view: null, getViewState: () => ({ type: "pythia" }) } as unknown;
	const view = new PythiaSidebarView(leaf as never, plugin);
	await view.onOpen();
	const pane = () => (view as unknown as { containerEl: { children: Element[] } }).containerEl.children[1];
	return { view, pane };
}

/** Create a conversation through the real service, then apply overrides so the
 *  seeded state (summary, notes, fork) drives the render path exactly as production would. */
export async function seedConversation(
	plugin: InstanceType<typeof PythiaPlugin>,
	over: Partial<Conversation> = {}
): Promise<Conversation> {
	const svc = (plugin as unknown as { conversationService: { createConversation(o: { name: string }): Promise<Conversation> } }).conversationService;
	const conv = await svc.createConversation({ name: over.name ?? "Test" });
	Object.assign(conv, over);
	return conv;
}

export const now = () => new Date().toISOString();
export const userMsg = (id: string, content: string) => ({ id, role: "user" as const, content, timestamp: now() });
export const aiMsg = (id: string, content: string) => ({ id, role: "assistant" as const, content, timestamp: now(), model: "claude-sonnet-4-6", tokenUsage: { inputTokens: 5, outputTokens: 9 } });
