// Embedding model registry (no Obsidian dependency — pure data, lives in models/
// so both settings and the services/embedding layer can import it).
//
// Mirrors the Xenova ONNX MiniLM family obsidian-similarity uses. Both models are
// 384-dim; the multilingual one is the default because the vault is DE + EN. The
// model files download from HuggingFace on first use and are cached by the browser.

export type EmbeddingModelId =
	| "xenova-all-MiniLM-L6-v2"
	| "xenova-paraphrase-multilingual-MiniLM-L12-v2";

export interface EmbeddingModelConfig {
	id: EmbeddingModelId;
	/** Short label for the settings dropdown. */
	label: string;
	/** HuggingFace repo id passed to transformers.js `pipeline()`. */
	repoId: string;
	/** Output dimensionality of the model. */
	dim: number;
	/** Max input tokens per embed call; longer text is truncated by the model. */
	maxTokens: number;
	/** Pooling strategy for the feature-extraction pipeline. */
	pooling: "mean" | "cls";
	/** Cosine floors for "related conversations", per strictness preset.
	 *
	 *  Per MODEL, because cosine distributions are not comparable across models —
	 *  measured, not assumed (ADR-169, `scripts/measure-related.mjs`): over the
	 *  same 554 chunks, the multilingual model's p90 pair score is 0.643 and the
	 *  English model's is 0.567, and its best-neighbour median is 0.08 higher
	 *  throughout. One shared constant therefore meant two different features
	 *  depending on which model the dropdown selected. */
	relatedFloors: Record<SimilarityPreset, number>;
}

/** How strict the "related conversations" similarity floor is. A named preset so
 *  the user never has to reason about raw cosine scores; each model maps it to a
 *  number in its own `relatedFloors`. */
/**
 * The three strictness labels a similarity floor can be set to (ADR-176).
 *
 * Named for what it is — a label — and NOT for either of the two questions it
 * labels, because those two are not the same question and do not share numbers:
 *
 * - **Related conversations** resolves it through `relatedMinScore(preset, modelId)`,
 *   against floors **measured** per embedding model (ADR-169).
 * - **Vault retrieval** resolves it through `vaultRetrievalMinScore(preset)`,
 *   against three constants that have never been measured (engineering-review #273).
 *
 * It was called `RelatedSimilarity` and used for both, which read as though the
 * measured floors also governed vault retrieval. They never did.
 */
export type SimilarityPreset = "strict" | "balanced" | "loose";

export const EMBEDDING_MODELS: Record<EmbeddingModelId, EmbeddingModelConfig> = {
	"xenova-all-MiniLM-L6-v2": {
		id: "xenova-all-MiniLM-L6-v2",
		label: "English",
		repoId: "Xenova/all-MiniLM-L6-v2",
		dim: 384,
		maxTokens: 256,
		pooling: "mean",
		// p75 / p90 / p95 of this model's own pair distribution (ADR-169).
		relatedFloors: { loose: 0.45, balanced: 0.57, strict: 0.67 },
	},
	"xenova-paraphrase-multilingual-MiniLM-L12-v2": {
		id: "xenova-paraphrase-multilingual-MiniLM-L12-v2",
		label: "Multilingual",
		repoId: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
		dim: 384,
		maxTokens: 128,
		pooling: "mean",
		// The same percentiles, ~0.08 higher throughout — this model scores every
		// pair hotter, which is exactly why the floors cannot be shared (ADR-169).
		relatedFloors: { loose: 0.55, balanced: 0.65, strict: 0.75 },
	},
};

/** Default for a bilingual (DE + EN) vault. */
export const DEFAULT_EMBEDDING_MODEL_ID: EmbeddingModelId =
	"xenova-paraphrase-multilingual-MiniLM-L12-v2";

export const SIMILARITY_PRESETS: readonly SimilarityPreset[] = ["strict", "balanced", "loose"];
export const DEFAULT_SIMILARITY_PRESET: SimilarityPreset = "balanced";

/** Every known model id, for validating a persisted setting. */
export const EMBEDDING_MODEL_IDS: readonly EmbeddingModelId[] = Object.keys(EMBEDDING_MODELS) as EmbeddingModelId[];

export function embeddingModelConfig(id: EmbeddingModelId): EmbeddingModelConfig {
	return EMBEDDING_MODELS[id] ?? EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL_ID];
}

/** Conservative chars-per-token for sizing a chunk against a token window.
 *
 *  German through the XLM-R tokenizer runs ~3.3–3.6 chars/token and English ~4;
 *  markdown (wikilinks, URLs, code) tokenizes worse than either. Sized to the
 *  pessimistic end on purpose: undersizing costs a few extra chunks, oversizing
 *  pushes text past the model's window where it contributes nothing. */
const CHARS_PER_TOKEN = 3.3;

/**
 * How many characters of note text one embed chunk should carry, for `id`.
 *
 * Until ADR-182 `maxTokens` was declared on every model and read by nothing: both
 * indexes chunked at a hardcoded 500 chars. That is ~150 tokens of German — over
 * the default (multilingual) model's 128-token window, and only ~60% of the
 * English model's 256. The window is a property of the model, so the chunk size
 * has to be too.
 *
 * Used for the VAULT index only. The conversation index deliberately stays at its
 * historical 500: ADR-169's `relatedFloors` were MEASURED at that chunk size, and
 * changing it would move the cosine distribution the floors are calibrated
 * against — re-measure with `scripts/measure-related.mjs` first (D-13/D-14).
 */
export function embedChunkChars(id: EmbeddingModelId): number {
	return Math.floor(embeddingModelConfig(id).maxTokens * CHARS_PER_TOKEN);
}
