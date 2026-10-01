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
 *
 * The card shows its data two ways (ADR-254): the chart, or the table of the
 * same numbers, switched from the head row. A switch writes nothing — not the
 * message, not data.json; the session remembers it, and the pin strip keeps its
 * own per pin.
 */

import { setIcon } from "obsidian";
import { t } from "../../i18n";
import { chartAsTable, chartLabel, chartTableRows, parseChartBlock, formatChartBlock, type ChartSpec } from "../../services/chartSpec";
import { parseRgb, type Rgb } from "../../services/color";
import { appendSourceIcon } from "../icons";
import { copyBlobWithFeedback, copyTextWithFeedback } from "../clipboard";
import { decorateTables } from "../tableDecorator";
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

/** Each drawn card's canonical source, so a pin can take it (ADR-216). The card
 *  is drawn by a processor that knows nothing of pins; this is how it answers. */
const chartSources = new WeakMap<HTMLElement, string>();

/** The canonical ```pythia-chart block a drawn card shows — what its Copy source
 *  button copies. Undefined for anything that is not a drawn chart card. */
export function chartSourceOf(card: HTMLElement): string | undefined {
	return chartSources.get(card);
}

/** The two ways a card shows its data (ADR-254): the drawing, or the table of
 *  the same numbers. Nothing else changes between them — head, note, sources. */
export type ChartView = "chart" | "table";

/** What each view is drawn with: the head icon while it is shown, and the
 *  switch's icon while it is the other one — Obsidian's own reading/editing
 *  toggle shows where it goes, not where it is. */
const VIEW_ICON: Record<ChartView, string> = { chart: "bar-chart-3", table: "table" };
const COPY_TABLE_ICON = "clipboard-list";

/**
 * Fired on the card, bubbling, when the USER switches its view — never by
 * `setChartView`. It informs; it decides nothing: a surface that owns the view
 * of the cards inside it (see `CHART_VIEW_OWNER`) listens to remember it.
 */
export const CHART_VIEW_EVENT = "pythia-chart-view";
export interface ChartViewDetail { view: ChartView }

declare global {
	interface HTMLElementEventMap {
		[CHART_VIEW_EVENT]: CustomEvent<ChartViewDetail>;
	}
}

/**
 * An ancestor carrying this attribute owns the view of every card drawn inside
 * it (ADR-254) — the pin strip, which keeps each pin's own. The card STARTS in
 * the owner's view, read at draw time, so it is never drawn in another view and
 * then corrected; it keeps the attribute current on a switch; and it never reads
 * or writes the session's memory below, so a pin's view never reaches the answer
 * it came from, nor the answer's the pin.
 */
export const CHART_VIEW_OWNER = "data-chart-view";

function ownerOf(el: HTMLElement): HTMLElement | null {
	return el.closest<HTMLElement>(`[${CHART_VIEW_OWNER}]`);
}

/**
 * The view a chart was last switched to, for this session: an answer is redrawn
 * on every send and every conversation switch, and a table the user asked for
 * must not turn back into a chart under them. Keyed by WHERE the chart is as
 * well as what it holds — the answer's message id, or the note's path — so the
 * same chart in another conversation or a saved note keeps its own view. A card
 * drawn where neither is known is not remembered. Only "table" is stored —
 * "chart" is the default. Never written to disk; bounded, oldest out first;
 * cleared on unload (principle 8).
 */
const rememberedViews = new Map<string, ChartView>();
const MAX_REMEMBERED_VIEWS = 200;

/** The memory's key for a chart drawn at `el`, or null when the place is unknown. */
function memoryKey(el: HTMLElement, sourcePath: string, block: string): string | null {
	const msgId = el.closest("[data-msg-id]")?.getAttribute("data-msg-id");
	const scope = sourcePath ? `note:${sourcePath}` : msgId ? `msg:${msgId}` : null;
	return scope ? `${scope}\n${block}` : null;
}

function rememberView(key: string, view: ChartView): void {
	rememberedViews.delete(key);
	if (view === "chart") return;
	rememberedViews.set(key, view);
	if (rememberedViews.size > MAX_REMEMBERED_VIEWS) {
		rememberedViews.delete(rememberedViews.keys().next().value as string);
	}
}

/** The plugin's onunload: the session is over. */
export function forgetChartViews(): void {
	rememberedViews.clear();
}

