import type { EmbeddingProvider } from "../EmbeddingProvider";
import { visibleClock } from "./visibleClock";
import { embeddingModelConfig, type EmbeddingModelId } from "../../../models/embeddingModels";
import { getEmbeddingBundle } from "./embeddingBundle";

export type ModelLoadProgress = { progress: number; file: string; loaded: number; total: number };

const READY_TIMEOUT_MS = 300_000; // model can download tens of MB on first use
const EMBED_TIMEOUT_MS = 120_000;

interface Pending {
	resolve: (vectors: number[][]) => void;
	reject: (err: Error) => void;
	/** Cancels the visible-time timeout (ADR-202). */
	cancelTimeout: () => void;
}

/**
 * Runs the embedding model inside a hidden same-origin iframe (about:srcdoc), the
 * same isolation obsidian-similarity uses: the heavy transformers.js/WASM runtime
 * lives off the plugin's own context, and `main.js` carries only the bundled
 * bootstrap as a string. Communicates over postMessage; embeds texts[] → vectors[].
 *
 * Runtime-only — not exercised by unit tests (which use a fake EmbeddingProvider);
 * the model-inference path needs verification inside a real Obsidian window.
 */
export class IframeEmbeddingProvider implements EmbeddingProvider {
	readonly dim: number;
	private readonly config = embeddingModelConfig(this.modelId);
	private iframe: HTMLIFrameElement | null = null;
	private reqId = 0;
	private readonly pending = new Map<number, Pending>();
	private loadError: Error | null = null;
	private readyPromise: Promise<void> | null = null;
	/** Bumped by `unload()`, so the ready poll below can tell that the load it is
	 *  waiting on has been abandoned (#363). */
	private generation = 0;

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
		const configJson = JSON.stringify(this.config).replace(/</g, "\\u003c");
		// Wrap the shared backend bundle in a module <script> at runtime; escape any
		// "</script" so it can't terminate the srcdoc script early.
		const moduleScript = `<script type="module">\n${getEmbeddingBundle().replace(/<\/script/gi, "<\\/script")}\n</script>`;
		const srcdoc = `<script>window.__EMBEDDING_MODEL_CONFIG__ = ${configJson};</script>\n${moduleScript}\n`;

		const iframe = document.createElement("iframe");
		iframe.setAttribute("style", "display: none;");
		iframe.srcdoc = srcdoc;
		document.body.appendChild(iframe);
		this.iframe = iframe;

		window.addEventListener("message", this.onMessage);

		// Ready is proven by a ping round-trip once the model has loaded.
		return new Promise<void>((resolve, reject) => {
			// Visible time, not wall time (ADR-202): a first download interrupted by
			// switching apps must not "time out" the moment Obsidian returns.
			const started = visibleClock.elapsed();
			const gen = this.generation;
			const tick = () => {
				// Unloaded while loading: stop. Without this the poll kept retrying
				// against a terminated backend every 1.5 s for the whole five-minute
				// deadline, and the promise nobody held rejected at the end of it.
				if (gen !== this.generation) return reject(new Error("Embedding provider unloaded"));
				if (this.loadError) return reject(this.loadError);
				if (visibleClock.elapsed() - started > READY_TIMEOUT_MS) return reject(new Error("Embedding model load timed out"));
				this.ping()
					.then(resolve)
					.catch(() => setTimeout(tick, 1500));
			};
			// Give the iframe a moment to mount before the first ping.
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

	/** Same-origin iframe → inference runs on the renderer UI thread, not off it. */
	isOffThread(): boolean {
		return false;
	}

	private request(payload: Record<string, unknown>, timeoutMs: number): Promise<number[][]> {
		const win = this.iframe?.contentWindow;
		if (!win) return Promise.reject(new Error("Embedding iframe is not available"));
		if (this.loadError) return Promise.reject(this.loadError);
		const requestId = this.reqId++;
		return new Promise<number[][]>((resolve, reject) => {
			const cancelTimeout = visibleClock.timeout(() => {
				this.pending.delete(requestId);
				reject(new Error(`Embedding request ${requestId} timed out`));
			}, timeoutMs);
			this.pending.set(requestId, { resolve, reject, cancelTimeout });
			win.postMessage({ requestId, ...payload }, window.origin);
		});
	}

	private onMessage = (event: MessageEvent): void => {
		if (event.origin !== window.location.origin) return;
		if (this.iframe && event.source !== this.iframe.contentWindow) return;
		const msg = event.data as {
			type?: string; requestId?: number; vectors?: number[][]; error?: string;
			message?: string; offline?: boolean; progress?: number; file?: string; loaded?: number; total?: number;
		};

		if (msg.type === "model-load-progress") {
			this.onProgress?.({ progress: msg.progress ?? 0, file: msg.file ?? "", loaded: msg.loaded ?? 0, total: msg.total ?? 0 });
			return;
		}
		if (msg.type === "model-load-error") {
			this.loadError = new Error(msg.message ?? "Embedding model failed to load");
			for (const [id, p] of this.pending) {
				p.cancelTimeout();
				p.reject(this.loadError);
				this.pending.delete(id);
			}
			return;
		}
		if (typeof msg.requestId !== "number") return;
		const pending = this.pending.get(msg.requestId);
		if (!pending) return;
		this.pending.delete(msg.requestId);
		pending.cancelTimeout();
		if (msg.error) pending.reject(new Error(`Embedding iframe: ${msg.error}`));
		else pending.resolve(msg.vectors ?? []);
	};

	unload(): void {
		window.removeEventListener("message", this.onMessage);
		for (const [, p] of this.pending) {
			p.cancelTimeout();
			p.reject(new Error("Embedding provider unloaded"));
		}
		this.pending.clear();
		// `readyPromise = null` below invites a later `ready()`; a load error kept
		// from the backend that has just been torn down would reject it instantly.
		this.generation++;
		this.loadError = null;
		this.iframe?.remove();
		this.iframe = null;
		this.readyPromise = null;
	}
}
