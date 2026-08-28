// The iframe entry point (browser build). It reads the model config the host
// injected as a window global, loads the model, and answers embed requests over
// postMessage. Pythia chunks conversations in the host (services/embedding/
// conversationText.ts), so the protocol here is a plain texts[] → vectors[]:
//
//   host → iframe : { requestId, texts: string[] }   (or "ping")
//   iframe → host : { requestId, vectors: number[][], error? }
//                   { type: "model-load-progress", progress, file, loaded, total }
//                   { type: "model-load-error", message, offline }

import { EmbeddingModel } from "./model";
import type { EmbeddingModelConfig } from "../../../../models/embeddingModels";

declare global {
	interface Window {
		__EMBEDDING_MODEL_CONFIG__: EmbeddingModelConfig;
	}
}

const post = (msg: unknown) => window.parent.postMessage(msg, window.origin);

const model = new EmbeddingModel(window.__EMBEDDING_MODEL_CONFIG__, (p) =>
	post({ type: "model-load-progress", progress: p.progress, file: p.file, loaded: p.loaded, total: p.total })
);

model.ready.catch((error: unknown) =>
	post({
		type: "model-load-error",
		message: error instanceof Error ? error.message : String(error),
		offline: !navigator.onLine,
	})
);

type Incoming = { requestId: number; texts?: string[]; ping?: boolean };

window.addEventListener("message", (event: MessageEvent<Incoming>) => {
	void (async () => {
		const { requestId, texts, ping } = event.data ?? {};
		const source = event.source as Window | null;
		if (!source || typeof requestId !== "number") return;
		try {
			await model.ready;
			if (ping) {
				source.postMessage({ requestId, vectors: [], ready: true }, window.origin);
				return;
			}
			const vectors: number[][] = [];
			for (const text of texts ?? []) {
				const data = await model.embed(text);
				vectors.push(data ? Array.from(data) : []);
			}
			source.postMessage({ requestId, vectors }, window.origin);
		} catch (error) {
			source.postMessage(
				{ requestId, vectors: [], error: error instanceof Error ? error.message : String(error) },
				window.origin
			);
		}
	})();
});