/** Per drawn card: what switches it. A card that is not drawn (the error card)
 *  has none, and `setChartView` on it does nothing. */
const viewSwitches = new WeakMap<HTMLElement, (view: ChartView) => void>();

/** A view read from an attribute: "table", or the default. */
function viewFrom(value: string | null | undefined): ChartView {
	return value === "table" ? "table" : "chart";
}

/** The view a card shows now. Anything that is not a drawn card reads "chart".
 *  The attribute, not `instanceof HTMLElement`: a card in a popout window
 *  belongs to that window's realm, and `instanceof` would call it a chart. */
export function chartViewOf(card: Element | null | undefined): ChartView {
	return viewFrom(card?.getAttribute("data-view"));
}

/** Show `view` on a drawn card — what its own switch does, minus the event and
 *  the memory: the caller is the owner and remembers it itself. */
export function setChartView(card: HTMLElement, view: ChartView): void {
	viewSwitches.get(card)?.(view);
}

/**
 * The table view's body: the cells of `chartTableRows`, the ONE reading of a
 * chart as a table, so it matches what *Copy table* copies.
 *
 * Every cell is `text`, never Markdown: a category label is model output, and a
 * `[link](…)` or `![](…)` in it must stay the characters it is (principle 9).
 * Framed by `decorateTables` itself — the answer table's scroll frame and drag
 * to pan, one implementation — and without a pin, which marks the table
 * decorated so the answer's own sweep never frames it again or hangs a second
 * Copy and Pin on it (the trap ADR-210's addendum found with the error card).
 */
function renderTable(parent: HTMLElement, spec: ChartSpec): void {
	const { header, rows } = chartTableRows(spec);
	const table = parent.createEl("table", { cls: "p-chart-table" });
	const headRow = table.createEl("thead").createEl("tr");
	header.forEach((text, i) => {
		if (i === 0) headRow.createEl("td", { text });
		else headRow.createEl("th", { cls: "p-chart-num", text, attr: { scope: "col" } });
	});
	const tbody = table.createEl("tbody");
	for (const [category, ...values] of rows) {
		const tr = tbody.createEl("tr");
		tr.createEl("th", { text: category, attr: { scope: "row" } });
		for (const value of values) tr.createEl("td", { cls: "p-chart-num", text: value });
	}
	decorateTables(parent);
}

/**
 * Draw the block at `el`. Idempotent: every call empties and rebuilds, which is
 * also what a width change does. `sourcePath` is the note the block is in, when
 * it is in one — what the session's memory of its view is kept by there.
 */
