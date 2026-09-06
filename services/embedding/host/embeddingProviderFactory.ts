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
		private readonly onProgress?: (p: ModelLoadProgress) => void,
		/** Optional: resolve a same-origin resource-path URL for the worker script, so
		 *  a Worker can start where `blob:` Workers are blocked (ADR-126). When it
		 *  yields a working Worker, inference stays OFF the UI thread. */
		private readonly resourceWorkerUrl?: () => Promise<string>
	) {
		this.dim = embeddingModelConfig(modelId).dim;
	}

	ready(): Promise<void> {
		if (!this.readyPromise) this.readyPromise = this.initialize();
		return this.readyPromise;
	}

	private async initialize(): Promise<void> {
		// 1. Blob-URL Worker (off-thread; works on most desktops).
		const blobWorker = new WorkerEmbeddingProvider(this.modelId, this.onProgress);
		try {
			await blobWorker.ready();
			this.active = blobWorker;
			return;
		} catch (err) {
			blobWorker.unload();
			console.warn("[Pythia] embedding: blob worker unavailable", err);
		}
		// 2. Resource-path Worker (blob-free; still OFF the UI thread) — for environments
		//    that block blob: Workers (Obsidian mobile, capacitor:// desktop builds).
		if (this.resourceWorkerUrl) {
			const resWorker = new WorkerEmbeddingProvider(this.modelId, this.onProgress, this.resourceWorkerUrl);
			try {
				await resWorker.ready();
				this.active = resWorker;
				return;
			} catch (err) {
				resWorker.unload();
				console.warn("[Pythia] embedding: resource-path worker unavailable — falling back to iframe (UI thread)", err);
			}
		}
		// 3. Same-origin iframe (LAST resort; runs on the UI thread — throttled by callers).
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

/** Build the embedding provider Pythia uses: blob Worker → resource-path Worker →
 *  iframe. `resourceWorkerUrl` (if given) resolves a same-origin URL for the worker
 *  script so a Worker can start where `blob:` is blocked (ADR-126). */
export function createEmbeddingProvider(
	modelId: EmbeddingModelId,
	onProgress?: (p: ModelLoadProgress) => void,
	resourceWorkerUrl?: () => Promise<string>
): EmbeddingProvider {
	return new FallbackEmbeddingProvider(modelId, onProgress, resourceWorkerUrl);
}
