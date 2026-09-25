// @vitest-environment happy-dom
//
// ADR-216: one builder per pinnable source, shared by that block's Copy and its
// Pin — so the two can never disagree — and a pin button only where pinning
// makes sense: in an answer, never in a pin's own body or in a vault note.
import { describe, it, expect, vi, beforeEach } from "vitest";
import "./helpers/viewHarness"; // Obsidian's DOM helpers (createEl, createDiv, …)
import { cellText, codeBlockSource, diagramSource, fenceFor, tableMarkdown, type PinBlock } from "../ui/pinSources";
import { decorateCodeBlocks } from "../ui/CodeBlockDecorator";
import { decorateTables } from "../ui/tableDecorator";
import { chartSourceOf, renderChartCard } from "../ui/chart/card";
import type { PinKind } from "../models/types";

function html(markup: string): HTMLElement {
	const el = document.createElement("div");
	el.innerHTML = markup;
	document.body.appendChild(el);
	return el;
}
const CODE = '<pre><code class="language-python">def revenue(q):\n    return 1\n</code></pre>';
const DIAGRAM = '<div class="block-language-mermaid"><pre><code>graph TD\n  A--&gt;B\n</code></pre><svg viewBox="0 0 10 10"></svg></div>';
const TABLE = "<table><thead><tr><th>Quarter</th><th>Note</th></tr></thead><tbody><tr><td>Q1</td><td>a | b\nc</td></tr><tr><td>Q2</td></tr></tbody></table>";
const CHART = '{"type":"bar","title":"Revenue","categories":["Q1","Q2"],"series":[{"name":"R","values":[1,2]}]}';

let copied: string[];
beforeEach(() => {
	document.body.innerHTML = "";
	copied = [];
	Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (s: string) => { copied.push(s); } } });
});

describe("the builders", () => {
	it("a code block is its fenced source", () => {
		expect(codeBlockSource(html(CODE).querySelector("pre")!)).toBe("```python\ndef revenue(q):\n    return 1\n```");
	});

	it("a diagram is its fenced source, and nothing when there is none to read", () => {
		expect(diagramSource(html(DIAGRAM).firstElementChild as HTMLElement)).toBe("```mermaid\ngraph TD\n  A-->B\n```");
		expect(diagramSource(html('<div class="block-language-mermaid"><svg></svg></div>').firstElementChild as HTMLElement)).toBe("");
	});

	it("a table is a pipe table: | escaped, a line break kept in its cell, a short row padded", () => {
		expect(tableMarkdown(html(TABLE).querySelector("table")!)).toBe(
			"| Quarter | Note |\n| --- | --- |\n| Q1 | a \\| b<br>c |\n| Q2 |  |",
		);
	});
});

