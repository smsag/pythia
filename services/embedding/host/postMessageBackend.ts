// The protocol both embedding backends speak, in one place (ADR-204, #365).
//
// A Web Worker and a same-origin iframe are two ways to get the model off the
// plugin's own context, and Pythia talks to both the same way: mount it, prove it
// ready with a ping round-trip, then `texts[] → vectors[]` over postMessage, with
// every deadline measured on the visible clock (ADR-202). Only the mounting and
// the teardown differ — and whether inference lands off the UI thread.
//
// It was written twice. #363 (a model that finished loading into a provider
// nobody owned) had to be fixed identically in both copies, which is what this
// file is for: a protocol implemented twice drifts, and the copy that drifts is
// the iframe one, because no unit test can reach it — it needs a real Obsidian
// window. A bug fixed here is fixed in both.

import type { EmbeddingProvider } from "../EmbeddingProvider";
import { visibleClock } from "./visibleClock";
import { embeddingModelConfig, type EmbeddingModelConfig, type EmbeddingModelId } from "../../../models/embeddingModels";

export type ModelLoadProgress = { progress: number; file: string; loaded: number; total: number };

/** How long a first load may take: the model can download tens of MB. */
const READY_TIMEOUT_MS = 300_000;
/** How long one embed request may take. */
const EMBED_TIMEOUT_MS = 120_000;
/** How long a ping may take before the poll tries again. */
const PING_TIMEOUT_MS = 5_000;
/** Between ready pings, and before the first one (the backend needs a moment to mount). */
const PING_EVERY_MS = 1_500;
const FIRST_PING_AFTER_MS = 300;

/** Anything the backend sends back. Shapes it in `frame/entry.ts`. */
export interface BackendMessage {
	type?: string;
	requestId?: number;
	vectors?: number[][];
	error?: string;
	message?: string;
	progress?: number;
	file?: string;
	loaded?: number;
	total?: number;
}

/** A mounted backend: how to reach it, and how to take it down. */
export interface BackendChannel {
	send(message: Record<string, unknown>): void;
	/** Tear the backend down and release everything mounting it took. */
	close(): void;
}

interface Pending {
	resolve: (vectors: number[][]) => void;
	reject: (err: Error) => void;
	/** Cancels the visible-time timeout (ADR-202). */
	cancelTimeout: () => void;
}

/**
 * The half of an embedding backend that is the same on both: the request/response
 * protocol, the ping-proven ready poll, the timeouts, and the teardown rules that
 * #363 established. A subclass supplies `mount()`, `label` and `isOffThread()`.
 */
export abstract class PostMessageEmbeddingProvider implements EmbeddingProvider {
	readonly dim: number;
	/** The model the backend is told to load; the subclass passes it on in `mount`. */
	protected readonly config: EmbeddingModelConfig;
	private channel: BackendChannel | null = null;
	private reqId = 0;
	private readonly pending = new Map<number, Pending>();
	private loadError: Error | null = null;
	private readyPromise: Promise<void> | null = null;
	/** Bumped by `unload()`, so a load in flight can tell it has been abandoned (#363). */
	private generation = 0;

	constructor(
		protected readonly modelId: EmbeddingModelId,
		protected readonly onProgress?: (p: ModelLoadProgress) => void,
	) {
		this.config = embeddingModelConfig(modelId);
		this.dim = this.config.dim;
	}

	/** Start the backend and return the channel to it. Called once per load; the
	 *  channel it returns is closed by `unload()` — including when the unload lands
	 *  while this is still running (#363), so `mount` must not leave anything
	 *  reachable only from its own local scope. */
	protected abstract mount(): Promise<BackendChannel>;

	/** What this backend calls itself in an error — "Embedding worker", say. */
	protected abstract readonly label: string;

	abstract isOffThread(): boolean;

	ready(): Promise<void> {
		if (!this.readyPromise) this.readyPromise = this.initialize();
		return this.readyPromise;
	}

