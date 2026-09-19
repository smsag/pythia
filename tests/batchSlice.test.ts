import { describe, it, expect } from "vitest";
import { sliceBatch } from "../services/embedding/host/frame/batchSlice";

const flat = (rows: number[][]): Float32Array => Float32Array.from(rows.flat());

describe("sliceBatch (ADR-182)", () => {
	it("splits a [batch, dim] result into one vector per input, in order", () => {
		const out = sliceBatch(flat([[1, 2], [3, 4], [5, 6]]), [3, 2], 3);
		expect(out.map((v) => [...v])).toEqual([[1, 2], [3, 4], [5, 6]]);
	});

	it("reads the width off the tail, so [dim] and [1, dim] both work", () => {
		expect([...sliceBatch(flat([[7, 8, 9]]), [3], 1)[0]]).toEqual([7, 8, 9]);
		expect([...sliceBatch(flat([[7, 8, 9]]), [1, 3], 1)[0]]).toEqual([7, 8, 9]);
	});

	it("throws when the batch came back SHORT rather than returning empty vectors", () => {
		// The failure this exists for: slicing past the end yields zero-length
		// vectors that survive quantization and only fail at serializeIndex as
		// "chunk dim 0 != 384", naming neither the batch nor the model.
		expect(() => sliceBatch(flat([[1, 2], [3, 4]]), [3, 2], 3)).toThrow(/batch of 3/);
	});

	it("throws on a degenerate dim instead of producing empty vectors", () => {
		expect(() => sliceBatch(new Float32Array(0), [0], 1)).toThrow(/batch of 1/);
		expect(() => sliceBatch(new Float32Array(4), [], 1)).toThrow();
	});

	it("names the batch size, the value count and the dim, so the log is actionable", () => {
		expect(() => sliceBatch(new Float32Array(5), [4], 3)).toThrow(
			"embed: batch of 3 returned 5 values at dim 4"
		);
	});

	it("tolerates a result LONGER than the batch (extra trailing data is ignored)", () => {
		const out = sliceBatch(flat([[1, 2], [3, 4], [9, 9]]), [3, 2], 2);
		expect(out.map((v) => [...v])).toEqual([[1, 2], [3, 4]]);
	});
});
