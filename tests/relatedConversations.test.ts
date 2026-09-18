import { describe, it, expect } from "vitest";
import { rankRelated, relatedMinScore, vaultRetrievalMinScore, VAULT_RETRIEVAL_MIN_SCORES } from "../services/embedding/relatedConversations";
import { EMBEDDING_MODELS, EMBEDDING_MODEL_IDS, SIMILARITY_PRESETS } from "../models/embeddingModels";
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

describe("relatedMinScore — per model (ADR-169)", () => {
	it("orders the presets strict > balanced > loose for every model", () => {
		for (const id of EMBEDDING_MODEL_IDS) {
			expect(relatedMinScore("strict", id)).toBeGreaterThan(relatedMinScore("balanced", id));
			expect(relatedMinScore("balanced", id)).toBeGreaterThan(relatedMinScore("loose", id));
		}
	});

	it("gives every catalog model a floor for every preset", () => {
		// A model added without floors would silently fall back to another model's
		// numbers — the bug ADR-169 exists to stop.
		for (const id of EMBEDDING_MODEL_IDS) {
			for (const preset of SIMILARITY_PRESETS) {
				const floor = EMBEDDING_MODELS[id].relatedFloors[preset];
				expect(typeof floor).toBe("number");
				expect(floor).toBeGreaterThan(0);
				expect(floor).toBeLessThan(1);
			}
		}
	});

	it("scores the multilingual model higher than the English one at every preset", () => {
		// Measured, not assumed: over the same 554 chunks the multilingual model's
		// pair scores run ~0.08 hotter throughout (ADR-169), so sharing one constant
		// made "Balanced" mean 19 of 23 neighbours on one model and 11 on the other.
		// The test is directional, not literal — it survives a re-measurement that
		// moves the numbers but not the relationship.
		for (const preset of SIMILARITY_PRESETS) {
			expect(relatedMinScore(preset, "xenova-paraphrase-multilingual-MiniLM-L12-v2")).toBeGreaterThan(
				relatedMinScore(preset, "xenova-all-MiniLM-L6-v2")
			);
		}
	});

	it("falls back to the default model's floors for an unknown model id", () => {
		const unknown = relatedMinScore("balanced", "not-a-model" as never);
		expect(unknown).toBe(relatedMinScore("balanced"));
	});

	it("keeps vault-RAG retrieval on its own, unmeasured floors", () => {
		// ADR-169 measured conversation pairs, not query-to-note retrieval. Retuning
		// vault RAG on that data would be guessing with extra steps, so the two are
		// deliberately separate constants — a test fails if they are merged again.
		expect(vaultRetrievalMinScore("balanced")).toBe(0.35);
		expect(VAULT_RETRIEVAL_MIN_SCORES.strict).toBe(0.5);
		expect(VAULT_RETRIEVAL_MIN_SCORES.loose).toBe(0.2);
	});
});