	private async initialize(): Promise<void> {
		const gen = this.generation;
		const channel = await this.mount();
		if (gen !== this.generation) {
			// Unloaded while the backend was starting (#363). Nothing else holds this
			// channel, so it is closed here or it is a leak with a model inside it.
			channel.close();
			throw new Error(`${this.label} was unloaded while it was starting`);
		}
		this.channel = channel;

		// Ready is proven by a ping round-trip once the model has loaded.
		return new Promise<void>((resolve, reject) => {
			// Visible time, not wall time (ADR-202): a first download interrupted by
			// switching apps must not "time out" the moment Obsidian returns.
			const started = visibleClock.elapsed();
			const tick = (): void => {
				// Unloaded while loading: stop. Without this the poll kept retrying
				// against a torn-down backend every 1.5 s for the whole five-minute
				// deadline, and the promise nobody held rejected at the end of it.
				if (gen !== this.generation) return reject(new Error(`${this.label} was unloaded`));
				if (this.loadError) return reject(this.loadError);
				if (visibleClock.elapsed() - started > READY_TIMEOUT_MS) {
					return reject(new Error(`${this.label} load timed out`));
				}
				this.ping()
					.then(resolve)
					.catch(() => setTimeout(tick, PING_EVERY_MS));
			};
			setTimeout(tick, FIRST_PING_AFTER_MS);
		});
	}

	private ping(): Promise<void> {
		return this.request({ ping: true }, PING_TIMEOUT_MS).then(() => undefined);
	}

	async embed(texts: string[]): Promise<Float32Array[]> {
		await this.ready();
		if (texts.length === 0) return [];
		const vectors = await this.request({ texts }, EMBED_TIMEOUT_MS);
		return vectors.map((v) => Float32Array.from(v));
	}

	private request(payload: Record<string, unknown>, timeoutMs: number): Promise<number[][]> {
		const channel = this.channel;
		if (!channel) return Promise.reject(new Error(`${this.label} is not available`));
		if (this.loadError) return Promise.reject(this.loadError);
		const requestId = this.reqId++;
		return new Promise<number[][]>((resolve, reject) => {
			const cancelTimeout = visibleClock.timeout(() => {
				this.pending.delete(requestId);
				reject(new Error(`Embedding request ${requestId} timed out`));
			}, timeoutMs);
			this.pending.set(requestId, { resolve, reject, cancelTimeout });
			try {
				channel.send({ requestId, ...payload });
			} catch (e) {
				// A backend that went away between the check and the send — an iframe
				// removed from the document, say. Fail this request rather than leave
				// it pending until its timeout.
				this.pending.delete(requestId);
				cancelTimeout();
				reject(e instanceof Error ? e : new Error(String(e)));
			}
		});
	}

	/** Every message from the backend goes through here. */
	protected receive(msg: BackendMessage): void {
		if (msg?.type === "model-load-progress") {
			this.onProgress?.({
				progress: msg.progress ?? 0, file: msg.file ?? "", loaded: msg.loaded ?? 0, total: msg.total ?? 0,
			});
			return;
		}
		if (msg?.type === "model-load-error") {
			this.failLoad(new Error(msg.message ?? "Embedding model failed to load"));
			return;
		}
		if (typeof msg?.requestId !== "number") return;
		const pending = this.pending.get(msg.requestId);
		if (!pending) return;
		this.pending.delete(msg.requestId);
		pending.cancelTimeout();
		if (msg.error) pending.reject(new Error(`${this.label}: ${msg.error}`));
		else pending.resolve(msg.vectors ?? []);
	}

	/** The backend failed as a whole — a Worker `error` event, or the model saying
	 *  it could not load. Everything waiting on it fails with the same reason. */
	protected failLoad(err: Error): void {
		this.loadError = err;
		this.failPending(err);
	}

	private failPending(err: Error): void {
		for (const [id, p] of this.pending) {
			p.cancelTimeout();
			p.reject(err);
			this.pending.delete(id);
		}
	}

	unload(): void {
		// Ahead of everything else, so a load in flight sees a generation it does
		// not belong to and closes its own channel (#363).
		this.generation++;
		this.failPending(new Error("Embedding provider unloaded"));
		// `readyPromise = null` below invites a later `ready()`; a load error kept
		// from the backend that has just been torn down would reject it instantly.
		this.loadError = null;
		this.channel?.close();
		this.channel = null;
		this.readyPromise = null;
	}
}
