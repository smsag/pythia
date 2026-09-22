import type { EmbeddingProvider, EmbeddingBackend } from "../EmbeddingProvider";
import { embeddingModelConfig, type EmbeddingModelId } from "../../../models/embeddingModels";
import { WorkerEmbeddingProvider } from "./workerEmbeddingProvider";
import { IframeEmbeddingProvider, type ModelLoadProgress } from "./iframeEmbeddingProvider";
import { EmbeddingOutOfMemoryError, isOutOfMemoryError } from "../memoryError";

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
/** Which backend is running the model. The label a report can quote (#306):
 *  a silent fall back to the UI thread is what hid that the Worker never ran.
 *  Declared on the seam (`EmbeddingProvider`) and re-exported here, so the
 *  interface does not have to import from one of its own implementations. */
export type { EmbeddingBackend };

export class FallbackEmbeddingProvider implements EmbeddingProvider {
	readonly dim: number;
	private active: EmbeddingProvider | null = null;
	private activeBackend: EmbeddingBackend | null = null;
	/** Why each backend the chain tried did NOT start (ADR-185). #306 made the
	 *  WINNER visible; the reason the others lost is the rest of the diagnosis —
	 *  "Unsupported device: wasm" and "Not allowed to load local resource: blob:"
	 *  are different bugs with different fixes — and it went only to
	 *  `console.warn`, where nobody looks until asked. */
	private readonly failures: string[] = [];
	private readyPromise: Promise<void> | null = null;

	constructor(
		private readonly modelId: EmbeddingModelId,
		private readonly onProgress?: (p: ModelLoadProgress) => void,
		/** Optional: resolve a same-origin resource-path URL for the worker script, so
		 *  a Worker can start where `blob:` Workers are blocked (ADR-126). When it
		 *  yields a working Worker, inference stays OFF the UI thread. */
		private readonly resourceWorkerUrl?: () => Promise<string>,
		/** Called ONCE, with the backend that actually started (ADR-182). The chain
		 *  is silent by design on the happy path, and that silence is what let a
		 *  desktop-wide fallback to the UI thread go unnoticed. */
		private readonly onBackend?: (backend: EmbeddingBackend, failures: string[]) => void
	) {
		this.dim = embeddingModelConfig(modelId).dim;
	}

	private record(backend: EmbeddingBackend, err: unknown): void {
		this.failures.push(`${backend}: ${err instanceof Error ? err.message : String(err)}`);
		// Out of memory ends the chain (ADR-198). Every backend shares one process,
		// so the next one would load the same model into the same exhausted heap —
		// on iOS that was two more loads, the last on the UI thread.
		if (isOutOfMemoryError(err)) throw new EmbeddingOutOfMemoryError(err);
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
			return this.engage(blobWorker, "worker (blob)");
		} catch (err) {
			blobWorker.unload();
			this.record("worker (blob)", err);
			console.warn("[Pythia] embedding: blob worker unavailable", err);
		}
		// 2. Resource-path Worker (blob-free; still OFF the UI thread) — for environments
		//    that block blob: Workers (Obsidian mobile, capacitor:// desktop builds).
		if (this.resourceWorkerUrl) {
			const resWorker = new WorkerEmbeddingProvider(this.modelId, this.onProgress, this.resourceWorkerUrl);
			try {
				await resWorker.ready();
				return this.engage(resWorker, "worker (resource)");
			} catch (err) {
				resWorker.unload();
				this.record("worker (resource)", err);
				console.warn("[Pythia] embedding: resource-path worker unavailable — falling back to iframe (UI thread)", err);
			}
		}
		// 3. Same-origin iframe (LAST resort; runs on the UI thread — throttled by callers).
		const iframe = new IframeEmbeddingProvider(this.modelId, this.onProgress);
		await iframe.ready();
		this.engage(iframe, "iframe (UI thread)");
	}

	private engage(provider: EmbeddingProvider, backend: EmbeddingBackend): void {
		this.active = provider;
		this.activeBackend = backend;
		// Once per model load, at info level: which backend is live is the first
		// thing a performance report needs, and it used to be visible only as the
		// absence of a warning.
		// eslint-disable-next-line no-console
		console.info(`[Pythia] embedding: ${backend}`);
		this.onBackend?.(backend, [...this.failures]);
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

	/** The backend that initialized, or null before `ready()` resolves (#306). */
	backend(): EmbeddingBackend | null {
		return this.activeBackend;
	}

	/** Why the backends ahead of the active one did not start (ADR-185). Empty
	 *  when the first choice won. */
	backendFailures(): string[] {
		return [...this.failures];
	}

	unload(): void {
		this.active?.unload();
		this.active = null;
		this.activeBackend = null;
		this.failures.length = 0;
		this.readyPromise = null;
	}
}

/** Build the embedding provider Pythia uses: blob Worker → resource-path Worker →
 *  iframe. `resourceWorkerUrl` (if given) resolves a same-origin URL for the worker
 *  script so a Worker can start where `blob:` is blocked (ADR-126). */
export function createEmbeddingProvider(
	modelId: EmbeddingModelId,
	onProgress?: (p: ModelLoadProgress) => void,
	resourceWorkerUrl?: () => Promise<string>,
	onBackend?: (backend: EmbeddingBackend, failures: string[]) => void
): EmbeddingProvider {
	return new FallbackEmbeddingProvider(modelId, onProgress, resourceWorkerUrl, onBackend);
}
