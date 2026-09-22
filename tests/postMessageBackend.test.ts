import { describe, it, expect, vi, afterEach } from "vitest";
import {
	PostMessageEmbeddingProvider, type BackendChannel, type BackendMessage, type ModelLoadProgress,
} from "../services/embedding/host/postMessageBackend";
import { DEFAULT_EMBEDDING_MODEL_ID } from "../models/embeddingModels";

// The protocol both embedding backends speak (ADR-204). Until it was extracted it
// existed twice and neither copy had a test: the Worker needs a real Worker and
// the iframe needs a real Obsidian window. Against a fake channel it is ordinary
// code, so the rules #363 established are now pinned rather than argued.

class TestBackend extends PostMessageEmbeddingProvider {
	protected readonly label = "Test backend";
	readonly sent: Record<string, unknown>[] = [];
	mounts = 0;
	closes = 0;
	/** When true, `mount()` waits for `releaseMount()`. */
	holdMount = false;
	sendThrows = false;
	private release: (() => void) | null = null;

	isOffThread(): boolean { return true; }

	protected async mount(): Promise<BackendChannel> {
		this.mounts++;
		if (this.holdMount) await new Promise<void>((r) => { this.release = r; });
		return {
			send: (message) => {
				if (this.sendThrows) throw new Error("the backend went away");
				this.sent.push(message);
			},
			close: () => { this.closes++; },
		};
	}

	releaseMount(): void { this.release?.(); this.release = null; }
	get mountPending(): boolean { return this.release !== null; }
	/** What the backend would have posted back. */
	deliver(msg: BackendMessage): void { this.receive(msg); }
	lastRequestId(): number { return this.sent.at(-1)?.requestId as number; }
}

afterEach(() => { vi.useRealTimers(); });

/** Let queued microtasks run — the protocol is all promises. */
const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

/** Drive a backend to ready: mount, first ping tick, answer the ping. */
const becomeReady = async (b: TestBackend): Promise<void> => {
	const ready = b.ready();
	await settle();
	vi.advanceTimersByTime(300); // FIRST_PING_AFTER_MS
	await settle();
	b.deliver({ requestId: b.lastRequestId(), vectors: [] });
	await ready;
};

const make = (): TestBackend => {
	vi.useFakeTimers();
	return new TestBackend(DEFAULT_EMBEDDING_MODEL_ID);
};

describe("PostMessageEmbeddingProvider — the request/response protocol", () => {
	it("is ready only once a ping has come back, then embeds", async () => {
		const b = make();
		await becomeReady(b);
		expect(b.sent[0]).toMatchObject({ ping: true });

		const embedding = b.embed(["alpha", "beta"]);
		await settle();
		expect(b.sent.at(-1)).toMatchObject({ texts: ["alpha", "beta"] });
		b.deliver({ requestId: b.lastRequestId(), vectors: [[1, 0], [0, 1]] });
		const vectors = await embedding;
		expect(vectors.map((v) => [...v])).toEqual([[1, 0], [0, 1]]);
	});

	it("mounts once, however many times ready() is asked", async () => {
		const b = make();
		await becomeReady(b);
		await b.ready();
		await b.ready();
		expect(b.mounts).toBe(1);
	});

	it("sends nothing for an empty batch", async () => {
		const b = make();
		await becomeReady(b);
		const before = b.sent.length;
		expect(await b.embed([])).toEqual([]);
		expect(b.sent).toHaveLength(before);
	});

	it("ignores a reply to a request it is not waiting for", async () => {
		const b = make();
		await becomeReady(b);
		expect(() => b.deliver({ requestId: 999, vectors: [[1]] })).not.toThrow();
		expect(() => b.deliver({ vectors: [[1]] })).not.toThrow();
	});

	it("passes the backend's own error back, named", async () => {
		const b = make();
		await becomeReady(b);
		const embedding = b.embed(["x"]);
		await settle();
		b.deliver({ requestId: b.lastRequestId(), error: "tokenizer exploded" });
		await expect(embedding).rejects.toThrow(/Test backend: tokenizer exploded/);
	});

	it("reports load progress", async () => {
		vi.useFakeTimers();
		const seen: ModelLoadProgress[] = [];
		const b = new TestBackend(DEFAULT_EMBEDDING_MODEL_ID, (p) => seen.push(p));
		b.deliver({ type: "model-load-progress", progress: 0.5, file: "model.onnx", loaded: 1, total: 2 });
		expect(seen).toEqual([{ progress: 0.5, file: "model.onnx", loaded: 1, total: 2 }]);
	});

	it("fails a request whose send throws, instead of waiting out its timeout", async () => {
		const b = make();
		await becomeReady(b);
		b.sendThrows = true;
		await expect(b.embed(["x"])).rejects.toThrow(/went away/);
	});
});

describe("PostMessageEmbeddingProvider — a failed load (#358/#363)", () => {
	it("fails the load and everything waiting on it when the model reports an error", async () => {
		const b = make();
		const ready = b.ready().catch((e: Error) => e.message);
		await settle();
		b.deliver({ type: "model-load-error", message: "RangeError: Out of memory" });
		vi.advanceTimersByTime(300);
		await settle();
		await expect(ready).resolves.toMatch(/Out of memory/);
	});

	it("stops the ready poll when the provider is unloaded mid-load", async () => {
		const b = make();
		const ready = b.ready().catch((e: Error) => e.message);
		await settle();
		b.unload();
		vi.advanceTimersByTime(300);
		await settle();
		// Before: the poll retried against a torn-down backend every 1.5 s for the
		// whole five-minute deadline, and nobody was holding the promise.
		await expect(ready).resolves.toMatch(/unloaded/);
	});

	it("closes a backend that finishes mounting after the unload", async () => {
		const b = make();
		b.holdMount = true;
		const ready = b.ready().catch((e: Error) => e.message);
		await settle();
		expect(b.mountPending).toBe(true);

		b.unload();
		expect(b.closes).toBe(0); // nothing was mounted yet to close
		b.releaseMount();         // …and then it mounts anyway
		await settle();
		expect(b.closes).toBe(1); // the channel nobody else holds is released
		await expect(ready).resolves.toMatch(/unloaded while it was starting/);
	});

	it("loads again after an unload — the load error does not survive it", async () => {
		const b = make();
		const first = b.ready().catch(() => "failed");
		await settle();
		b.deliver({ type: "model-load-error", message: "boom" });
		vi.advanceTimersByTime(300);
		await settle();
		await expect(first).resolves.toBe("failed");

		b.unload();
		await becomeReady(b);
		expect(b.mounts).toBe(2);
	});
});

describe("PostMessageEmbeddingProvider — unload", () => {
	it("closes the channel and fails what was in flight", async () => {
		const b = make();
		await becomeReady(b);
		const embedding = b.embed(["x"]).catch((e: Error) => e.message);
		await settle();
		b.unload();
		expect(b.closes).toBe(1);
		await expect(embedding).resolves.toMatch(/unloaded/);
	});
});
