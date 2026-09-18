import { describe, it, expect, vi, beforeEach } from "vitest";
import { runInNewContext } from "node:vm";

// engineering-review #306: on desktop the embedding Worker never engaged,
// because transformers.js read Electron's Node-enabled Worker as Node and
// rejected `wasm`. The fix is a prelude that hides `process` before the bundle.

vi.mock("obsidian", () => ({ normalizePath: (p: string) => p }));
vi.mock("../services/embedding/host/embeddingBundle", () => ({ getEmbeddingBundle: () => "/*BUNDLE*/ export {};" }));

import { WORKER_PRELUDE, withWorkerPrelude } from "../services/embedding/host/workerPrelude";
import { embeddingWorkerUrl } from "../services/embedding/host/workerBundleUrl";

/** Run the prelude in a fresh global and report BOTH things transformers.js can
 *  read: the bare identifier (`typeof process`, `process?.release?.name` —
 *  env.js:38-39) and the property (`globalThis.process`). The prelude has one
 *  mechanism for each, and they fail in different circumstances, so a probe that
 *  reads only one of them cannot tell which half did the work. */
function afterPrelude(setup: string, globals: Record<string, unknown> = {}): { bare: string; property: string } {
	const ctx: Record<string, unknown> = { ...globals };
	runInNewContext(`${setup}\n${WORKER_PRELUDE}\nresult = { bare: typeof process, property: typeof globalThis.process };`, ctx);
	return ctx.result as { bare: string; property: string };
}

describe("the Worker prelude", () => {
	it("hides a Node `process` in a Worker (no window) — transformers.js then sees a browser", () => {
		expect(afterPrelude("", { process: { release: { name: "node" } } }))
			.toEqual({ bare: "undefined", property: "undefined" });
	});

	it("still hides it when the property cannot be deleted, by assigning undefined", () => {
		const seen = afterPrelude(
			`Object.defineProperty(globalThis, "process", { value: { release: { name: "node" } }, writable: true, configurable: false });`,
		);
		expect(seen).toEqual({ bare: "undefined", property: "undefined" });
	});

	it("deletes a `process` that cannot be ASSIGNED — the half the assignment alone cannot do", () => {
		// Configurable but not writable: `delete` succeeds where `globalThis.process =
		// undefined` throws (and is swallowed). The mirror of the case below, and the
		// reason the prelude tries `delete` FIRST rather than only assigning.
		const seen = afterPrelude(
			`Object.defineProperty(globalThis, "process", { value: { release: { name: "node" } }, writable: false, configurable: true });`,
		);
		expect(seen.property).toBe("undefined");
	});

	it("STILL hides it from the bare name when the property half cannot touch it (ADR-185)", () => {
		// The hole that survived #306: `delete` fails on a non-configurable property,
		// the assignment fails on a non-writable one, both are wrapped in `catch` —
		// so on a locked-down `process` the prelude silently did nothing, which is
		// exactly what an M2 Air reporting `iframe (UI thread)` after #306 shipped
		// looks like. A top-level `const` binds the IDENTIFIER, and no property
		// descriptor can defeat that.
		const seen = afterPrelude(
			`Object.defineProperty(globalThis, "process", { value: { release: { name: "node" } }, writable: false, configurable: false });`,
		);
		expect(seen.bare).toBe("undefined");
		// The property is untouchable by design — proving the two halves are not
		// the same mechanism wearing two hats.
		expect(seen.property).toBe("object");
	});

	it("hides `process.release.name` too, which is the second thing env.js reads", () => {
		const ctx: Record<string, unknown> = { process: { release: { name: "node" } } };
		runInNewContext(`${WORKER_PRELUDE}\nresult = process?.release?.name;`, ctx);
		expect(ctx.result).toBeUndefined();
	});

	it("leaves a window's `process` PROPERTY alone — the iframe is not a Worker", () => {
		// The guard is on the property half only; the `const` is unconditional
		// because a `const` inside the guard block would shadow only that block.
		// Harmless, because the iframe is rendered from the bare bundle and never
		// sees the prelude at all — asserted below.
		expect(afterPrelude("", { window: {}, process: { release: { name: "node" } } }).property).toBe("object");
	});

	it("is a no-op where there is no `process` (mobile Workers)", () => {
		expect(afterPrelude("")).toEqual({ bare: "undefined", property: "undefined" });
	});

	it("never throws, even on a `process` it can neither delete nor overwrite — the fallback chain handles that", () => {
		expect(() => afterPrelude(
			`Object.defineProperty(globalThis, "process", { value: {}, writable: false, configurable: false });`,
		)).not.toThrow();
	});

	it("comes first: ESM hoists imports, so only a prefix runs before transformers.js reads `process`", () => {
		const source = withWorkerPrelude("import x from 'y';");
		expect(source.startsWith(WORKER_PRELUDE)).toBe(true);
		expect(source.indexOf("import")).toBeGreaterThan(source.indexOf(WORKER_PRELUDE) + WORKER_PRELUDE.length - 1);
	});

	it("is a single line, so it cannot shift the bundle's own first line", () => {
		expect(WORKER_PRELUDE).not.toContain("\n");
	});
});

