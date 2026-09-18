/**
 * The first statement of the embedding bundle when it runs as a Web Worker
 * (engineering-review #306).
 *
 * Obsidian's desktop app enables Node integration in workers, so a Worker sees
 * `process.release.name === "node"`. transformers.js reads that at module load
 * (`IS_NODE_ENV`, even in its browser build) and then offers only the
 * onnxruntime-node devices — `cpu` — and rejects the `wasm` device Pythia always
 * asks for. The Worker started fine and failed at model load, every time, and
 * every desktop fell back to the UI-thread iframe.
 *
 * Hiding `process` before any bundled module runs makes the Worker look like
 * what the iframe already is: a browser. It must be a PREFIX of the source, not
 * a statement in `frame/entry.ts` — ESM hoists imports, so anything in the entry
 * runs after transformers.js has already read `process`. The bundle is one
 * self-contained esbuild file with no `import` left, so a prefix really is first.
 *
 * No-op where it does not apply: in a window (the iframe) and where there is no
 * `process` (mobile Workers). If the property cannot be removed, the Worker
 * fails as before and the fallback chain catches it.
 */
export const WORKER_PRELUDE =
	"if (typeof window === \"undefined\" && typeof globalThis.process !== \"undefined\") {" +
	" try { delete globalThis.process; } catch (_) {}" +
	" if (typeof globalThis.process !== \"undefined\") { try { globalThis.process = undefined; } catch (_) {} }" +
	" }";

/** The bundle as a Worker must run it: prelude first. The iframe keeps the bare bundle. */
export function withWorkerPrelude(bundle: string): string {
	return `${WORKER_PRELUDE}\n${bundle}`;
}
