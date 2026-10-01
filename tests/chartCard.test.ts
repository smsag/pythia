// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
	renderChartCard, chartViewOf, setChartView, forgetChartViews, CHART_VIEW_EVENT, CHART_VIEW_OWNER, type ChartViewDetail,
} from "../ui/chart/card";
import { decorateCodeBlocks } from "../ui/CodeBlockDecorator";
import { chartAsTable, formatChartBlock, parseChartSpec, CHART_BLOCK_LANG } from "../services/chartSpec";
import { t } from "../i18n";

// Obsidian augments Element.prototype at runtime; happy-dom gives bare elements.
// Only the handful the card actually calls, rather than importing the full view
// harness — which would pull the whole plugin in for a test about one block.
type Opts = { cls?: string; text?: string; attr?: Record<string, string> };
function applyOpts(el: Element, o?: Opts): void {
	if (!o) return;
	if (o.cls) el.setAttribute("class", o.cls);
	if (o.text != null) el.textContent = o.text;
	if (o.attr) for (const k in o.attr) el.setAttribute(k, o.attr[k]);
}
const proto = Element.prototype as unknown as Record<string, unknown>;
proto.createEl = function (this: Element, tag: string, o?: Opts): Element {
	const e = document.createElement(tag);
	applyOpts(e, o);
	this.appendChild(e);
	return e;
};
proto.createDiv  = function (this: Element, o?: Opts) { return (this as unknown as { createEl(t: string, o?: Opts): Element }).createEl("div", o); };
proto.createSpan = function (this: Element, o?: Opts) { return (this as unknown as { createEl(t: string, o?: Opts): Element }).createEl("span", o); };
proto.empty      = function (this: Element) { while (this.firstChild) this.removeChild(this.firstChild); };
proto.addClass   = function (this: Element, ...c: string[]) { this.classList.add(...c); };
proto.removeClass = function (this: Element, ...c: string[]) { this.classList.remove(...c); };
// decorateCodeBlocks builds its frame through the GLOBAL createEl.
(globalThis as unknown as { createEl: unknown }).createEl = (tag: string, o?: Opts): Element => {
	const e = document.createElement(tag);
	applyOpts(e, o);
	return e;
};

/** The block body as the code-block processor hands it over: the JSON between
 *  the fences, not the fenced text. */
function body(raw: Record<string, unknown>): string {
	const parsed = parseChartSpec(raw);
	if (!parsed.ok) throw new Error(parsed.error);
	return formatChartBlock(parsed.spec).split("\n").slice(1, -1).join("\n");
}

const BAR = body({
	type: "bar", title: "Revenue", categories: ["a", "b", "c"],
	series: [{ name: "EMEA", values: [1, 2, 3], source: "example.com" }],
});

let host: HTMLElement;

beforeEach(() => {
	document.body.innerHTML = "";
	document.body.className = "theme-light";
	host = document.body.appendChild(document.createElement("div"));
	forgetChartViews(); // a switch is remembered for the session; each test starts a new one
});