describe("the resource-path Worker file", () => {
	async function write(version: string, existing: string[] = []) {
		const writes: Record<string, string> = {};
		const removed: string[] = [];
		const plugin = {
			manifest: { dir: ".obsidian/plugins/pythia", id: "pythia", version },
			app: {
				vault: {
					configDir: ".obsidian",
					adapter: {
						exists: async (p: string) => existing.includes(p),
						write: async (path: string, data: string) => { writes[path] = data; },
						list: async () => ({ files: existing, folders: [] }),
						remove: async (p: string) => { removed.push(p); },
						getResourcePath: (p: string) => `app://x/${p}`,
					},
				},
			},
		};
		const url = await embeddingWorkerUrl(plugin as never);
		return { writes, removed, url };
	}

	it("is written with the prelude, under a name derived from the CONTENT", async () => {
		const { writes } = await write("9.9.9");
		const [path] = Object.keys(writes);
		expect(path).toMatch(/^\.obsidian\/plugins\/pythia\/embedding-worker-9\.9\.9-[0-9a-z]+\.mjs$/);
		expect(writes[path].startsWith(WORKER_PRELUDE)).toBe(true);
		expect(writes[path]).toContain("/*BUNDLE*/");
	});

	it("names the file by a fingerprint, so a same-version rebuild cannot serve stale worker code", async () => {
		// The file is written only when ABSENT, so the name is the whole cache key.
		// #306 hand-bumped a `-p1` marker for this; ADR-185 changed the prelude
		// again, which is the second time that marker would have had to be
		// remembered. Whatever the fingerprint is, it must MOVE when the source
		// does — which a version number and a hand-typed marker do not.
		const { writes } = await write("9.9.9");
		const [path] = Object.keys(writes);
		const source = writes[path];
		const { conversationContentHash } = await import("../services/embedding/embeddingIndex");
		expect(path).toContain(conversationContentHash([source]));
		expect(path).not.toContain(conversationContentHash([source + " "]));
	});

	it("drops worker bundles left by earlier builds, and never the one it just wrote", async () => {
		const stale = ".obsidian/plugins/pythia/embedding-worker-9.9.8-abc.mjs";
		const { writes, removed } = await write("9.9.9", [stale]);
		const [path] = Object.keys(writes);
		expect(removed).toEqual([stale]);
		expect(removed).not.toContain(path);
	});
});

// ── Which backend engaged, and why the others did not ─────────────────────

const behaviour = { blob: true, resource: true };
vi.mock("../services/embedding/host/workerEmbeddingProvider", () => ({
	WorkerEmbeddingProvider: class {
		constructor(_m: string, _p: unknown, private spawnUrl?: unknown) {}
		ready() {
			if (this.spawnUrl) return behaviour.resource ? Promise.resolve() : Promise.reject(new Error("Not allowed to load local resource: blob:"));
			return behaviour.blob ? Promise.resolve() : Promise.reject(new Error("Unsupported device: wasm"));
		}
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

describe("FallbackEmbeddingProvider.backendFailures — WHY the others lost (ADR-185)", () => {
	beforeEach(() => {
		behaviour.blob = true;
		behaviour.resource = true;
		vi.spyOn(console, "info").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	it("is empty when the first choice wins", async () => {
		const p = new FallbackEmbeddingProvider(DEFAULT_EMBEDDING_MODEL_ID, undefined, async () => "app://x/w.mjs");
		await p.ready();
		expect(p.backendFailures()).toEqual([]);
	});

	it("carries each backend's own reason, not just the fact that it lost", async () => {
		// "Unsupported device: wasm" and "Not allowed to load local resource: blob:"
		// are different bugs with different fixes. The label alone says `iframe (UI
		// thread)` for both, which is how #306 stayed undiagnosed for three ADRs.
		behaviour.blob = false;
		behaviour.resource = false;
		const p = new FallbackEmbeddingProvider(DEFAULT_EMBEDDING_MODEL_ID, undefined, async () => "app://x/w.mjs");
		await p.ready();
		expect(p.backendFailures()).toEqual([
			"worker (blob): Unsupported device: wasm",
			"worker (resource): Not allowed to load local resource: blob:",
		]);
	});

	it("hands the same reasons to onBackend, so a report has them without a second call", async () => {
		behaviour.blob = false;
		let seen: { backend: string; failures: string[] } | null = null;
		const p = new FallbackEmbeddingProvider(
			DEFAULT_EMBEDDING_MODEL_ID, undefined, async () => "app://x/w.mjs",
			(backend, failures) => { seen = { backend, failures }; },
		);
		await p.ready();
		expect(seen).toEqual({ backend: "worker (resource)", failures: ["worker (blob): Unsupported device: wasm"] });
	});

	it("hands out a COPY — a caller holding the list cannot rewrite the diagnosis", async () => {
		behaviour.blob = false;
		const p = new FallbackEmbeddingProvider(DEFAULT_EMBEDDING_MODEL_ID, undefined, async () => "app://x/w.mjs");
		await p.ready();
		p.backendFailures().push("invented");
		expect(p.backendFailures()).toHaveLength(1);
	});

	it("forgets them on unload, so a re-init reports its own run", async () => {
		behaviour.blob = false;
		const p = new FallbackEmbeddingProvider(DEFAULT_EMBEDDING_MODEL_ID, undefined, async () => "app://x/w.mjs");
		await p.ready();
		expect(p.backendFailures()).toHaveLength(1);
		p.unload();
		expect(p.backendFailures()).toEqual([]);
	});
});
