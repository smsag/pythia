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
function checkPie(series: ChartSeries[]): string | null {
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
		const pieError = checkPie(series);
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
