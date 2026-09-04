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

// Track loads so tests can assert content is read lazily, once per note per sync.
const loads: string[] = [];
const note = (path: string, content: string): IndexableNote => ({
	path,
	load: async () => { loads.push(path); return content; },
});

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

	it("reads note content lazily — once per note per sync (bounded memory, ADR-120)", async () => {
		loads.length = 0;
		const svc = new VaultIndexService(new FakeProvider(), new MemStore());
		await svc.sync([alpha, beta, gamma]);
		expect(loads).toEqual(["Notes/alpha.md", "Notes/beta.md", "Notes/gamma.md"]);
	});

	it("reports progress per processed note against the total", async () => {
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

	// ── Targeted incremental updates (event-driven watcher, ADR-121) ──────────

	it("updateNote re-embeds only the changed note and leaves the rest", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		await svc.sync([alpha, beta]);
		p.embedded = [];
		await svc.updateNote(note("Notes/alpha.md", "alpha topics — revised"));
		expect(p.embedded.every((t) => t.includes("alpha"))).toBe(true);
		expect(p.embedded.length).toBeGreaterThan(0);
		expect(svc.size()).toBe(2);
	});

	it("updateNote is a no-op when the content is unchanged", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		await svc.sync([alpha, beta]);
		p.embedded = [];
		await svc.updateNote(alpha); // same content
		expect(p.embedded).toEqual([]);
	});

	it("updateNote adds a brand-new note", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		await svc.sync([alpha]);
		await svc.updateNote(beta);
		expect(svc.size()).toBe(2);
		expect((await svc.query("beta", { minScore: 0.5 })).map((r) => r.id)).toEqual(["Notes/beta.md"]);
	});

	it("updateNote respects the cap for NEW notes but still updates existing ones", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		await svc.sync([alpha, beta]); // size 2
		await svc.updateNote(gamma, { cap: 2 }); // new, at cap → skipped
		expect(svc.size()).toBe(2);
		await svc.updateNote(note("Notes/alpha.md", "alpha revised"), { cap: 2 }); // existing → allowed
		expect(svc.size()).toBe(2);
	});

	it("updateNote drops a note that became empty", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		await svc.sync([alpha, beta]);
		await svc.updateNote(note("Notes/alpha.md", "   "));
		expect(svc.size()).toBe(1);
		expect((await svc.query("alpha", { minScore: 0.5 })).find((r) => r.id === "Notes/alpha.md")).toBeUndefined();
	});

	it("updateNote no-ops until the index is built (isReady)", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		await svc.updateNote(alpha); // never synced → not ready
		expect(p.embedded).toEqual([]);
		expect(svc.size()).toBe(0);
	});

	it("applyBatch persists ONCE for many changes (ADR-122)", async () => {
		const p = new FakeProvider();
		const store = new MemStore();
		const svc = new VaultIndexService(p, store);
		await svc.sync([alpha, beta, gamma]); // writes: 1
		const writesAfterSync = store.writes;
		await svc.applyBatch(
			{
				updates: [note("Notes/alpha.md", "alpha revised"), note("Notes/delta.md", "brand new alpha-ish")],
				removes: ["Notes/beta.md"],
			},
			{},
		);
		// One edit + one add + one remove → a SINGLE index write, not three.
		expect(store.writes).toBe(writesAfterSync + 1);
		expect(svc.size()).toBe(3); // alpha(updated) + gamma + delta; beta removed
	});

	it("applyBatch does not write when nothing actually changed", async () => {
		const p = new FakeProvider();
		const store = new MemStore();
		const svc = new VaultIndexService(p, store);
		await svc.sync([alpha, beta]);
		const before = store.writes;
		await svc.applyBatch({ updates: [alpha], removes: ["Notes/ghost.md"] }, {}); // unchanged + non-existent
		expect(store.writes).toBe(before);
	});

	it("removeNote drops a note from the index", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		await svc.sync([alpha, beta]);
		await svc.removeNote("Notes/alpha.md");
		expect(svc.size()).toBe(1);
		expect((await svc.query("alpha", { minScore: 0.5 })).find((r) => r.id === "Notes/alpha.md")).toBeUndefined();
	});

	it("hydrateForQuery makes a persisted index queryable WITHOUT embedding any notes (mobile)", async () => {
		const store = new MemStore();
		await new VaultIndexService(new FakeProvider(), store).sync([alpha, beta]); // built on "desktop"

		// "Mobile": hydrate only — never syncs notes.
		const p2 = new FakeProvider();
		const svc2 = new VaultIndexService(p2, store);
		expect(svc2.isReady()).toBe(false);
		await svc2.hydrateForQuery();
		expect(svc2.isReady()).toBe(true);
		expect(svc2.size()).toBe(2); // loaded from the synced index
		const out = await svc2.query("alpha", { minScore: 0.5 });
		expect(out.map((r) => r.id)).toEqual(["Notes/alpha.md"]);
		expect(p2.embedded).toEqual(["alpha"]); // ONLY the query was embedded — no notes
	});

	it("hydrateForQuery on an empty store is ready but returns [] (no desktop index yet)", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		await svc.hydrateForQuery();
		expect(svc.isReady()).toBe(true);
		expect(svc.size()).toBe(0);
		expect(await svc.query("alpha", { minScore: 0.5 })).toEqual([]);
		expect(p.embedded).toEqual([]); // empty index short-circuits before embedding the query
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
