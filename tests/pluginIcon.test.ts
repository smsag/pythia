// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { registeredIcons } from "./mocks/obsidian";
import { PYTHIA_ICON_ID, PYTHIA_ICON_SVG, registerPythiaIcon } from "../ui/pluginIcon";

/** Parses the markup the way Obsidian does — as the body of a 100-unit svg. */
function render(): SVGSVGElement {
	const host = document.createElement("div");
	host.innerHTML = `<svg viewBox="0 0 100 100">${PYTHIA_ICON_SVG}</svg>`;
	return host.firstElementChild as SVGSVGElement;
}

describe("the Pythia icon", () => {
	it("registers itself under the id the ribbon, the commands and the view ask for", () => {
		registerPythiaIcon();
		expect(PYTHIA_ICON_ID).toBe("pythia-logo");
		expect(registeredIcons.get(PYTHIA_ICON_ID)).toBe(PYTHIA_ICON_SVG);
	});

	it("is well-formed markup: one group holding the serpent and its eye", () => {
		const svg = render();
		expect(svg.querySelector("parsererror")).toBeNull();
		const g = svg.firstElementChild!;
		expect(g.tagName.toLowerCase()).toBe("g");
		expect(g.children).toHaveLength(2);
		expect(g.children[0].tagName.toLowerCase()).toBe("path");
		expect(g.children[1].tagName.toLowerCase()).toBe("circle");
	});

	it("scales Lucide's 24-unit grid into the 100-unit box addIcon draws in", () => {
		const g = render().firstElementChild!;
		const scale = Number(/scale\(([\d.]+)\)/.exec(g.getAttribute("transform") ?? "")?.[1]);
		expect(scale).toBeCloseTo(100 / 24, 3);
	});

	it("inherits Obsidian's stroke width rather than pinning its own (ADR-168)", () => {
		// `.svg-icon` sets `stroke-width: var(--icon-stroke)` and a Lucide icon
		// carries no attribute of its own. An attribute here would block that, and
		// the group's scale() multiplies the stroke — a hardcoded 2 drew at 8.33%
		// of the icon's width against core's 7.29%.
		const g = render().firstElementChild!;
		expect(g.hasAttribute("stroke-width")).toBe(false);
		for (const shape of Array.from(g.children)) {
			expect(shape.hasAttribute("stroke-width")).toBe(false);
		}
	});

	it("keeps Lucide's other rules: round caps and joins, stroke only", () => {
		const g = render().firstElementChild!;
		expect(g.getAttribute("stroke-linecap")).toBe("round");
		expect(g.getAttribute("stroke-linejoin")).toBe("round");
		expect(g.getAttribute("fill")).toBe("none");
		for (const shape of Array.from(g.children)) {
			expect(shape.hasAttribute("fill")).toBe(false);
		}
	});

	it("takes its colour from the control it is drawn in", () => {
		const g = render().firstElementChild!;
		expect(g.getAttribute("stroke")).toBe("currentColor");
		expect(PYTHIA_ICON_SVG).not.toMatch(/#[0-9a-f]{3,8}\b/i);
		expect(PYTHIA_ICON_SVG).not.toMatch(/\b(rgb|hsl)a?\(/);
	});

	it("carries the designed geometry unchanged", () => {
		expect(PYTHIA_ICON_SVG).toContain(
			'd="M5 19c-2.5 0-2.5-4.5 0-4.5h13c2.5 0 2.5-4.5 0-4.5H6c-2.5 0-2.5-4.5 0-4.5h9.5"',
		);
		expect(PYTHIA_ICON_SVG).toContain('cx="17.5" cy="5.5" r="1.5"');
	});
});
