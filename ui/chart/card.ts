/**
 * The chart card (ADR-210) — what a ```pythia-chart block becomes.
 *
 * One function serves both places a chart can appear: the assistant answer in
 * the panel, and any note in the vault, through the code block processor
 * registered in `main.ts`. There is no second renderer for the note case, which
 * is what makes "copy the source block" worth offering at all.
 *
 * Two things are easy to get wrong here and both are guarded:
 *
 * - **`data-decorated` is set first, before anything else.** The processor names
 *   our container `.block-language-pythia-chart`, which is exactly what
 *   `decorateCodeBlocks`' diagram branch matches — and `stampSvgSize` would then
 *   pin a hard pixel width onto our SVG and undo the responsiveness below.
 *   `data-decorated` is that pass's own opt-out.
 * - **The chart is laid out to the width it is given**, not drawn at some
 *   natural size and panned. A diagram overflows because Mermaid decided how big
 *   it is (ADR-004); we decide, so there is nothing to scroll. A `ResizeObserver`
 *   re-lays it out, coalesced through `requestAnimationFrame`.
 */

import { setIcon } from "obsidian";
import { t } from "../../i18n";
import { chartLabel, parseChartBlock, formatChartBlock, type ChartSpec } from "../../services/chartSpec";
import { parseRgb, type Rgb } from "../../services/color";
import { appendSourceIcon } from "../icons";
import { copyBlobWithFeedback, copyTextWithFeedback } from "../clipboard";
import { chartPalette, rgbCss } from "./palette";
import { renderChartSvg, swatchCount } from "./render";
import { chartPngBlob } from "./export";

/** Narrower than this and an axis has no room; wider and a chart in a wide note
 *  stops being a chart and becomes a banner. */
const MIN_WIDTH = 240;
const MAX_WIDTH = 720;

const GROUND_LIGHT: Rgb = [255, 255, 255];
const GROUND_DARK:  Rgb = [26, 26, 26];

/** `rgba(…, 0)` — a body with no background of its own, which parses as black
 *  and would hand every light theme a dark palette. */
const TRANSPARENT = /rgba?\([^)]*,\s*0(\.0+)?\s*\)\s*$/;

interface Ground { rgb: Rgb; css: string }

/**
 * The colour the chart will actually sit on.
 *
 * Read from the body's own computed background first, because that is the truth
 * whatever the theme did; then Obsidian's `.theme-dark` class, the same fallback
 * ADR-198 used for the search field's rule; then a fixed pair. Never throws, and
 * never returns a value the palette cannot use.
 */
function chartGround(): Ground {
	const computed = getComputedStyle(document.body).backgroundColor ?? "";
	const parsed = TRANSPARENT.test(computed) ? null : parseRgb(computed);
	const rgb = parsed ?? (document.body.classList.contains("theme-dark") ? GROUND_DARK : GROUND_LIGHT);
	return { rgb, css: rgbCss(rgb) };
}

/** Anything with a dot and no slash reads as a domain; everything else is a
 *  vault path. The same distinction the citation markers already make. */
function sourceIsWeb(source: string): boolean {
	return !source.includes("/") && /\.[a-z]{2,}$/i.test(source);
}

function renderSources(parent: HTMLElement, spec: ChartSpec): void {
	const seen = new Set<string>();
	const sources = spec.series
		.map((s) => s.source)
		.filter((s): s is string => !!s && !seen.has(s) && !!seen.add(s));
	if (sources.length === 0 && !spec.note) return;

	const row = parent.createDiv({ cls: "p-chart-foot" });
	if (spec.note) row.createSpan({ cls: "p-chart-note", text: spec.note });
	if (sources.length === 0) return;

	// A run-in prefix, not a column (ADR-153): this row wraps, and flex wrapping
	// has no hanging indent, so a label column would align only the first line
	// while charging its width on every one.
	row.createSpan({ cls: "p-chart-foot-label", text: t("chartSourcesLabel") + " " });
	for (const source of sources) {
		const entry = row.createSpan({ cls: "p-chart-source" });
		appendSourceIcon(entry, sourceIsWeb(source) ? "web" : "note");
		entry.createSpan({ text: source });
	}
}

