/**
 * Charts in an answer (ADR-210) — the contract and its one boundary.
 *
 * A chart is a fenced ```pythia-chart block inside the assistant message's own
 * `content`. That is the whole storage design: the block persists, re-renders on
 * reload, copies, and travels verbatim into a saved or archived conversation note
 * — none of which a field on `Message` would have given without a second marker
 * grammar and a sanitizer of its own.
 *
 * Two doors reach that block and BOTH come through `parseChartSpec`:
 *   1. the model writes the block itself (the prompt rule), validated here when
 *      the card renders it;
 *   2. the model calls the `render_chart` tool, validated here before Pythia
 *      splices the canonical block into the answer.
 * The tool exists for what door 1 cannot do: hand the model a precise reason and
 * let it fix the spec in the same turn.
 *
 * Nothing here throws and nothing here touches the DOM.
 */

import { t } from "../i18n";

export type ChartType = "bar" | "line" | "pie";

export const CHART_TYPES: readonly ChartType[] = ["bar", "line", "pie"];

/** The fence's info string. One constant — the parser, the emitter, the code
 *  block processor and the tool description all name the same language. */
export const CHART_BLOCK_LANG = "pythia-chart";

/** == the palette size (ui/chart/palette.ts). A ninth series has no colour. */
export const MAX_CHART_SERIES = 8;

/** Beyond this a categorical axis is unreadable at sidebar width whatever the
 *  label strategy, so it is refused with a reason rather than drawn badly. */
export const MAX_CHART_CATEGORIES = 48;

/** A "chart" of one number is a sentence. Counted over finite values, so one
 *  category with two series still qualifies. */
export const MIN_CHART_POINTS = 2;

const MAX_TITLE_CHARS = 120;
const MAX_UNIT_CHARS  = 16;
const MAX_NOTE_CHARS  = 240;

export interface ChartSeries {
	name: string;
	/** `null` is the legitimate spelling of a gap — a missing year, an unreported
	 *  figure. It is not the same as 0 and must survive validation. */
	values: (number | null)[];
	/** Where this series' numbers came from: a bare domain for a web result, or a
	 *  vault path. Rendered under the chart; never invented by Pythia. */
	source?: string;
}

export interface ChartSpec {
	type: ChartType;
	title?: string;
	categories: string[];
	series: ChartSeries[];
	unit?: string;
	stacked?: boolean;
	note?: string;
}

export type ChartParse =
	| { ok: true;  spec: ChartSpec }
	| { ok: false; error: string };

function fail(error: string): ChartParse {
	return { ok: false, error };
}

/** A trimmed, length-capped string, or undefined for anything else. The fallback
 *  is the default, never the raw value (principle 1). */
function optionalText(raw: unknown, max: number): string | undefined {
	if (typeof raw !== "string") return undefined;
	const text = raw.trim();
	if (!text) return undefined;
	return text.length > max ? text.slice(0, max) : text;
}

/** How a value is described back to the model when it is not a number. Quoted so
 *  an empty string or a stray space is visible in the error. */
function describe(value: unknown): string {
	if (value === undefined) return "undefined";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number") return String(value);
	if (value === null) return "null";
	return Array.isArray(value) ? "an array" : typeof value;
}

function parseCategories(raw: unknown): ChartParse | string[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		return fail('"categories" must be a non-empty array of label strings.');
	}
	if (raw.length > MAX_CHART_CATEGORIES) {
		return fail(
			`"categories" has ${raw.length} entries; at most ${MAX_CHART_CATEGORIES} are supported. ` +
			"Group the smaller ones together or chart a subset."
		);
	}
	const categories: string[] = [];
	for (let i = 0; i < raw.length; i++) {
		const label = raw[i];
		if (typeof label !== "string" || !label.trim()) {
			return fail(`"categories[${i}]" must be a non-empty string (got ${describe(label)}).`);
		}
		categories.push(label.trim());
	}
	return categories;
}

