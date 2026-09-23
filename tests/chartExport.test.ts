// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { inlineChartColors } from "../ui/chart/export";

const SVG_NS = "http://www.w3.org/2000/svg";

function el(parent: Element, tag: string, attrs: Record<string, string> = {}): SVGElement {
	const node = document.createElementNS(SVG_NS, tag) as SVGElement;
	for (const k in attrs) node.setAttribute(k, attrs[k]);
	parent.appendChild(node);
	return node;
}

function chart(): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("class", "p-chart-svg");
	svg.setAttribute("width", "400");
	svg.setAttribute("height", "250");
	svg.style.setProperty("--p-chart-c0", "#1d4d7e");
	el(svg, "rect", { class: "p-chart-bar p-chart-c0", x: "0", y: "0", width: "10", height: "20" });
	el(svg, "text", { class: "p-chart-axis", x: "5", y: "5" }).textContent = "12";
	document.body.appendChild(svg);
	return svg;
}

let live: SVGSVGElement;
let clone: SVGSVGElement;

beforeEach(() => {
	document.body.innerHTML = "";
	live = chart();
	clone = live.cloneNode(true) as SVGSVGElement;
	inlineChartColors(live, clone, "rgb(255, 255, 255)");
});

describe("inlineChartColors", () => {
	// The one unavoidable rule of the whole export: a CSS custom property does
	// not cross the <img> boundary, so anything still referring to one would
	// rasterise as nothing.
	it("leaves no var() and no custom property anywhere in the clone", () => {
		const markup = new XMLSerializer().serializeToString(clone);
		expect(markup).not.toContain("var(");
		expect(markup).not.toContain("--p-chart-");
	});

	it("strips the classes a stylesheet would have matched", () => {
		expect(new XMLSerializer().serializeToString(clone)).not.toContain("p-chart-bar");
	});

	// The one colour with no Obsidian token behind it is written in directly, off
	// the root's own inline style rather than through the CSSOM — so the export
	// is right even where getComputedStyle is not helpful.
	it("writes each series swatch in without consulting a stylesheet", () => {
		const bar = clone.querySelectorAll("rect")[1];
		expect(bar.getAttribute("fill")).toBe("#1d4d7e");
	});

	it("strokes a line series rather than filling it", () => {
		const svg = document.createElementNS(SVG_NS, "svg");
		svg.setAttribute("width", "10");
		svg.setAttribute("height", "10");
		svg.style.setProperty("--p-chart-c1", "#b7712b");
		el(svg, "path", { class: "p-chart-line p-chart-c1", d: "M 0 0 L 1 1" });
		document.body.appendChild(svg);
		const copy = svg.cloneNode(true) as SVGSVGElement;
		inlineChartColors(svg, copy, "rgb(255, 255, 255)");
		const path = copy.querySelector("path");
		expect(path?.getAttribute("stroke")).toBe("#b7712b");
		expect(path?.getAttribute("fill")).toBe("none");
	});

	// Hard rule 2 forbids embedding a font, and the SVG-as-image document loads
	// no theme webfont, so a generic stack is the honest substitute for one that
	// would silently fall back to a serif face.
	it("rewrites the font to a stack the raster can actually resolve", () => {
		const family = clone.getAttribute("font-family") ?? "";
		expect(family).toContain("sans-serif");
		expect(family).not.toContain("--font");
	});

	// A transparent PNG looks right on a white page and unreadable on a dark slide.
	it("paints the ground in as the first element", () => {
		const first = clone.firstElementChild;
		expect(first?.tagName).toBe("rect");
		expect(first?.getAttribute("fill")).toBe("rgb(255, 255, 255)");
		expect(first?.getAttribute("width")).toBe("400");
		expect(first?.getAttribute("height")).toBe("250");
	});

	it("leaves the live chart untouched", () => {
		expect(live.getAttribute("class")).toBe("p-chart-svg");
		expect(live.style.getPropertyValue("--p-chart-c0")).toBe("#1d4d7e");
		expect(live.querySelector(".p-chart-bar")).not.toBeNull();
	});

	it("keeps the geometry — an export is the same chart, not a redraw", () => {
		const bar = clone.querySelectorAll("rect")[1];
		expect(bar.getAttribute("width")).toBe("10");
		expect(bar.getAttribute("height")).toBe("20");
	});

	it("survives a chart with nothing in it", () => {
		const empty = document.createElementNS(SVG_NS, "svg");
		empty.setAttribute("width", "10");
		empty.setAttribute("height", "10");
		const emptyClone = empty.cloneNode(true) as SVGSVGElement;
		expect(() => inlineChartColors(empty, emptyClone, "rgb(0, 0, 0)")).not.toThrow();
		expect(emptyClone.firstElementChild?.tagName).toBe("rect");
	});
});
