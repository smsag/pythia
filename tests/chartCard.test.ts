// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { renderChartCard } from "../ui/chart/card";
import { decorateCodeBlocks } from "../ui/CodeBlockDecorator";
import { formatChartBlock, parseChartSpec, CHART_BLOCK_LANG } from "../services/chartSpec";

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

	it("offers both copy controls", () => {
		renderChartCard(BAR, host);
		expect(host.querySelectorAll(".p-chart-actions button")).toHaveLength(2);
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
