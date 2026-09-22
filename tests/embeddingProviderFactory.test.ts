import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmbeddingBackend } from "../services/embedding/EmbeddingProvider";

// Which constructed provider should fail `ready()`. The factory news these up
// itself (no injection), so the modules are mocked rather than the instances.
const fail = { blobWorker: false, resourceWorker: false, iframe: false };
/** The message a failing backend throws, when a test needs a specific one. */
const failWith: { message: string | null } = { message: null };
const built: string[] = [];

vi.mock("../services/embedding/host/workerEmbeddingProvider", () => ({
	WorkerEmbeddingProvider: class {
		readonly dim = 4;
		private readonly kind: string;
		constructor(_id: string, _p?: unknown, spawnUrl?: () => Promise<string>) {
			this.kind = spawnUrl ? "resourceWorker" : "blobWorker";
			built.push(this.kind);
		}
		async ready(): Promise<void> {
			if (fail[this.kind as "blobWorker" | "resourceWorker"]) throw new Error(failWith.message ?? `${this.kind} unavailable`);
		}
		async embed(): Promise<Float32Array[]> { return []; }
		isOffThread(): boolean { return true; }
		unload(): void {}
	},
}));

vi.mock("../services/embedding/host/iframeEmbeddingProvider", () => ({
	IframeEmbeddingProvider: class {
		readonly dim = 4;
		constructor() { built.push("iframe"); }
		async ready(): Promise<void> { if (fail.iframe) throw new Error("iframe unavailable"); }
		async embed(): Promise<Float32Array[]> { return []; }
		isOffThread(): boolean { return false; }
		unload(): void {}
	},
}));

import { createEmbeddingProvider } from "../services/embedding/host/embeddingProviderFactory";
import { DEFAULT_EMBEDDING_MODEL_ID } from "../models/embeddingModels";

const make = (): { provider: ReturnType<typeof createEmbeddingProvider>; seen: EmbeddingBackend[] } => {
	const seen: EmbeddingBackend[] = [];
	const provider = createEmbeddingProvider(
		DEFAULT_EMBEDDING_MODEL_ID,
		undefined,
		async () => "app://resource/worker.mjs",
		(b) => seen.push(b),
	);
	return { provider, seen };
};

beforeEach(() => {
	fail.blobWorker = false;
	fail.resourceWorker = false;
	fail.iframe = false;
	failWith.message = null;
	built.length = 0;
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("FallbackEmbeddingProvider — which backend started (ADR-182)", () => {
	it("reports the blob Worker when it starts, and never builds the others", async () => {
		const { provider, seen } = make();
		await provider.ready();
		expect(seen).toEqual(["worker (blob)"]);
		expect(provider.backend?.()).toBe("worker (blob)");
		expect(built).toEqual(["blobWorker"]);
	});

	it("falls through to the resource Worker and says so", async () => {
		fail.blobWorker = true;
		const { provider, seen } = make();
		await provider.ready();
		expect(seen).toEqual(["worker (resource)"]);
		expect(provider.isOffThread?.()).toBe(true); // still off the UI thread
		expect(built).toEqual(["blobWorker", "resourceWorker"]);
	});

	it("names the iframe when BOTH Workers are refused — the slow path, no longer silent", async () => {
		fail.blobWorker = true;
		fail.resourceWorker = true;
		const { provider, seen } = make();
		await provider.ready();
		expect(seen).toEqual(["iframe (UI thread)"]);
		expect(provider.backend?.()).toBe("iframe (UI thread)");
		expect(provider.isOffThread?.()).toBe(false);
	});

	it("tries the three backends in order, and only as far as it must", async () => {
		fail.blobWorker = true;
		fail.resourceWorker = true;
		const { provider } = make();
		await provider.ready();
		expect(built).toEqual(["blobWorker", "resourceWorker", "iframe"]);
	});

	it("reports nothing before ready() has resolved", () => {
		const { provider, seen } = make();
		expect(provider.backend?.()).toBeNull();
		expect(seen).toEqual([]);
	});

	it("reports once per resolution, not once per embed", async () => {
		const { provider, seen } = make();
		await provider.ready();
		await provider.ready();
		await provider.embed(["a"]);
		expect(seen).toEqual(["worker (blob)"]);
	});

	it("forgets the backend on unload, so a stale one cannot be reported", async () => {
		const { provider } = make();
		await provider.ready();
		provider.unload();
		expect(provider.backend?.()).toBeNull();
	});
});

describe("FallbackEmbeddingProvider — why the others failed (ADR-185)", () => {
	it("reports each failure REASON, not just that it fell back", async () => {
		// "Unsupported device: wasm" and "Not allowed to load local resource: blob:"
		// are different bugs with different fixes. The chain knew which and threw it
		// into console.warn, where nobody looks until asked.
		fail.blobWorker = true;
		fail.resourceWorker = true;
		const { provider, seen } = make();
		await provider.ready();
		expect(seen).toEqual(["iframe (UI thread)"]);
		const failures = provider.backendFailures?.() ?? [];
		expect(failures).toHaveLength(2);
		expect(failures[0]).toContain("worker (blob)");
		expect(failures[0]).toContain("blobWorker unavailable");
		expect(failures[1]).toContain("worker (resource)");
	});

	it("hands the reasons to the callback alongside the winner", async () => {
		fail.blobWorker = true;
		const seen: { backend: string; failures: string[] }[] = [];
		const provider = createEmbeddingProvider(
			DEFAULT_EMBEDDING_MODEL_ID,
			undefined,
			async () => "app://resource/worker.mjs",
			(backend, failures) => seen.push({ backend, failures }),
		);
		await provider.ready();
		expect(seen[0].backend).toBe("worker (resource)");
		expect(seen[0].failures).toHaveLength(1);
	});

	it("reports nothing when the first choice won", async () => {
		const { provider } = make();
		await provider.ready();
		expect(provider.backendFailures?.()).toEqual([]);
	});

	it("forgets the reasons on unload, so a retry cannot inherit stale ones", async () => {
		fail.blobWorker = true;
		const { provider } = make();
		await provider.ready();
		expect(provider.backendFailures?.()).toHaveLength(1);
		provider.unload();
		expect(provider.backendFailures?.()).toEqual([]);
	});
});

describe("FallbackEmbeddingProvider — out of memory ends the chain (ADR-198)", () => {
	it("does not load the model again in the next backend when the first ran out of memory", async () => {
		// Measured on iOS: every backend shares one WebContent process, so the
		// chain went on to load the model twice more — the last time on the UI thread.
		fail.blobWorker = true;
		failWith.message = "no available backend found. ERR: [wasm] RangeError: Out of memory";
		const { provider, seen } = make();
		await expect(provider.ready()).rejects.toThrow(/ran out of memory/);
		expect(built).toEqual(["blobWorker"]);
		expect(seen).toEqual([]);
	});

	it("still falls through on a refusal, which is what the chain is for", async () => {
		fail.blobWorker = true;
		failWith.message = "Not allowed to load local resource: blob:";
		const { provider } = make();
		await provider.ready();
		expect(built).toEqual(["blobWorker", "resourceWorker"]);
	});
});
