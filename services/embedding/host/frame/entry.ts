// Unified embedding backend entry (browser build, ADR-121). ONE bundle serves
// BOTH the Web Worker (off the UI thread) and the same-origin iframe fallback —
// it detects its context at runtime — so the heavy @huggingface/transformers
// runtime is bundled ONCE and inlined once into main.js (see embeddingBundle.ts),
// instead of twice. Replaces the former separate bootstrap.ts (iframe) and
// worker.ts (worker) entries.
//
//   Worker:  host → { type:"init", config } then { requestId, texts|ping }
//   Iframe:  config via window.__EMBEDDING_MODEL_CONFIG__, then postMessage requests
//   Both  →  { requestId, vectors[], error? }
//            { type:"model-load-progress"|"model-load-error", … }

import { EmbeddingModel } from "./model";
import type { EmbeddingModelConfig } from "../../../../models/embeddingModels";

let model: EmbeddingModel | null = null;

function makeModel(config: EmbeddingModelConfig, reply: (m: unknown) => void): void {
	model = new EmbeddingModel(config, (p) =>
		reply({ type: "model-load-progress", progress: p.progress, file: p.file, loaded: p.loaded, total: p.total })
	);
	model.ready.catch((error: unknown) =>
		reply({
			type: "model-load-error",
			message: error instanceof Error ? error.message : String(error),
			offline: !navigator.onLine,
		})
	);
}

async function handle(data: { requestId?: number; texts?: string[]; ping?: boolean }, reply: (m: unknown) => void): Promise<void> {
	const { requestId, texts, ping } = data ?? {};
	if (typeof requestId !== "number") return;
	try {
		if (!model) throw new Error("embedding backend not initialized");
		await model.ready;
		if (ping) {
			reply({ requestId, vectors: [], ready: true });
			return;
		}
		const vectors: number[][] = [];
		for (const text of texts ?? []) {
			const d = await model.embed(text);
			vectors.push(d ? Array.from(d) : []);
		}
		reply({ requestId, vectors });
	} catch (error) {
		reply({ requestId, vectors: [], error: error instanceof Error ? error.message : String(error) });
	}
}

if (typeof window === "undefined") {
	// ── Web Worker: config via an init message; reply to the worker host. ──
	const ctx = self as unknown as { postMessage: (m: unknown) => void; onmessage: ((e: MessageEvent) => void) | null };
	const reply = (m: unknown) => ctx.postMessage(m);
	ctx.onmessage = (event: MessageEvent): void => {
		const data = (event.data ?? {}) as {
			type?: string; config?: EmbeddingModelConfig; requestId?: number; texts?: string[]; ping?: boolean;
		};
		if (data.type === "init" && data.config) {
			makeModel(data.config, reply);
			return;
		}
		void handle(data, reply);
	};
} else {
	// ── Iframe: config injected as a window global; reply to the parent frame. ──
	const w = window as unknown as { __EMBEDDING_MODEL_CONFIG__: EmbeddingModelConfig };
	makeModel(w.__EMBEDDING_MODEL_CONFIG__, (m) => window.parent.postMessage(m, window.origin));
	window.addEventListener("message", (event: MessageEvent) => {
		const source = event.source as Window | null;
		if (!source) return;
		void handle(event.data ?? {}, (m) => source.postMessage(m, window.origin));
	});
}
