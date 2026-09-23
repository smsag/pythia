/**
 * Chart geometry (ADR-210) — pure arithmetic, no DOM.
 *
 * Everything a chart needs to be drawn is computed here and handed to
 * `render.ts` as plain numbers and path strings. Two things follow from that
 * split, and both are the point of it:
 *
 * - the layout can be unit-tested without a DOM, which is where the bugs are
 *   (a bar escaping its plot, a pie whose arcs do not close, an axis that lies);
 * - re-laying out at a new width is just calling this again, which is what lets
 *   a chart be responsive instead of sitting in a pan-scroll frame like a
 *   diagram whose size someone else decided (ADR-004).
 *
 * Title and legend are laid out INSIDE the SVG, not around it in HTML. A chart
 * exists to be copied into a document, and a picture that loses its title on the
 * way is worse than no picture.
 */

import type { ChartSpec } from "../../services/chartSpec";

export interface Rect { x: number; y: number; w: number; h: number }

export interface ValueTick { value: number; label: string; y: number }
export interface CategoryTick { index: number; label: string; x: number }
export interface LegendEntry { seriesIndex: number; name: string; swatchX: number; textX: number; y: number }

export interface BarRect {
	seriesIndex: number; categoryIndex: number;
	x: number; y: number; w: number; h: number;
	value: number; labelX: number; labelY: number;
}
export interface LineGeometry { seriesIndex: number; segments: string[]; dots: { x: number; y: number }[] }
export interface PieSlice {
	categoryIndex: number; d: string; value: number; share: number;
	labelX: number; labelY: number;
}

interface CommonGeometry {
	width: number; height: number;
	title?: { text: string; x: number; y: number };
	legend: LegendEntry[];
}
export interface CartesianGeometry extends CommonGeometry {
	kind: "cartesian";
	plot: Rect;
	valueTicks: ValueTick[];
	categoryTicks: CategoryTick[];
	bars: BarRect[];
	lines: LineGeometry[];
	zeroY: number;
}
export interface PieGeometry extends CommonGeometry {
	kind: "pie";
	cx: number; cy: number; r: number;
	slices: PieSlice[];
}
export type ChartGeometry = CartesianGeometry | PieGeometry;

export const FONT_LABEL = 11;
export const FONT_TITLE = 13;
/** Average glyph advance as a fraction of font size, for the interface font.
 *  An estimate on purpose: measuring text needs a DOM, and this module stays
 *  pure so the geometry can be tested. Over-estimating only widens a margin. */
const CHAR_W = 0.58;

const PAD          = 8;
const TITLE_H      = 22;
const LEGEND_ROW_H = 18;
const SWATCH_W     = 10;
const AXIS_BOTTOM  = 20;
const AXIS_RIGHT   = 10;
const TICK_TARGET  = 5;
const PLOT_RATIO   = 0.52;
const PLOT_MIN_H   = 120;
const PLOT_MAX_H   = 420;

function textWidth(text: string, fontSize = FONT_LABEL): number {
	return text.length * fontSize * CHAR_W;
}

/** Heckbert's "nice numbers": 1, 2, 5 or 10 times a power of ten. */
function niceNum(range: number, round: boolean): number {
	if (!(range > 0)) return 1;
	const exp = Math.floor(Math.log10(range));
	const f = range / Math.pow(10, exp);
	let nf: number;
	if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
	else       nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
	return nf * Math.pow(10, exp);
}

/** Round a value to the precision its own step implies, so 0.30000000000000004
 *  never reaches an axis label. */
function quantize(value: number, step: number): number {
	const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
	return Number(value.toFixed(Math.min(decimals, 12)));
}

export interface NiceScale { min: number; max: number; step: number; values: number[] }

/** A rounded axis covering [lo, hi]. An empty or degenerate range still yields a
 *  usable axis: a single value is given room either side rather than collapsing
 *  the plot to a line of height zero. */
export function niceTicks(lo: number, hi: number, target = TICK_TARGET): NiceScale {
	let low = Number.isFinite(lo) ? lo : 0;
	let high = Number.isFinite(hi) ? hi : 0;
	if (high < low) [low, high] = [high, low];
	if (high === low) {
		const pad = Math.abs(high) > 0 ? Math.abs(high) * 0.5 : 1;
		low -= pad;
		high += pad;
	}
	const step = niceNum(niceNum(high - low, false) / Math.max(1, target - 1), true);
	const min = Math.floor(low / step) * step;
	const max = Math.ceil(high / step) * step;
	const values: number[] = [];
	// Counted rather than accumulated: adding `step` repeatedly drifts, and a
	// drifting axis shows a tick at 0.30000000000000004.
	const count = Math.round((max - min) / step);
	for (let i = 0; i <= count; i++) values.push(quantize(min + i * step, step));
	return { min: quantize(min, step), max: quantize(max, step), step, values };
}

