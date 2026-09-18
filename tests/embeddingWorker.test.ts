import { describe, it, expect, vi, beforeEach } from "vitest";
import { runInNewContext } from "node:vm";

// engineering-review #306: on desktop the embedding Worker never engaged,
// because transformers.js read Electron's Node-enabled Worker as Node and
// rejected `wasm`. The fix is a prelude that hides `process` before the bundle.

vi.mock("obsidian", () => ({ normalizePath: (p: string) => p }));
vi.mock("../services/embedding/host/embeddingBundle", () => ({ getEmbeddingBundle: () => "/*BUNDLE*/ export {};" }));

import { WORKER_PRELUDE, withWorkerPrelude } from "../services/embedding/host/workerPrelude";
import { embeddingWorkerUrl } from "../services/embedding/host/workerBundleUrl";

/** Run the prelude in a fresh global and report what transformers.js would see. */
function processAfterPrelude(globals: Record<string, unknown>): string {
	const ctx: Record<string, unknown> = { ...globals };
	runInNewContext(`${WORKER_PRELUDE}\nresult = typeof process;`, ctx);
	return ctx.result as string;
}

describe("the Worker prelude", () => {
	it("hides a Node `process` in a Worker (no window) — transformers.js then sees a browser", () => {
		expect(processAfterPrelude({ process: { release: { name: "node" } } })).toBe("undefined");
	});

	it("still hides it when the property cannot be deleted, by assigning undefined", () => {
		const ctx: Record<string, unknown> = {};
		runInNewContext(
			`Object.defineProperty(globalThis, "process", { value: { release: { name: "node" } }, writable: true, configurable: false });
			${WORKER_PRELUDE}
			result = typeof process;`,
			ctx,
		);
		expect(ctx.result).toBe("undefined");
	});

	it("leaves a window alone — the iframe is not a Worker", () => {
		expect(processAfterPrelude({ window: {}, process: { release: { name: "node" } } })).toBe("object");
	});

	it("is a no-op where there is no `process` (mobile Workers)", () => {
		expect(processAfterPrelude({})).toBe("undefined");
	});

	it("never throws, even on a `process` it can neither delete nor overwrite — the fallback chain handles that", () => {
		const ctx: Record<string, unknown> = {};
		expect(() => runInNewContext(
			`Object.defineProperty(globalThis, "process", { value: {}, writable: false, configurable: false });
			${WORKER_PRELUDE}`,
			ctx,
		)).not.toThrow();
	});

	it("comes first: ESM hoists imports, so only a prefix runs before transformers.js reads `process`", () => {
		const source = withWorkerPrelude("import x from 'y';");
		expect(source.startsWith(WORKER_PRELUDE)).toBe(true);
		expect(source.indexOf("import")).toBeGreaterThan(source.indexOf(WORKER_PRELUDE) + WORKER_PRELUDE.length - 1);
	});
});

describe("the resource-path Worker file", () => {
	it("is written with the prelude, under a name no pre-#306 file of the same version can have", async () => {
		const writes: Record<string, string> = {};
		const plugin = {
			manifest: { dir: ".obsidian/plugins/pythia", id: "pythia", version: "9.9.9" },
			app: {
				vault: {
					configDir: ".obsidian",
					adapter: {
						exists: async () => false,
						write: async (path: string, data: string) => { writes[path] = data; },
						list: async () => ({ files: [], folders: [] }),
						remove: async () => {},
						getResourcePath: (p: string) => `app://x/${p}`,
					},
				},
			},
		};
		await embeddingWorkerUrl(plugin as never);
		const [path] = Object.keys(writes);
		expect(path).toBe(".obsidian/plugins/pythia/embedding-worker-9.9.9-p1.mjs");
		expect(writes[path].startsWith(WORKER_PRELUDE)).toBe(true);
		expect(writes[path]).toContain("/*BUNDLE*/");
	});
});

// ── Which backend engaged ─────────────────────────────────────────────────

const behaviour = { blob: true, resource: true };
vi.mock("../services/embedding/host/workerEmbeddingProvider", () => ({
	WorkerEmbeddingProvider: class {
		constructor(_m: string, _p: unknown, private spawnUrl?: unknown) {}
		ready() { return (this.spawnUrl ? behaviour.resource : behaviour.blob) ? Promise.resolve() : Promise.reject(new Error("no")); }
		unload() {}
		isOffThread() { return true; }
		embed() { return Promise.resolve([]); }
	},
}));
vi.mock("../services/embedding/host/iframeEmbeddingProvider", () => ({
	IframeEmbeddingProvider: class {
		ready() { return Promise.resolve(); }
		unload() {}
		isOffThread() { return false; }
		embed() { return Promise.resolve([]); }
	},
}));

import { FallbackEmbeddingProvider } from "../services/embedding/host/embeddingProviderFactory";
import { DEFAULT_EMBEDDING_MODEL_ID } from "../models/embeddingModels";

describe("FallbackEmbeddingProvider.backend — the label a report can quote", () => {
	beforeEach(() => {
		behaviour.blob = true;
		behaviour.resource = true;
		vi.spyOn(console, "info").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	async function engaged(withResource = true) {
		const p = new FallbackEmbeddingProvider(DEFAULT_EMBEDDING_MODEL_ID, undefined, withResource ? async () => "app://x/w.mjs" : undefined);
		expect(p.backend()).toBeNull();
		await p.ready();
		return p;
	}

	it("names the blob Worker when it engages, and logs it once", async () => {
		const p = await engaged();
		expect(p.backend()).toBe("worker (blob)");
		expect(p.isOffThread()).toBe(true);
		expect(console.info).toHaveBeenCalledWith("[Pythia] embedding: worker (blob)");
	});

	it("names the resource-path Worker when blob is refused", async () => {
		behaviour.blob = false;
		expect((await engaged()).backend()).toBe("worker (resource)");
	});

	it("says UI thread out loud when both Workers fail", async () => {
		behaviour.blob = false;
		behaviour.resource = false;
		const p = await engaged();
		expect(p.backend()).toBe("iframe (UI thread)");
		expect(p.isOffThread()).toBe(false);
		expect(console.info).toHaveBeenCalledWith("[Pythia] embedding: iframe (UI thread)");
	});

	it("forgets the backend on unload", async () => {
		const p = await engaged();
		p.unload();
		expect(p.backend()).toBeNull();
	});
});
