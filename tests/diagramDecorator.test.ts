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
import { decorateCodeBlocks } from "../ui/CodeBlockDecorator";

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
		expect(svg.style.getPropertyValue("width")).toBe("2400px");
		expect(svg.style.getPropertyValue("max-width")).toBe("none");
	});

	it("a pending block is not framed as code, and is sized when Obsidian swaps it in", async () => {
		const root = html(PENDING_MERMAID);
		decorateCodeBlocks(root, new WeakMap());
		expect(root.querySelector(".p-code-frame")).toBeNull();

		root.querySelector("pre")!.replaceWith(html(DRAWN_MERMAID).firstElementChild!);
		await flush();
		expect(root.querySelector<SVGElement>(".mermaid > svg")!.style.getPropertyValue("width")).toBe("2400px");
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

describe("the diagram's own SVG", () => {
	it("an icon ahead of the drawing is never the one sized", () => {
		const root = html('<div class="block-language-plantuml"><span class="tools"><svg class="svg-icon" viewBox="0 0 24 24"></svg></span><svg viewBox="0 0 1200 300"></svg></div>');
		decorateCodeBlocks(root, new WeakMap());
		const [icon, drawing] = Array.from(root.querySelectorAll<SVGElement>("svg"));
		expect(icon.getAttribute("style")).toBeNull();
		expect(drawing.style.getPropertyValue("width")).toBe("1200px");
	});
});
