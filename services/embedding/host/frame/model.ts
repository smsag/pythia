// Runs INSIDE the embedding iframe only — never imported by the main plugin
// bundle. This is the sole file that pulls in @huggingface/transformers, so the
// esbuild "iframe" pass (browser target) bundles it here while `main.js` stays
// free of the heavy ML runtime. The onnxruntime WASM and the model weights are
// fetched from the CDN / HuggingFace at runtime and cached by the browser.

import { env, pipeline, type ProgressInfo } from "@huggingface/transformers";
import type { EmbeddingModelConfig } from "../../../../models/embeddingModels";

env.allowLocalModels = false;

// transformers.js's `pipeline()` overloads produce a union type too large for TS
// to represent (TS2590), so we cast to these minimal local signatures.
type FeaturePipeline = (
	input: string,
	opts: { pooling: "mean" | "cls"; normalize: boolean }
) => Promise<{ data: Float32Array }>;
type CreatePipeline = (
	task: "feature-extraction",
	model: string,
	options?: Record<string, unknown>
) => Promise<FeaturePipeline>;
const createPipeline = pipeline as unknown as CreatePipeline;

export type Device = "wasm" | "webgpu";
export type ModelLoadProgress = { progress: number; file: string; loaded: number; total: number };
export type ModelLoadProgressCallback = (p: ModelLoadProgress) => void;

const TRANSFORMERS_CACHE = "transformers-cache";
const cacheKeyFor = (repoId: string, file: string) => `https://huggingface.co/${repoId}/resolve/main/${file}`;

async function isModelCached(repoId: string): Promise<boolean> {
	if (typeof caches === "undefined") return true;
	try {
		const cache = await caches.open(TRANSFORMERS_CACHE);
		return (await cache.match(cacheKeyFor(repoId, "config.json"))) !== undefined;
	} catch {
		return true;
	}
}

export class EmbeddingModel {
	#pipeline: FeaturePipeline | null = null;
	#device: Device = "wasm";
	#queue: Promise<unknown> = Promise.resolve(); // serialize inference calls
	readonly config: EmbeddingModelConfig;
	ready: Promise<void>;

	constructor(config: EmbeddingModelConfig, onProgress?: ModelLoadProgressCallback) {
		this.config = config;
		this.ready = this.#initialize(onProgress);
	}

	async #initialize(onProgress?: ModelLoadProgressCallback): Promise<void> {
		// Always use the WASM backend. WebGPU compute is unstable in Obsidian's
		// Electron renderer — requesting a WebGPU device could hard-crash the GPU
		// process and reload the whole app. WASM is portable and stable (a bit
		// slower). Revisit WebGPU behind an opt-in once it's verified safe here.
		this.#device = "wasm";

		if (!navigator.onLine && !(await isModelCached(this.config.repoId))) {
			throw new Error(
				`The ${this.config.label} model has not been downloaded yet and you appear to be offline. `
				+ `Connect to the internet to finish setting up.`
			);
		}

		this.#pipeline = await createPipeline("feature-extraction", this.config.repoId, {
			device: "wasm",
			dtype: "q8",
			progress_callback: onProgress
				? (info: ProgressInfo) => {
					if (info.status === "progress") {
						onProgress({ progress: info.progress, file: info.file, loaded: info.loaded, total: info.total });
					}
				}
				: undefined,
		});
	}

	getDevice(): Device {
		return this.#device;
	}

	/** Embed a single string, serialized behind the queue so calls never overlap. */
	embed(input: string): Promise<Float32Array | null> {
		return new Promise((resolve, reject) => {
			this.#queue = this.#queue.then(async () => {
				try {
					if (!this.#pipeline) return reject(new Error("pipeline not initialized"));
					const result = await this.#pipeline(input, {
						pooling: this.config.pooling,
						normalize: true,
					});
					resolve(result.data);
				} catch (err) {
					reject(err instanceof Error ? err : new Error(String(err)));
				}
			});
		});
	}
}
