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
 * TWO mechanisms, because either alone has a hole (ADR-182):
 *
 *  • `const process = void 0` shadows the identifier for the whole module, so
 *    every one of the bundle's ~38 bare `process` reads resolves to it no matter
 *    what the global is. This is the one that cannot be defeated: a
 *    NON-CONFIGURABLE `process` makes `defineProperty` throw, and the original
 *    prefix then silently did nothing — which is a live suspect for why an M2
 *    Air still reported `iframe (UI thread)` after ADR-179.
 *  • `defineProperty` on `globalThis` stays for code that reads
 *    `globalThis.process` explicitly, which a lexical shadow does not intercept.
 *
 * The `const` is safe as a top-level statement, and safe ONLY because this is a
 * module: a top-level `const` in a module is a module-scope binding, while in a
 * classic script it would collide with a non-configurable global `process` and
 * throw at parse time. That is not an assumption — the bundle uses `import.meta`
 * twelve times, which is a SyntaxError outside a module, so it cannot be loaded
 * any other way, and both Worker paths pass `{ type: "module" }`. It must also
 * not be wrapped in a function, for the same `import.meta` reason. The bundle
 * declares no top-level `process`, so there is no redeclaration, and nothing runs
 * before line one, so the temporal dead zone is never entered.
 *
 * `defineProperty` rather than a plain assignment: the bundle is an ES module and
 * so is strict, where assigning to a non-writable global throws — that would kill
 * the Worker at statement one and look exactly like the bug it fixes. Both are
 * guarded. The fix can only move embedding off the UI thread; it cannot take it
 * down.
 */
export const WORKER_ENV_PREFIX =
	'try{Object.defineProperty(globalThis,"process",{value:undefined,writable:true,configurable:true})}catch{};const process=void 0;';

/** The embedding bundle as the Web Worker must see it. The ONE place the prefix
 *  is applied — both worker paths (blob URL and resource path) go through it, and
 *  the iframe deliberately does not (principle 4: one builder per fact). */
export function workerSource(): string {
	return `${WORKER_ENV_PREFIX}\n${getEmbeddingBundle()}`;
}