function renderError(el: HTMLElement, source: string, detail: string): void {
	const card = el.createDiv({ cls: "p-chart-card p-chart-card--error" });
	const head = card.createDiv({ cls: "p-chart-head" });
	setIcon(head.createSpan({ cls: "p-chart-head-icon" }), "alert-triangle");
	head.createSpan({ cls: "p-chart-head-label", text: t("chartInvalidTitle") });

	const actions = head.createDiv({ cls: "p-chart-actions" });
	const copyBtn = actions.createEl("button", {
		cls: "pb pb-icon p-chart-btn", attr: { title: t("chartCopySourceTooltip") },
	});
	setIcon(copyBtn, "copy");
	copyBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		// The data is still the user's even when Pythia cannot draw it, so the
		// copy control stays: a broken chart must never be a dead end.
		void copyTextWithFeedback(copyBtn, "```pythia-chart\n" + source + "\n```");
	});

	// The detail is the parser's own English string — the same one the model
	// receives and the same one a bug report can quote (see locales/chart.en.ts).
	card.createDiv({ cls: "p-chart-error-detail", text: detail });
	// `decorateCodeBlocks` sweeps every undecorated <pre> in the subtree and only
	// skips mermaid/plantuml ancestors, so without its own opt-out this one gets
	// framed as a code block, labelled "code" and given a second copy button
	// beside the one above it. Same mechanism the card uses on its container.
	const pre = card.createEl("pre", { cls: "p-chart-error-source", text: source });
	pre.dataset.decorated = "1";
}

/**
 * Draw the block at `el`. Idempotent: every call empties and rebuilds, which is
 * also what a width change does.
 */
/** Each drawn card's canonical source, so a pin can take it (ADR-216). The card
 *  is drawn by a processor that knows nothing of pins; this is how it answers. */
const chartSources = new WeakMap<HTMLElement, string>();

/** The canonical ```pythia-chart block a drawn card shows — what its Copy source
 *  button copies. Undefined for anything that is not a drawn chart card. */
export function chartSourceOf(card: HTMLElement): string | undefined {
	return chartSources.get(card);
}

export function renderChartCard(source: string, el: HTMLElement): void {
	el.dataset.decorated = "1";
	el.empty();

	const parsed = parseChartBlock(source);
	if (!parsed.ok) { renderError(el, source, parsed.error); return; }
	const spec = parsed.spec;

	const card = el.createDiv({ cls: "p-chart-card" });
	chartSources.set(card, formatChartBlock(spec));
	const head = card.createDiv({ cls: "p-chart-head" });
	setIcon(head.createSpan({ cls: "p-chart-head-icon" }), "bar-chart-3");
	head.createSpan({ cls: "p-chart-head-label", text: chartLabel(spec) });

	const actions = head.createDiv({ cls: "p-chart-actions" });
	const body = card.createDiv({ cls: "p-chart-body" });
	renderSources(card, spec);

	let svg: SVGSVGElement | null = null;
	let ground = chartGround();

	const paint = (): void => {
		const available = body.clientWidth || card.clientWidth || el.clientWidth || MAX_WIDTH;
		const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(available)));
		ground = chartGround();
		const palette = chartPalette(swatchCount(spec), ground.rgb);
		body.empty();
		svg = renderChartSvg(spec, width, palette);
		body.appendChild(svg);
	};

	const imageBtn = actions.createEl("button", {
		cls: "pb pb-icon p-chart-btn", attr: { title: t("chartCopyImageTooltip") },
	});
	setIcon(imageBtn, "image");
	imageBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		if (!svg) return;
		// The blob is handed over unresolved on purpose — see ui/clipboard.ts.
		void copyBlobWithFeedback(imageBtn, "image/png", chartPngBlob(svg, ground.css), {
			fallbackText:   formatChartBlock(spec),
			fallbackNotice: t("chartImageCopyFallback"),
			restoreIcon:    "image",
		});
	});

	const sourceBtn = actions.createEl("button", {
		cls: "pb pb-icon p-chart-btn", attr: { title: t("chartCopySourceTooltip") },
	});
	setIcon(sourceBtn, "copy");
	sourceBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		void copyTextWithFeedback(sourceBtn, formatChartBlock(spec));
	});

	paint();

	if (typeof ResizeObserver === "function") {
		let lastWidth = body.clientWidth;
		let queued = false;
		const observer = new ResizeObserver(() => {
			const width = body.clientWidth;
			if (width === lastWidth || queued) return;
			lastWidth = width;
			queued = true;
			requestAnimationFrame(() => { queued = false; paint(); });
		});
		observer.observe(body);
	}
}
