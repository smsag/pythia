/**
 * Series colours for a chart (ADR-210).
 *
 * A chart series is the one thing on screen with no Obsidian token behind it —
 * there is no `--color-series-3` — so this is the single place in the plugin
 * allowed to name a colour. Everything else a chart draws (axes, gridlines,
 * labels) carries a class and takes its colour from `--text-faint`,
 * `--background-modifier-border` and `--text-muted` in `styles.css`.
 *
 * Two rules make that defensible rather than a licence:
 *
 * 1. **The hue is fixed, the lightness is not.** A swatch is derived against the
 *    ground it will actually sit on, so the same series is dark on a light theme
 *    and light on a dark one. Nothing is hardcoded per theme.
 * 2. **Every swatch clears 3:1 against that ground** — WCAG 2.2 §1.4.11, the
 *    boundary of a non-text user-interface component. That is the same number
 *    and the same reasoning ADR-198 established for the search field's rule, and
 *    `tests/chartPalette.test.ts` recomputes it from the measured grounds in
 *    `tests/fixtures/themeGrounds.ts`, so weakening a swatch fails.
 *
 * Series 1 is deliberately NOT `var(--color-accent)`. Hard rule 6 governs
 * accent-*coloured surfaces* — a filled button, a selected segment — and a chart
 * series is not one. The accent is user-chosen and can be any hue, so using it
 * here would collide with whichever neighbour happens to share it, in a way
 * neither Pythia nor the user could see coming.
 */

import { relativeLuminance, readableOnAccent, type Rgb } from "../../services/color";

/** WCAG 2.2 §1.4.11 — a non-text graphical object against its background. */
export const CHART_SWATCH_MIN = 3;

/**
 * Eight hues, no two closer than 30°.
 *
 * The order is not arbitrary and is not merely "spread out": it is interleaved
 * against `LUMA_RANKS` below, so that two series close on the luminance ladder
 * are far apart on the colour wheel and vice versa. Every pair is therefore
 * separated by brightness, by hue, or by both — which is the property
 * `tests/chartPalette.test.ts` actually asserts. A plain ascending list put two
 * near-black greens on the ladder's bottom two rungs.
 */
export const CHART_HUES: readonly number[] = [210, 30, 150, 330, 180, 60, 105, 285];

/**
 * Where each series sits on the luminance ladder below.
 *
 * Hue alone does not separate two series for a reader with deuteranopia or
 * protanopia — roughly 1 in 12 men — so consecutive series are also pulled apart
 * in brightness. No two neighbours here are closer than two rungs, which is what
 * puts a contrast ratio of at least 1.5:1 between any series and the next.
 */
const LUMA_RANKS: readonly number[] = [2, 6, 0, 4, 7, 3, 5, 1];

/**
 * The ladder itself, expressed in WCAG's shifted luminance (`L + 0.05`) because
 * that is the quantity contrast ratios are made of: a fixed ratio between two
 * rungs IS a fixed contrast between two series, at any point on the ladder.
 *
 * Two earlier attempts were wrong and are worth recording. Aiming at a contrast
 * ratio per series inverted on a dark theme: `#1a1a1a` sits at a luminance of
 * 0.010, so a swatch needs only L≈0.14 to clear 3.2:1 against it where the same
 * ratio against white demands L≈0.28 — the dark theme got the muddier colours of
 * the two. Ranking by HSL *lightness* instead failed differently: luminance
 * depends on hue as much as on lightness, so a yellow and a purple at the same
 * lightness came out 1.03:1 apart, which is to say indistinguishable.
 *
 * Both ends are chosen so the whole ladder clears `CHART_SWATCH_MIN` against the
 * grounds `tests/fixtures/themeGrounds.ts` measured — the light band's top rung
 * is 3.18:1 on white, the dark band's bottom rung 3.11:1 on Obsidian's dark.
 */
const BAND_ON_LIGHT = { min: 0.082, max: 0.330 };
const BAND_ON_DARK  = { min: 0.190, max: 0.800 };

