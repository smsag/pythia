// Out-of-memory, told apart from every other way a model can fail to load (ADR-199).
//
// The fallback chain (blob Worker → resource Worker → iframe) exists for backends
// that are REFUSED — a blocked `blob:` URL, a missing wasm device. Running out of
// memory is not a refusal: every backend shares the same WebContent process, so
// the next one loads the same model into the same exhausted heap. Measured on
// iOS: the blob Worker failed with `RangeError: Out of memory`, and the chain
// went on to load the model twice more — the second time on the UI thread.

/** Thrown in place of trying the next backend, so the caller can say what happened. */
export class EmbeddingOutOfMemoryError extends Error {
	constructor(cause: unknown) {
		super(`The embedding model ran out of memory while loading: ${describe(cause)}`);
		this.name = "EmbeddingOutOfMemoryError";
	}
}

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Whether `err` says the process ran out of memory. The shapes it matches are
 * the ones actually seen or emitted by the layers involved:
 *  - WebKit / V8: `RangeError: Out of memory`, `Array buffer allocation failed`
 *  - onnxruntime-web: `no available backend found. ERR: [wasm] RangeError: Out of memory`
 *  - Emscripten: `Aborted(OOM)`, `Cannot enlarge memory arrays`
 */
export function isOutOfMemoryError(err: unknown): boolean {
	if (err instanceof EmbeddingOutOfMemoryError) return true;
	const text = describe(err);
	return /out of memory|array buffer allocation failed|cannot enlarge memory|\bOOM\b/i.test(text);
}
