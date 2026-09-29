// @vitest-environment happy-dom
//
// Diagrams in an answer are drawn at their natural size in a scroll frame, so a
// wide one scrolls instead of shrinking to unreadable. Two hosts broke that:
//
// - Obsidian's own Mermaid (1.13.7 app.js) REPLACES the <pre> with
//   <div class="mermaid"><svg width="100%" …>, asynchronously, with no
//   block-language-* container. Pythia only looked for block-language-*, so a
//   Mermaid diagram was never sized and shrank to the chat's width.
// - A Vizardry canvas IS a block-language-vizardry element, lays itself out and
//   has its own scroll frames. Pythia's treatment stamped its toolbar icon.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "./helpers/viewHarness";
import { decorateCodeBlocks, labelFloor, MIN_DIAGRAM_LABEL_PX } from "../ui/CodeBlockDecorator";

function html(markup: string): HTMLElement {
	const el = document.createElement("div");
	el.innerHTML = markup;
	document.body.appendChild(el);
	return el;
}
/** What Obsidian leaves once a Mermaid block is drawn. */
const DRAWN_MERMAID = '<div class="mermaid"><svg width="100%" style="max-width: 2400px;" viewBox="0 0 2400 900"><g></g></svg></div>';
/** What it leaves before, while the library loads or the pane is hidden. */
const PENDING_MERMAID = '<pre><code class="language-mermaid">flowchart LR\n  A --&gt; B</code></pre>';
const VIZARDRY = '<div class="block-language-vizardry vizardry-canvas">'
	+ '<div class="vizardry-controls"><button><svg class="svg-icon" viewBox="0 0 24 24"></svg></button></div>'
	+ '<div class="vzd-wardley-wrap"><svg class="vzd-wardley-svg" viewBox="0 0 800 520"></svg></div></div>';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { document.body.innerHTML = ""; });

describe("Obsidian's Mermaid", () => {
	it("a drawn diagram is sized to its viewBox, not to the chat", () => {
		const root = html(DRAWN_MERMAID);
		decorateCodeBlocks(root, new WeakMap());
		const svg = root.querySelector<SVGElement>(".mermaid > svg")!;
		expect(root.querySelector<HTMLElement>(".mermaid")!.dataset.decorated).toBe("1");
		expect(svg.style.getPropertyValue("--p-diag-w")).toBe("2400px");
		expect(svg.classList.contains("p-diag-svg")).toBe(true);
		expect(svg.style.getPropertyValue("height")).toBe("");
	});

	it("a pending block is not framed as code, and is sized when Obsidian swaps it in", async () => {
		const root = html(PENDING_MERMAID);
		decorateCodeBlocks(root, new WeakMap());
		expect(root.querySelector(".p-code-frame")).toBeNull();

		root.querySelector("pre")!.replaceWith(html(DRAWN_MERMAID).firstElementChild!);
		await flush();
		expect(root.querySelector<SVGElement>(".mermaid > svg")!.style.getPropertyValue("--p-diag-w")).toBe("2400px");
	});

	it("an untrusted vault's guard keeps its source block as Obsidian drew it", () => {
		const root = html(`<div class="mermaid-wrapper is-guarded"><div class="mermaid-guard-source">${PENDING_MERMAID}</div></div>`);
		decorateCodeBlocks(root, new WeakMap());
		expect(root.querySelector(".p-code-frame")).toBeNull();
	});
});

describe("a canvas that lays itself out (Vizardry)", () => {
	it("is left alone: not decorated, no SVG stamped — its icon least of all", () => {
		const root = html(VIZARDRY);
		decorateCodeBlocks(root, new WeakMap());
		expect(root.querySelector<HTMLElement>(".vizardry-canvas")!.dataset.decorated).toBeUndefined();
		for (const svg of Array.from(root.querySelectorAll("svg"))) expect(svg.getAttribute("style")).toBeNull();
	});

	it("styles.css gives it none of the diagram rules either", () => {
		const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
		const diagramRules = css.match(/^\.p-ai-body[^{\n]*block-language-[^{\n]*\{/gm) ?? [];
		expect(diagramRules.length).toBeGreaterThan(0);
		for (const rule of diagramRules) {
			if (/:hover|p-diag-copy|copy-code-button/.test(rule)) continue;
			expect(rule).toContain(":not(.vizardry-canvas)");
			expect(rule).toContain(".mermaid");
		}
	});
});

describe("the readability floor (ADR-248, revising ADR-244)", () => {
	const drawn = (labels: string) =>
		`<div class="mermaid"><svg viewBox="0 0 1000 600">${labels}</svg></div>`;

	it("shrinks until the smallest label reaches 11px, no further", () => {
		const root = html(drawn('<foreignObject><div class="nodeLabel" style="font-size: 16px">Mail</div><div class="nodeLabel" style="font-size: 14px">Heute</div></foreignObject>'));
		decorateCodeBlocks(root, new WeakMap());
		const svg = root.querySelector<SVGElement>("svg")!;
		expect(svg.style.getPropertyValue("--p-diag-floor")).toBe((MIN_DIAGRAM_LABEL_PX / 14).toFixed(3));
	});

	it("never enlarges a drawing whose labels are already small", () => {
		const root = html(drawn('<text style="font-size: 9px">tiny</text>'));
		expect(labelFloor(root.querySelector("svg")!)).toBe(1);
	});

	it("falls back to the stylesheet's 0.9 when no label can be measured", () => {
		const root = html(drawn("<g></g>"));
		decorateCodeBlocks(root, new WeakMap());
		expect(root.querySelector<SVGElement>("svg")!.style.getPropertyValue("--p-diag-floor")).toBe("");
		const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
		expect(Number(css.match(/--p-diag-floor:\s*([\d.]+)/)?.[1])).toBeGreaterThanOrEqual(0.9);
	});
});

describe("a theme that centres diagrams (Klartext)", () => {
	it("styles.css makes the container a block, above the theme's (0,2,1) flex rule", () => {
		const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
		// A centred flex item wider than its scroller overflows to the left, out of reach.
		expect(css).toMatch(/\.pythia-view \.p-ai-body :is\(\.mermaid, \[class\*='block-language-'\]:not\(\.vizardry-canvas\)\) \{\s*display: block;/);
	});
});

describe("the diagram's own SVG", () => {
	it("an icon ahead of the drawing is never the one sized", () => {
		const root = html('<div class="block-language-plantuml"><span class="tools"><svg class="svg-icon" viewBox="0 0 24 24"></svg></span><svg viewBox="0 0 1200 300"></svg></div>');
		decorateCodeBlocks(root, new WeakMap());
		const [icon, drawing] = Array.from(root.querySelectorAll<SVGElement>("svg"));
		expect(icon.getAttribute("style")).toBeNull();
		expect(drawing.style.getPropertyValue("--p-diag-w")).toBe("1200px");
	});
});
