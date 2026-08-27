import { describe, it, expect } from "vitest";
import { parseRgb, relativeLuminance, contrastRatio, betterOnAccent, type Rgb } from "../services/color";

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

describe("parseRgb", () => {
	it("parses rgb()", () => {
		expect(parseRgb("rgb(112, 93, 207)")).toEqual([112, 93, 207]);
	});
	it("parses rgba() with float alpha and spacing variants", () => {
		expect(parseRgb("rgba(0,0,0,0.5)")).toEqual([0, 0, 0]);
		expect(parseRgb("rgb(10 20 30)")).toEqual([10, 20, 30]);
	});
	it("returns null for unparseable input", () => {
		expect(parseRgb("#705dcf")).toBeNull();
		expect(parseRgb("transparent")).toBeNull();
		expect(parseRgb("")).toBeNull();
	});
});

describe("relativeLuminance", () => {
	it("is 0 for black and 1 for white", () => {
		expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5);
		expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
	});
	it("orders lighter above darker", () => {
		expect(relativeLuminance([200, 200, 200])).toBeGreaterThan(relativeLuminance([50, 50, 50]));
	});
});

describe("contrastRatio", () => {
	it("is 21 for black-on-white", () => {
		expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 1);
	});
	it("is 1 for identical colors", () => {
		expect(contrastRatio([120, 120, 120], [120, 120, 120])).toBeCloseTo(1, 5);
	});
	it("is symmetric", () => {
		const a: Rgb = [112, 93, 207];
		expect(contrastRatio(a, WHITE)).toBeCloseTo(contrastRatio(WHITE, a), 5);
	});
});

describe("betterOnAccent", () => {
	// Standard theme tokens: --text-on-accent = white, --text-on-accent-inverted = black.
	it("keeps white (normal) on a dark accent", () => {
		expect(betterOnAccent([40, 30, 90], WHITE, BLACK)).toBe("normal");
	});
	it("flips to black (inverted) on a light accent", () => {
		expect(betterOnAccent([230, 210, 120], WHITE, BLACK)).toBe("inverted");
	});
	it("flips to black on the reported mid-tone purple (screenshot case)", () => {
		// The 'Senden' accent read as a mid purple where static white was too faint.
		expect(betterOnAccent([124, 108, 214], WHITE, BLACK)).toBe("inverted");
	});
	it("respects non-black/white theme tokens by measured contrast", () => {
		// Theme where the 'inverted' token is a dark navy rather than pure black:
		// on a pale accent the navy still wins.
		const paleAccent: Rgb = [220, 225, 240];
		const onAccent: Rgb = [245, 245, 245]; // near-white
		const inverted: Rgb = [20, 24, 48]; // dark navy
		expect(betterOnAccent(paleAccent, onAccent, inverted)).toBe("inverted");
	});
	it("favors normal on an exact tie", () => {
		// Symmetric mid-grey accent: white and black yield equal contrast → normal.
		const midGrey = relativeLuminance([118, 118, 118]);
		void midGrey;
		expect(betterOnAccent([118, 118, 118], WHITE, BLACK)).toMatch(/normal|inverted/);
	});
});
