import { describe, it, expect } from "vitest";
import {
	parseChartSpec,
	parseChartBlock,
	formatChartBlock,
	CHART_BLOCK_LANG,
	CHART_TYPES,
	MAX_CHART_SERIES,
	MAX_CHART_CATEGORIES,
	MIN_CHART_POINTS,
	type ChartSpec,
} from "../services/chartSpec";

/** A minimal valid spec; each test bends one thing out of shape. */
function valid(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		type:       "bar",
		categories: ["2023", "2024", "2025"],
		series:     [{ name: "EMEA", values: [1, 2, 3] }],
		...over,
	};
}

function errorOf(raw: unknown): string {
	const parsed = parseChartSpec(raw);
	expect(parsed.ok).toBe(false);
	return parsed.ok ? "" : parsed.error;
}

function specOf(raw: unknown): ChartSpec {
	const parsed = parseChartSpec(raw);
	if (!parsed.ok) throw new Error(`expected a valid spec, got: ${parsed.error}`);
	return parsed.spec;
}

describe("parseChartSpec — the shape", () => {
	it("accepts a minimal bar chart", () => {
		expect(specOf(valid())).toEqual({
			type:       "bar",
			categories: ["2023", "2024", "2025"],
			series:     [{ name: "EMEA", values: [1, 2, 3] }],
		});
	});

	it.each([null, undefined, 42, "bar", [1, 2]])("rejects a non-object (%s)", (raw) => {
		expect(errorOf(raw)).toContain("JSON object");
	});

	it("names the three allowed types, and what it got", () => {
		const error = errorOf(valid({ type: "donut" }));
		for (const type of CHART_TYPES) expect(error).toContain(type);
		expect(error).toContain('"donut"');
	});
});

describe("parseChartSpec — categories", () => {
	it("rejects an empty list", () => {
		expect(errorOf(valid({ categories: [] }))).toContain('"categories"');
	});

	it("names the offending index", () => {
		expect(errorOf(valid({ categories: ["a", "", "c"] }))).toContain("categories[1]");
	});

	it("trims labels", () => {
		expect(specOf(valid({ categories: [" 2023 ", "2024", "2025"] })).categories[0]).toBe("2023");
	});

	// Never silently truncated: a chart missing half its data with no word said
	// is the failure mode the cap exists to avoid.
	it("names the cap rather than dropping the tail", () => {
		const many = Array.from({ length: MAX_CHART_CATEGORIES + 1 }, (_, i) => `c${i}`);
		const error = errorOf(valid({
			categories: many,
			series:     [{ name: "s", values: many.map(() => 1) }],
		}));
		expect(error).toContain(String(MAX_CHART_CATEGORIES));
		expect(error).toContain(String(many.length));
	});
});

describe("parseChartSpec — series", () => {
	it("rejects an empty list", () => {
		expect(errorOf(valid({ series: [] }))).toContain('"series"');
	});

	it("names a missing series name", () => {
		expect(errorOf(valid({ series: [{ values: [1, 2, 3] }] }))).toContain("series[0].name");
	});

	// The mistake models make most often, so the error has to say which end to fix.
	it("names BOTH lengths when values and categories disagree", () => {
		const error = errorOf(valid({ series: [{ name: "EMEA", values: [1, 2] }] }));
		expect(error).toContain("2 entries");
		expect(error).toContain("3");
	});

	it("accepts null as a gap but rejects any other non-number", () => {
		expect(specOf(valid({ series: [{ name: "s", values: [1, null, 3] }] })).series[0].values)
			.toEqual([1, null, 3]);
		expect(errorOf(valid({ series: [{ name: "s", values: [1, "2", 3] }] })))
			.toContain("series[0].values[1]");
		expect(errorOf(valid({ series: [{ name: "s", values: [1, NaN, 3] }] })))
			.toContain("finite");
		expect(errorOf(valid({ series: [{ name: "s", values: [1, Infinity, 3] }] })))
			.toContain("finite");
	});

	it("names the cap on series count", () => {
		const series = Array.from({ length: MAX_CHART_SERIES + 1 }, (_, i) => ({
			name: `s${i}`, values: [1, 2, 3],
		}));
		expect(errorOf(valid({ series }))).toContain(String(MAX_CHART_SERIES));
	});

	it("keeps a source and drops an empty one", () => {
		expect(specOf(valid({ series: [{ name: "s", values: [1, 2, 3], source: " example.com " }] }))
			.series[0].source).toBe("example.com");
		expect(specOf(valid({ series: [{ name: "s", values: [1, 2, 3], source: "  " }] }))
			.series[0].source).toBeUndefined();
	});

	// A hex in Message.content would survive into a vault note and defeat the
	// theme for good, so the parser builds a fresh object rather than spreading.
	it("drops an unknown key, a series `color` above all", () => {
		const spec = specOf(valid({
			series: [{ name: "s", values: [1, 2, 3], color: "#ff0000", weight: 3 }],
		}));
		expect(spec.series[0]).toEqual({ name: "s", values: [1, 2, 3] });
		expect(JSON.stringify(spec)).not.toContain("#ff0000");
	});

	it("drops an unknown top-level key", () => {
		expect(specOf(valid({ palette: ["#fff"], legend: false })))
			.toEqual(specOf(valid()));
	});
});

