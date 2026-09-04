import type { EmbeddingProvider } from "../EmbeddingProvider";
import { embeddingModelConfig, type EmbeddingModelId } from "../../../models/embeddingModels";
import type { ModelLoadProgress } from "./iframeEmbeddingProvider";
import { getEmbeddingBundle } from "./embeddingBundle";

const READY_TIMEOUT_MS = 300_000; // model can download tens of MB on first use
const EMBED_TIMEOUT_MS = 120_000;

interface Pending {
	resolve: (vectors: number[][]) => void;
	reject: (err: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}

/**
 * Runs the embedding model in a real Web Worker (ADR-119) so inference executes on
 * a BACKGROUND thread — unlike the same-origin iframe, which shares Obsidian's UI
 * thread and freezes it while embedding a large vault. The worker is loaded from a
 * Blob URL built from the bundled worker source; the protocol mirrors the iframe's
 * (init → ping-proven ready → texts[]→vectors[]). If the environment refuses a
 * blob worker (CSP) or the runtime fails, `ready()` rejects and the caller falls
 * back to the iframe provider (see embeddingProviderFactory).
 */
export class WorkerEmbeddingProvider implements EmbeddingProvider {
	readonly dim: number;
	private readonly config = embeddingModelConfig(this.modelId);
	private worker: Worker | null = null;
	private blobUrl: string | null = null;
	private reqId = 0;
	private readonly pending = new Map<number, Pending>();
	private loadError: Error | null = null;
	private readyPromise: Promise<void> | null = null;

	constructor(
		private readonly modelId: EmbeddingModelId,
		private readonly onProgress?: (p: ModelLoadProgress) => void
	) {
		this.dim = this.config.dim;
	}

	ready(): Promise<void> {
		if (!this.readyPromise) this.readyPromise = this.initialize();
		return this.readyPromise;
	}

	private initialize(): Promise<void> {
		const blob = new Blob([getEmbeddingBundle()], { type: "text/javascript" });
		this.blobUrl = URL.createObjectURL(blob);
		const worker = new Worker(this.blobUrl, { type: "module" });
		this.worker = worker;
		worker.addEventListener("message", this.onMessage);
		worker.addEventListener("error", this.onError);
		worker.postMessage({ type: "init", config: this.config });

		// Ready is proven by a ping round-trip once the model has loaded.
		return new Promise<void>((resolve, reject) => {
			const started = Date.now();
			const tick = () => {
				if (this.loadError) return reject(this.loadError);
				if (Date.now() - started > READY_TIMEOUT_MS) return reject(new Error("Embedding worker load timed out"));
				this.ping()
					.then(resolve)
					.catch(() => setTimeout(tick, 1500));
			};
			setTimeout(tick, 300);
		});
	}

	private ping(): Promise<void> {
		return this.request({ ping: true }, 5_000).then(() => undefined);
	}

	async embed(texts: string[]): Promise<Float32Array[]> {
		await this.ready();
		if (texts.length === 0) return [];
		const vectors = await this.request({ texts }, EMBED_TIMEOUT_MS);
		return vectors.map((v) => Float32Array.from(v));
	}

	private request(payload: Record<string, unknown>, timeoutMs: number): Promise<number[][]> {
		const worker = this.worker;
		if (!worker) return Promise.reject(new Error("Embedding worker is not available"));
		if (this.loadError) return Promise.reject(this.loadError);
		const requestId = this.reqId++;
		return new Promise<number[][]>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error(`Embedding request ${requestId} timed out`));
			}, timeoutMs);
			this.pending.set(requestId, { resolve, reject, timeout });
			worker.postMessage({ requestId, ...payload });
		});
	}

	private onError = (event: ErrorEvent): void => {
		this.loadError = new Error(event.message || "Embedding worker error");
		for (const [id, p] of this.pending) {
			clearTimeout(p.timeout);
			p.reject(this.loadError);
			this.pending.delete(id);
		}
	};

	private onMessage = (event: MessageEvent): void => {
		const msg = event.data as {
			type?: string; requestId?: number; vectors?: number[][]; error?: string;
			message?: string; progress?: number; file?: string; loaded?: number; total?: number;
		};

		if (msg.type === "model-load-progress") {
			this.onProgress?.({ progress: msg.progress ?? 0, file: msg.file ?? "", loaded: msg.loaded ?? 0, total: msg.total ?? 0 });
			return;
		}
		if (msg.type === "model-load-error") {
			this.loadError = new Error(msg.message ?? "Embedding model failed to load");
			for (const [id, p] of this.pending) {
				clearTimeout(p.timeout);
				p.reject(this.loadError);
				this.pending.delete(id);
			}
			return;
		}
		if (typeof msg.requestId !== "number") return;
		const pending = this.pending.get(msg.requestId);
		if (!pending) return;
		this.pending.delete(msg.requestId);
		clearTimeout(pending.timeout);
		if (msg.error) pending.reject(new Error(`Embedding worker: ${msg.error}`));
		else pending.resolve(msg.vectors ?? []);
	};

	unload(): void {
		for (const [, p] of this.pending) {
			clearTimeout(p.timeout);
			p.reject(new Error("Embedding provider unloaded"));
		}
		this.pending.clear();
		this.worker?.terminate();
		this.worker = null;
		if (this.blobUrl) { URL.revokeObjectURL(this.blobUrl); this.blobUrl = null; }
		this.readyPromise = null;
	}
}
