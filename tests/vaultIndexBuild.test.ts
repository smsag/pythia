// The BUILD half of VaultIndexService: what happens when a build is interrupted,
// how often it writes, when it gives up on a note, and what the persisted index
// says about itself (ADR-182/181). Split from VaultIndexService.test.ts, which
// keeps the sync/query behaviour, when that file outgrew the size ratchet.
import { describe, it, expect } from "vitest";
import { VaultIndexService, type IndexableNote } from "../services/embedding/VaultIndexService";
import type { IndexStore } from "../services/embedding/ConversationIndexService";
import type { EmbeddingProvider } from "../services/embedding/EmbeddingProvider";
import { deserializeIndex } from "../services/embedding/embeddingIndex";

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

const note = (path: string, content: string): IndexableNote => ({ path, load: async () => content });
const alpha = note("Notes/alpha.md", "all about alpha topics");
const beta = note("Notes/beta.md", "all about beta topics");
const gamma = note("Notes/gamma.md", "unrelated gamma material");

// ── ADR-182: a build must survive being interrupted ──────────────────────────
describe("VaultIndexService — crash-safe build (ADR-182)", () => {
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
		// The build COMPLETED — before ADR-182 one bad note threw out of doSync, so
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

// ── ADR-182: the write rate is bounded, not just the loss window ─────────────
describe("VaultIndexService — persist throttling (ADR-182)", () => {
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

describe("VaultIndexService — failure streak (ADR-182)", () => {
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

// ── ADR-184: the index knows whether it finished, and what it indexed ────────
describe("VaultIndexService — completeness (ADR-184)", () => {
	const many = (n: number): IndexableNote[] =>
		Array.from({ length: n }, (_, i) => note(`Notes/c${i}.md`, `note ${i} alpha`));

	it("is not complete until a build finishes", async () => {
		const store = new MemStore();
		const svc = new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 });
		expect(svc.isComplete("S")).toBe(false);
		await svc.sync([alpha, beta], undefined, {}, "S");
		expect(svc.isComplete("S")).toBe(true);
	});

	it("an INTERRUPTED build leaves the index incomplete, rows and all", async () => {
		// This is the bug ADR-182 created and ADR-184 closes: partial persistence
		// made "has rows" stop meaning "is built", and every reader that asked
		// size() > 0 started calling a fraction of a vault done.
		const store = new MemStore();
		class DyingProvider extends FakeProvider {
			async embed(texts: string[]): Promise<Float32Array[]> {
				if (this.embedded.length >= 30) throw new Error("gone");
				return super.embed(texts);
			}
		}
		const svc = new VaultIndexService(new DyingProvider(), store, { persistIntervalMs: 0 });
		await expect(svc.sync(many(60), undefined, {}, "S")).rejects.toThrow();
		expect(svc.size()).toBeGreaterThan(0); // rows were kept
		expect(svc.isComplete("S")).toBe(false); // but nobody may call it built

		// And a FRESH session reading that file agrees.
		const reopened = new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 });
		await reopened.hydrateForQuery();
		expect(reopened.size()).toBeGreaterThan(0);
		expect(reopened.isComplete("S")).toBe(false);
	});

	it("a completed build survives a restart as complete", async () => {
		const store = new MemStore();
		await new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 }).sync([alpha, beta], undefined, {}, "S");
		const reopened = new VaultIndexService(new FakeProvider(), store);
		await reopened.hydrateForQuery();
		expect(reopened.isComplete("S")).toBe(true);
	});

	it("is NOT complete for a different scope, even though the rows are fine", async () => {
		// Narrowing the folders has to drop what is now outside them; only a rebuild
		// does that, so the index must report itself unfinished for the new scope.
		const store = new MemStore();
		const svc = new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 });
		await svc.sync([alpha, beta], undefined, {}, "SCOPE-WIDE");
		expect(svc.isComplete("SCOPE-WIDE")).toBe(true);
		expect(svc.isComplete("SCOPE-NARROW")).toBe(false);
		expect(svc.indexedScope()).toBe("SCOPE-WIDE");
	});

	it("marks a no-op re-sync complete when the file did not say so", async () => {
		// Resuming a build that turns out to have nothing left to embed still has to
		// record that it finished — otherwise it re-scans forever.
		const store = new MemStore();
		await new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 }).sync([alpha], undefined, {}, "S");
		const raw = store.buf!;
		// Re-open and sync the same notes under the same scope: nothing to embed.
		const svc = new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 });
		await svc.sync([alpha], undefined, {}, "S");
		expect(svc.isComplete("S")).toBe(true);
		expect(raw).not.toBeNull();
	});

	it("clear() resets completeness so the next build really rebuilds", async () => {
		const store = new MemStore();
		const svc = new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 });
		await svc.sync([alpha, beta], undefined, {}, "S");
		await svc.clear();
		expect(svc.isComplete("S")).toBe(false);
	});

	it("a watcher edit neither completes nor invalidates the index", async () => {
		const store = new MemStore();
		const svc = new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 });
		await svc.sync([alpha, beta], undefined, {}, "S");
		await svc.updateNote(note("Notes/alpha.md", "alpha revised"));
		expect(svc.isComplete("S")).toBe(true);

		const reopened = new VaultIndexService(new FakeProvider(), store);
		await reopened.hydrateForQuery();
		expect(reopened.isComplete("S")).toBe(true); // the flag survived the batch write
	});
});

describe("VaultIndexService — every mid-build write says it is unfinished (ADR-184)", () => {
	/** Records what each write CLAIMED about itself, not just that it happened. */
	class RecordingStore implements IndexStore {
		buf: ArrayBuffer | null = null;
		claims: boolean[] = [];
		async read(): Promise<ArrayBuffer | null> { return this.buf; }
		async write(b: ArrayBuffer): Promise<void> {
			this.buf = b;
			this.claims.push(deserializeIndex(b).meta.complete);
		}
	}

	const many = (n: number): IndexableNote[] =>
		Array.from({ length: n }, (_, i) => note(`Notes/w${i}.md`, `note ${i} alpha`));

	it("flushes mid-build as INCOMPLETE and only the final write as complete", async () => {
		// A mid-build flush that claimed completion would be worse than not
		// flushing at all: the rows survive AND the next session believes them.
		const store = new RecordingStore();
		await new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 }).sync(many(60), undefined, {}, "S");
		expect(store.claims.length).toBeGreaterThan(1); // there were mid-build flushes
		expect(store.claims.slice(0, -1).every((c) => c === false)).toBe(true);
		expect(store.claims[store.claims.length - 1]).toBe(true);
	});

	it("the rescue write on failure is incomplete too", async () => {
		const store = new RecordingStore();
		class DyingProvider extends FakeProvider {
			async embed(texts: string[]): Promise<Float32Array[]> {
				if (this.embedded.length >= 30) throw new Error("gone");
				return super.embed(texts);
			}
		}
		const svc = new VaultIndexService(new DyingProvider(), store, { persistIntervalMs: 0 });
		await expect(svc.sync(many(60), undefined, {}, "S")).rejects.toThrow();
		expect(store.claims.length).toBeGreaterThan(0);
		expect(store.claims.every((c) => c === false)).toBe(true);
	});
});
