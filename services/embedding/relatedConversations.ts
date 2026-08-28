import { maxPairwiseCosine } from "./vectorMath";
import type { IndexedConversation } from "./embeddingIndex";

/** Default similarity floor for "sufficiently related" — tune in the UI layer. */
export const DEFAULT_MIN_SCORE = 0.35;

export interface RelatedResult {
	id: string;
	/** Max chunk-to-chunk cosine to the source conversation, ≈ [-1, 1]. */
	score: number;
}

/**
 * Rank the conversations in `index` by semantic similarity to `sourceId`, keeping
 * only those at or above `minScore`, most-similar first. The source is excluded.
 * Similarity is the best chunk-to-chunk cosine (max-pairwise) between the source's
 * chunk vectors and each candidate's — the same measure obsidian-similarity uses.
 *
 * Pure: operates on a prebuilt in-memory index, so it is fully testable with
 * fabricated vectors and independent of the embedding runtime.
 */
export function rankRelated(
	sourceId: string,
	index: IndexedConversation[],
	opts: { minScore?: number; limit?: number } = {}
): RelatedResult[] {
	const { minScore = DEFAULT_MIN_SCORE, limit } = opts;
	const source = index.find((i) => i.id === sourceId);
	if (!source || source.chunks.length === 0) return [];

	const ranked = index
		.filter((i) => i.id !== sourceId && i.chunks.length > 0)
		.map((i) => ({ id: i.id, score: maxPairwiseCosine(source.chunks, i.chunks) }))
		.filter((r) => Number.isFinite(r.score) && r.score >= minScore)
		.sort((a, b) => b.score - a.score);

	return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}
