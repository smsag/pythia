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

	it("sync honours a fine throttle cadence and still indexes every note (ADR-125)", async () => {
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, new MemStore());
		// yieldEveryNotes:1 = yield after every note (the UI-thread build cadence).
		await svc.sync([alpha, beta, gamma], undefined, { yieldEveryNotes: 1, breatherMs: 0 });
		expect(svc.size()).toBe(3);
		expect((await svc.query("alpha", { minScore: 0.5 })).map((r) => r.id)).toEqual(["Notes/alpha.md"]);
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

// ── ADR-179: a build must survive being interrupted ──────────────────────────
describe("VaultIndexService — crash-safe build (ADR-179)", () => {
	/** Fails on one specific note, the way an embed timeout does on a huge one. */
	class FlakyProvider extends FakeProvider {
		constructor(private readonly poison: string) { super(); }
		async embed(texts: string[]): Promise<Float32Array[]> {
			if (texts.some((t) => t.includes(this.poison))) throw new Error("embed failed");
			return super.embed(texts);
		}
	}

	const many = (n: number): IndexableNote[] =>
		Array.from({ length: n }, (_, i) => note(`Notes/n${i}.md`, `note ${i} about alpha`));

	it("persists partway through a long build, not only at the end", async () => {
		const store = new MemStore();
		const svc = new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 });
		await svc.sync(many(60));
		// 60 notes past a 25-note flush interval: two mid-build writes plus the final.
		expect(store.writes).toBeGreaterThan(1);
	});

	it("commits what it embedded when the provider dies mid-build, then rethrows", async () => {
		const store = new MemStore();
		// Dies for good partway through — an unloaded provider, not one bad note.
		class DyingProvider extends FakeProvider {
			async embed(texts: string[]): Promise<Float32Array[]> {
				if (this.embedded.length >= 30) throw new Error("Embedding provider unloaded");
				return super.embed(texts);
			}
		}
		const s = new VaultIndexService(new DyingProvider(), store, { persistIntervalMs: 0 });
		await expect(s.sync(many(60))).rejects.toThrow();
		expect(store.buf).not.toBeNull(); // the ~30 embedded notes survived the failure

		// And a RESTART resumes from them rather than starting over.
		const p2 = new FakeProvider();
		await new VaultIndexService(p2, store, { persistIntervalMs: 0 }).sync(many(60));
		expect(p2.embedded.length).toBeLessThan(60);
	});

	it("resumes on the SAME instance, not only after a restart", async () => {
		// `load()` is a no-op once `loaded` is set, so a partial persist that updated
		// only the store left `this.items` holding the stale pre-sync list — and the
		// next sync on this instance rebuilt `existing` from it and re-embedded
		// everything the failed pass had just saved. A fresh-instance test cannot see
		// this: it reads the store. Retrying in place is the common case (the vault
		// refresh runs again on the next turn), so it is the one that must work.
		const store = new MemStore();
		let dead = true;
		class RecoveringProvider extends FakeProvider {
			async embed(texts: string[]): Promise<Float32Array[]> {
				if (dead && this.embedded.length >= 30) throw new Error("backend gone");
				return super.embed(texts);
			}
		}
		const p = new RecoveringProvider();
		const svc = new VaultIndexService(p, store, { persistIntervalMs: 0 });
		await expect(svc.sync(many(60))).rejects.toThrow();
		const embeddedBeforeRetry = p.embedded.length;

		dead = false;
		await svc.sync(many(60)); // same instance
		// Only the ~30 notes the first pass never reached cost an embed the second
		// time. Re-embedding all 60 here is the regression.
		expect(p.embedded.length - embeddedBeforeRetry).toBeLessThan(45);
		expect(svc.size()).toBe(60);
	});

	it("drops a note whose embed fails instead of discarding the whole build", async () => {
		const store = new MemStore();
		const p = new FlakyProvider("beta");
		const s = new VaultIndexService(p, store, { persistIntervalMs: 0 });
		await s.sync([alpha, beta, gamma]);
		// The build COMPLETED — before ADR-179 one bad note threw out of doSync, so
		// the index never became ready and every retry failed identically.
		expect(s.isReady()).toBe(true);
		expect(s.size()).toBe(2); // alpha + gamma; beta dropped
		expect(await s.query("alpha", { minScore: 0.5 })).toHaveLength(1);
	});

	it("a resumed build re-embeds only what the interrupted one did not reach", async () => {
		const store = new MemStore();
		const first = new VaultIndexService(new FlakyProvider("gamma"), store, { persistIntervalMs: 0 });
		await first.sync([alpha, beta, gamma]); // gamma dropped, alpha+beta persisted

		const p2 = new FakeProvider();
		await new VaultIndexService(p2, store, { persistIntervalMs: 0 }).sync([alpha, beta, gamma]);
		// alpha and beta came back from disk; only gamma cost an embed this time.
		expect(p2.embedded.some((t) => t.includes("gamma"))).toBe(true);
		expect(p2.embedded.some((t) => t.includes("alpha"))).toBe(false);
	});

	it("a mid-build flush never drops notes the pass has not reached yet", async () => {
		const store = new MemStore();
		const notes = many(60);
		await new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 }).sync(notes);

		// Re-sync with one note changed: the flush snapshots must carry the other 59
		// unchanged vectors, not just the handful rebuilt so far.
		const changed = [...notes];
		changed[5] = note("Notes/n5.md", "now about beta instead");
		const s2 = new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 });
		await s2.sync(changed);
		expect(s2.size()).toBe(60);
	});
});

