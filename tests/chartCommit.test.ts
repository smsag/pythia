import { describe, it, expect } from "vitest";
import {
	chartAsTable, chartBlockAsTable, chartTableRows, commitAnswerCharts, demoteUnworthyCharts,
	formatChartBlock, parseChartSpec, parseFencedChartBlock, CHART_BLOCK_LANG, CHART_GAP, type ChartSpec,
} from "../services/chartSpec";

/**
 * A chart the model writes itself, held at commit to the rule the tool door
 * holds (ADR-236, closing D-65). A refused block becomes the table of its data.
 */
function spec(raw: Record<string, unknown>): ChartSpec {
	const parsed = parseChartSpec(raw);
	if (!parsed.ok) throw new Error(parsed.error);
	return parsed.spec;
}

const PRICES = spec({
	type: "bar", title: "Preispunkte (Einmalkauf)", unit: "$",
	categories: ["SpaceJump", "AirSpace", "FlashSpace", "AltTab"],
	series: [{ name: "Preis", values: [9.99, null, 9.99, 0], source: "getspacejump.com" }],
	note: "AltTab: Kern gratis.",
});
const REVENUE = spec({
	type: "bar", title: "Revenue", categories: ["2022", "2023", "2024"],
	series: [{ name: "EMEA", values: [10, 12, 15] }],
});

describe("chartAsTable", () => {
	it("keeps everything the block held, and adds no word of its own", () => {
		expect(chartAsTable(PRICES)).toBe([
			"**Preispunkte (Einmalkauf)**",
			"",
			"|   | Preis ($) |",
			"| --- | --- |",
			"| SpaceJump | 9.99 |",
			"| AirSpace | – |",
			"| FlashSpace | 9.99 |",
			"| AltTab | 0 |",
			"",
			"AltTab: Kern gratis. (getspacejump.com)",
		].join("\n"));
	});

	it("gives a column to each series, and keeps a pipe from ending a cell", () => {
		const table = chartAsTable(spec({
			type: "bar", categories: ["a|b", "c", "d"],
			series: [{ name: "x", values: [1, 2, 3] }, { name: "y", values: [4, 5, 6] }],
		}));
		expect(table).toContain("|   | x | y |");
		expect(table).toContain("| a\\|b | 1 | 4 |");
		expect(table.startsWith("|")).toBe(true);
	});
});

// ADR-254: the one reading of a chart as a table — the card's table view draws
// these cells and chartAsTable writes them, so the two cannot disagree.
describe("chartTableRows", () => {
	it("one row per category, one column per series, the unit in the header, a gap as –", () => {
		expect(chartTableRows(PRICES)).toEqual({
			header: ["", "Preis ($)"],
			rows: [["SpaceJump", "9.99"], ["AirSpace", CHART_GAP], ["FlashSpace", "9.99"], ["AltTab", "0"]],
		});
	});

	it("writes a value exactly as a bar's label does, and never a title, note or source", () => {
		const table = chartTableRows(spec({
			type: "bar", title: "T", note: "N", categories: ["a", "b", "c"],
			series: [{ name: "x", values: [1e6, 0.1, -3], source: "s.example" }, { name: "y", values: [1, 2, 3] }],
		}));
		expect(table.header).toEqual(["", "x", "y"]);
		expect(table.rows).toEqual([["a", "1000000", "1"], ["b", "0.1", "2"], ["c", "-3", "3"]]);
		expect(JSON.stringify(table)).not.toMatch(/"T"|"N"|s\.example/);
	});
});

describe("a fenced chart block (what a pin stores)", () => {
	it("parses back to the spec it was written from", () => {
		const parsed = parseFencedChartBlock(formatChartBlock(PRICES));
		expect(parsed.ok && parsed.spec).toEqual(PRICES);
	});

	it("is copied as the table of its data, or not at all when it does not parse", () => {
		expect(chartBlockAsTable(formatChartBlock(PRICES))).toBe(chartAsTable(PRICES));
		expect(chartBlockAsTable("```" + CHART_BLOCK_LANG + "\n{ nope\n```")).toBeNull();
	});
});

describe("demoteUnworthyCharts", () => {
	const fence = (s: ChartSpec) => formatChartBlock(s);

	it("turns a block the tool door would refuse into its table", () => {
		const text = `Die Preise:\n\n${fence(PRICES)}\n\nSo weit.`;
		const out = demoteUnworthyCharts(text);
		expect(out).not.toContain("```" + CHART_BLOCK_LANG);
		expect(out).toContain("| AirSpace | – |");
		expect(out.startsWith("Die Preise:")).toBe(true);
		expect(out.endsWith("So weit.")).toBe(true);
	});

	it("leaves a chart worth drawing exactly as written", () => {
		const text = `Growth:\n\n${fence(REVENUE)}\n`;
		expect(demoteUnworthyCharts(text)).toBe(text);
	});

	it("leaves a block that does not parse, for the card to explain", () => {
		const text = "```" + CHART_BLOCK_LANG + "\n{ not json\n```";
		expect(demoteUnworthyCharts(text)).toBe(text);
	});

	it("touches no other code block", () => {
		const text = "```json\n{\"type\":\"bar\"}\n```";
		expect(demoteUnworthyCharts(text)).toBe(text);
	});

	it("judges each block on its own", () => {
		const out = demoteUnworthyCharts(`${fence(REVENUE)}\n\n${fence(PRICES)}`);
		expect(out).toContain("```" + CHART_BLOCK_LANG);
		expect(out).toContain("| SpaceJump | 9.99 |");
		expect(out.match(new RegExp("```" + CHART_BLOCK_LANG, "g"))).toHaveLength(1);
	});
});

describe("commitAnswerCharts", () => {
	it("splices the tool's charts in, and holds the written ones to the rule", () => {
		const text = `Before.\n\n${formatChartBlock(PRICES)}\n\nAfter.`;
		const out = commitAnswerCharts(text, [{ offset: "Before.".length, block: formatChartBlock(REVENUE) }]);
		expect(out).toContain(formatChartBlock(REVENUE));
		expect(out).toContain("| FlashSpace | 9.99 |");
		expect(out.indexOf("Revenue")).toBeLessThan(out.indexOf("Preispunkte"));
	});
});
