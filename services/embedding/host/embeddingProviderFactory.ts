import type { EmbeddingProvider } from "../EmbeddingProvider";
import { embeddingModelConfig, type EmbeddingModelId } from "../../../models/embeddingModels";
import { WorkerEmbeddingProvider } from "./workerEmbeddingProvider";
import { IframeEmbeddingProvider, type ModelLoadProgress } from "./iframeEmbeddingProvider";

/**
 * The embedding provider Pythia actually uses (ADR-119): a Web Worker (off the UI
 * thread) with the same-thread iframe as an automatic fallback. On first use it
 * tries the worker; if the environment refuses a blob worker (CSP) or the worker
 * runtime fails to become ready, it transparently falls back to the iframe — so
 * embedding always works, just on the UI thread (kept responsive by the
 * cooperative-yield throttling in VaultIndexService) when the worker is unavailable.
 *
 * Implements EmbeddingProvider itself so callers (ConversationIndexService /
 * VaultIndexService) are unaware of which backend is live.
 */
export class FallbackEmbeddingProvider implements EmbeddingProvider {
	readonly dim: number;
	private active: EmbeddingProvider | null = null;
	private readyPromise: Promise<void> | null = null;

	constructor(
		private readonly modelId: EmbeddingModelId,
		private readonly onProgress?: (p: ModelLoadProgress) => void
	) {
		this.dim = embeddingModelConfig(modelId).dim;
	}

	ready(): Promise<void> {
		if (!this.readyPromise) this.readyPromise = this.initialize();
		return this.readyPromise;
	}

	private async initialize(): Promise<void> {
		const worker = new WorkerEmbeddingProvider(this.modelId, this.onProgress);
		try {
			await worker.ready();
			this.active = worker;
			return;
		} catch (err) {
			worker.unload();
			console.warn("[Pythia] embedding worker unavailable — falling back to iframe", err);
		}
		const iframe = new IframeEmbeddingProvider(this.modelId, this.onProgress);
		await iframe.ready();
		this.active = iframe;
	}

	async embed(texts: string[]): Promise<Float32Array[]> {
		await this.ready();
		return this.active!.embed(texts);
	}

	/** Reflects the backend that actually initialized: true only if the Worker
	 *  engaged (off-thread), false once we fell back to the UI-thread iframe.
	 *  Before `ready()` resolves the backend is unknown — report false so callers
	 *  throttle rather than assume off-thread. */
	isOffThread(): boolean {
		return this.active?.isOffThread?.() ?? false;
	}

	unload(): void {
		this.active?.unload();
		this.active = null;
		this.readyPromise = null;
	}
}

/** Build the embedding provider Pythia uses (worker with iframe fallback). */
export function createEmbeddingProvider(
	modelId: EmbeddingModelId,
	onProgress?: (p: ModelLoadProgress) => void
): EmbeddingProvider {
	return new FallbackEmbeddingProvider(modelId, onProgress);
}