describe("renderChartCard — a valid block", () => {
	it("draws one SVG inside a card", () => {
		renderChartCard(BAR, host);
		expect(host.querySelectorAll(".p-chart-card")).toHaveLength(1);
		expect(host.querySelectorAll("svg")).toHaveLength(1);
	});

	// createEl("svg") makes an HTML element called "svg" that renders nothing and
	// reports no error. The namespace is the difference between a chart and a gap.
	it("builds the SVG in the SVG namespace", () => {
		renderChartCard(BAR, host);
		const svg = host.querySelector("svg");
		expect(svg?.namespaceURI).toBe("http://www.w3.org/2000/svg");
	});

	it("offers the view switch and both copy controls", () => {
		renderChartCard(BAR, host);
		expect(host.querySelectorAll(".p-chart-actions button")).toHaveLength(3);
	});

	it("shows the chart's own title, or the kind of chart when it has none", () => {
		renderChartCard(BAR, host);
		expect(host.querySelector(".p-chart-head-label")?.textContent).toBe("Revenue");

		host.remove();
		host = document.body.appendChild(document.createElement("div"));
		renderChartCard(body({
			type: "pie", categories: ["a", "b"], series: [{ name: "s", values: [1, 2] }],
		}), host);
		expect(host.querySelector(".p-chart-head-label")?.textContent).toBe("Pie chart");
	});

	// The head row names the chart; the SVG on screen does not name it again
	// (ADR-236). The exported picture carries the title — see chartLayout.
	it("names the chart once: in the head row, not again inside the SVG", () => {
		renderChartCard(BAR, host);
		expect(host.querySelector(".p-chart-head-label")?.textContent).toBe("Revenue");
		expect(host.querySelectorAll(".p-chart-title")).toHaveLength(0);
		expect(host.textContent?.split("Revenue").length).toBe(2);
	});

	it("lists each distinct series source once", () => {
		renderChartCard(body({
			type: "bar", categories: ["a", "b"],
			series: [
				{ name: "one", values: [1, 2], source: "example.com" },
				{ name: "two", values: [2, 1], source: "example.com" },
				{ name: "three", values: [3, 1], source: "other.org" },
			],
		}), host);
		const sources = Array.from(host.querySelectorAll(".p-chart-source")).map((e) => e.textContent);
		expect(sources).toEqual(["example.com", "other.org"]);
	});

	it("draws no source row when no series declares one", () => {
		renderChartCard(body({
			type: "bar", categories: ["a", "b"], series: [{ name: "s", values: [1, 2] }],
		}), host);
		expect(host.querySelector(".p-chart-foot")).toBeNull();
	});

	// The processor names our container .block-language-pythia-chart, which is
	// exactly what decorateCodeBlocks' diagram branch matches — and stampSvgSize
	// would pin a hard pixel width onto the SVG and undo the responsive layout.
	it("marks the container decorated, so the diagram pass leaves it alone", () => {
		renderChartCard(BAR, host);
		expect(host.dataset.decorated).toBe("1");
	});

	it("is idempotent — a second call leaves one chart, not two", () => {
		renderChartCard(BAR, host);
		renderChartCard(BAR, host);
		expect(host.querySelectorAll("svg")).toHaveLength(1);
		expect(host.querySelectorAll(".p-chart-card")).toHaveLength(1);
	});

	it("puts no colour in the markup — only custom properties the theme resolves", () => {
		renderChartCard(BAR, host);
		const svg = host.querySelector("svg");
		expect(svg?.outerHTML ?? "").not.toMatch(/fill="#|fill="rgb/);
		expect(svg?.style.getPropertyValue("--p-chart-c0")).toMatch(/^#|^rgb/);
	});
});

describe("renderChartCard — a block it cannot draw", () => {
	const broken = '{"type":"bar","categories":["a","b"],"series":[{"name":"s","values":[1]}]}';

	it("says so instead of rendering nothing", () => {
		renderChartCard(broken, host);
		expect(host.querySelector(".p-chart-card--error")).not.toBeNull();
		expect(host.querySelector("svg")).toBeNull();
	});

	// The detail is the parser's own string — the same one the model receives and
	// the same one a bug report can quote.
	it("shows the parser's reason, naming the field", () => {
		renderChartCard(broken, host);
		expect(host.querySelector(".p-chart-error-detail")?.textContent).toContain("series[0].values");
	});

	// The data is still the user's even when Pythia cannot draw it.
	it("still offers the source, and still keeps it on screen", () => {
		renderChartCard(broken, host);
		expect(host.querySelectorAll(".p-chart-actions button")).toHaveLength(1);
		expect(host.querySelector(".p-chart-error-source")?.textContent).toBe(broken);
	});

	it("reports invalid JSON rather than throwing", () => {
		expect(() => renderChartCard("{ nope", host)).not.toThrow();
		expect(host.querySelector(".p-chart-card--error")).not.toBeNull();
	});

	it("marks the container decorated on the error path too", () => {
		renderChartCard(broken, host);
		expect(host.dataset.decorated).toBe("1");
	});
});

describe("the block language", () => {
	it("is the one the emitter writes and the processor registers", () => {
		expect(formatChartBlock({
			type: "bar", categories: ["a", "b"], series: [{ name: "s", values: [1, 2] }],
		}).startsWith("```" + CHART_BLOCK_LANG)).toBe(true);
	});
});

describe("a chart and the code-block decorator", () => {
	const broken = '{"type":"bar","categories":["a","b"],"series":[{"name":"s","values":[1]}]}';

	/** What the panel really does: the processor draws the card, then
	 *  `decorateCodeBlocks` sweeps the same subtree. */
	function decorateAround(source: string): HTMLElement {
		const container = document.body.appendChild(document.createElement("div"));
		const block = container.appendChild(document.createElement("div"));
		block.className = "block-language-pythia-chart";
		renderChartCard(source, block);
		decorateCodeBlocks(container, new WeakMap());
		return container;
	}

	it("leaves a drawn chart alone", () => {
		const container = decorateAround(BAR);
		expect(container.querySelector(".p-code-frame")).toBeNull();
		expect(container.querySelector(".p-scroll-frame")).toBeNull();
		expect(container.querySelectorAll("svg")).toHaveLength(1);
	});

	// The `pre` pass takes any undecorated <pre> in the subtree and only skips
	// mermaid/plantuml ancestors — so the error card's source block was being
	// framed as a code block, labelled "code", and given a second copy button
	// next to the one the card already offers.
	it("does not dress the error card's source as a code block", () => {
		const container = decorateAround(broken);
		expect(container.querySelector(".p-code-frame")).toBeNull();
		expect(container.querySelector(".p-code-head")).toBeNull();
		expect(container.querySelectorAll("button")).toHaveLength(1);
	});
});

describe("the table view (ADR-254)", () => {
	const card = (root: HTMLElement = host): HTMLElement => root.querySelector<HTMLElement>(".p-chart-card")!;
	const viewBtn = (root: HTMLElement = host): HTMLButtonElement => root.querySelector<HTMLButtonElement>(".p-chart-view-btn")!;
	const copyViewBtn = (root: HTMLElement = host): HTMLButtonElement => root.querySelector<HTMLButtonElement>(".p-chart-copy-view")!;
	const cells = (root: HTMLElement = host): string[][] =>
		Array.from(root.querySelectorAll("tr")).map((tr) => Array.from(tr.children).map((c) => c.textContent ?? ""));
	const fresh = (): HTMLElement => document.body.appendChild(document.createElement("div"));

	it("starts as the chart, with a switch that shows where it goes", () => {
		renderChartCard(BAR, host);
		expect(chartViewOf(card())).toBe("chart");
		expect(host.querySelector(".p-chart-head-icon")?.getAttribute("data-icon")).toBe("bar-chart-3");
		expect(viewBtn().getAttribute("data-icon")).toBe("table");
		expect(viewBtn().getAttribute("title")).toBe(t("chartShowTableTooltip"));
		expect(viewBtn().className).toContain("pb pb-icon");
	});

	it("the switch shows the table of the same numbers; the head and the sources stay", () => {
		renderChartCard(BAR, host);
		viewBtn().click();
		expect(chartViewOf(card())).toBe("table");
		expect(host.querySelector("svg")).toBeNull();
		expect(cells()).toEqual([["", "EMEA"], ["a", "1"], ["b", "2"], ["c", "3"]]);
		expect(host.querySelector(".p-chart-head-label")?.textContent).toBe("Revenue");
		expect(host.querySelector(".p-chart-head-icon")?.getAttribute("data-icon")).toBe("table");
		expect(viewBtn().getAttribute("data-icon")).toBe("bar-chart-3");
		expect(viewBtn().getAttribute("title")).toBe(t("chartShowChartTooltip"));
		expect(Array.from(host.querySelectorAll(".p-chart-source")).map((e) => e.textContent)).toEqual(["example.com"]);
	});

	it("names the unit in the column header and a gap as –; headers carry their scope", () => {
		renderChartCard(body({
			type: "line", categories: ["2023", "2024", "2025"], unit: "%",
			series: [{ name: "EMEA", values: [12.4, null, 15] }, { name: "APAC", values: [9, 10, 11] }],
		}), host);
		viewBtn().click();
		expect(cells()).toEqual([
			["", "EMEA (%)", "APAC (%)"],
			["2023", "12.4", "9"],
			["2024", "–", "10"],
			["2025", "15", "11"],
		]);
		expect(Array.from(host.querySelectorAll("thead th")).map((th) => th.getAttribute("scope"))).toEqual(["col", "col"]);
		expect(Array.from(host.querySelectorAll("tbody th")).map((th) => th.getAttribute("scope"))).toEqual(["row", "row", "row"]);
	});

	// A category label is model output (principle 9): in a cell it is text, so a
	// link or an image in it is the characters it is — nothing is fetched.
	it("keeps a label as text: a link or an image in it never becomes markup", () => {
		const evil = "![x](https://evil.example/a.png)";
		renderChartCard(body({
			type: "bar", categories: [evil, "[y](https://e.example)", "c"],
			series: [{ name: "<b>s</b>", values: [1, 2, 3] }],
		}), host);
		viewBtn().click();
		expect(host.querySelector("table img, table a, table b")).toBeNull();
		expect(cells()[1][0]).toBe(evil);
		expect(cells()[0][1]).toBe("<b>s</b>");
	});

	it("switching back draws the chart again", () => {
		renderChartCard(BAR, host);
		viewBtn().click();
		viewBtn().click();
		expect(chartViewOf(card())).toBe("chart");
		expect(host.querySelectorAll("svg")).toHaveLength(1);
		expect(host.querySelector("table")).toBeNull();
	});

	it("the copy beside the switch follows the view: the picture, then the table as Markdown", async () => {
		const copied: string[] = [];
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (s: string) => { copied.push(s); } } });
		renderChartCard(BAR, host);
		expect(copyViewBtn().getAttribute("title")).toBe(t("chartCopyImageTooltip"));
		viewBtn().click();
		expect(copyViewBtn().getAttribute("title")).toBe(t("chartCopyTableTooltip"));
		copyViewBtn().click();
		await Promise.resolve();
		const parsed = parseChartSpec(JSON.parse(BAR));
		if (!parsed.ok) throw new Error(parsed.error);
		expect(copied).toEqual([chartAsTable(parsed.spec)]);
		expect(host.querySelectorAll(".p-chart-actions button")).toHaveLength(3);
	});

	/** A place for a card inside answer `msgId`, as the panel draws one. */
	const inAnswer = (msgId: string): HTMLElement => {
		const row = fresh();
		row.setAttribute("data-msg-id", msgId);
		return row.appendChild(document.createElement("div"));
	};

	it("a switch is remembered for the session where it was made, and forgotten on unload", () => {
		const first = inAnswer("a1");
		renderChartCard(BAR, first);
		viewBtn(first).click();
		const again = inAnswer("a1");
		renderChartCard(BAR, again);
		expect(chartViewOf(card(again))).toBe("table");
		expect(again.querySelector("table")).not.toBeNull();

		forgetChartViews();
		const afterUnload = inAnswer("a1");
		renderChartCard(BAR, afterUnload);
		expect(chartViewOf(card(afterUnload))).toBe("chart");
	});

	// The same chart elsewhere — another conversation's answer, a note it was
	// saved to — keeps its own view: the memory is keyed by place and data.
	it("the same chart in another answer or in a note keeps its own view", () => {
		const first = inAnswer("a1");
		renderChartCard(BAR, first);
		viewBtn(first).click();
		const otherAnswer = inAnswer("b7");
		renderChartCard(BAR, otherAnswer);
		expect(chartViewOf(card(otherAnswer))).toBe("chart");
		const note = fresh();
		renderChartCard(BAR, note, "Notes/Revenue.md");
		expect(chartViewOf(card(note))).toBe("chart");

		viewBtn(note).click();
		const noteAgain = fresh();
		renderChartCard(BAR, noteAgain, "Notes/Revenue.md");
		expect(chartViewOf(card(noteAgain))).toBe("table");
		const otherNote = fresh();
		renderChartCard(BAR, otherNote, "Notes/Other.md");
		expect(chartViewOf(card(otherNote))).toBe("chart");
	});

	it("a chart drawn where no place is known is not remembered", () => {
		renderChartCard(BAR, host);
		viewBtn().click();
		const again = fresh();
		renderChartCard(BAR, again);
		expect(chartViewOf(card(again))).toBe("chart");
	});

	it("tells the surface which view the user chose, in an event that bubbles", () => {
		const seen: string[] = [];
		host.addEventListener(CHART_VIEW_EVENT, (e) => seen.push((e as CustomEvent<ChartViewDetail>).detail.view));
		renderChartCard(BAR, host);
		viewBtn().click();
		viewBtn().click();
		expect(seen).toEqual(["table", "chart"]);
	});

	// The pin strip: the card is DRAWN in the owner's view — no draw in another
	// view to be corrected after — keeps the owner's attribute current, and
	// stays out of the session's memory, which the answer reads.
	it("a card inside an owner starts in the owner's view, keeps it current, and leaves the memory alone", () => {
		const answerHost = inAnswer("a1");
		renderChartCard(BAR, answerHost);
		viewBtn(answerHost).click();                  // the answer: table

		const owner = inAnswer("a1");                 // even inside the same answer
		owner.setAttribute(CHART_VIEW_OWNER, "chart");
		const inner = owner.appendChild(document.createElement("div"));
		renderChartCard(BAR, inner);
		expect(chartViewOf(card(inner))).toBe("chart");
		expect(inner.querySelector("svg")).not.toBeNull();

		viewBtn(inner).click();
		viewBtn(inner).click();                       // back to chart: the owner's, not the memory's
		expect(owner.getAttribute(CHART_VIEW_OWNER)).toBe("chart");
		viewBtn(inner).click();
		expect(owner.getAttribute(CHART_VIEW_OWNER)).toBe("table");

		const answerAgain = inAnswer("a1");
		renderChartCard(BAR, answerAgain);
		expect(chartViewOf(card(answerAgain))).toBe("table"); // the answer's own, untouched
		viewBtn(answerAgain).click();                         // the answer back to chart
		const ownedAgain = owner.appendChild(document.createElement("div"));
		renderChartCard(BAR, ownedAgain);
		expect(chartViewOf(card(ownedAgain))).toBe("table");  // the owner's, untouched
	});

	it("setChartView switches a card silently: no event, no memory", () => {
		const seen: string[] = [];
		const place = inAnswer("a1");
		place.addEventListener(CHART_VIEW_EVENT, () => seen.push("event"));
		renderChartCard(BAR, place);
		setChartView(card(place), "table");
		expect(chartViewOf(card(place))).toBe("table");
		expect(place.querySelector("table")).not.toBeNull();
		expect(seen).toEqual([]);
		const again = inAnswer("a1");
		renderChartCard(BAR, again);
		expect(chartViewOf(card(again))).toBe("chart");
	});

	// A toggle has one name that never changes; its state is aria-pressed.
	it("the switch has a stable name and says whether the table is shown", () => {
		renderChartCard(BAR, host);
		const name = viewBtn().getAttribute("aria-label");
		expect(name).toBe(t("chartTableViewLabel"));
		expect(viewBtn().getAttribute("aria-pressed")).toBe("false");
		viewBtn().click();
		expect(viewBtn().getAttribute("aria-label")).toBe(name);
		expect(viewBtn().getAttribute("aria-pressed")).toBe("true");
	});

	it("an error card has no view to switch", () => {
		renderChartCard('{"type":"bar"}', host);
		expect(host.querySelector(".p-chart-view-btn")).toBeNull();
		expect(chartViewOf(host.querySelector(".p-chart-card"))).toBe("chart");
		expect(() => setChartView(host.querySelector<HTMLElement>(".p-chart-card")!, "table")).not.toThrow();
	});

	// decorateTables takes every undecorated <table> in an answer; the card's own
	// is framed by it once, without a pin, and the answer's sweep leaves it alone.
	it("the card's table is framed once — scroll frame, no Copy or Pin — pin or no pin", () => {
		const first = inAnswer("a1");
		renderChartCard(BAR, first);
		viewBtn(first).click();               // remembered: the next draw opens as a table
		const container = inAnswer("a1");
		const block = container.appendChild(document.createElement("div"));
		block.className = "block-language-pythia-chart";
		renderChartCard(BAR, block);
		decorateCodeBlocks(container, new WeakMap(), () => undefined);
		expect(container.querySelectorAll("table")).toHaveLength(1);
		expect(container.querySelector(".p-chart-body > .p-scroll-frame > table.p-chart-table")).not.toBeNull();
		expect(container.querySelectorAll(".p-scroll-frame")).toHaveLength(1);
		expect(container.querySelector(".p-table-actions")).toBeNull();
		expect(container.querySelectorAll(".p-chart-actions .p-pin-btn")).toHaveLength(1);
	});
});
