// The embedding Web Worker entry point (browser build, ADR-119). Same job as the
// iframe bootstrap, but running on a REAL background thread so model inference
// never blocks Obsidian's UI thread. The heavy @huggingface/transformers runtime
// is bundled into this worker (never into main.js) and loaded from a Blob URL by
// WorkerEmbeddingProvider.
//
//   host → worker : { type: "init", config }
//                   { requestId, texts: string[] }   (or { requestId, ping: true })
//   worker → host : { requestId, vectors: number[][], error? }
//                   { type: "model-load-progress", progress, file, loaded, total }
//                   { type: "model-load-error", message, offline }

import { EmbeddingModel } from "./model";
import type { EmbeddingModelConfig } from "../../../../models/embeddingModels";

// In a dedicated worker `self` is the global scope; `postMessage` targets the host.
const ctx = self as unknown as {
	postMessage: (msg: unknown) => void;
	onmessage: ((e: MessageEvent) => void) | null;
};

let model: EmbeddingModel | null = null;

ctx.onmessage = (event: MessageEvent): void => {
	const data = (event.data ?? {}) as {
		type?: string; config?: EmbeddingModelConfig; requestId?: number; texts?: string[]; ping?: boolean;
	};

	if (data.type === "init" && data.config) {
		model = new EmbeddingModel(data.config, (p) =>
			ctx.postMessage({ type: "model-load-progress", progress: p.progress, file: p.file, loaded: p.loaded, total: p.total })
		);
		model.ready.catch((error: unknown) =>
			ctx.postMessage({
				type: "model-load-error",
				message: error instanceof Error ? error.message : String(error),
				offline: !navigator.onLine,
			})
		);
		return;
	}

	void (async () => {
		const { requestId, texts, ping } = data;
		if (typeof requestId !== "number") return;
		try {
			if (!model) throw new Error("embedding worker not initialized");
			await model.ready;
			if (ping) {
				ctx.postMessage({ requestId, vectors: [], ready: true });
				return;
			}
			const vectors: number[][] = [];
			for (const text of texts ?? []) {
				const dataVec = await model.embed(text);
				vectors.push(dataVec ? Array.from(dataVec) : []);
			}
			ctx.postMessage({ requestId, vectors });
		} catch (error) {
			ctx.postMessage({ requestId, vectors: [], error: error instanceof Error ? error.message : String(error) });
		}
	})();
};