describe("a fence the code inside cannot close (review of ADR-216)", () => {
	it("is three backticks for ordinary code, and one longer than the longest run inside", () => {
		expect(fenceFor("let x = 1;")).toBe("```");
		expect(fenceFor("inline `code` here")).toBe("```");
		expect(fenceFor("```js\nx\n```")).toBe("````");
		expect(fenceFor("a ```` b")).toBe("`````");
	});

	it("a code block that shows a Markdown example keeps it whole", () => {
		const pre = document.createElement("pre");
		const code = pre.appendChild(document.createElement("code"));
		code.className = "language-md";
		code.textContent = "Use:\n```js\nlet x = 1;\n```\n";
		const source = codeBlockSource(pre);
		expect(source).toBe("````md\nUse:\n```js\nlet x = 1;\n```\n````");
		// No line inside the body closes the outer fence.
		const body = source.split("\n").slice(1, -1);
		expect(body.some((l) => /^`{4,}\s*$/.test(l))).toBe(false);
	});

	it("so does a diagram whose source contains backticks", () => {
		const el = html('<div class="block-language-mermaid"><pre><code>graph TD\n  A["```"]\n</code></pre><svg></svg></div>').firstElementChild as HTMLElement;
		expect(diagramSource(el)).toBe('````mermaid\ngraph TD\n  A["```"]\n````');
	});
});

describe("a table cell comes back as what it SHOWED (review of ADR-216)", () => {
	const cell = (text: string): string => {
		const td = document.createElement("td");
		td.textContent = text;
		return cellText(td);
	};

	it("text that looks like markup is escaped, never re-read as markup", () => {
		expect(cell("<div>")).toBe("\\<div\\>");
		expect(cell("*not emphasis*")).toBe("\\*not emphasis\\*");
		expect(cell("[[Not a link]]")).toBe("\\[\\[Not a link\\]\\]");
		expect(cell("`code`")).toBe("\\`code\\`");
		expect(cell("==mark== ~~del~~ $x$")).toBe("\\=\\=mark\\=\\= \\~\\~del\\~\\~ \\$x\\$");
		expect(cell("a\\b")).toBe("a\\\\b");
	});

	it("ordinary text is untouched, a pipe still escaped, a line break still <br>", () => {
		expect(cell("Q1 2026: 10.5 (est.)")).toBe("Q1 2026: 10.5 (est.)");
		expect(cell("a | b\nc")).toBe("a \\| b<br>c");
	});
});

describe("Copy and Pin take the same text", () => {
	const pinsOf = (root: HTMLElement): Array<{ kind: PinKind; source: string }> => {
		const got: Array<{ kind: PinKind; source: string }> = [];
		const onPin: PinBlock = (kind, source) => got.push({ kind, source });
		decorateCodeBlocks(root, new WeakMap(), onPin);
		root.querySelectorAll<HTMLButtonElement>(".p-pin-btn").forEach((b) => b.click());
		return got;
	};

	it("for a code block", async () => {
		const root = html(CODE);
		const [pin] = pinsOf(root);
		root.querySelector<HTMLButtonElement>(".p-code-copy:not(.p-pin-btn)")!.click();
		await Promise.resolve();
		expect(pin).toEqual({ kind: "code", source: copied[0] });
	});

	it("for a diagram", async () => {
		const root = html(DIAGRAM);
		const [pin] = pinsOf(root);
		root.querySelector<HTMLButtonElement>(".p-diag-copy:not(.p-pin-btn)")!.click();
		await Promise.resolve();
		expect(pin).toEqual({ kind: "diagram", source: copied[0] });
	});

	it("for a table — which gains a Copy for exactly that reason", async () => {
		const root = html(TABLE);
		const [pin] = pinsOf(root);
		root.querySelector<HTMLButtonElement>(".p-table-btn:not(.p-pin-btn)")!.click();
		await Promise.resolve();
		expect(pin).toEqual({ kind: "table", source: copied[0] });
		// Outside the scroll frame, so a wide table does not scroll its buttons away.
		expect(root.querySelector(".p-scroll-frame .p-table-actions")).toBeNull();
	});

	it("for a chart — the card's canonical source block", () => {
		const root = html('<div class="host"></div>');
		const host = root.querySelector<HTMLElement>(".host")!;
		renderChartCard(CHART, host);
		const card = host.querySelector<HTMLElement>(".p-chart-card")!;
		const [pin] = pinsOf(root);
		expect(pin.kind).toBe("chart");
		expect(pin.source).toBe(chartSourceOf(card));
		expect(pin.source.startsWith("```pythia-chart")).toBe(true);
	});
});

describe("no pin where pinning makes no sense (the forbidden direction)", () => {
	it("decorating without onPin — a summary card, a pin's own body — draws no pin", () => {
		const root = html(CODE + DIAGRAM + TABLE);
		decorateCodeBlocks(root, new WeakMap());
		expect(root.querySelector(".p-pin-btn")).toBeNull();
		expect(root.querySelector(".p-table-actions")).toBeNull();
		decorateTables(html(TABLE));
		expect(document.querySelector(".p-pin-btn")).toBeNull();
	});

	it("a chart drawn on its own — in a vault note — has no pin", () => {
		const host = html("").appendChild(document.createElement("div"));
		renderChartCard(CHART, host);
		expect(host.querySelector(".p-pin-btn")).toBeNull();
	});

	it("a chart that could not be drawn offers no pin", () => {
		const root = html('<div class="host"></div>');
		renderChartCard("{ not json", root.querySelector<HTMLElement>(".host")!);
		const onPin = vi.fn();
		decorateCodeBlocks(root, new WeakMap(), onPin);
		expect(root.querySelector(".p-chart-card--error .p-pin-btn")).toBeNull();
	});

	it("decorating twice adds no second pin", () => {
		const root = html(CODE + TABLE);
		decorateCodeBlocks(root, new WeakMap(), vi.fn());
		decorateCodeBlocks(root, new WeakMap(), vi.fn());
		expect(root.querySelectorAll(".p-pin-btn")).toHaveLength(2);
	});
});