export function renderChartCard(source: string, el: HTMLElement, sourcePath = ""): void {
	el.dataset.decorated = "1";
	el.empty();

	const parsed = parseChartBlock(source);
	if (!parsed.ok) { renderError(el, source, parsed.error); return; }
	const spec = parsed.spec;
	const block = formatChartBlock(spec);

	const card = el.createDiv({ cls: "p-chart-card" });
	chartSources.set(card, block);
	const head = card.createDiv({ cls: "p-chart-head" });
	const headIcon = head.createSpan({ cls: "p-chart-head-icon" });
	head.createSpan({ cls: "p-chart-head-label", text: chartLabel(spec) });

	const actions = head.createDiv({ cls: "p-chart-actions" });
	const body = card.createDiv({ cls: "p-chart-body" });
	renderSources(card, spec);

	const owner = ownerOf(el);
	const drawnKey = owner ? null : memoryKey(el, sourcePath, block);
	let view: ChartView = owner
		? viewFrom(owner.getAttribute(CHART_VIEW_OWNER))
		: (drawnKey && rememberedViews.get(drawnKey)) || "chart";
	let svg: SVGSVGElement | null = null;
	let ground = chartGround();

	const paint = (): void => {
		body.empty();
		svg = null;
		if (view === "table") { renderTable(body, spec); return; }
		const available = body.clientWidth || card.clientWidth || el.clientWidth || MAX_WIDTH;
		const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(available)));
		ground = chartGround();
		const palette = chartPalette(swatchCount(spec), ground.rgb);
		svg = renderChartSvg(spec, width, palette, false);
		body.appendChild(svg);
	};

	const copyImage = (btn: HTMLButtonElement): void => {
		if (!svg) return;
		// The picture has no head row, so it carries the title the screen leaves
		// to the head (ADR-236). It is drawn beside the live one, hidden, because
		// the export reads each node's computed paint — and it reads it before
		// its first await, so the node can go as soon as the promise exists.
		const titled = renderChartSvg(spec, Number(svg.getAttribute("width")) || MAX_WIDTH,
			chartPalette(swatchCount(spec), ground.rgb), true);
		titled.style.position = "absolute";
		titled.style.visibility = "hidden";
		titled.style.pointerEvents = "none";
		body.appendChild(titled);
		const blob = chartPngBlob(titled, ground.css);
		titled.remove();
		// The blob is handed over unresolved on purpose — see ui/clipboard.ts.
		void copyBlobWithFeedback(btn, "image/png", blob, {
			fallbackText:   block,
			fallbackNotice: t("chartImageCopyFallback"),
			restoreIcon:    "image",
		});
	};

	/** The copy that belongs to the view: the picture, or the table as Markdown.
	 *  Made fresh on every switch rather than relabelled, so a ✓ still flashing
	 *  from the last copy restores its icon on a button that has already gone. */
	const copyViewButton = (shown: ChartView): HTMLButtonElement => {
		const btn = createEl("button", {
			cls: "pb pb-icon p-chart-btn p-chart-copy-view",
			attr: { title: shown === "chart" ? t("chartCopyImageTooltip") : t("chartCopyTableTooltip") },
		});
		const icon = shown === "chart" ? "image" : COPY_TABLE_ICON;
		setIcon(btn, icon);
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			if (shown === "chart") copyImage(btn);
			else void copyTextWithFeedback(btn, chartAsTable(spec), icon);
		});
		return btn;
	};

	// A toggle: one name that never changes, its state in aria-pressed. The
	// tooltip says what a press does, which is what a sighted user asks.
	const viewBtn = actions.createEl("button", {
		cls: "pb pb-icon p-chart-btn p-chart-view-btn", attr: { "aria-label": t("chartTableViewLabel") },
	});
	let copyViewBtn = actions.appendChild(copyViewButton(view));
	const sourceBtn = actions.createEl("button", {
		cls: "pb pb-icon p-chart-btn", attr: { title: t("chartCopySourceTooltip") },
	});
	setIcon(sourceBtn, "copy");
	sourceBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		void copyTextWithFeedback(sourceBtn, block);
	});

	const show = (next: ChartView): void => {
		const changed = next !== view;
		view = next;
		card.dataset.view = next;
		setIcon(headIcon, VIEW_ICON[next]);
		const other: ChartView = next === "chart" ? "table" : "chart";
		setIcon(viewBtn, VIEW_ICON[other]);
		viewBtn.setAttribute("title", other === "table" ? t("chartShowTableTooltip") : t("chartShowChartTooltip"));
		viewBtn.setAttribute("aria-pressed", String(next === "table"));
		if (changed) {
			const fresh = copyViewButton(next);
			copyViewBtn.replaceWith(fresh);
			copyViewBtn = fresh;
		}
		paint();
	};
	viewSwitches.set(card, (next) => { if (next !== view) show(next); });

	viewBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		const next: ChartView = view === "chart" ? "table" : "chart";
		show(next);
		// Read again now: the card is on screen, which it may not have been when
		// it was drawn. An owner keeps the view; otherwise the session does.
		const switchOwner = ownerOf(card);
		if (switchOwner) switchOwner.setAttribute(CHART_VIEW_OWNER, next);
		else {
			const key = memoryKey(card, sourcePath, block);
			if (key) rememberView(key, next);
		}
		const detail: ChartViewDetail = { view: next };
		card.dispatchEvent(new CustomEvent(CHART_VIEW_EVENT, { bubbles: true, detail }));
	});

	show(view);

	if (typeof ResizeObserver === "function") {
		let lastWidth = body.clientWidth;
		let queued = false;
		const observer = new ResizeObserver(() => {
			const width = body.clientWidth;
			if (width === lastWidth || queued) return;
			lastWidth = width;
			// A table is not laid out to a width — rebuilding it would only lose
			// its scroll position and any selection in it.
			if (view !== "chart") return;
			queued = true;
			requestAnimationFrame(() => { queued = false; if (view === "chart") paint(); });
		});
		observer.observe(body);
	}
}
