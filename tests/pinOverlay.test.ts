// @vitest-environment happy-dom
//
// ADR-216 on the real view: the pinned strip at the top of the chat — what it
// shows, how it cycles and unpins, that it follows the conversation, that the
// selection strip and a code block pin into it, and that ↗ says so when the
// source is gone.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MarkdownRenderer, Notice } from "obsidian";
import { makePlugin, mountView, seedConversation, userMsg, aiMsg } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { PythiaSidebarView } from "../sidebar";
import type { Conversation, Pin } from "../models/types";
import { decorateCodeBlocks } from "../ui/CodeBlockDecorator";
import { codeBlockSource, diagramSource, tableMarkdown } from "../ui/pinSources";
import { chartSourceOf, chartViewOf, forgetChartViews, renderChartCard } from "../ui/chart/card";
import { chartBlockAsTable, CHART_BLOCK_LANG } from "../services/chartSpec";
import type { PinController } from "../ui/PinController";
import { t } from "../i18n";

const pin = (id: string, source: string, over: Partial<Pin> = {}): Pin =>
	({ id, messageId: "a1", kind: "text", source, createdAt: "", ...over });

let plugin: InstanceType<typeof PythiaPlugin>;
let view: PythiaSidebarView;
let pane: () => Element;

const overlay = (): HTMLElement => pane().querySelector<HTMLElement>(".p-pins")!;
const wrapper = (): HTMLElement => pane().querySelector<HTMLElement>(".pythia-messages-wrapper")!;
const title = (): string => overlay().querySelector(".p-acc-title")?.textContent ?? "";
const action = (tip: string): HTMLButtonElement => overlay().querySelector<HTMLButtonElement>(`.p-pin-action[title="${tip}"]`)!;
const shown = (): string[] => (Notice as unknown as { shown: string[] }).shown;
const pins = (v: PythiaSidebarView): PinController => (v as unknown as { pins: PinController }).pins;

async function open(over: Partial<Conversation>): Promise<Conversation> {
	const conv = await seedConversation(plugin, {
		name: "Pinned", messages: [userMsg("u1", "q"), aiMsg("a1", "The first answer. It has a passage worth keeping.")], ...over,
	} as Partial<Conversation>);
	({ view, pane } = await mountView(plugin));
	await view.setActiveConversation(conv);
	return conv;
}

beforeEach(async () => {
	document.body.innerHTML = "";
	(Notice as unknown as { shown: string[] }).shown = [];
	plugin = await makePlugin();
});