/**
 * The value range an axis must cover.
 *
 * A bar chart always includes zero. A bar's length is read as its magnitude, so
 * an axis that starts at 90 turns a 2% difference into a doubling — the classic
 * misleading chart, and not something to leave to the model's judgement. A line
 * chart shows change rather than magnitude, so it keeps its own range.
 */
export function axisDomain(spec: ChartSpec): { lo: number; hi: number } {
	let lo = Infinity;
	let hi = -Infinity;
	if (spec.type === "bar" && spec.stacked) {
		for (let c = 0; c < spec.categories.length; c++) {
			let pos = 0;
			let neg = 0;
			for (const s of spec.series) {
				const v = s.values[c];
				if (v === null || v === undefined) continue;
				if (v >= 0) pos += v; else neg += v;
			}
			lo = Math.min(lo, neg);
			hi = Math.max(hi, pos);
		}
	} else {
		for (const s of spec.series) {
			for (const v of s.values) {
				if (v === null || v === undefined) continue;
				lo = Math.min(lo, v);
				hi = Math.max(hi, v);
			}
		}
	}
	if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1 };
	if (spec.type === "bar") { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
	return { lo, hi };
}

/** An axis label: short, and locale-independent by construction (ADR-139's rule
 *  for dates, for the same reason — these sit on a fixed pixel budget). */
export function formatTick(value: number, step: number, unit?: string): string {
	const abs = Math.abs(value);
	let text: string;
	if (abs >= 1e9)      text = quantize(value / 1e9, Math.max(step / 1e9, 0.1)) + "B";
	else if (abs >= 1e6) text = quantize(value / 1e6, Math.max(step / 1e6, 0.1)) + "M";
	else if (abs >= 1e4) text = quantize(value / 1e3, Math.max(step / 1e3, 0.1)) + "k";
	else                 text = String(quantize(value, step));
	return unit ? text + unit : text;
}

/**
 * Show every nth category label, so they never overlap.
 *
 * Thinning rather than scrolling: the chart is drawn at the width it was given
 * (see the module header), so the labels have to fit that width rather than the
 * width forcing a scrollbar.
 */
export function labelStride(count: number, plotWidth: number, longestLabel: number): number {
	if (count <= 1 || plotWidth <= 0) return 1;
	const slot = plotWidth / count;
	const needed = longestLabel * FONT_LABEL * CHAR_W + 6;
	if (needed <= slot) return 1;
	return Math.min(count, Math.max(2, Math.ceil(needed / slot)));
}

