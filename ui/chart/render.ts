/**
 * Drawing a chart's geometry as SVG (ADR-210).
 *
 * Three rules hold this to the plugin's own:
 *
 * - **`createSvg`, never `createEl`.** `createEl("svg")` makes an HTML element
 *   called "svg" which renders absolutely nothing and reports no error — the
 *   classic silent failure. `ui/toolbarIcons.ts` has used `createSvg` since the
 *   toolbar shipped; this is the same idiom at a larger scale, and
 *   `tests/chartRules.test.ts` fails if it is abandoned.
 * - **No colour in the markup.** Series swatches arrive as `--p-chart-cN`
 *   custom properties set on the `<svg>` root and are applied by
 *   `.p-chart-cN` rules in `styles.css`; every other stroke and fill is a class
 *   over an Obsidian token. So a theme change repaints the chart, and hard rule
 *   3 is kept without the renderer knowing any colour at all.
 * - **Classes go on via `attr`, not `cls`.** An SVG element's `className` is a
 *   read-only `SVGAnimatedString`, so the convenient option is the one that
 *   silently does nothing on some DOMs.
 *
 * The title and legend are drawn here, inside the SVG, because the exported PNG
 * is the whole point and it has to carry them.
 */

import type { ChartSpec } from "../../services/chartSpec";
import { layoutChart, FONT_LABEL, FONT_TITLE, type ChartGeometry } from "./layout";
import { onSwatchText, type ChartPalette } from "./palette";

const SVG_NS = "http://www.w3.org/2000/svg";

/** A single-series bar chart with few enough categories can carry its numbers;
 *  a grouped one cannot without becoming a table with pictures. */
const VALUE_LABEL_MAX_CATEGORIES = 12;
/** Below this share a slice has no room for its own percentage. */
const PIE_LABEL_MIN_SHARE = 0.06;

type Attrs = Record<string, string | number>;

function el<K extends keyof SVGElementTagNameMap>(
	parent: Element, tag: K, attrs: Attrs = {}, text?: string,
): SVGElementTagNameMap[K] {
	const node = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
	for (const key in attrs) node.setAttribute(key, String(attrs[key]));
	if (text !== undefined) node.textContent = text;
	parent.appendChild(node);
	return node;
}

/** What a screen reader is told. The numbers are in the block right beside it,
 *  so this describes the shape rather than reciting the data. */
function ariaLabel(spec: ChartSpec): string {
	const kind = spec.type === "pie" ? "Pie chart" : spec.type === "line" ? "Line chart" : "Bar chart";
	const names = spec.series.map((s) => s.name).join(", ");
	const head = spec.title ? `${kind}: ${spec.title}.` : `${kind}.`;
	return `${head} ${names} over ${spec.categories.length} categories.`;
}

function drawFrame(svg: SVGSVGElement, geometry: ChartGeometry): void {
	if (geometry.title) {
		el(svg, "text", {
			class: "p-chart-title",
			x: geometry.title.x, y: geometry.title.y, "font-size": FONT_TITLE,
		}, geometry.title.text);
	}
	for (const entry of geometry.legend) {
		el(svg, "rect", {
			class: `p-chart-swatch p-chart-c${entry.seriesIndex}`,
			x: entry.swatchX, y: entry.y - 5, width: 10, height: 10, rx: 2,
		});
		el(svg, "text", {
			class: "p-chart-legend", x: entry.textX, y: entry.y,
			"font-size": FONT_LABEL, "dominant-baseline": "middle",
		}, entry.name);
	}
}