const SATURATION = 0.62;

/** Enough halvings to land within a 255th of the target luminance. */
const SEARCH_STEPS = 24;

/**
 * The HSL lightness at which `hue` reaches `targetLuma`.
 *
 * Relative luminance rises monotonically with lightness at a fixed hue and
 * saturation, so a binary search always converges — and unlike a fixed lightness
 * it gives every hue the brightness the ladder asked for rather than the one its
 * own hue happens to have.
 */
function lightnessForLuma(hue: number, sat: number, targetLuma: number): number {
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < SEARCH_STEPS; i++) {
		const mid = (lo + hi) / 2;
		if (relativeLuminance(hslToRgb(hue, sat, mid)) < targetLuma) lo = mid;
		else hi = mid;
	}
	return (lo + hi) / 2;
}

/** The swatch for one series: its own hue, at the rung its rank names. */
function swatchFor(hue: number, ground: Rgb, rank: number): Rgb {
	const band = relativeLuminance(ground) < 0.5 ? BAND_ON_DARK : BAND_ON_LIGHT;
	const t = rank / (LUMA_RANKS.length - 1);
	const shifted = band.min * Math.pow(band.max / band.min, t);
	const targetLuma = Math.max(0, shifted - 0.05);
	return hslToRgb(hue, SATURATION, lightnessForLuma(hue, SATURATION, targetLuma));
}

export interface ChartPalette {
	/** CSS colour values, in series order — what goes on `--p-chart-cN`. */
	colors: string[];
	/** The same swatches resolved, for an on-bar label or a contrast assertion. */
	rgb: Rgb[];
}

function hue2rgb(p: number, q: number, t: number): number {
	let h = t;
	if (h < 0) h += 1;
	if (h > 1) h -= 1;
	if (h < 1 / 6) return p + (q - p) * 6 * h;
	if (h < 1 / 2) return q;
	if (h < 2 / 3) return p + (q - p) * (2 / 3 - h) * 6;
	return p;
}

/** HSL → sRGB. Local because this is the only module that works in hue space. */
export function hslToRgb(hDeg: number, s: number, l: number): Rgb {
	const h = (((hDeg % 360) + 360) % 360) / 360;
	if (s === 0) {
		const v = Math.round(l * 255);
		return [v, v, v];
	}
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	return [
		Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
		Math.round(hue2rgb(p, q, h) * 255),
		Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
	];
}

function toHex([r, g, b]: Rgb): string {
	return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

/**
 * `count` series colours derived against `ground`.
 *
 * `count` above `CHART_HUES.length` is not this function's problem to solve —
 * `parseChartSpec` refuses a ninth series with a reason, which is the honest
 * place for that limit. The wrap here is a safety net, not a feature.
 */
export function chartPalette(count: number, ground: Rgb): ChartPalette {
	const colors: string[] = [];
	const rgb: Rgb[] = [];
	for (let i = 0; i < Math.max(0, count); i++) {
		const swatch = swatchFor(
			CHART_HUES[i % CHART_HUES.length],
			ground,
			LUMA_RANKS[i % LUMA_RANKS.length],
		);
		rgb.push(swatch);
		colors.push(toHex(swatch));
	}
	return { colors, rgb };
}

/** An `Rgb` as a CSS value. Here rather than at the call site because this is
 *  the module colour syntax is allowed to live in — `tests/chartRules.test.ts`
 *  fails on a colour literal anywhere else under `ui/chart/`. */
export function rgbCss([r, g, b]: Rgb): string {
	return `rgb(${r}, ${g}, ${b})`;
}

/** A value label drawn ON a bar, in whichever of black or white is readable on
 *  that swatch. `readableOnAccent` with no theme tokens is exactly that question
 *  already answered (ADR-154) — never a second copy of it. */
export function onSwatchText(swatch: Rgb): string {
	return readableOnAccent(swatch, []);
}