describe("the strip", () => {
	it("is absent when nothing is pinned", async () => {
		await open({});
		expect(overlay().hidden).toBe(true);
		expect(wrapper().classList.contains("has-pins")).toBe(false);
	});

	it("shows one pin, collapsed, with its kind and a one-line excerpt", async () => {
		await open({ pins: [pin("p1", "a passage worth keeping\nsecond line")] });
		expect(overlay().hidden).toBe(false);
		expect(wrapper().classList.contains("has-pins")).toBe(true);
		expect(title()).toBe(`${t("pinKindText")} · a passage worth keeping`);
		expect(overlay().querySelector(".p-acc")?.classList.contains("open")).toBe(false);
		// Plain text, not Markdown: a leading "#" stays a "#".
		expect(overlay().querySelector(".p-pin-text")?.textContent).toBe("a passage worth keeping\nsecond line");
	});

	it("cycles through several with ‹ n/m ›", async () => {
		await open({ pins: [pin("p1", "one"), pin("p2", "two"), pin("p3", "three")] });
		expect(overlay().querySelector(".p-pin-count")?.textContent).toBe("1/3");
		action(t("pinNextTooltip")).click();
		expect(title()).toContain("two");
		expect(overlay().querySelector(".p-pin-count")?.textContent).toBe("2/3");
		action(t("pinPrevTooltip")).click();
		action(t("pinPrevTooltip")).click();
		expect(title()).toContain("three");
	});

	it("shows no ‹ › for a single pin", async () => {
		await open({ pins: [pin("p1", "one")] });
		expect(overlay().querySelector(".p-pin-count")).toBeNull();
	});

	it("collapsed, it keeps ‹ › and ↗; copy and ✕ come with the open pin", async () => {
		await open({ pins: [pin("p1", "one"), pin("p2", "two")] });
		expect(action(t("pinCopyTooltip")).classList.contains("p-pin-action--open")).toBe(true);
		expect(action(t("pinRemoveTooltip")).classList.contains("p-pin-action--open")).toBe(true);
		for (const tip of [t("pinPrevTooltip"), t("pinNextTooltip"), t("pinJumpTooltip")]) {
			expect(action(tip).classList.contains("p-pin-action--open")).toBe(false);
		}
	});

	it("✕ unpins and saves; the last one takes the strip with it", async () => {
		const conv = await open({ pins: [pin("p1", "one"), pin("p2", "two")] });
		action(t("pinRemoveTooltip")).click();
		expect(conv.pins?.map((p) => p.id)).toEqual(["p2"]);
		action(t("pinRemoveTooltip")).click();
		expect("pins" in conv).toBe(false);
		expect(overlay().hidden).toBe(true);
		expect(wrapper().classList.contains("has-pins")).toBe(false);
	});

	it("follows the conversation: another one without pins hides it", async () => {
		await open({ pins: [pin("p1", "one")] });
		const other = await seedConversation(plugin, { name: "Plain", messages: [] } as Partial<Conversation>);
		await view.setActiveConversation(other);
		expect(overlay().hidden).toBe(true);
	});

	it("remembers open-or-closed per conversation, not one flag for all", async () => {
		await open({ pins: [pin("p1", "one")] });
		overlay().querySelector<HTMLButtonElement>(".p-acc-toggle")!.click();       // open A's pin
		const b = await seedConversation(plugin, { name: "B", messages: [aiMsg("b1", "x")], pins: [pin("q1", "other", { messageId: "b1" })] } as Partial<Conversation>);
		await view.setActiveConversation(b);
		expect(overlay().querySelector(".p-acc")?.classList.contains("open")).toBe(false); // B starts collapsed
		const a = plugin.conversationStore.getAll().find((c) => c.name === "Pinned")!;
		await view.setActiveConversation(a);
		expect(overlay().querySelector(".p-acc")?.classList.contains("open")).toBe(true);  // A as it was left
	});

	it("pinning something new leaves the strip as it was", async () => {
		const conv = await open({ pins: [pin("p1", "one")] });
		pins(view).pinText("two", "a1", 0);
		expect(conv.pins).toHaveLength(2);
		expect(title()).toContain("two");                                        // the new one is shown…
		expect(overlay().querySelector(".p-acc")?.classList.contains("open")).toBe(false); // …not opened
	});

	it("keeps open-or-closed as view state — nothing about it is written", async () => {
		const conv = await open({ pins: [pin("p1", "one")] });
		overlay().querySelector<HTMLButtonElement>(".p-acc-toggle")!.click();
		expect(overlay().querySelector(".p-acc")?.classList.contains("open")).toBe(true);
		expect(JSON.stringify(conv.pins)).not.toMatch(/open|expanded|shown/);
	});
});

describe("pinning", () => {
	it("from the selection strip: the selected passage, and which occurrence it is", async () => {
		const conv = await open({});
		const body = pane().querySelector<HTMLElement>('[data-msg-id="a1"] .p-ai-body')!;
		const text = body.firstChild as Text;
		const start = text.data.indexOf("a passage");
		const range = document.createRange();
		range.setStart(text, start);
		range.setEnd(text, start + "a passage".length);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);

		const pinBtn = Array.from(pane().querySelectorAll<HTMLButtonElement>(".pythia-sel-btn")).find((b) => b.textContent === t("pinBtn"))!;
		pinBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

		expect(conv.pins).toHaveLength(1);
		expect(conv.pins?.[0]).toMatchObject({ kind: "text", messageId: "a1", source: "a passage", occurrenceIndex: 0 });
		expect(overlay().hidden).toBe(false);
	});

	it("from a code block's own pin button", async () => {
		const conv = await open({});
		const body = pane().querySelector<HTMLElement>('[data-msg-id="a1"] .p-ai-body')!;
		const holder = body.createDiv();
		holder.innerHTML = '<pre><code class="language-js">let x = 1;\n</code></pre>';
		decorateCodeBlocks(holder, new WeakMap(), pins(view).pinBlock);
		holder.querySelector<HTMLButtonElement>(".p-pin-btn")!.click();
		expect(conv.pins?.[0]).toMatchObject({ kind: "code", messageId: "a1", source: "```js\nlet x = 1;\n```" });
		expect(title()).toBe(`${t("pinKindCode")} · let x = 1;`);
	});

	it("says so, and pins nothing, beyond the limit", async () => {
		const conv = await open({ pins: [1, 2, 3, 4, 5].map((i) => pin(`p${i}`, `s${i}`)) });
		pins(view).pinText("one more", "a1", 0);
		expect(conv.pins).toHaveLength(5);
		expect(shown()).toContain(t("pinLimit", { limit: 5 }));
		expect(shown().at(-1)).toMatch(/\b5\b/);   // the number is in the sentence, not a placeholder
		expect(shown().at(-1)).not.toMatch(/[{}]/);
	});

	it("a block in an answer that is still streaming says to wait", async () => {
		await open({});
		const streaming = pane().querySelector(".p-chat")!.createDiv({ cls: "p-msg-ai" });
		const holder = streaming.createDiv({ cls: "p-ai-body" });
		holder.innerHTML = "<pre><code>x\n</code></pre>";
		decorateCodeBlocks(holder, new WeakMap(), pins(view).pinBlock);
		holder.querySelector<HTMLButtonElement>(".p-pin-btn")!.click();
		expect(shown()).toContain(t("pinNotYet"));
	});
});

