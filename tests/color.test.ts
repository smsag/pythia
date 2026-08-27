import { describe, it, expect } from "vitest";
import { parseRgb, relativeLuminance, contrastRatio, readableOnAccent, type Rgb } from "../services/color";

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

describe("readableOnAccent", () => {
	// Standard theme tokens: --text-on-accent = white, --text-on-accent-inverted = black.
	const std: { value: string; rgb: Rgb }[] = [
		{ value: "var(--text-on-accent, #fff)", rgb: WHITE },
		{ value: "var(--text-on-accent-inverted, #000)", rgb: BLACK },
	];

	it("keeps the white token on a dark accent", () => {
		expect(readableOnAccent([40, 30, 90], std)).toBe("var(--text-on-accent, #fff)");
	});
	it("flips to the black token on a light accent", () => {
		expect(readableOnAccent([230, 210, 120], std)).toBe("var(--text-on-accent-inverted, #000)");
	});
	it("keeps a non-white theme token when it still clears AA (theme intent preserved)", () => {
		// Dark accent, theme uses a near-white on-accent that passes AA → keep it.
		const tokens: { value: string; rgb: Rgb }[] = [{ value: "var(--text-on-accent)", rgb: [245, 245, 245] }];
		expect(readableOnAccent([30, 24, 70], tokens)).toBe("var(--text-on-accent)");
	});
	it("forces pure black/white when BOTH theme tokens read poorly (the reported bug)", () => {
		// Pale purple accent where the theme's on-accent (near-white) AND its
		// 'inverted' (a mid purple) both fail AA — the exact case the old
		// pick-the-less-bad-token logic left unreadable. Must fall back to pure.
		const paleAccent: Rgb = [200, 190, 230];
		const tokens: { value: string; rgb: Rgb }[] = [
			{ value: "onAccent", rgb: [245, 245, 245] },
			{ value: "inverted", rgb: [150, 120, 180] },
		];
		expect(readableOnAccent(paleAccent, tokens)).toBe("#000000");
	});
	it("uses the pure black/white fallback when no theme tokens are given", () => {
		expect(readableOnAccent([230, 210, 120], [])).toBe("#000000"); // light accent → black
		expect(readableOnAccent([40, 30, 90], [])).toBe("#ffffff"); // dark accent → white
	});
	it("respects a custom AA threshold", () => {
		// Mid purple where white ≈ 4.23 (< 4.5): default AA rejects the white token
		// and the fallback picks black; a relaxed threshold keeps the white token.
		const midPurple: Rgb = [124, 108, 214];
		const whiteOnly: { value: string; rgb: Rgb }[] = [{ value: "white-token", rgb: WHITE }];
		expect(readableOnAccent(midPurple, whiteOnly)).toBe("#000000");
		expect(readableOnAccent(midPurple, whiteOnly, 4)).toBe("white-token");
	});
});