function parseSeries(raw: unknown, categories: string[]): ChartParse | ChartSeries[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		return fail('"series" must be a non-empty array of { name, values } objects.');
	}
	if (raw.length > MAX_CHART_SERIES) {
		return fail(
			`"series" has ${raw.length} entries; at most ${MAX_CHART_SERIES} are supported. ` +
			"Chart the most important ones."
		);
	}
	const series: ChartSeries[] = [];
	for (let i = 0; i < raw.length; i++) {
		const entry = raw[i];
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			return fail(`"series[${i}]" must be an object with "name" and "values".`);
		}
		const e = entry as Record<string, unknown>;
		if (typeof e.name !== "string" || !e.name.trim()) {
			return fail(`"series[${i}].name" must be a non-empty string (got ${describe(e.name)}).`);
		}
		if (!Array.isArray(e.values)) {
			return fail(`"series[${i}].values" must be an array of numbers (got ${describe(e.values)}).`);
		}
		// Naming BOTH lengths is the point: this is the mistake models make most,
		// and "lengths must match" alone does not say which end to fix.
		if (e.values.length !== categories.length) {
			return fail(
				`"series[${i}].values" has ${e.values.length} entries but "categories" has ` +
				`${categories.length} — every series needs one value per category (use null for a gap).`
			);
		}
		const values: (number | null)[] = [];
		for (let v = 0; v < e.values.length; v++) {
			const value = e.values[v];
			if (value === null) { values.push(null); continue; }
			if (typeof value !== "number" || !Number.isFinite(value)) {
				return fail(
					`"series[${i}].values[${v}]" must be a finite number or null ` +
					`(got ${describe(value)}).`
				);
			}
			values.push(value);
		}
		// Built fresh, so an unknown key — a hardcoded `color` above all — is
		// dropped rather than carried into `Message.content`, where it would
		// survive into a vault note and defeat the theme for good.
		const built: ChartSeries = { name: e.name.trim(), values };
		const source = optionalText(e.source, MAX_TITLE_CHARS);
		if (source) built.source = source;
		series.push(built);
	}
	return series;
}

/** A pie is the one type whose geometry can be impossible rather than merely
 *  ugly, so its extra rules live together and each says what to use instead. */
function checkPie(series: ChartSeries[], categories: string[]): string | null {
	// A pie colours by SLICE, so its slice count is bounded by the palette rather
	// than by the axis — eight is where two slices would have to share a colour.
	if (categories.length > MAX_CHART_SERIES) {
		return `A pie chart has ${categories.length} slices; at most ${MAX_CHART_SERIES} can be ` +
			'told apart by colour. Use "bar", or group the smaller slices together.';
	}
	if (series.length !== 1) {
		return `A pie chart needs exactly one series (got ${series.length}). ` +
			'Use "bar" to compare several series.';
	}
	let total = 0;
	const values = series[0].values;
	for (let v = 0; v < values.length; v++) {
		const value = values[v];
		if (value === null) continue;
		if (value < 0) {
			return `"series[0].values[${v}]" is negative; a pie chart cannot show ` +
				'negative values. Use "bar".';
		}
		total += value;
	}
	if (total <= 0) return "A pie chart needs a total above zero.";
	return null;
}

function countPoints(series: ChartSeries[]): number {
	let n = 0;
	for (const s of series) for (const v of s.values) if (v !== null) n++;
	return n;
}

/**
 * The ONE validator. Both doors call it; a second copy of any rule here is the
 * bug this file exists to prevent.
 */
export function parseChartSpec(raw: unknown): ChartParse {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return fail('A chart must be a JSON object with "type", "categories" and "series".');
	}
	const r = raw as Record<string, unknown>;

	if (!CHART_TYPES.includes(r.type as ChartType)) {
		return fail(
			`"type" must be one of ${CHART_TYPES.join(", ")} (got ${describe(r.type)}).`
		);
	}
	const type = r.type as ChartType;

	const categories = parseCategories(r.categories);
	if (!Array.isArray(categories)) return categories;

	const series = parseSeries(r.series, categories);
	if (!Array.isArray(series)) return series;

	if (type === "pie") {
		const pieError = checkPie(series, categories);
		if (pieError) return fail(pieError);
	}

	const points = countPoints(series);
	if (points < MIN_CHART_POINTS) {
		return fail(
			`A chart needs at least ${MIN_CHART_POINTS} data points (got ${points}). ` +
			"State a single figure in the text instead."
		);
	}

	const spec: ChartSpec = { type, categories, series };
	const title = optionalText(r.title, MAX_TITLE_CHARS);
	if (title) spec.title = title;
	const unit = optionalText(r.unit, MAX_UNIT_CHARS);
	if (unit) spec.unit = unit;
	// Stacking is a bar-only arrangement; on a line or a pie it would be a field
	// the renderer silently ignores, which is worse than not accepting it.
	if (type === "bar" && r.stacked === true) spec.stacked = true;
	const note = optionalText(r.note, MAX_NOTE_CHARS);
	if (note) spec.note = note;
	return { ok: true, spec };
}