describe("↗ back to the source", () => {
	it("says so when the message is no longer in the conversation", async () => {
		await open({ pins: [pin("p1", "gone", { messageId: "deleted" })] });
		action(t("pinJumpTooltip")).click();
		await new Promise((r) => setTimeout(r, 0)); // a tab not on screen is looked for first (ADR-225)
		expect(shown()).toContain(t("pinGone"));
	});

	it("collapses the pin before jumping, so what it jumps to is not under it", async () => {
		await open({ pins: [pin("p1", "a passage", { occurrenceIndex: 0 })] });
		overlay().querySelector<HTMLButtonElement>(".p-acc-toggle")!.click();
		action(t("pinJumpTooltip")).click();
		expect(overlay().querySelector(".p-acc")?.classList.contains("open")).toBe(false);
		expect(shown()).not.toContain(t("pinGone"));
		// The passage is flashed in place.
		expect(pane().querySelector('[data-msg-id="a1"] pythia-pin-flash')?.textContent).toBe("a passage");
	});
});

describe("pins belong to their conversation", () => {
	it("a fork does not inherit them", async () => {
		const source = await open({ pins: [pin("p1", "a passage")] });
		const before = new Set(plugin.conversationStore.getAll().map((c) => c.id));
		// The fork is built and stored first; opening it in a panel is what the
		// harness cannot do, and is not what is under test.
		await plugin.cmdForkConversation(source.id, "a passage", "a1", 0).catch(() => undefined);
		const fork = plugin.conversationStore.getAll().find((c) => !before.has(c.id));
		expect(fork).toBeDefined();
		expect(fork?.forkedFromId).toBe(source.id);
		expect(fork?.pins).toBeUndefined();
		expect(source.pins).toHaveLength(1);
	});
});

describe("↗ finds each kind of block again (review of ADR-216)", () => {
	it("code, diagram, chart and table: the block itself is found and flashed", async () => {
		const conv = await open({});
		const body = pane().querySelector<HTMLElement>('[data-msg-id="a1"] .p-ai-body')!;
		const code = body.createDiv();
		code.innerHTML = '<pre><code class="language-py">print(1)\n</code></pre>';
		const diagram = body.createDiv({ cls: "block-language-mermaid" });
		diagram.innerHTML = "<pre><code>graph TD\n  A--&gt;B\n</code></pre><svg></svg>";
		const chartHost = body.createDiv();
		renderChartCard('{"type":"bar","title":"R","categories":["Q1","Q2"],"series":[{"name":"R","values":[1,2]}]}', chartHost);
		const table = body.createDiv();
		table.innerHTML = "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>";

		const pre = code.querySelector("pre")!;
		const card = chartHost.querySelector<HTMLElement>(".p-chart-card")!;
		const tableEl = table.querySelector("table")!;
		const targets: Array<[Pin["kind"], string, HTMLElement]> = [
			["code", codeBlockSource(pre), pre],
			["diagram", diagramSource(diagram), diagram],
			["chart", chartSourceOf(card)!, card],
			["table", tableMarkdown(tableEl), tableEl],
		];
		conv.pins = targets.map(([kind, source], i) => pin(`b${i}`, source, { kind }));
		pins(view).render();

		for (const [kind, , el] of targets) {
			action(t("pinJumpTooltip")).click();
			expect(el.classList.contains("p-pin-flash-block"), kind).toBe(true);
			action(t("pinNextTooltip")).click();
		}
		expect(shown()).not.toContain(t("pinGone"));
	});

	it("a block no longer in the answer: the jump falls back to the message, and nothing is flashed", async () => {
		await open({ pins: [pin("b", "```py\ngone()\n```", { kind: "code" })] });
		action(t("pinJumpTooltip")).click();
		expect(pane().querySelector(".p-pin-flash-block")).toBeNull();
		expect(shown()).not.toContain(t("pinGone")); // the MESSAGE is still there
	});
});

