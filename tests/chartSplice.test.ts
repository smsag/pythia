import { describe, it, expect } from "vitest";
import { spliceChartBlocks, formatChartBlock, parseChartSpec, CHART_BLOCK_LANG } from "../services/chartSpec";

const BLOCK_A = "```" + CHART_BLOCK_LANG + '\n{"a":1}\n```';
const BLOCK_B = "```" + CHART_BLOCK_LANG + '\n{"b":2}\n```';

/** Every line that opens a fence must be a line of its own, or the fence never
 *  opens and the chart is a dead card with nothing said (principle 2). */
function fencesStartLines(text: string): boolean {
	return text
		.split("\n")
		.every((line) => !line.includes("```") || line.trimStart().startsWith("```"));
}

describe("spliceChartBlocks", () => {
	it("returns the text untouched when there is nothing to place", () => {
		const text = "Just prose.";
		expect(spliceChartBlocks(text, [])).toBe(text);
	});

	it("places a block at the offset the tool was called at", () => {
		const out = spliceChartBlocks("Before.After.", [{ offset: 7, block: BLOCK_A }]);
		expect(out.indexOf(BLOCK_A)).toBeGreaterThan(out.indexOf("Before."));
		expect(out.indexOf(BLOCK_A)).toBeLessThan(out.indexOf("After."));
	});

	it("opens the fence on a line of its own, mid-sentence or not", () => {
		for (const offset of [0, 1, 6, 7, 13]) {
			const out = spliceChartBlocks("Before.After.", [{ offset, block: BLOCK_A }]);
			expect(fencesStartLines(out)).toBe(true);
		}
	});

	it("does not pile up blank lines where the model already left one", () => {
		const out = spliceChartBlocks("Before.\n\nAfter.", [{ offset: 9, block: BLOCK_A }]);
		expect(out).not.toMatch(/\n{3,}/);
		expect(fencesStartLines(out)).toBe(true);
	});

	it("keeps two blocks in ascending offset order", () => {
		const out = spliceChartBlocks("one two three", [
			{ offset: 9, block: BLOCK_B },
			{ offset: 3, block: BLOCK_A },
		]);
		expect(out.indexOf(BLOCK_A)).toBeLessThan(out.indexOf(BLOCK_B));
		expect(fencesStartLines(out)).toBe(true);
	});

	it("keeps call order for two blocks at the same offset", () => {
		const out = spliceChartBlocks("one two", [
			{ offset: 3, block: BLOCK_B },
			{ offset: 3, block: BLOCK_A },
		]);
		expect(out.indexOf(BLOCK_B)).toBeLessThan(out.indexOf(BLOCK_A));
		expect(fencesStartLines(out)).toBe(true);
	});

	it("clamps an offset past either end instead of losing the chart", () => {
		expect(spliceChartBlocks("short", [{ offset: 9999, block: BLOCK_A }])).toContain(BLOCK_A);
		expect(spliceChartBlocks("short", [{ offset: -5,   block: BLOCK_A }])).toContain(BLOCK_A);
	});

	it("places a chart into an answer that is otherwise empty", () => {
		const out = spliceChartBlocks("", [{ offset: 0, block: BLOCK_A }]);
		expect(out.startsWith("```")).toBe(true);
		expect(out.endsWith("\n")).toBe(true);
	});

	// A model that calls the tool AND writes the block for the same data is
	// normal, not a malfunction — one chart, not two.
	it("skips a block the model already wrote itself", () => {
		const text = "Here it is.\n\n" + BLOCK_A + "\n";
		const out = spliceChartBlocks(text, [{ offset: 11, block: BLOCK_A }]);
		expect(out).toBe(text);
	});

	it("skips a duplicate within the same batch", () => {
		const out = spliceChartBlocks("prose", [
			{ offset: 5, block: BLOCK_A },
			{ offset: 5, block: BLOCK_A },
		]);
		expect(out.split(BLOCK_A)).toHaveLength(2);
	});

	it("recognises a canonically emitted block, so the skip actually fires", () => {
		const parsed = parseChartSpec({
			type: "bar", categories: ["a", "b"], series: [{ name: "s", values: [1, 2] }],
		});
		expect(parsed.ok).toBe(true);
		const block = parsed.ok ? formatChartBlock(parsed.spec) : "";
		const text = "The model wrote it:\n\n" + block + "\n";
		expect(spliceChartBlocks(text, [{ offset: 19, block }])).toBe(text);
	});
});