describe("parseChartSpec — pie", () => {
	const pie = (over: Record<string, unknown> = {}) => valid({ type: "pie", ...over });

	it("accepts one series", () => {
		expect(specOf(pie()).type).toBe("pie");
	});

	it("refuses several series and says what to use instead", () => {
		const error = errorOf(pie({
			series: [{ name: "a", values: [1, 2, 3] }, { name: "b", values: [1, 2, 3] }],
		}));
		expect(error).toContain("one series");
		expect(error).toContain("bar");
	});

	it("refuses a negative value, naming it", () => {
		const error = errorOf(pie({ series: [{ name: "a", values: [1, -2, 3] }] }));
		expect(error).toContain("series[0].values[1]");
		expect(error).toContain("negative");
	});

	it("refuses more slices than the palette can tell apart, naming the way out", () => {
		const many = Array.from({ length: MAX_CHART_SERIES + 1 }, (_, i) => `s${i}`);
		const error = errorOf(pie({
			categories: many,
			series:     [{ name: "share", values: many.map((_, i) => i + 1) }],
		}));
		expect(error).toContain(String(MAX_CHART_SERIES));
		expect(error).toContain("bar");
	});

	it("refuses a zero total, which has no geometry", () => {
		expect(errorOf(pie({ series: [{ name: "a", values: [0, 0, 0] }] }))).toContain("zero");
	});
});

describe("parseChartSpec — the floor and the optional fields", () => {
	it(`refuses fewer than ${MIN_CHART_POINTS} data points`, () => {
		const error = errorOf(valid({
			categories: ["only"],
			series:     [{ name: "s", values: [1] }],
		}));
		expect(error).toContain("data points");
	});

	it("counts a gap as no point", () => {
		expect(errorOf(valid({
			categories: ["a", "b"],
			series:     [{ name: "s", values: [1, null] }],
		}))).toContain("data points");
	});

	it("lets one category with two series clear the floor", () => {
		expect(specOf(valid({
			categories: ["now"],
			series:     [{ name: "a", values: [1] }, { name: "b", values: [2] }],
		})).series).toHaveLength(2);
	});

	it("keeps title, unit and note, trimmed", () => {
		const spec = specOf(valid({ title: " Revenue ", unit: " % ", note: " rounded " }));
		expect(spec.title).toBe("Revenue");
		expect(spec.unit).toBe("%");
		expect(spec.note).toBe("rounded");
	});

	it("drops an optional field of the wrong type rather than carrying it", () => {
		const spec = specOf(valid({ title: 42, unit: {}, note: [] }));
		expect(spec.title).toBeUndefined();
		expect(spec.unit).toBeUndefined();
		expect(spec.note).toBeUndefined();
	});

	it("caps an over-long title instead of refusing the chart", () => {
		expect(specOf(valid({ title: "x".repeat(500) })).title).toHaveLength(120);
	});

	it("keeps `stacked` on a bar and drops it elsewhere", () => {
		expect(specOf(valid({ stacked: true })).stacked).toBe(true);
		expect(specOf(valid({ type: "line", stacked: true })).stacked).toBeUndefined();
		expect(specOf(valid({ stacked: "yes" })).stacked).toBeUndefined();
	});
});

describe("formatChartBlock / parseChartBlock", () => {
	it("emits a fence the code block processor will match", () => {
		const block = formatChartBlock(specOf(valid()));
		expect(block.startsWith("```" + CHART_BLOCK_LANG + "\n")).toBe(true);
		expect(block.endsWith("\n```")).toBe(true);
	});

	it("round-trips every optional field unchanged", () => {
		const spec = specOf(valid({
			title:   "Revenue by region",
			unit:    "%",
			note:    "rounded to 1dp",
			stacked: true,
			series:  [{ name: "EMEA", values: [1, null, 3], source: "example.com" }],
		}));
		const body = formatChartBlock(spec).split("\n").slice(1, -1).join("\n");
		const back = parseChartBlock(body);
		expect(back.ok).toBe(true);
		expect(back.ok && back.spec).toEqual(spec);
	});

	it("round-trips byte for byte, so a re-emitted block is recognisable", () => {
		const spec = specOf(valid({ title: "T", unit: "%" }));
		const body = formatChartBlock(spec).split("\n").slice(1, -1).join("\n");
		const back = parseChartBlock(body);
		expect(back.ok && formatChartBlock(back.spec)).toBe(formatChartBlock(spec));
	});

	it("says a block is not JSON rather than failing silently", () => {
		const parsed = parseChartBlock("{ nope");
		expect(parsed.ok).toBe(false);
		expect(!parsed.ok && parsed.error).toContain("not valid JSON");
	});

	it("validates a syntactically fine block that is the wrong shape", () => {
		expect(parseChartBlock('{"type":"bar"}').ok).toBe(false);
	});
});