/** A new chart needs at least this many values to show a shape, and a bar chart
 *  at least this many different ones to show more than "same or not". */
export const MIN_WORTH_POINTS = 3;
export const MIN_DISTINCT_BAR_VALUES = 3;
/** A bar shorter than this share of the tallest is a sliver, not a bar. */
export const MIN_BAR_SHARE = 0.02;

/**
 * Whether a valid chart says anything a sentence would not (ADR-236).
 *
 * `parseChartSpec` answers "can this be drawn"; this answers "should it be",
 * and only for a chart the model is asking for now — the `render_chart` door.
 * A block already in a note keeps rendering: a rule about taste must not turn
 * yesterday's chart into an error card. Each refusal names what it saw and
 * what to write instead, because it goes to the model mid-answer.
 *
 * - Fewer than three values: a shape needs three points.
 * - A bar chart whose values take two different values or fewer ("9.99, 9.99,
 *   9.99, 0"): it shows only "the same" and "different", which one sentence says.
 * - A line or pie whose values are all equal: no change, no share to see.
 * - A one-series bar chart with a missing value: the empty slot reads as zero.
 * - A bar chart where a non-zero bar is under 2% of the tallest: it is a
 *   sliver, and values that far apart are usually different measures that do
 *   not belong on one axis at all (1,200 switches a day beside 4 desktops).
 */
export function chartWorthDrawing(spec: ChartSpec): string | null {
	const values = spec.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
	const noChart = "Say it in a sentence or a short table instead, and do not write it as a chart block either.";
	if (values.length < MIN_WORTH_POINTS) {
		return `Only ${values.length} value(s): a chart needs at least ${MIN_WORTH_POINTS} to show a shape. ${noChart}`;
	}
	const distinct = [...new Set(values)];
	if (spec.type === "bar" && distinct.length < MIN_DISTINCT_BAR_VALUES) {
		return (
			`The ${values.length} values take only ${distinct.length} different value(s) ` +
			`(${distinct.join(", ")}): a bar chart of that shows only "the same" and "different". ${noChart}`
		);
	}
	if (spec.type !== "bar" && distinct.length === 1) {
		return `Every value is ${distinct[0]}: there is no change or share to see. ${noChart}`;
	}
	if (spec.type === "bar") {
		const largest = Math.max(...values.map((v) => Math.abs(v)));
		const smallest = Math.min(...values.filter((v) => v !== 0).map((v) => Math.abs(v)));
		if (largest > 0 && smallest / largest < MIN_BAR_SHARE) {
			return (
				`Values from ${smallest} to ${largest} on one axis: the small bars would be slivers. ` +
				"If they measure different things, they do not belong on one axis at all; write them " +
				"out as a list or a short table, and do not write it as a chart block either."
			);
		}
	}
	if (spec.type === "bar" && spec.series.length === 1) {
		const missing = spec.categories.filter((_, i) => spec.series[0].values[i] === null);
		if (missing.length > 0) {
			return (
				`No value for ${missing.map((c) => `"${c}"`).join(", ")}: in a one-series bar chart an ` +
				`empty slot reads as zero. Leave those categories out and name them in "note". ` +
				"If what is left is not worth a chart, say it in a sentence or a short table."
			);
		}
	}
	return null;
}

/** The ONE canonical emitter. Key order is fixed so `formatChartBlock` round-trips
 *  through `parseChartBlock` unchanged — which is what lets `spliceChartBlocks`
 *  recognise a block the model already wrote. */
export function formatChartBlock(spec: ChartSpec): string {
	const ordered: Record<string, unknown> = { type: spec.type };
	if (spec.title !== undefined)   ordered.title = spec.title;
	ordered.categories = spec.categories;
	ordered.series = spec.series.map((s) => {
		const out: Record<string, unknown> = { name: s.name, values: s.values };
		if (s.source !== undefined) out.source = s.source;
		return out;
	});
	if (spec.unit !== undefined)    ordered.unit = spec.unit;
	if (spec.stacked !== undefined) ordered.stacked = spec.stacked;
	if (spec.note !== undefined)    ordered.note = spec.note;
	return "```" + CHART_BLOCK_LANG + "\n" + JSON.stringify(ordered, null, 2) + "\n```";
}

