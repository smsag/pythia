import { describe, it, expect } from "vitest";
import {
	applyJournal, COMPACT_MIN_ROWS, deserializeJournal, IndexJournal, serializeJournal, shouldCompact,
} from "../services/embedding/indexJournal";
import { serializeIndex, type IndexedConversation } from "../services/embedding/embeddingIndex";
import { VaultIndexService, type IndexableNote } from "../services/embedding/VaultIndexService";
import type { IndexStore } from "../services/embedding/ConversationIndexService";
import type { EmbeddingProvider } from "../services/embedding/EmbeddingProvider";

const row = (id: string, v = 1): IndexedConversation => ({ id, contentHash: `h-${id}-${v}`, chunks: [Int8Array.from([v, 0, 0, 0])] });

class MemStore implements IndexStore {
	buf: ArrayBuffer | null = null;
	writes = 0;
	bytes = 0;
	async read(): Promise<ArrayBuffer | null> { return this.buf; }
	async write(b: ArrayBuffer): Promise<void> { this.buf = b; this.writes++; this.bytes += b.byteLength; }
}

/** An index store with a journal beside it, as `VaultIndexStore` has. */
class JournaledStore extends MemStore {
	readonly journalStore = new MemStore();
	journal(): IndexStore { return this.journalStore; }
}

class FakeProvider implements EmbeddingProvider {
	readonly dim = 4;
	embedded: string[] = [];
	async ready(): Promise<void> {}
	async embed(texts: string[]): Promise<Float32Array[]> {
		this.embedded.push(...texts);
		return texts.map((t) => Float32Array.from([t.includes("alpha") ? 1 : 0, t.includes("beta") ? 1 : 0, 1, 0]));
	}
	unload(): void {}
}

const note = (path: string, text: string): IndexableNote => ({ path, load: async () => text });
const vault = (n: number): IndexableNote[] => Array.from({ length: n }, (_, i) => note(`Notes/${i}.md`, `note ${i} beta`));

describe("shouldCompact — when the journal is folded back into the base (ADR-221)", () => {
	it("never below the floor, however small the base", () => {
		expect(shouldCompact(COMPACT_MIN_ROWS - 1, 10)).toBe(false);
		expect(shouldCompact(COMPACT_MIN_ROWS, 10)).toBe(true);
	});
	it("at five percent of a large base", () => {
		expect(shouldCompact(249, 5000)).toBe(false);
		expect(shouldCompact(250, 5000)).toBe(true);
	});
});

describe("the journal file", () => {
	it("round-trips its rows, removals, base and signature", () => {
		const buf = serializeJournal({ base: 111, upserts: [row("a")], removed: ["b"], keeper: "desktop", writtenAt: 222 }, 4);
		expect(deserializeJournal(buf, 4)).toEqual({ base: 111, upserts: [row("a")], removed: ["b"], keeper: "desktop", writtenAt: 222 });
	});

	it("is not a journal when it names no base, has another dimension, or is torn", () => {
		expect(deserializeJournal(serializeIndex([row("a")], 4, { complete: true, scope: "" }), 4)).toBeNull(); // a base, not a journal
		expect(deserializeJournal(serializeJournal({ base: 1, upserts: [], removed: [] }, 4), 8)).toBeNull();
		expect(deserializeJournal(new ArrayBuffer(3), 4)).toBeNull();
	});

	it("keeps only string ids among its removals", () => {
		const buf = serializeIndex([], 4, { complete: false, scope: "" }, { journalOf: 1, removed: ["a", 2, null, "b"] });
		expect(deserializeJournal(buf, 4)?.removed).toEqual(["a", "b"]);
	});

	it("applies as: upserts replace or add, removals drop, the rest stays", () => {
		const out = applyJournal([row("a"), row("b"), row("c")], { upserts: [row("b", 2), row("d")], removed: ["c"] });
		expect(out.map((r) => r.contentHash)).toEqual(["h-a-1", "h-b-2", "h-d-1"]);
	});
});

