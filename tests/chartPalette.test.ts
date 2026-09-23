import { describe, it, expect } from "vitest";
import { chartPalette, hslToRgb, onSwatchText, CHART_HUES, CHART_SWATCH_MIN } from "../ui/chart/palette";
import { contrastRatio, relativeLuminance, parseRgb, type Rgb } from "../services/color";
import { THEME_GROUNDS, UI_BOUNDARY_CONTRAST, GROUNDS_MEASURED_IN } from "./fixtures/themeGrounds";

function hexToRgb(hex: string): Rgb {
	const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!m) throw new Error(`not a hex colour: ${hex}`);
	return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Every ground the fixture measures, light and dark, as one flat list. */
const GROUNDS = Object.entries(THEME_GROUNDS).flatMap(([mode, themes]) =>
	Object.entries(themes).map(([name, g]) => ({
		label: `${name} (${mode})`,
		rgb:   hexToRgb(g.background),
	})),
);

describe("the chart palette clears the UI-boundary floor", () => {
	// The number is WCAG's, not ours, and it is the same one ADR-198 used for
	// the search field's rule. Lowering a swatch fails here.
	it("uses WCAG's non-text threshold, the same one ADR-198 established", () => {
		expect(CHART_SWATCH_MIN).toBe(UI_BOUNDARY_CONTRAST);
	});

	it.each(GROUNDS)(`every swatch clears ${UI_BOUNDARY_CONTRAST}:1 on $label`, ({ rgb: ground }) => {
		const { rgb } = chartPalette(CHART_HUES.length, ground);
		const weak = rgb
			.map((swatch, i) => ({ i, cr: contrastRatio(swatch, ground) }))
			.filter((s) => s.cr < CHART_SWATCH_MIN);
		expect(weak).toEqual([]);
	});

	it(`is evidence for the themes measured in ${GROUNDS_MEASURED_IN}, not a proof for all`, () => {
		expect(GROUNDS.length).toBeGreaterThanOrEqual(4);
	});
});

describe("the chart palette separates its series", () => {
	it("keeps every pair of hues at least 30° apart", () => {
		for (let i = 0; i < CHART_HUES.length; i++) {
			for (let j = i + 1; j < CHART_HUES.length; j++) {
				const raw = Math.abs(CHART_HUES[i] - CHART_HUES[j]) % 360;
				expect(Math.min(raw, 360 - raw)).toBeGreaterThanOrEqual(30);
			}
		}
	});

	// Hue alone does not separate two series for a reader with deuteranopia, so
	// consecutive series must also differ in brightness.
	it.each(GROUNDS)("pulls consecutive series apart in brightness on $label", ({ rgb: ground }) => {
		const { rgb } = chartPalette(CHART_HUES.length, ground);
		for (let i = 1; i < rgb.length; i++) {
			expect(contrastRatio(rgb[i - 1], rgb[i])).toBeGreaterThanOrEqual(1.3);
		}
	});

	// The real property, and the reason CHART_HUES is interleaved against the
	// luminance ladder rather than sorted: ANY two series in one chart must be
	// told apart, not just the ones that happen to be adjacent.
	it.each(GROUNDS)("separates every pair by hue or by brightness on $label", ({ rgb: ground }) => {
		const { rgb } = chartPalette(CHART_HUES.length, ground);
		const weak: string[] = [];
		for (let i = 0; i < rgb.length; i++) {
			for (let j = i + 1; j < rgb.length; j++) {
				const raw = Math.abs(CHART_HUES[i] - CHART_HUES[j]) % 360;
				const hueGap = Math.min(raw, 360 - raw);
				if (hueGap < 60 && contrastRatio(rgb[i], rgb[j]) < 1.3) {
					weak.push(`${i}/${j}: ${hueGap}° apart, ${contrastRatio(rgb[i], rgb[j]).toFixed(2)}:1`);
				}
			}
		}
		expect(weak).toEqual([]);
	});

	it("darkens against a light ground and lightens against a dark one", () => {
		const onWhite = chartPalette(4, [255, 255, 255]).rgb.map(relativeLuminance);
		const onBlack = chartPalette(4, [26, 26, 26]).rgb.map(relativeLuminance);
		for (let i = 0; i < 4; i++) expect(onBlack[i]).toBeGreaterThan(onWhite[i]);
	});
});

describe("chartPalette — the mechanics", () => {
	it("returns a parseable CSS value beside every resolved swatch", () => {
		const { colors, rgb } = chartPalette(3, [255, 255, 255]);
		expect(colors).toHaveLength(3);
		expect(rgb).toHaveLength(3);
		for (let i = 0; i < 3; i++) expect(hexToRgb(colors[i])).toEqual(rgb[i]);
	});

	it("returns nothing for a count of zero or less", () => {
		expect(chartPalette(0, [255, 255, 255]).colors).toEqual([]);
		expect(chartPalette(-2, [255, 255, 255]).colors).toEqual([]);
	});

	// parseChartSpec refuses a ninth series with a reason; this is only the net.
	it("wraps rather than running out of colours", () => {
		const { colors } = chartPalette(CHART_HUES.length + 2, [255, 255, 255]);
		expect(colors).toHaveLength(CHART_HUES.length + 2);
		expect(colors[CHART_HUES.length]).toBe(colors[0]);
	});

	it("is deterministic for a ground", () => {
		expect(chartPalette(8, [255, 255, 255])).toEqual(chartPalette(8, [255, 255, 255]));
	});
});

describe("hslToRgb", () => {
	it("maps the primaries", () => {
		expect(hslToRgb(0,   1, 0.5)).toEqual([255, 0, 0]);
		expect(hslToRgb(120, 1, 0.5)).toEqual([0, 255, 0]);
		expect(hslToRgb(240, 1, 0.5)).toEqual([0, 0, 255]);
	});

	it("maps a zero saturation to grey, and wraps the hue", () => {
		expect(hslToRgb(200, 0, 0.5)).toEqual([128, 128, 128]);
		expect(hslToRgb(390, 1, 0.5)).toEqual(hslToRgb(30, 1, 0.5));
		expect(hslToRgb(-30, 1, 0.5)).toEqual(hslToRgb(330, 1, 0.5));
	});
});

describe("onSwatchText", () => {
	it("is pure black or white, never a theme token", () => {
		for (const swatch of chartPalette(8, [255, 255, 255]).rgb) {
			expect(["#ffffff", "#000000"]).toContain(onSwatchText(swatch));
		}
	});

	it("clears AA on the swatch it labels", () => {
		for (const swatch of chartPalette(8, [26, 26, 26]).rgb) {
			const label = parseRgb(onSwatchText(swatch)) ?? hexToRgb(onSwatchText(swatch));
			expect(contrastRatio(swatch, label)).toBeGreaterThanOrEqual(4.5);
		}
	});
});