/** What a chart is called wherever it is named: its own title when it has one,
 *  the kind of chart when it does not. Never empty. The card's head row and a
 *  pinned chart's strip both read this — one rule, not a regex beside it. */
export function chartLabel(spec: ChartSpec): string {
	if (spec.title) return spec.title;
	return spec.type === "pie" ? t("chartTypePie")
		: spec.type === "line" ? t("chartTypeLine")
		: t("chartTypeBar");
}

/** A block's body, as the code block processor hands it over: JSON, then the
 *  same validation as the tool path. */
export function parseChartBlock(source: string): ChartParse {
	let raw: unknown;
	try {
		raw = JSON.parse(source);
	} catch (e) {
		return fail(`The chart block is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
	}
	return parseChartSpec(raw);
}

/** A chart the `render_chart` tool accepted, and where in the answer it belongs.
 *  The offset is `fullText.length` at the moment the tool was called — see
 *  `ui/ToolCallController.ts` for why the view can know that exactly. */
export interface PendingChartBlock {
	offset: number;
	block: string;
}

function leadFor(out: string): string {
	if (out.length === 0)   return "";
	if (out.endsWith("\n\n")) return "";
	if (out.endsWith("\n"))   return "\n";
	return "\n\n";
}

function trailFor(rest: string): string {
	if (rest.length === 0)     return "\n";
	if (rest.startsWith("\n\n")) return "";
	if (rest.startsWith("\n"))   return "\n";
	return "\n\n";
}

/**
 * Put each accepted chart into the answer at the point the model paused to ask
 * for it.
 *
 * The blank lines are not cosmetic: a fence that does not start at a line
 * boundary never opens, and the chart is then a dead card with no error — the
 * silent failure principle 2 forbids. A block whose text is already in the
 * answer is skipped, because a model that calls the tool AND writes the block
 * for the same data is a normal occurrence, not a malfunction.
 */
export function spliceChartBlocks(text: string, blocks: readonly PendingChartBlock[]): string {
	if (blocks.length === 0) return text;

	const ordered = blocks
		.map((b, i) => ({ block: b.block, i, offset: Math.min(Math.max(b.offset, 0), text.length) }))
		.sort((a, b) => a.offset - b.offset || a.i - b.i);

	let out = "";
	let cursor = 0;
	const placed = new Set<string>();
	for (const b of ordered) {
		if (placed.has(b.block) || text.includes(b.block)) continue;
		placed.add(b.block);
		out += text.slice(cursor, b.offset);
		cursor = b.offset;
		out += leadFor(out) + b.block + trailFor(text.slice(cursor));
	}
	return out + text.slice(cursor);
}

/** A chart block the model wrote into its answer: the fence line, the JSON,
 *  the closing fence. A chart's JSON never holds three backticks. */
const CHART_FENCE_RX = new RegExp("```" + CHART_BLOCK_LANG + "[^\\n]*\\n([\\s\\S]*?)\\n```", "g");

/** A table cell's text: a pipe would end the cell, a line break the row. */
function cell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim() || " ";
}

/** How a table writes a gap — a `null` value, which is not 0. */
export const CHART_GAP = "–";

/** A chart's data as table cells: a header row and one row per category. */
export interface ChartTable {
	/** An empty corner, then each series' name with the unit in brackets. */
	header: string[];
	/** The category, then each series' value: as the bar labels write it, a gap as `CHART_GAP`. */
	rows: string[][];
}

/**
 * The ONE reading of a chart as a table (ADR-254): one row per category, one
 * column per series, the unit in the column header. The card's table view draws
 * it and `chartAsTable` writes it as Markdown, so the table on screen and the
 * table copied cannot disagree — and a value is `String(value)`, exactly what a
 * bar's label shows, so the chart and its table cannot either.
 */
export function chartTableRows(spec: ChartSpec): ChartTable {
	const unit = spec.unit ? ` (${spec.unit})` : "";
	return {
		header: ["", ...spec.series.map((s) => s.name + unit)],
		rows: spec.categories.map((category, i) => [
			category,
			...spec.series.map((s) => (s.values[i] === null ? CHART_GAP : String(s.values[i]))),
		]),
	};
}

/**
 * A chart's data as the Markdown table it should have been (ADR-236, D-65), and
 * what *Copy table* copies (ADR-254).
 *
 * Everything the block held survives: the title as a bold line, the cells of
 * `chartTableRows`, the note and the series' sources under it. No word is added
 * in any language, because the answer's language is the model's.
 */
export function chartAsTable(spec: ChartSpec): string {
	const { header, rows } = chartTableRows(spec);
	const line = (cells: string[]): string => `| ${cells.map(cell).join(" | ")} |`;
	const rule = `|${" --- |".repeat(header.length)}`;
	const sources = [...new Set(spec.series.map((s) => s.source).filter((s): s is string => !!s))];
	const foot = [spec.note, sources.length > 0 ? `(${sources.join(", ")})` : ""].filter(Boolean).join(" ");
	return [spec.title ? `**${spec.title}**\n` : "", [line(header), rule, ...rows.map(line)].join("\n"), foot ? `\n${foot}` : ""]
		.filter(Boolean)
		.join("\n");
}

/** A whole fenced block — what `formatChartBlock` writes and a chart pin stores
 *  — parsed: the fence lines dropped, the JSON between them validated. */
export function parseFencedChartBlock(fenced: string): ChartParse {
	return parseChartBlock(fenced.trim().split("\n").slice(1, -1).join("\n"));
}

/** A fenced chart block as the Markdown table of its data, or null when the
 *  block does not parse — the caller then copies the block as it is. */
export function chartBlockAsTable(fenced: string): string | null {
	const parsed = parseFencedChartBlock(fenced);
	return parsed.ok ? chartAsTable(parsed.spec) : null;
}

/**
 * Every chart the model wrote itself, held to the rule the tool door holds
 * (ADR-236, closing D-65): a block `chartWorthDrawing` refuses becomes the
 * table of its data. Run once, on the answer being committed — never on a
 * stored message, where a rule about taste must not rewrite what is there. A
 * block that does not parse is left for the card to explain, source and all.
 */
export function demoteUnworthyCharts(text: string): string {
	return text.replace(CHART_FENCE_RX, (whole: string, body: string) => {
		const parsed = parseChartBlock(body);
		if (!parsed.ok || !chartWorthDrawing(parsed.spec)) return whole;
		return chartAsTable(parsed.spec);
	});
}

/** The answer as it is stored: the tool's charts spliced in where the model
 *  asked for them, and the charts it wrote itself held to the same rule. The
 *  ONE commit step for the send and for a model comparison. */
export function commitAnswerCharts(text: string, blocks: readonly PendingChartBlock[]): string {
	return demoteUnworthyCharts(spliceChartBlocks(text, blocks));
}

/** What the model is told when a chart was accepted and placed. Short, and it
 *  carries the one instruction that matters: the numbers are drawn now, so do
 *  not write them out again underneath. */
export const CHART_TOOL_OK =
	"Chart drawn inline in your answer at this point. Do not repeat these numbers as a table " +
	"or a list — refer to the chart in your prose.";

/** When the call was valid but nothing here can place it. Never reported as a
 *  success: a model told "drawn" when nothing was drawn will write its answer
 *  around a chart that does not exist. */
export const CHART_TOOL_UNPLACED =
	"Error: a chart cannot be placed automatically here. Write it into your answer yourself, " +
	"as a ```" + CHART_BLOCK_LANG + " fenced block containing the same JSON.";

/**
 * Validate a `render_chart` call and record where its block belongs.
 *
 * The ONE place a tool call becomes a chart, shared by the send path and the
 * model comparison so the two cannot answer differently. Returns the string the
 * model receives — never throws, like every other tool result.
 */
export function acceptChartCall(input: unknown, offset: number, into: PendingChartBlock[]): string {
	const parsed = parseChartSpec(input);
	if (!parsed.ok) return `Error: ${parsed.error}`;
	const refusal = chartWorthDrawing(parsed.spec);
	if (refusal) return `Error: not drawn. ${refusal}`;
	into.push({ offset, block: formatChartBlock(parsed.spec) });
	return CHART_TOOL_OK;
}