function legendLayout(spec: ChartSpec, width: number, top: number): { entries: LegendEntry[]; height: number } {
	if (spec.series.length < 2) return { entries: [], height: 0 };
	const entries: LegendEntry[] = [];
	let x = PAD;
	let row = 0;
	for (let i = 0; i < spec.series.length; i++) {
		const w = SWATCH_W + 4 + textWidth(spec.series[i].name) + 14;
		if (x > PAD && x + w > width - PAD) { row++; x = PAD; }
		entries.push({
			seriesIndex: i,
			name:        spec.series[i].name,
			swatchX:     x,
			textX:       x + SWATCH_W + 4,
			y:           top + row * LEGEND_ROW_H + LEGEND_ROW_H / 2,
		});
		x += w;
	}
	return { entries, height: (row + 1) * LEGEND_ROW_H };
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
	// A slice covering the whole circle has no chord to draw an arc across, so it
	// is drawn as two half-arcs; without this the path collapses to nothing and
	// a single-category pie renders empty.
	if (to - from >= Math.PI * 2 - 1e-9) {
		return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
	}
	const x1 = cx + r * Math.cos(from), y1 = cy + r * Math.sin(from);
	const x2 = cx + r * Math.cos(to),   y2 = cy + r * Math.sin(to);
	const large = to - from > Math.PI ? 1 : 0;
	return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

function layoutPie(spec: ChartSpec, width: number, headTop: number, legendH: number): PieGeometry {
	const values = spec.series[0].values;
	let total = 0;
	for (const v of values) if (v !== null && v !== undefined) total += v;

	const top = headTop + legendH + PAD;
	const r = Math.max(40, Math.min((width - PAD * 2) / 2, 150));
	const cx = width / 2;
	const cy = top + r;

	const slices: PieSlice[] = [];
	// Start at twelve o'clock and run clockwise, the direction a pie is read in.
	let angle = -Math.PI / 2;
	for (let i = 0; i < values.length; i++) {
		const value = values[i];
		if (value === null || value === undefined || value <= 0) continue;
		const share = total > 0 ? value / total : 0;
		const sweep = share * Math.PI * 2;
		const mid = angle + sweep / 2;
		slices.push({
			categoryIndex: i,
			d:             arcPath(cx, cy, r, angle, angle + sweep),
			value,
			share,
			labelX:        cx + Math.cos(mid) * r * 0.66,
			labelY:        cy + Math.sin(mid) * r * 0.66,
		});
		angle += sweep;
	}
	return {
		kind: "pie", width, height: cy + r + PAD,
		cx, cy, r, slices, legend: [],
	};
}

function layoutCartesian(
	spec: ChartSpec, width: number, headTop: number, legendH: number,
): CartesianGeometry {
	const { lo, hi } = axisDomain(spec);
	const scale = niceTicks(lo, hi);
	const unit = spec.unit;

	let axisLeft = 0;
	for (const v of scale.values) {
		axisLeft = Math.max(axisLeft, textWidth(formatTick(v, scale.step, unit)));
	}
	axisLeft = Math.ceil(axisLeft) + PAD;

	const plotTop = headTop + legendH + PAD;
	const plotH = Math.round(Math.min(PLOT_MAX_H, Math.max(PLOT_MIN_H, width * PLOT_RATIO)));
	const plot: Rect = {
		x: axisLeft,
		y: plotTop,
		w: Math.max(40, width - axisLeft - AXIS_RIGHT),
		h: plotH,
	};

	const span = scale.max - scale.min || 1;
	const toY = (v: number): number => plot.y + plot.h * (1 - (v - scale.min) / span);
	const zeroY = Math.min(plot.y + plot.h, Math.max(plot.y, toY(0)));

	const valueTicks: ValueTick[] = scale.values.map((value) => ({
		value, label: formatTick(value, scale.step, unit), y: toY(value),
	}));

	const groups = spec.categories.length;
	const groupW = plot.w / groups;
	const longest = spec.categories.reduce((m, c) => Math.max(m, c.length), 0);
	const stride = labelStride(groups, plot.w, longest);
	const categoryTicks: CategoryTick[] = [];
	for (let i = 0; i < groups; i++) {
		if (i % stride !== 0) continue;
		categoryTicks.push({ index: i, label: spec.categories[i], x: plot.x + groupW * (i + 0.5) });
	}

	const bars: BarRect[] = [];
	const lines: LineGeometry[] = [];

	if (spec.type === "bar") {
		const bandW = groupW * 0.74;
		const barW = spec.stacked ? bandW : Math.max(1, bandW / spec.series.length);
		const stackTops = new Array<number>(groups).fill(0);
		for (let s = 0; s < spec.series.length; s++) {
			for (let c = 0; c < groups; c++) {
				const value = spec.series[s].values[c];
				if (value === null || value === undefined) continue;
				const x = spec.stacked
					? plot.x + groupW * c + (groupW - bandW) / 2
					: plot.x + groupW * c + (groupW - bandW) / 2 + barW * s;
				const base = spec.stacked ? stackTops[c] : 0;
				const yTop = toY(base + value);
				const yBase = spec.stacked ? toY(base) : zeroY;
				if (spec.stacked) stackTops[c] += value;
				const y = Math.min(yTop, yBase);
				// A non-zero value always paints at least a hairline; a bar that
				// rounds to nothing reads as missing data, which it is not.
				const h = Math.max(value === 0 ? 0 : 1, Math.abs(yBase - yTop));
				bars.push({
					seriesIndex: s, categoryIndex: c, x, y, w: barW, h, value,
					labelX: x + barW / 2, labelY: y - 3,
				});
			}
		}
	} else {
		for (let s = 0; s < spec.series.length; s++) {
			const segments: string[] = [];
			const dots: { x: number; y: number }[] = [];
			let current: string[] = [];
			for (let c = 0; c < groups; c++) {
				const value = spec.series[s].values[c];
				if (value === null || value === undefined) {
					// A gap breaks the line rather than being bridged: joining across
					// a missing year would draw a trend nobody reported.
					if (current.length) segments.push(current.join(" "));
					current = [];
					continue;
				}
				const x = plot.x + groupW * (c + 0.5);
				const y = toY(value);
				current.push(`${current.length === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
				dots.push({ x, y });
			}
			if (current.length) segments.push(current.join(" "));
			lines.push({ seriesIndex: s, segments, dots });
		}
	}

	return {
		kind: "cartesian", width, height: plot.y + plot.h + AXIS_BOTTOM,
		plot, valueTicks, categoryTicks, bars, lines, zeroY, legend: [],
	};
}

/** The one entry point: a validated spec plus the width it has to fit. */
export function layoutChart(spec: ChartSpec, width: number): ChartGeometry {
	const w = Math.max(200, Math.round(width));
	const headTop = spec.title ? TITLE_H : PAD;
	const { entries, height: legendH } = legendLayout(spec, w, headTop);

	const geometry = spec.type === "pie"
		? layoutPie(spec, w, headTop, legendH)
		: layoutCartesian(spec, w, headTop, legendH);

	geometry.legend = entries;
	if (spec.title) geometry.title = { text: spec.title, x: PAD, y: FONT_TITLE + 2 };
	return geometry;
}
