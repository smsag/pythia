import { describe, it, expect } from "vitest";
import { rankRelated, relatedMinScore, RELATED_MIN_SCORES, DEFAULT_MIN_SCORE } from "../services/embedding/relatedConversations";
import { quantize } from "../services/embedding/vectorMath";
import type { IndexedConversation } from "../services/embedding/embeddingIndex";

const f = (...xs: number[]) => Float32Array.from(xs);
const idx = (id: string, ...vecs: Float32Array[]): IndexedConversation => ({
	id,
	contentHash: id,
	chunks: vecs.map(quantize),
});

describe("rankRelated", () => {
	// source points along x; near is close to x, far is orthogonal, opp is opposite.
	const source = idx("source", f(1, 0));
	const near = idx("near", f(0.95, 0.05));
	const far = idx("far", f(0, 1));
	const opp = idx("opp", f(-1, 0));

	it("excludes the source and ranks by similarity, filtering below minScore", () => {
		const out = rankRelated("source", [source, near, far, opp], { minScore: 0.35 });
		expect(out.map((r) => r.id)).toEqual(["near"]); // far (0) and opp (-1) filtered out
		expect(out[0].score).toBeGreaterThan(0.9);
	});

	it("orders multiple matches most-similar first", () => {
		const mid = idx("mid", f(0.6, 0.4));
		const out = rankRelated("source", [source, near, mid], { minScore: 0 });
		expect(out.map((r) => r.id)).toEqual(["near", "mid"]);
	});

	it("respects the limit", () => {
		const out = rankRelated("source", [source, near, idx("mid", f(0.6, 0.4))], { minScore: 0, limit: 1 });
		expect(out).toHaveLength(1);
		expect(out[0].id).toBe("near");
	});

	it("returns [] when the source is not in the index", () => {
		expect(rankRelated("ghost", [near, far])).toEqual([]);
	});

	it("returns [] when the source has no chunks", () => {
		const empty: IndexedConversation = { id: "source", contentHash: "h", chunks: [] };
		expect(rankRelated("source", [empty, near])).toEqual([]);
	});

	it("uses best chunk-to-chunk (max-pairwise) similarity across a multi-chunk source", () => {
		// Source's second chunk aligns with `far`; max-pairwise should surface it.
		const multi = idx("source", f(1, 0), f(0, 1));
		const out = rankRelated("source", [multi, far], { minScore: 0.35 });
		expect(out.map((r) => r.id)).toEqual(["far"]);
	});
});

describe("relatedMinScore", () => {
	it("maps each preset to an ordered floor (strict > balanced > loose)", () => {
		expect(relatedMinScore("strict")).toBeGreaterThan(relatedMinScore("balanced"));
		expect(relatedMinScore("balanced")).toBeGreaterThan(relatedMinScore("loose"));
		expect(relatedMinScore("balanced")).toBe(DEFAULT_MIN_SCORE);
		expect(RELATED_MIN_SCORES.strict).toBeGreaterThan(0);
		expect(RELATED_MIN_SCORES.loose).toBeGreaterThan(0);
	});
});
