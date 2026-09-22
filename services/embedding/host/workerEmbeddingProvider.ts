import { PostMessageEmbeddingProvider, type BackendChannel, type BackendMessage, type ModelLoadProgress } from "./postMessageBackend";
import type { EmbeddingModelId } from "../../../models/embeddingModels";
import { getEmbeddingBundle } from "./embeddingBundle";
import { withWorkerPrelude } from "./workerPrelude";

/**
 * Runs the embedding model in a real Web Worker (ADR-119) so inference executes on
 * a BACKGROUND thread — unlike the same-origin iframe, which shares Obsidian's UI
 * thread and freezes it while embedding a large vault. The worker is loaded from a
 * Blob URL built from the bundled worker source. If the environment refuses a blob
 * worker (CSP) or the runtime fails, `ready()` rejects and the caller falls back to
 * the iframe provider (see embeddingProviderFactory).
 *
 * Everything about the conversation with the backend — the ping-proven ready poll,
 * requests, timeouts, teardown — is `PostMessageEmbeddingProvider` (ADR-204). What
 * is here is how a Worker is started and stopped.
 */
export class WorkerEmbeddingProvider extends PostMessageEmbeddingProvider {
	protected readonly label = "Embedding worker";
	private blobUrl: string | null = null;

	constructor(
		modelId: EmbeddingModelId,
		onProgress?: (p: ModelLoadProgress) => void,
		/** Optional: resolve a same-origin, loadable URL for the worker script (e.g. a
		 *  plugin resource path). When omitted, the worker loads from a `blob:` URL.
		 *  Some environments (Obsidian mobile, and desktop builds on `capacitor://`)
		 *  block `blob:` Workers — a resource-path URL is the blob-free alternative that
		 *  keeps inference OFF the UI thread (ADR-126). */
		private readonly spawnUrl?: () => Promise<string>,
	) {
		super(modelId, onProgress);
	}

	/** A real Web Worker → inference runs off the UI thread. */
	isOffThread(): boolean {
		return true;
	}

	protected async mount(): Promise<BackendChannel> {
		let url: string;
		if (this.spawnUrl) {
			url = await this.spawnUrl(); // blob-free (resource path)
		} else {
			const blob = new Blob([withWorkerPrelude(getEmbeddingBundle())], { type: "text/javascript" });
			this.blobUrl = URL.createObjectURL(blob);
			url = this.blobUrl;
		}
		const worker = new Worker(url, { type: "module" });
		const onMessage = (event: MessageEvent): void => this.receive(event.data as BackendMessage);
		const onError = (event: ErrorEvent): void => this.failLoad(new Error(event.message || "Embedding worker error"));
		worker.addEventListener("message", onMessage);
		worker.addEventListener("error", onError);
		worker.postMessage({ type: "init", config: this.config });
		return {
			send: (message) => worker.postMessage(message),
			close: () => {
				worker.removeEventListener("message", onMessage);
				worker.removeEventListener("error", onError);
				worker.terminate();
				if (this.blobUrl) {
					URL.revokeObjectURL(this.blobUrl);
					this.blobUrl = null;
				}
			},
		};
	}
}