describe("a pin that cannot be rendered still says what it holds (review of ADR-216)", () => {
	it("logs the failure and shows the snapshot as text", async () => {
		await open({ pins: [pin("t", "first"), pin("c", "```js\nlet x = 1;\n```", { kind: "code" })] });
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const render = vi.spyOn(MarkdownRenderer, "render").mockRejectedValueOnce(new Error("renderer broke"));
		action(t("pinNextTooltip")).click();
		await new Promise((r) => setTimeout(r, 0));

		expect(error).toHaveBeenCalledWith("[Pythia] pin render failed:", expect.stringContaining("renderer broke"));
		const body = overlay().querySelector<HTMLElement>(".p-pin-text")!;
		expect(body.textContent).toBe("```js\nlet x = 1;\n```");
		render.mockRestore();
		error.mockRestore();
	});
});

describe("a pin's body is owned by one child component (ADR-216 addendum)", () => {
	it("each render replaces — and unloads — the last body's component, and hiding releases it", async () => {
		await open({ pins: [pin("c1", "```js\na\n```", { kind: "code" }), pin("c2", "```js\nb\n```", { kind: "code" })] });
		const viewComponent = view as unknown as { addChild(c: unknown): unknown; removeChild(c: unknown): unknown };
		const added: unknown[] = [];
		const removed: unknown[] = [];
		const add = vi.spyOn(viewComponent, "addChild").mockImplementation((c) => { added.push(c); return c; });
		const remove = vi.spyOn(viewComponent, "removeChild").mockImplementation((c) => { removed.push(c); return c; });

		for (let i = 0; i < 4; i++) action(t("pinNextTooltip")).click();
		expect(added).toHaveLength(4);
		// Each render released the body before it: the one drawn when the view
		// opened (before this spy), then every one drawn here but the last.
		expect(removed).toHaveLength(4);
		expect(removed.slice(1)).toEqual(added.slice(0, 3));

		action(t("pinRemoveTooltip")).click();           // ✕ c1 or c2 — one body left
		action(t("pinRemoveTooltip")).click();           // the last: the strip hides
		expect(removed).toContain(added[added.length - 1]);
		expect(new Set(removed).size).toBe(removed.length);
		add.mockRestore();
		remove.mockRestore();
	});
});

