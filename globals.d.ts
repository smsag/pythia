// Build-time constants injected by esbuild `define` (see esbuild.config.mjs).

/** The bundled embedding-iframe bootstrap wrapped in a <script type="module">…</script>. */
declare const __IFRAME_CONTENTS_PLACEHOLDER__: string;

/** The bundled embedding Web Worker source (ESM, self-contained), loaded via a Blob URL. */
declare const __WORKER_CONTENTS_PLACEHOLDER__: string;
