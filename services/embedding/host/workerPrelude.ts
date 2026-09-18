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
 * `process` (mobile Workers).
 *
 * TWO mechanisms, because the property half alone has a hole (ADR-185). `delete`
 * fails on a NON-CONFIGURABLE property and the assignment fails on a
 * non-writable one; both are wrapped in `catch`, so where `process` is locked
 * down the prelude silently does nothing — which is what an M2 Air reporting
 * `iframe (UI thread)` after this shipped looks like. A top-level `const` binds
 * the IDENTIFIER for the whole module, and no property descriptor can defeat
 * that: transformers.js reads the bare name (`typeof process`,
 * `process?.release?.name`), so the binding is what it actually sees. The
 * property half stays for code that reads `globalThis.process` explicitly, which
 * a lexical shadow does not intercept.
 *
 * The `const` is safe as a top-level statement, and safe ONLY because the bundle
 * is a module: in a classic script it would collide with that same
 * non-configurable global and throw at parse time. Not an assumption — the
 * bundle uses `import.meta`, a SyntaxError outside a module, and both Worker
 * paths pass `{ type: "module" }`. It is unconditional rather than inside the
 * guard above, because a `const` in a block shadows only that block; the iframe
 * never gets the prelude at all. Nothing above it names `process` bare, so the
 * temporal dead zone is never entered, and the bundle declares no top-level
 * `process`, so there is no redeclaration.
 *
 * If neither mechanism can take effect the Worker fails as before and the
 * fallback chain catches it.
 */
export const WORKER_PRELUDE =
	"if (typeof window === \"undefined\" && typeof globalThis.process !== \"undefined\") {" +
	" try { delete globalThis.process; } catch (_) {}" +
	" if (typeof globalThis.process !== \"undefined\") { try { globalThis.process = undefined; } catch (_) {} }" +
	" }" +
	" const process = void 0;";

/** The bundle as a Worker must run it: prelude first. The iframe keeps the bare bundle. */
export function withWorkerPrelude(bundle: string): string {
	return `${WORKER_PRELUDE}\n${bundle}`;
}