describe("a pinned chart keeps its own view (ADR-254)", () => {
	const SPEC = '{"type":"bar","title":"R","categories":["Q1","Q2","Q3"],"series":[{"name":"R","values":[1,2,3]}]}';
	const fence = new RegExp("^```" + CHART_BLOCK_LANG + "\\n([\\s\\S]*)\\n```$");
	const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
	const pinCard = (): HTMLElement => overlay().querySelector<HTMLElement>(".p-chart-card")!;
	const toggle = (card: HTMLElement): void => card.querySelector<HTMLButtonElement>(".p-chart-view-btn")!.click();
	let copied: string[];
	/** The view each chart card was in at the moment it was drawn. */
	let drawnAs: string[];

	/** A chart in the answer a1, drawn and decorated as the panel does: the
	 *  processor draws the card, then the decorator hangs this view's pin on it. */
	function chartInAnswer(): HTMLElement {
		const body = pane().querySelector<HTMLElement>('[data-msg-id="a1"] .p-ai-body')!;
		const block = body.createDiv({ cls: "block-language-pythia-chart" });
		renderChartCard(SPEC, block);
		decorateCodeBlocks(body, new WeakMap(), pins(view).pinBlock);
		return block.querySelector<HTMLElement>(".p-chart-card")!;
	}

	beforeEach(() => {
		forgetChartViews();
		copied = [];
		drawnAs = [];
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (s: string) => { copied.push(s); } } });
		// The mock renderer writes text; a pin body here must be drawn as Obsidian
		// draws it — a ```pythia-chart block through the chart processor.
		vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app: unknown, md: string, el: HTMLElement) => {
			const m = fence.exec(md.trim());
			if (!m) { el.appendChild(document.createTextNode(md)); return; }
			const block = el.createDiv({ cls: "block-language-pythia-chart" });
			renderChartCard(m[1], block);
			drawnAs.push(chartViewOf(block.querySelector(".p-chart-card")));
		});
	});
	afterEach(() => vi.restoreAllMocks());

	it("the pin carries the card's switch", async () => {
		await open({});
		chartInAnswer().querySelector<HTMLButtonElement>(".p-pin-btn")!.click();
		await settle();
		expect(pinCard().querySelector(".p-chart-view-btn")).not.toBeNull();
		expect(pinCard().querySelector(".p-pin-btn")).toBeNull(); // no pinning from a pin
	});

	it("pinned from the table view, the pin opens as the table", async () => {
		await open({});
		const card = chartInAnswer();
		toggle(card);
		card.querySelector<HTMLButtonElement>(".p-pin-btn")!.click();
		await settle();
		expect(chartViewOf(pinCard())).toBe("table");
		expect(pinCard().querySelector("table")).not.toBeNull();
	});

	it("a switch in the pin stays in the pin: not the answer, not the session's memory", async () => {
		await open({});
		const card = chartInAnswer();
		card.querySelector<HTMLButtonElement>(".p-pin-btn")!.click();
		await settle();
		toggle(pinCard());
		expect(chartViewOf(pinCard())).toBe("table");
		expect(chartViewOf(card)).toBe("chart");
		// The answer drawn again, where it is: still the answer's own view.
		expect(chartViewOf(chartInAnswer())).toBe("chart");
	});

	// No draw in the answer's view to be corrected after (review of ADR-254): the
	// pin's body says its view before the card is drawn.
	it("the pin's card is drawn in the pin's view from the start, whatever the answer shows", async () => {
		await open({});
		const card = chartInAnswer();
		card.querySelector<HTMLButtonElement>(".p-pin-btn")!.click();   // pinned as a chart
		pins(view).pinText("a passage", "a1", 0);
		await settle();
		toggle(card);                                                 // the answer: table
		drawnAs = [];
		action(t("pinPrevTooltip")).click();                           // the chart pin drawn again
		await settle();
		expect(drawnAs).toEqual(["chart"]);
		expect(pinCard().querySelectorAll("svg")).toHaveLength(1);
	});

	it("a pin pinned as a table is drawn as one at once — never a chart first", async () => {
		await open({});
		const card = chartInAnswer();
		toggle(card);
		card.querySelector<HTMLButtonElement>(".p-pin-btn")!.click();   // pinned as a table
		pins(view).pinText("a passage", "a1", 0);
		await settle();
		drawnAs = [];
		action(t("pinPrevTooltip")).click();
		await settle();
		expect(drawnAs).toEqual(["table"]);
		expect(pinCard().querySelector("svg")).toBeNull();
	});

	it("a switch in the answer does not change the pin, even when the pin is drawn again", async () => {
		await open({});
		const card = chartInAnswer();
		card.querySelector<HTMLButtonElement>(".p-pin-btn")!.click();
		pins(view).pinText("a passage", "a1", 0);
		await settle();
		toggle(card);                               // the session now remembers "table" for this chart
		action(t("pinPrevTooltip")).click();        // the chart pin's body is drawn anew
		await settle();
		expect(chartViewOf(pinCard())).toBe("chart");
	});

	it("keeps each pin's view while ‹ › cycles away and back", async () => {
		await open({});
		chartInAnswer().querySelector<HTMLButtonElement>(".p-pin-btn")!.click();
		pins(view).pinText("a passage", "a1", 0);
		await settle();
		action(t("pinPrevTooltip")).click();       // back to the chart
		await settle();
		toggle(pinCard());
		action(t("pinNextTooltip")).click();
		action(t("pinPrevTooltip")).click();
		await settle();
		expect(chartViewOf(pinCard())).toBe("table");
	});

	it("pinning the same chart again from the other view reopens it in that view", async () => {
		const conv = await open({});
		const card = chartInAnswer();
		card.querySelector<HTMLButtonElement>(".p-pin-btn")!.click();
		await settle();
		toggle(card);
		card.querySelector<HTMLButtonElement>(".p-pin-btn")!.click();
		await settle();
		expect(conv.pins).toHaveLength(1);
		expect(chartViewOf(pinCard())).toBe("table");
	});

	it("the strip's Copy copies what the pin shows: the table as Markdown, or the block", async () => {
		await open({});
		const card = chartInAnswer();
		const source = chartSourceOf(card)!;
		card.querySelector<HTMLButtonElement>(".p-pin-btn")!.click();
		await settle();
		action(t("pinCopyTooltip")).click();
		toggle(pinCard());
		action(t("pinCopyTooltip")).click();
		await settle();
		expect(copied).toEqual([source, chartBlockAsTable(source)]);
	});
});
