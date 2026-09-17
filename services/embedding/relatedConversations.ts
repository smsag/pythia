import { maxPairwiseCosine } from "./vectorMath";
import type { IndexedConversation } from "./embeddingIndex";
import {
	embeddingModelConfig,
	DEFAULT_EMBEDDING_MODEL_ID,
	type EmbeddingModelId,
	type RelatedSimilarity,
} from "../../models/embeddingModels";

/** Fallback floor when `rankRelated` is called without one. Module-private:
 *  every production caller resolves a floor through `relatedMinScore`, and an
 *  exported constant invites a second source of truth. */
const DEFAULT_MIN_SCORE = 0.5;

/**
 * The cosine floor for one strictness preset on one model.
 *
 * The floors live on the model (`EMBEDDING_MODELS[...].relatedFloors`) because
 * cosine distributions are a property of the model, not of the preset: measured
 * over the same corpus, the multilingual model scores every pair ~0.08 higher
 * than the English one (ADR-169). A single shared constant made "Balanced" mean
 * 19 of 23 neighbours on one model and 11 on the other.
 */
export function relatedMinScore(
	preset: RelatedSimilarity,
	modelId: EmbeddingModelId = DEFAULT_EMBEDDING_MODEL_ID
): number {
	const floors = embeddingModelConfig(modelId).relatedFloors;
	return floors[preset] ?? floors.balanced;
}

/** Vault-RAG retrieval (ADR-116) keeps the ORIGINAL model-agnostic floors.
 *
 *  It scores a query against note chunks, not a conversation against other
 *  conversations, so ADR-169's measurements say nothing about it — and retuning
 *  it on data that does not describe it would be guessing with extra steps.
 *  Measure it separately before touching these. */
export const VAULT_RETRIEVAL_MIN_SCORES: Record<RelatedSimilarity, number> = {
	strict: 0.5,
	balanced: 0.35,
	loose: 0.2,
};

export function vaultRetrievalMinScore(preset: RelatedSimilarity): number {
	return VAULT_RETRIEVAL_MIN_SCORES[preset] ?? VAULT_RETRIEVAL_MIN_SCORES.balanced;
}

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
