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
}

export const EMBEDDING_MODELS: Record<EmbeddingModelId, EmbeddingModelConfig> = {
	"xenova-all-MiniLM-L6-v2": {
		id: "xenova-all-MiniLM-L6-v2",
		label: "English",
		repoId: "Xenova/all-MiniLM-L6-v2",
		dim: 384,
		maxTokens: 256,
		pooling: "mean",
	},
	"xenova-paraphrase-multilingual-MiniLM-L12-v2": {
		id: "xenova-paraphrase-multilingual-MiniLM-L12-v2",
		label: "Multilingual",
		repoId: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
		dim: 384,
		maxTokens: 128,
		pooling: "mean",
	},
};

/** Default for a bilingual (DE + EN) vault. */
export const DEFAULT_EMBEDDING_MODEL_ID: EmbeddingModelId =
	"xenova-paraphrase-multilingual-MiniLM-L12-v2";

/** How strict the "related conversations" similarity floor is. A named preset so
 *  the user never has to reason about raw cosine scores; mapped to a number in
 *  `services/embedding/relatedConversations.ts`. */
export type RelatedSimilarity = "strict" | "balanced" | "loose";
export const DEFAULT_RELATED_SIMILARITY: RelatedSimilarity = "balanced";

export function embeddingModelConfig(id: EmbeddingModelId): EmbeddingModelConfig {
	return EMBEDDING_MODELS[id] ?? EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL_ID];
}
