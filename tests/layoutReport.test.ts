import { describe, it, expect } from "vitest";
import {
	formatLayoutReport,
	labelFor,
	probeStrip,
	type BoxFacts,
	type LayoutReport,
} from "../ui/layoutReport";

function box(label: string, over: Partial<BoxFacts> = {}): BoxFacts {
	return {
		label,
		top: 0, bottom: 100, left: 0, right: 400,
		padding: "0px",
		margin: "0px",
		backgroundColor: "rgb(26, 26, 26)",
		backgroundImage: "none",
		boxShadow: "none",
		maskImage: "none",
		overflow: "visible",
		...over,
	};
}

const report: LayoutReport = {
	version: "2.13.1",
	platform: "test · dpr 3",
	viewportWidth: 396,
	viewportHeight: 858,
	visualViewportHeight: 858,
	composerBottom: 712,
	panelBottom: 752,
	chain: [box("div.p-input-area"), box("div.view-content.pythia-view")],
	probes: [{ y: 712, stack: ["div.p-input-area"] }],
};

describe("labelFor", () => {
	it("reads as a selector, keeping data-type so a rule can be scoped to our leaf", () => {
		const el = { tagName: "DIV", className: "workspace-leaf-content", getAttribute: () => "pythia" } as unknown as Element;
		expect(labelFor(el)).toBe('div.workspace-leaf-content[data-type="pythia"]');
	});

	it("caps the class list so Obsidian's state classes cannot swamp the report", () => {
		const el = { tagName: "DIV", className: "a b c d e f", getAttribute: () => null } as unknown as Element;
		expect(labelFor(el)).toBe("div.a.b.c.d");
	});

	it("survives an element with no classes at all", () => {
		const el = { tagName: "BODY", className: "", getAttribute: () => null } as unknown as Element;
		expect(labelFor(el)).toBe("body");
	});
});

describe("probeStrip", () => {
	const doc = (hits: Element[]) => ({ elementsFromPoint: () => hits }) as unknown as Document;
	const el = (cls: string) => ({ tagName: "DIV", className: cls, getAttribute: () => null }) as unknown as Element;

	it("returns nothing when there is no strip — an empty report means no strip", () => {
		expect(probeStrip(doc([]), 100, 800, 800)).toEqual([]);
		expect(probeStrip(doc([]), 100, 800, 800.5)).toEqual([]);
	});

	it("samples the strip end to end and names what is on top", () => {
		const probes = probeStrip(doc([el("fade"), el("drawer")]), 100, 700, 750, 5);
		expect(probes).toHaveLength(6);
		expect(probes[0].y).toBe(700);
		expect(probes[5].y).toBe(750);
		expect(probes[0].stack).toEqual(["div.fade", "div.drawer"]);
	});
});

describe("formatLayoutReport", () => {
	it("states both gaps separately — ours and the one below us", () => {
		const md = formatLayoutReport(report);
		expect(md).toContain("**40px between the composer and the panel's own bottom**");
		expect(md).toContain("**106px between the panel's bottom and the viewport's**");
	});

	it("lists every ancestor with the boxes that could create space", () => {
		const md = formatLayoutReport({
			...report,
			chain: [box("div.p-input-area", { padding: "4px 12px" }), box("div.leaf", { margin: "0px 0px 34px" })],
		});
		expect(md).toContain("`div.p-input-area`");
		expect(md).toContain("4px 12px");
		expect(md).toContain("0px 0px 34px");
	});

	it("singles out whatever paints — the gradient nobody can find in styles.css", () => {
		const md = formatLayoutReport({
			...report,
			chain: [box("div.drawer", { backgroundImage: "linear-gradient(rgba(0,0,0,0), rgb(34,34,34))" })],
		});
		expect(md).toContain("`div.drawer` — bg-image linear-gradient(rgba(0,0,0,0), rgb(34,34,34))");
	});

	it("says so plainly when no ancestor paints anything", () => {
		expect(formatLayoutReport(report)).toContain("None in the chain");
	});

	it("says so plainly when the composer reaches the viewport bottom", () => {
		expect(formatLayoutReport({ ...report, probes: [] }))
			.toContain("Nothing — the composer reaches the bottom of the viewport.");
	});
});
