// The seam between the pure similarity/index logic and the actual embedding
// runtime. M1 defines the interface and tests everything against fakes; the real
// transformers.js implementation (M2) plugs in here without touching the callers.

export interface EmbeddingProvider {
	/** Output dimensionality — must match the index's stored dim. */
	readonly dim: number;
	/** Resolves once the model is loaded and ready to embed. */
	ready(): Promise<void>;
	/** Embed each input string into a raw (un-normalized) vector, aligned by index. */
	embed(texts: string[]): Promise<Float32Array[]>;
	/** Release the model/runtime (e.g. tear down the worker/iframe). */
	unload(): void;
	/** True only when inference runs on a BACKGROUND thread (a real Web Worker).
	 *  False when it runs on the renderer UI thread (the iframe fallback — e.g. when
	 *  the environment blocks blob-URL Workers, which happens on Obsidian mobile AND
	 *  on some desktop builds). Meaningful only after `ready()` resolves; callers that
	 *  can't await treat `undefined`/absent as "not off-thread" and throttle. */
	isOffThread?(): boolean;
	/** Which backend actually started, once `ready()` has resolved (ADR-182).
	 *
	 *  `isOffThread()` answers yes/no; this answers WHICH, because "no" has two very
	 *  different causes (blob refused vs. the Worker runtime rejecting `wasm`) and a
	 *  silent fallback is what hid ADR-182's bug for three ADRs. `null` before the
	 *  chain has resolved. */
	backend?(): EmbeddingBackend | null;
	/** Why the backends ahead of the active one did not start (ADR-185) — the
	 *  reason, not just the fact. Empty when the first choice won. */
	backendFailures?(): string[];
}

/** The three backends `FallbackEmbeddingProvider` can land on, in the order it
 *  tries them. Diagnostic identifiers, deliberately readable as-is so a debug log
 *  and a settings line can both print them without a translation table. */
export type EmbeddingBackend = "worker (blob)" | "worker (resource)" | "iframe (UI thread)";