describe("IndexJournal — in memory", () => {
	it("a row is either upserted or removed, the last change wins", () => {
		const j = new IndexJournal(new MemStore());
		j.reset(1);
		j.record("a", row("a"));
		j.record("a", undefined);
		j.record("b", undefined);
		j.record("b", row("b"));
		expect(j.rows).toBe(2);
	});

	it("takes nothing without a base to attach to — a file from before ADR-220", () => {
		const j = new IndexJournal(new MemStore());
		j.reset(undefined);
		expect(j.canTake(1000)).toBe(false);
	});

	it("ignores a journal on disk that extends another base", async () => {
		const store = new MemStore();
		store.buf = serializeJournal({ base: 1, upserts: [row("x")], removed: [] }, 4);
		const j = new IndexJournal(store);
		const out = await j.load(2, [row("a")], 4);
		expect(out.items).toEqual([row("a")]);
		expect(j.rows).toBe(0);
	});
});

describe("VaultIndexService with a journal — an edit writes kilobytes, not the index (ADR-221)", () => {
	async function built(n = 200): Promise<{ store: JournaledStore; svc: VaultIndexService }> {
		const store = new JournaledStore();
		const svc = new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 });
		await svc.sync(vault(n), undefined, {}, "S");
		return { store, svc };
	}

	it("an edit goes to the journal; the index file is not touched", async () => {
		const { store, svc } = await built();
		const baseWrites = store.writes;
		await svc.applyBatch({ updates: [note("Notes/new.md", "an alpha note")], removes: ["Notes/3.md"] });
		expect(store.writes).toBe(baseWrites);
		expect(store.journalStore.writes).toBe(1);
		// One row in the journal against 200 in the base.
		expect(store.journalStore.buf!.byteLength * 20).toBeLessThan(store.buf!.byteLength);
	});

	it("the next session reads the index and its journal as one", async () => {
		const { store, svc } = await built();
		await svc.applyBatch({ updates: [note("Notes/new.md", "an alpha note")], removes: ["Notes/3.md"] });
		const next = new VaultIndexService(new FakeProvider(), store);
		await next.hydrateForQuery();
		expect(next.size()).toBe(200); // 200 − 1 + 1
		expect((await next.query("alpha", { minScore: 0.9 })).map((r) => r.id)).toEqual(["Notes/new.md"]);
		expect(next.isComplete("S")).toBe(true);
	});

	it("carries earlier journal entries forward across a session", async () => {
		const { store, svc } = await built();
		await svc.applyBatch({ updates: [note("Notes/one.md", "alpha one")], removes: [] });
		const next = new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 });
		await next.hydrateForQuery();
		await next.applyBatch({ updates: [note("Notes/two.md", "alpha two")], removes: [] });
		const third = new VaultIndexService(new FakeProvider(), store);
		await third.hydrateForQuery();
		expect(third.size()).toBe(202);
	});

	it("folds the journal back into the index once it has outgrown it", async () => {
		const { store, svc } = await built(100);
		const baseWrites = store.writes;
		for (let i = 0; i < COMPACT_MIN_ROWS; i++) {
			await svc.applyBatch({ updates: [note(`Notes/extra-${i}.md`, `alpha ${i}`)], removes: [] });
		}
		expect(store.writes).toBe(baseWrites + 1); // the compaction
		const next = new VaultIndexService(new FakeProvider(), store);
		await next.hydrateForQuery();
		expect(next.size()).toBe(100 + COMPACT_MIN_ROWS); // nothing lost in the fold
	});

	it("a rewritten index leaves the old journal behind, ignored", async () => {
		const { store, svc } = await built();
		await svc.applyBatch({ updates: [note("Notes/new.md", "an alpha note")], removes: [] });
		await new Promise((r) => setTimeout(r, 2)); // the next base carries a later writtenAt
		await svc.sync(vault(200), undefined, {}, "S"); // a full sync drops new.md and rewrites the base
		const next = new VaultIndexService(new FakeProvider(), store);
		await next.hydrateForQuery();
		expect(next.size()).toBe(200);
		expect((await next.query("alpha", { minScore: 0.9 })).map((r) => r.id)).toEqual([]);
	});

	it("an index from before ADR-220, with no write time, is rewritten once and journaled after", async () => {
		const store = new JournaledStore();
		store.buf = serializeIndex(vault(10).map((n, i) => row(n.path, i)), 4, { complete: true, scope: "S" });
		const svc = new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 });
		await svc.hydrateForQuery();
		await svc.applyBatch({ updates: [note("Notes/a.md", "alpha")], removes: [] });
		expect([store.writes, store.journalStore.writes]).toEqual([1, 0]);
		await svc.applyBatch({ updates: [note("Notes/b.md", "alpha b")], removes: [] });
		expect([store.writes, store.journalStore.writes]).toEqual([1, 1]);
	});
});
