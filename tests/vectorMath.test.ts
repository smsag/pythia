import { describe, it, expect } from "vitest";
import { l2Normalize, quantize, cosine, maxPairwiseCosine, QUANT_SCALE } from "../services/embedding/vectorMath";

const f = (...xs: number[]) => Float32Array.from(xs);

describe("l2Normalize", () => {
	it("scales a vector to unit length", () => {
		const n = l2Normalize(f(3, 4));
		expect(Math.hypot(n[0], n[1])).toBeCloseTo(1, 6);
		expect(n[0]).toBeCloseTo(0.6, 6);
		expect(n[1]).toBeCloseTo(0.8, 6);
	});
	it("leaves a zero vector unchanged", () => {
		expect(Array.from(l2Normalize(f(0, 0, 0)))).toEqual([0, 0, 0]);
	});
});

describe("quantize", () => {
	it("produces Int8 values within [-127, 127]", () => {
		const q = quantize(f(10, -10, 0.001, -0.001));
		for (const v of q) {
			expect(v).toBeGreaterThanOrEqual(-127);
			expect(v).toBeLessThanOrEqual(127);
		}
	});
	it("maps an axis-aligned unit vector to the scale", () => {
		const q = quantize(f(5, 0));
		expect(q[0]).toBe(QUANT_SCALE);
		expect(q[1]).toBe(0);
	});
});

describe("cosine", () => {
	it("is ≈1 for identical directions", () => {
		const q = quantize(f(1, 2, 3, 4));
		expect(cosine(q, q)).toBeGreaterThan(0.99);
	});
	it("is 0 for orthogonal vectors", () => {
		expect(cosine(quantize(f(1, 0)), quantize(f(0, 1)))).toBe(0);
	});
	it("is ≈-1 for opposite directions", () => {
		expect(cosine(quantize(f(1, 0)), quantize(f(-1, 0)))).toBeCloseTo(-1, 6);
	});
	it("throws on length mismatch", () => {
		expect(() => cosine(quantize(f(1, 0)), quantize(f(1, 0, 0)))).toThrow(/length mismatch/);
	});
});

describe("maxPairwiseCosine", () => {
	it("returns the best chunk-to-chunk similarity", () => {
		const a = [quantize(f(1, 0)), quantize(f(0, 1))];
		const b = [quantize(f(0.9, 0.1)), quantize(f(-1, 0))]; // first is close to a[0]
		expect(maxPairwiseCosine(a, b)).toBeGreaterThan(0.9);
	});
	it("returns 0 when either set is empty", () => {
		expect(maxPairwiseCosine([], [quantize(f(1, 0))])).toBe(0);
		expect(maxPairwiseCosine([quantize(f(1, 0))], [])).toBe(0);
	});
});
