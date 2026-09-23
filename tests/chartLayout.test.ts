import { describe, it, expect } from "vitest";
import {
	layoutChart, niceTicks, axisDomain, formatTick, labelStride,
	type CartesianGeometry, type PieGeometry,
} from "../ui/chart/layout";
import { parseChartSpec, type ChartSpec } from "../services/chartSpec";

function spec(over: Record<string, unknown> = {}): ChartSpec {
	const parsed = parseChartSpec({
		type:       "bar",
		categories: ["a", "b", "c"],
		series:     [{ name: "one", values: [10, 20, 30] }],
		...over,
	});
	if (!parsed.ok) throw new Error(parsed.error);
	return parsed.spec;
}

function cartesian(s: ChartSpec, width = 420): CartesianGeometry {
	const g = layoutChart(s, width);
	if (g.kind !== "cartesian") throw new Error("expected a cartesian chart");
	return g;
}

function pie(s: ChartSpec, width = 420): PieGeometry {
	const g = layoutChart(s, width);
	if (g.kind !== "pie") throw new Error("expected a pie chart");
	return g;
}

describe("niceTicks", () => {
	it("rounds the axis outward to whole steps", () => {
		const scale = niceTicks(0, 97);
		expect(scale.min).toBeLessThanOrEqual(0);
		expect(scale.max).toBeGreaterThanOrEqual(97);
		expect(scale.values[0]).toBe(scale.min);
		expect(scale.values[scale.values.length - 1]).toBe(scale.max);
	});

	it("spaces the ticks evenly", () => {
		const { values, step } = niceTicks(0, 97);
		for (let i = 1; i < values.length; i++) {
			expect(values[i] - values[i - 1]).toBeCloseTo(step, 9);
		}
	});

	// Counted rather than accumulated: adding a step repeatedly drifts, and a
	// drifting axis shows a tick labelled 0.30000000000000004.
	it("does not accumulate floating-point drift", () => {
		for (const value of niceTicks(0, 1).values) {
			expect(String(value)).not.toMatch(/\d{8,}/);
		}
	});

	it("gives a single value room either side instead of a zero-height plot", () => {
		const scale = niceTicks(42, 42);
		expect(scale.max).toBeGreaterThan(scale.min);
		expect(scale.min).toBeLessThanOrEqual(42);
		expect(scale.max).toBeGreaterThanOrEqual(42);
	});

	it("handles an all-zero range", () => {
		const scale = niceTicks(0, 0);
		expect(scale.max).toBeGreaterThan(scale.min);
	});

	it("covers a negative range and a range straddling zero", () => {
		expect(niceTicks(-80, -10).min).toBeLessThanOrEqual(-80);
		const straddle = niceTicks(-30, 45);
		expect(straddle.min).toBeLessThanOrEqual(-30);
		expect(straddle.max).toBeGreaterThanOrEqual(45);
	});

	it("survives a reversed or non-finite range rather than throwing", () => {
		expect(niceTicks(90, 10).min).toBeLessThanOrEqual(10);
		expect(niceTicks(NaN, Infinity).values.length).toBeGreaterThan(1);
	});
});

describe("axisDomain", () => {
	// A bar's length reads as its magnitude, so an axis starting at 90 turns a
	// 2% difference into a doubling. Not left to the model's judgement.
	it("always includes zero for a bar chart", () => {
		expect(axisDomain(spec({ series: [{ name: "s", values: [95, 97, 99] }] })).lo).toBe(0);
	});

	it("includes zero from below for negative bars", () => {
		expect(axisDomain(spec({ series: [{ name: "s", values: [-5, -9, -2] }] })).hi).toBe(0);
	});

	// A line chart shows change rather than magnitude, so it keeps its own range.
	it("does not force zero for a line chart", () => {
		const domain = axisDomain(spec({ type: "line", series: [{ name: "s", values: [95, 97, 99] }] }));
		expect(domain.lo).toBe(95);
		expect(domain.hi).toBe(99);
	});

	it("sums a stacked bar's columns", () => {
		const domain = axisDomain(spec({
			stacked: true,
			series:  [{ name: "a", values: [10, 20, 30] }, { name: "b", values: [5, 5, 5] }],
		}));
		expect(domain.hi).toBe(35);
	});

	it("ignores gaps", () => {
		expect(axisDomain(spec({ type: "line", series: [{ name: "s", values: [4, null, 9] }] })))
			.toEqual({ lo: 4, hi: 9 });
	});
});

