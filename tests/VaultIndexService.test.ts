import { describe, it, expect } from "vitest";
import { VaultIndexService, type IndexableNote } from "../services/embedding/VaultIndexService";
import type { IndexStore } from "../services/embedding/ConversationIndexService";
import type { EmbeddingProvider } from "../services/embedding/EmbeddingProvider";

// Fake embedder: maps text to a 4-dim axis vector by keyword, and records every
// text embedded so tests can assert the incremental (re-embed only changed) path.
class FakeProvider implements EmbeddingProvider {
	readonly dim = 4;
	embedded: string[] = [];
	async ready(): Promise<void> {}
	async embed(texts: string[]): Promise<Float32Array[]> {
		this.embedded.push(...texts);
		return texts.map((t) => {
			const v = new Float32Array(4);
			if (t.includes("alpha")) v[0] = 1;
			else if (t.includes("beta")) v[1] = 1;
			else v[2] = 1;
			return v;
		});
	}
	unload(): void {}
}

class MemStore implements IndexStore {
	buf: ArrayBuffer | null = null;
	writes = 0;
	async read(): Promise<ArrayBuffer | null> { return this.buf; }
	async write(b: ArrayBuffer): Promise<void> { this.buf = b; this.writes++; }
}

const note = (path: string, content: string): IndexableNote => ({ path, content });

const alpha = note("Notes/alpha.md", "all about alpha topics");
const beta = note("Notes/beta.md", "all about beta topics");
const gamma = note("Notes/gamma.md", "unrelated gamma material");

describe("VaultIndexService", () => {
	it("embeds every note on first sync and persists once", async () => {
		const p = new FakeProvider();
		const store = new MemStore();
		const svc = new VaultIndexService(p, store);
		await svc.sync([alpha, beta]);
		expect(p.embedded.length).toBeGreaterThanOrEqual(2);
		expect(store.writes).toBe(1);
	});

	it("re-embeds nothing when unchanged (incremental)", async () => {
		const p = new FakeProvider();
		const store = new MemStore();
		const svc = new VaultIndexService(p, store);
		await svc.sync([alpha, beta]);
		const after = p.embedded.length;
		const writes = store.writes;
		await svc.sync([alpha, beta]);
		expect(p.embedded.length).toBe(after);
		expect(store.writes).toBe(writes);
	});

	it("re-embeds only the note whose content changed", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		await svc.sync([alpha, beta]);
		p.embedded = [];
		await svc.sync([note("Notes/alpha.md", "all about alpha topics — revised"), beta]);
		expect(p.embedded.length).toBeGreaterThan(0);
		expect(p.embedded.every((t) => t.includes("alpha"))).toBe(true);
	});

	it("is not ready until a sync completes, then ready after (ADR-118)", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		expect(svc.isReady()).toBe(false);
		await svc.sync([alpha, beta]);
		expect(svc.isReady()).toBe(true);
	});

	it("query returns [] before any sync (index not ready), without embedding", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		const out = await svc.query("alpha", { minScore: 0.5 });
		expect(out).toEqual([]);
		expect(p.embedded).toEqual([]); // did not even embed the query
	});

	it("query ranks the indexed notes most relevant to the text, above the floor", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		await svc.sync([alpha, beta, gamma]);
		const out = await svc.query("tell me about alpha", { minScore: 0.5 });
		expect(out.map((r) => r.id)).toEqual(["Notes/alpha.md"]);
		expect(out[0].score).toBeGreaterThan(0.9);
	});

	it("query applies the limit AFTER dropping excluded paths", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		const alpha2 = note("Notes/alpha2.md", "more alpha discussion");
		await svc.sync([alpha, alpha2, beta]);
		// Both alpha notes match; exclude the first, limit 1 → still returns one (the other).
		const out = await svc.query("alpha", { minScore: 0.5, limit: 1, exclude: ["Notes/alpha.md"] });
		expect(out.length).toBe(1);
		expect(out[0].id).toBe("Notes/alpha2.md");
	});

	it("query returns [] for empty text", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		await svc.sync([alpha, beta]);
		expect(await svc.query("   ", { minScore: 0.5 })).toEqual([]);
	});

	it("drops a removed note from the index on the next sync", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		await svc.sync([alpha, beta]);
		await svc.sync([beta]);
		const out = await svc.query("alpha", { minScore: 0.5 });
		expect(out.find((r) => r.id === "Notes/alpha.md")).toBeUndefined();
	});

	it("skips empty notes (no chunks to embed)", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		await svc.sync([alpha, note("Notes/empty.md", "   ")]);
		const out = await svc.query("alpha", { minScore: 0.5 });
		expect(out.find((r) => r.id === "Notes/empty.md")).toBeUndefined();
		expect(out.map((r) => r.id)).toEqual(["Notes/alpha.md"]);
	});

	it("reports progress as notes are embedded", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		const calls: Array<[number, number]> = [];
		await svc.sync([alpha, beta, gamma], (done, total) => calls.push([done, total]));
		expect(calls.length).toBe(3); // one per embedded note
		expect(calls[calls.length - 1]).toEqual([3, 3]);
	});

	it("clear() wipes the index and marks it not-ready until the next sync (ADR-119)", async () => {
		const p = new FakeProvider();
		const store = new MemStore();
		const svc = new VaultIndexService(p, store);
		await svc.sync([alpha, beta]);
		expect(svc.isReady()).toBe(true);
		await svc.clear();
		expect(svc.isReady()).toBe(false);
		expect(await svc.query("alpha", { minScore: 0.5 })).toEqual([]); // empty index
		// A fresh sync rebuilds and becomes queryable again.
		await svc.sync([alpha, beta]);
		expect((await svc.query("alpha", { minScore: 0.5 })).map((r) => r.id)).toEqual(["Notes/alpha.md"]);
	});

	it("serves queries from a persisted index, embedding only the query", async () => {
		const store = new MemStore();
		await new VaultIndexService(new FakeProvider(), store).sync([alpha, beta]);

		const p2 = new FakeProvider(); // fresh: embedded starts empty
		const svc2 = new VaultIndexService(p2, store);
		await svc2.sync([alpha, beta]); // loads from store, no note re-embeds; marks ready
		const out = await svc2.query("alpha", { minScore: 0.5 });
		expect(p2.embedded).toEqual(["alpha"]); // only the query was embedded
		expect(out.map((r) => r.id)).toEqual(["Notes/alpha.md"]);
	});
});
