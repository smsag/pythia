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