describe("formatTick", () => {
	it("keeps small numbers exact and short", () => {
		expect(formatTick(12, 1)).toBe("12");
		expect(formatTick(0.5, 0.1)).toBe("0.5");
	});

	it("abbreviates thousands, millions and billions", () => {
		expect(formatTick(20000, 5000)).toBe("20k");
		expect(formatTick(3_000_000, 1_000_000)).toBe("3M");
		expect(formatTick(2_000_000_000, 1e9)).toBe("2B");
	});

	it("appends the unit", () => {
		expect(formatTick(40, 10, "%")).toBe("40%");
	});

	it("is locale-independent — no grouping separator can differ by region", () => {
		expect(formatTick(1234, 100)).not.toMatch(/[,.]\d{3}/);
	});
});

describe("labelStride", () => {
	it("shows every label when they fit", () => {
		expect(labelStride(4, 400, 4)).toBe(1);
	});

	it("thins rather than letting labels overlap", () => {
		expect(labelStride(40, 300, 8)).toBeGreaterThan(1);
	});

	it("never returns zero, whatever it is given", () => {
		for (const args of [[0, 300, 4], [1, 0, 4], [48, 1, 40]] as [number, number, number][]) {
			expect(labelStride(...args)).toBeGreaterThanOrEqual(1);
		}
	});

	it("never strides past the number of categories", () => {
		expect(labelStride(6, 10, 30)).toBeLessThanOrEqual(6);
	});
});

describe("layoutChart — bars stay inside the plot", () => {
	const fixtures: [string, ChartSpec][] = [
		["simple",   spec()],
		["negative", spec({ series: [{ name: "s", values: [-4, 8, -2] }] })],
		["grouped",  spec({ series: [{ name: "a", values: [1, 2, 3] }, { name: "b", values: [3, 2, 1] }] })],
		["stacked",  spec({ stacked: true, series: [{ name: "a", values: [1, 2, 3] }, { name: "b", values: [3, 2, 1] }] })],
		["gaps",     spec({ series: [{ name: "s", values: [5, null, 15] }] })],
		["zeroes",   spec({ series: [{ name: "s", values: [0, 0, 7] }] })],
	];

	it.each(fixtures)("keeps every bar within the plot rect (%s)", (_name, s) => {
		for (const width of [240, 420, 720]) {
			const g = cartesian(s, width);
			for (const bar of g.bars) {
				expect(bar.x).toBeGreaterThanOrEqual(g.plot.x - 0.01);
				expect(bar.x + bar.w).toBeLessThanOrEqual(g.plot.x + g.plot.w + 0.01);
				expect(bar.y).toBeGreaterThanOrEqual(g.plot.y - 1.01);
				expect(bar.y + bar.h).toBeLessThanOrEqual(g.plot.y + g.plot.h + 1.01);
			}
		}
	});

	it("never overlaps two grouped bars in one category", () => {
		const g = cartesian(spec({
			series: [{ name: "a", values: [1, 2, 3] }, { name: "b", values: [3, 2, 1] }],
		}));
		for (let c = 0; c < 3; c++) {
			const inGroup = g.bars.filter((b) => b.categoryIndex === c).sort((a, b) => a.x - b.x);
			for (let i = 1; i < inGroup.length; i++) {
				expect(inGroup[i].x).toBeGreaterThanOrEqual(inGroup[i - 1].x + inGroup[i - 1].w - 0.01);
			}
		}
	});

	it("draws a hairline for a tiny value but nothing for a zero", () => {
		const g = cartesian(spec({ series: [{ name: "s", values: [0, 0.0001, 1000] }] }));
		const zero = g.bars.find((b) => b.categoryIndex === 0);
		const tiny = g.bars.find((b) => b.categoryIndex === 1);
		expect(zero?.h).toBe(0);
		expect(tiny?.h).toBeGreaterThanOrEqual(1);
	});

	it("skips a gap instead of drawing it as zero", () => {
		const g = cartesian(spec({ series: [{ name: "s", values: [5, null, 15] }] }));
		expect(g.bars.map((b) => b.categoryIndex)).toEqual([0, 2]);
	});
});