// ── ADR-179: the write rate is bounded, not just the loss window ─────────────
describe("VaultIndexService — persist throttling (ADR-179)", () => {
	const many = (n: number): IndexableNote[] =>
		Array.from({ length: n }, (_, i) => note(`Notes/t${i}.md`, `note ${i} about alpha`));

	it("does NOT rewrite the whole index every 25 embeds when they are fast", async () => {
		// Every persist serializes the entire index (~19 MB at the 5k cap). With the
		// embed count alone, a cold build at that size would do ~200 full rewrites —
		// and on a synced vault, 200 sync events. The clock floor is what stops it.
		const store = new MemStore();
		await new VaultIndexService(new FakeProvider(), store).sync(many(200));
		expect(store.writes).toBe(1); // only the final one; nothing is 30s apart here
	});

	it("still flushes mid-build once the interval has elapsed", async () => {
		const store = new MemStore();
		await new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 }).sync(many(60));
		expect(store.writes).toBeGreaterThan(1);
	});

	it("an interrupted build persists regardless of the interval", async () => {
		// The rescue write is not throttled: the whole point is that the work is not
		// lost, and by then there is no "later" to defer to.
		const store = new MemStore();
		class DyingProvider extends FakeProvider {
			async embed(texts: string[]): Promise<Float32Array[]> {
				if (this.embedded.length >= 30) throw new Error("backend gone");
				return super.embed(texts);
			}
		}
		// Default (30s) interval, so no mid-build flush can have happened.
		const svc = new VaultIndexService(new DyingProvider(), store);
		await expect(svc.sync(many(60))).rejects.toThrow();
		expect(store.writes).toBe(1);
		expect(svc.size()).toBeGreaterThan(0);
	});
});

describe("VaultIndexService — failure streak (ADR-179)", () => {
	class PoisonProvider extends FakeProvider {
		constructor(private readonly poison: string) { super(); }
		async embed(texts: string[]): Promise<Float32Array[]> {
			if (texts.some((t) => t.includes(this.poison))) throw new Error("embed failed");
			return super.embed(texts);
		}
	}

	it("five bad notes SCATTERED through an unchanged vault do not abort the build", async () => {
		// The streak must reset on a note whose vectors are REUSED, not only on a
		// successful embed. Otherwise five bad notes anywhere in a mostly-unchanged
		// vault trip the dead-backend guard and the build never completes — which is
		// the original bug, reinstated by its own safety valve.
		const store = new MemStore();
		const settled = Array.from({ length: 20 }, (_, i) => note(`Notes/s${i}.md`, `settled ${i} alpha`));
		await new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 }).sync(settled);

		// Interleave 5 notes that always fail among the 20 unchanged ones.
		const withPoison: IndexableNote[] = [];
		settled.forEach((n, i) => {
			withPoison.push(n);
			if (i % 4 === 0) withPoison.push(note(`Notes/bad${i}.md`, "poison content"));
		});
		const svc = new VaultIndexService(new PoisonProvider("poison"), store, { persistIntervalMs: 0 });
		await expect(svc.sync(withPoison)).resolves.toBeUndefined();
		expect(svc.isReady()).toBe(true);
		expect(svc.size()).toBe(20); // the 20 good notes kept, the 5 bad ones dropped
	});

	it("but five bad notes IN A ROW still stop the build", async () => {
		const store = new MemStore();
		const notes = Array.from({ length: 8 }, (_, i) => note(`Notes/b${i}.md`, "poison content"));
		const svc = new VaultIndexService(new PoisonProvider("poison"), store, { persistIntervalMs: 0 });
		await expect(svc.sync(notes)).rejects.toThrow();
		expect(svc.isReady()).toBe(false);
	});
});