function drawCartesian(svg: SVGSVGElement, spec: ChartSpec, geometry: ChartGeometry): void {
	if (geometry.kind !== "cartesian") return;
	const { plot } = geometry;

	for (const tick of geometry.valueTicks) {
		el(svg, "line", {
			class: "p-chart-grid",
			x1: plot.x, y1: tick.y, x2: plot.x + plot.w, y2: tick.y,
		});
		el(svg, "text", {
			class: "p-chart-axis", x: plot.x - 5, y: tick.y,
			"font-size": FONT_LABEL, "text-anchor": "end", "dominant-baseline": "middle",
		}, tick.label);
	}

	// The zero line is the axis a bar is read against, so it is drawn over the
	// gridlines rather than being one of them.
	el(svg, "line", {
		class: "p-chart-zero",
		x1: plot.x, y1: geometry.zeroY, x2: plot.x + plot.w, y2: geometry.zeroY,
	});

	for (const tick of geometry.categoryTicks) {
		el(svg, "text", {
			class: "p-chart-axis", x: tick.x, y: plot.y + plot.h + 14,
			"font-size": FONT_LABEL, "text-anchor": "middle",
		}, tick.label);
	}

	for (const bar of geometry.bars) {
		el(svg, "rect", {
			class: `p-chart-bar p-chart-c${bar.seriesIndex}`,
			x: bar.x, y: bar.y, width: bar.w, height: bar.h, rx: 1,
		});
	}

	const labelValues = spec.type === "bar"
		&& spec.series.length === 1
		&& spec.categories.length <= VALUE_LABEL_MAX_CATEGORIES;
	if (labelValues) {
		for (const bar of geometry.bars) {
			// Above the bar, in the muted text colour — not on the bar, which would
			// make the label's readability depend on the swatch underneath it.
			el(svg, "text", {
				class: "p-chart-value", x: bar.labelX, y: bar.labelY,
				"font-size": FONT_LABEL - 1, "text-anchor": "middle",
			}, String(bar.value) + (spec.unit ?? ""));
		}
	}

	for (const line of geometry.lines) {
		for (const segment of line.segments) {
			el(svg, "path", { class: `p-chart-line p-chart-c${line.seriesIndex}`, d: segment });
		}
		for (const dot of line.dots) {
			el(svg, "circle", {
				class: `p-chart-dot p-chart-c${line.seriesIndex}`, cx: dot.x, cy: dot.y, r: 2.5,
			});
		}
	}
}

function drawPie(svg: SVGSVGElement, geometry: ChartGeometry, palette: ChartPalette): void {
	if (geometry.kind !== "pie") return;
	for (const slice of geometry.slices) {
		el(svg, "path", {
			class: `p-chart-slice p-chart-c${slice.categoryIndex % palette.rgb.length}`,
			d: slice.d,
		});
	}
	for (const slice of geometry.slices) {
		if (slice.share < PIE_LABEL_MIN_SHARE) continue;
		const swatch = palette.rgb[slice.categoryIndex % palette.rgb.length];
		// The one label drawn ON a swatch rather than beside it, so it is the one
		// place that asks whether black or white reads on that colour (ADR-154).
		el(svg, "text", {
			class: "p-chart-slice-label", x: slice.labelX, y: slice.labelY,
			"font-size": FONT_LABEL, "text-anchor": "middle", "dominant-baseline": "middle",
			fill: onSwatchText(swatch),
		}, `${Math.round(slice.share * 100)}%`);
	}
}

/**
 * A validated spec plus the width it must fit, as an `<svg>` ready to insert.
 *
 * A pie's slices are coloured by CATEGORY — its one series is the whole chart,
 * so the thing the reader tells apart is the slice. Everywhere else the colour
 * belongs to the series.
 */
export function renderChartSvg(spec: ChartSpec, width: number, palette: ChartPalette): SVGSVGElement {
	const geometry = layoutChart(spec, width);
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("class", "p-chart-svg");
	svg.setAttribute("viewBox", `0 0 ${geometry.width} ${geometry.height}`);
	svg.setAttribute("width", String(geometry.width));
	svg.setAttribute("height", String(geometry.height));
	svg.setAttribute("role", "img");
	svg.setAttribute("aria-label", ariaLabel(spec));
	for (let i = 0; i < palette.colors.length; i++) {
		svg.style.setProperty(`--p-chart-c${i}`, palette.colors[i]);
	}

	drawFrame(svg, geometry);
	if (geometry.kind === "pie") drawPie(svg, geometry, palette);
	else drawCartesian(svg, spec, geometry);
	return svg;
}

/** How many colours a spec needs: one per slice for a pie, one per series
 *  otherwise. One rule, so the card and the renderer cannot disagree. */
export function swatchCount(spec: ChartSpec): number {
	return spec.type === "pie" ? spec.categories.length : spec.series.length;
}