describe("layoutChart — lines", () => {
	it("breaks the path at a gap rather than bridging it", () => {
		const g = cartesian(spec({ type: "line", series: [{ name: "s", values: [1, null, 3] }] }));
		expect(g.lines[0].segments).toHaveLength(2);
		expect(g.lines[0].dots).toHaveLength(2);
	});

	it("starts every segment with a move", () => {
		const g = cartesian(spec({ type: "line", series: [{ name: "s", values: [1, null, 3] }] }));
		for (const segment of g.lines[0].segments) expect(segment.startsWith("M ")).toBe(true);
	});

	it("keeps every point inside the plot", () => {
		const g = cartesian(spec({ type: "line", series: [{ name: "s", values: [-3, 12, 7] }] }));
		for (const dot of g.lines[0].dots) {
			expect(dot.y).toBeGreaterThanOrEqual(g.plot.y - 0.01);
			expect(dot.y).toBeLessThanOrEqual(g.plot.y + g.plot.h + 0.01);
		}
	});

	it("draws no bars for a line chart, and no lines for a bar chart", () => {
		expect(cartesian(spec({ type: "line" })).bars).toEqual([]);
		expect(cartesian(spec()).lines).toEqual([]);
	});
});

describe("layoutChart — pie", () => {
	const pieSpec = (values: (number | null)[]) => spec({
		type: "pie", series: [{ name: "share", values }],
	});

	it("sweeps exactly one full turn", () => {
		const g = pie(pieSpec([1, 2, 3]));
		const total = g.slices.reduce((sum, s) => sum + s.share, 0);
		expect(total).toBeCloseTo(1, 9);
	});

	it("closes every arc", () => {
		for (const slice of pie(pieSpec([1, 2, 3])).slices) {
			expect(slice.d.endsWith("Z")).toBe(true);
		}
	});

	// A full-circle slice has no chord, so the naive arc path collapses to nothing.
	it("draws a single-slice pie as a whole circle, not an empty path", () => {
		const g = pie(pieSpec([0, 0, 5]));
		expect(g.slices).toHaveLength(1);
		expect(g.slices[0].share).toBeCloseTo(1, 9);
		expect(g.slices[0].d.length).toBeGreaterThan(20);
	});

	it("keeps every label inside the circle", () => {
		const g = pie(pieSpec([3, 4, 5]));
		for (const slice of g.slices) {
			const dx = slice.labelX - g.cx;
			const dy = slice.labelY - g.cy;
			expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThan(g.r);
		}
	});

	it("skips a zero or missing slice", () => {
		expect(pie(pieSpec([5, 0, null])).slices.map((s) => s.categoryIndex)).toEqual([0]);
	});
});

describe("layoutChart — the frame", () => {
	// A chart exists to be copied into a document; a picture that loses its title
	// on the way is worse than no picture, so both live inside the SVG.
	it("puts the title inside the geometry", () => {
		expect(layoutChart(spec({ title: "Revenue" }), 420).title?.text).toBe("Revenue");
		expect(layoutChart(spec(), 420).title).toBeUndefined();
	});

	it("shows a legend only when there is more than one series", () => {
		expect(layoutChart(spec(), 420).legend).toEqual([]);
		expect(layoutChart(spec({
			series: [{ name: "a", values: [1, 2, 3] }, { name: "b", values: [3, 2, 1] }],
		}), 420).legend).toHaveLength(2);
	});

	it("wraps a legend that does not fit on one row", () => {
		const many = Array.from({ length: 8 }, (_, i) => ({
			name: `a rather long series name ${i}`, values: [1, 2, 3],
		}));
		const legend = layoutChart(spec({ series: many }), 300).legend;
		expect(new Set(legend.map((e) => e.y)).size).toBeGreaterThan(1);
	});

	it("derives a positive height at every width, and grows with it", () => {
		const narrow = layoutChart(spec(), 240);
		const wide   = layoutChart(spec(), 720);
		expect(narrow.height).toBeGreaterThan(0);
		expect(wide.height).toBeGreaterThanOrEqual(narrow.height);
		expect(wide.width).toBe(720);
	});

	it("refuses to lay out below a usable width instead of producing a negative plot", () => {
		const g = cartesian(spec(), 20);
		expect(g.plot.w).toBeGreaterThan(0);
		expect(g.plot.h).toBeGreaterThan(0);
	});
});
