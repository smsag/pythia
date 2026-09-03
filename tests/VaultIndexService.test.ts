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

	it("retrieves the notes most relevant to a query, above the floor", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		const out = await svc.retrieve("tell me about alpha", [alpha, beta, gamma], { minScore: 0.5 });
		expect(out.map((r) => r.id)).toEqual(["Notes/alpha.md"]);
		expect(out[0].score).toBeGreaterThan(0.9);
	});

	it("applies the limit", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		// Two alpha notes both match the query; limit to one.
		const alpha2 = note("Notes/alpha2.md", "more alpha discussion");
		const out = await svc.retrieve("alpha", [alpha, alpha2, beta], { minScore: 0.5, limit: 1 });
		expect(out.length).toBe(1);
	});

	it("drops a removed note from later retrievals", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		await svc.retrieve("alpha", [alpha, beta], { minScore: 0.5 });
		const out = await svc.retrieve("beta", [beta], { minScore: 0.5 });
		expect(out.find((r) => r.id === "Notes/alpha.md")).toBeUndefined();
	});

	it("skips empty notes (no chunks to embed)", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		const out = await svc.retrieve("alpha", [alpha, note("Notes/empty.md", "   ")], { minScore: 0.5 });
		expect(out.find((r) => r.id === "Notes/empty.md")).toBeUndefined();
		expect(out.map((r) => r.id)).toEqual(["Notes/alpha.md"]);
	});

	it("returns [] for an empty query without embedding", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		const out = await svc.retrieve("   ", [alpha, beta], { minScore: 0.5 });
		expect(out).toEqual([]);
	});

	it("serves retrieval from a persisted index without re-embedding notes", async () => {
		const store = new MemStore();
		await new VaultIndexService(new FakeProvider(), store).sync([alpha, beta]);

		const p2 = new FakeProvider(); // fresh: embedded starts empty
		const svc2 = new VaultIndexService(p2, store);
		const out = await svc2.retrieve("alpha", [alpha, beta], { minScore: 0.5 });
		// Only the query itself is embedded — the note vectors come from the store.
		expect(p2.embedded).toEqual(["alpha"]);
		expect(out.map((r) => r.id)).toEqual(["Notes/alpha.md"]);
	});
});
