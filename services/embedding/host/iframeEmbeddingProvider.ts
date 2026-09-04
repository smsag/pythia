import type { EmbeddingProvider } from "../EmbeddingProvider";
import { embeddingModelConfig, type EmbeddingModelId } from "../../../models/embeddingModels";
import { getEmbeddingBundle } from "./embeddingBundle";

export type ModelLoadProgress = { progress: number; file: string; loaded: number; total: number };

const READY_TIMEOUT_MS = 300_000; // model can download tens of MB on first use
const EMBED_TIMEOUT_MS = 120_000;

interface Pending {
	resolve: (vectors: number[][]) => void;
	reject: (err: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
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
			const started = Date.now();
			const tick = () => {
				if (this.loadError) return reject(this.loadError);
				if (Date.now() - started > READY_TIMEOUT_MS) return reject(new Error("Embedding model load timed out"));
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

	private request(payload: Record<string, unknown>, timeoutMs: number): Promise<number[][]> {
		const win = this.iframe?.contentWindow;
		if (!win) return Promise.reject(new Error("Embedding iframe is not available"));
		if (this.loadError) return Promise.reject(this.loadError);
		const requestId = this.reqId++;
		return new Promise<number[][]>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error(`Embedding request ${requestId} timed out`));
			}, timeoutMs);
			this.pending.set(requestId, { resolve, reject, timeout });
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
		if (msg.error) pending.reject(new Error(`Embedding iframe: ${msg.error}`));
		else pending.resolve(msg.vectors ?? []);
	};

	unload(): void {
		window.removeEventListener("message", this.onMessage);
		for (const [, p] of this.pending) {
			clearTimeout(p.timeout);
			p.reject(new Error("Embedding provider unloaded"));
		}
		this.pending.clear();
		this.iframe?.remove();
		this.iframe = null;
		this.readyPromise = null;
	}
}
