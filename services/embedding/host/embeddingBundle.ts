// Single inlining point for the bundled embedding backend source (ADR-121).
// `__EMBEDDING_BUNDLE_PLACEHOLDER__` is replaced by esbuild `define` with the
// bundled `frame/entry.ts` as a string. Referenced ONLY here (once), so the
// ~0.85 MB ML runtime appears exactly once in main.js and is shared by both the
// iframe and worker providers (the same bundle detects its context).
//
// Read lazily via a function so merely IMPORTING a provider (e.g. in unit tests,
// where the esbuild `define` isn't applied) never evaluates the placeholder —
// it's only touched at real provider init, which tests don't trigger.
export function getEmbeddingBundle(): string {
	return __EMBEDDING_BUNDLE_PLACEHOLDER__;
}

/**
 * Prepended to the bundle on the WORKER paths only — never the iframe (ADR-179).
 *
 * Obsidian gives desktop Workers Node access, so `process` is defined there.
 * transformers.js 3.8.1 reads exactly this (`src/env.js:38-39`):
 *
 *     const IS_PROCESS_AVAILABLE = typeof process !== 'undefined';
 *     const IS_NODE_ENV = IS_PROCESS_AVAILABLE && process?.release?.name === 'node';
 *
 * and on that branch `src/backends/onnx.js` binds onnxruntime-NODE, whose
 * `supportedDevices` on macOS is `['cpu']`. Our `device: "wasm"` is then rejected
 * with `Unsupported device: "wasm". Should be one of: cpu.`, the Worker never
 * becomes ready, and the ENTIRE chain falls through to the UI-thread iframe —
 * on every desktop, not just the `capacitor://` builds ADR-126 was about.
 *
 * Hiding `process` first makes the Worker look like the browser it actually is,
 * which is exactly why the iframe has always worked: Electron does not give
 * subframes Node access, so `process` was never there.
 *
 * It must run BEFORE the bundle, not inside `entry.ts`: an ES `import` is
 * hoisted, so a statement in that file executes after transformers' module body
 * has already read `process`. The esbuild pass emits a self-contained ESM bundle
 * with no remaining top-level imports, so a textual prefix does run first.
 *
 * `defineProperty` rather than assignment: the bundle is an ES module and so is
 * strict, where assigning to a non-writable global throws — that would kill the
 * Worker at statement one and look exactly like the bug it fixes. Wrapped in
 * try/catch because a NON-CONFIGURABLE `process` makes defineProperty throw too;
 * there we simply fall through to the iframe as before. The fix can only move
 * embedding off the UI thread; it cannot take it down.
 */
export const WORKER_ENV_PREFIX =
	'try{Object.defineProperty(globalThis,"process",{value:undefined,writable:true,configurable:true})}catch{}';

/** The embedding bundle as the Web Worker must see it. The ONE place the prefix
 *  is applied — both worker paths (blob URL and resource path) go through it, and
 *  the iframe deliberately does not (principle 4: one builder per fact). */
export function workerSource(): string {
	return `${WORKER_ENV_PREFIX}\n${getEmbeddingBundle()}`;
}
