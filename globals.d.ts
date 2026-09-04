// Build-time constants injected by esbuild `define` (see esbuild.config.mjs).

/** The bundled embedding backend source (ESM, self-contained). One bundle serves
 *  both the iframe and the Web Worker — it detects its context at runtime — and is
 *  inlined once via embeddingBundle.ts (ADR-121). */
declare const __EMBEDDING_BUNDLE_PLACEHOLDER__: string;
