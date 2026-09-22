import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	TFile: class { path = ""; extension = "md"; },
	Notice: class {
		static shown: string[] = [];
		constructor(public msg?: string) { if (msg) (this.constructor as unknown as { shown: string[] }).shown.push(msg); }
		setMessage(): void {} hide(): void {}
	},
	normalizePath: (p: string) => p,
}));

import { Notice } from "obsidian";
import { VaultRagService } from "../services/VaultRagService";
import { DEFAULT_EMBEDDING_MODEL_ID } from "../models/embeddingModels";
import { BuildGuard, type BuildMarker } from "../services/embedding/buildGuard";
import { serializeIndex } from "../services/embedding/embeddingIndex";
import { FakeProvider, MemStore, fakeApp, settings, conv, DEPS, settle } from "./helpers/vaultRagFixtures";

// ── The crash-loop breaker (ADR-199) ─────────────────────────────────────────

/** A guard over a plain variable — what Obsidian's localStorage is in production. */
const memGuard = (initial: BuildMarker | null = null) => {
	const box = { marker: initial as BuildMarker | null };
	const guard = new BuildGuard({ load: () => box.marker, save: (m) => { box.marker = m; } }, () => 1000);
	return { box, guard };
};

const noticesShown = (): string[] => (Notice as unknown as { shown: string[] }).shown;

describe("VaultRagService — the crash-loop breaker (ADR-199)", () => {
	it("marks a build while it runs and clears the mark when it finishes", async () => {
		const { box, guard } = memGuard();
		let seenDuring: BuildMarker | null = null;
		class Watching extends FakeProvider {
			async embed(texts: string[]): Promise<Float32Array[]> { seenDuring ??= box.marker; return super.embed(texts); }
		}
		const svc = new VaultRagService(fakeApp("hello") as never, () => settings(), () => new Watching(), () => new MemStore(), { ...DEPS, guard });
		await svc.getRelevantNotes(conv, "anything");
		await settle();
		expect(seenDuring).toMatchObject({ attempts: 1, modelId: DEFAULT_EMBEDDING_MODEL_ID });
		expect(box.marker).toBeNull();
	});

	it("does NOT start an automatic build after two builds died, and says so once", async () => {
		// Two markers left behind = two builds the OS killed. The third, started by
		// the next send, is what made Obsidian reload every minute.
		const { guard } = memGuard({ attempts: 2, startedAt: 1, modelId: DEFAULT_EMBEDDING_MODEL_ID });
		const provider = new FakeProvider();
		let providerAsked = 0;
		const svc = new VaultRagService(fakeApp("hello") as never, () => settings(), () => { providerAsked++; return provider; }, () => new MemStore(), { ...DEPS, guard });
		const before = noticesShown().length;
		expect(await svc.getRelevantNotes(conv, "one")).toEqual([]);
		expect(await svc.getRelevantNotes(conv, "two")).toEqual([]);
		await settle();
		expect(provider.embedded).toEqual([]);
		expect(providerAsked).toBe(0); // not even constructed: no "preparing the model" notice
		expect(noticesShown().slice(before).filter((m) => m.includes("paused"))).toHaveLength(1);
		expect((await svc.status()).state).toBe("paused");
	});

	it("still resumes after ONE interrupted build — a swiped-away app is not a crash loop", async () => {
		const { box, guard } = memGuard({ attempts: 1, startedAt: 1, modelId: DEFAULT_EMBEDDING_MODEL_ID });
		const provider = new FakeProvider();
		const svc = new VaultRagService(fakeApp("hello") as never, () => settings(), () => provider, () => new MemStore(), { ...DEPS, guard });
		await svc.getRelevantNotes(conv, "anything");
		await settle();
		expect(provider.embedded.length).toBeGreaterThan(0);
		expect(box.marker).toBeNull();
	});

	it("Build now runs a paused build and forgets the history", async () => {
		const { box, guard } = memGuard({ attempts: 5, startedAt: 1, modelId: DEFAULT_EMBEDDING_MODEL_ID });
		const provider = new FakeProvider();
		const svc = new VaultRagService(fakeApp("hello") as never, () => settings(), () => provider, () => new MemStore(), { ...DEPS, guard });
		svc.buildNow();
		await settle();
		expect(provider.embedded.length).toBeGreaterThan(0);
		expect(box.marker).toBeNull();
		expect((await svc.status()).state).toBe("ready");
	});

	it("an ordinary failure ends the mark — the process survived to report it", async () => {
		const { box, guard } = memGuard();
		class Broken extends FakeProvider { async ready(): Promise<void> { throw new Error("download failed"); } }
		const svc = new VaultRagService(fakeApp("hello") as never, () => settings(), () => new Broken(), () => new MemStore(), { ...DEPS, guard });
		await svc.getRelevantNotes(conv, "anything");
		await settle();
		expect(box.marker).toBeNull();
		expect(await svc.status()).toMatchObject({ state: "failed", error: "download failed", outOfMemory: false });
	});

	it("out of memory KEEPS the mark: it is one allocation short of the kill", async () => {
		const { box, guard } = memGuard();
		class Oom extends FakeProvider { async ready(): Promise<void> { throw new Error("no available backend found. ERR: [wasm] RangeError: Out of memory"); } }
		const svc = new VaultRagService(fakeApp("hello") as never, () => settings(), () => new Oom(), () => new MemStore(), { ...DEPS, guard });
		await svc.getRelevantNotes(conv, "anything");
		await settle();
		expect(box.marker?.attempts).toBe(1);
		expect(await svc.status()).toMatchObject({ state: "failed", outOfMemory: true });
	});

	it("a normal unload mid-build is not counted as a crash", async () => {
		const { box, guard } = memGuard();
		let release!: () => void;
		class Slow extends FakeProvider { ready(): Promise<void> { return new Promise((r) => { release = r; }); } }
		const svc = new VaultRagService(fakeApp("hello") as never, () => settings(), () => new Slow(), () => new MemStore(), { ...DEPS, guard });
		void svc.getRelevantNotes(conv, "anything");
		await settle();
		expect(box.marker?.attempts).toBe(1);
		svc.dispose();
		expect(box.marker).toBeNull();
		release();
	});
});

describe("VaultRagService — status without loading the model (ADR-199)", () => {
	const scopeOf = (svc: VaultRagService): string => (svc as unknown as { scopeSignature(): string }).scopeSignature();
	const fileWith = (complete: boolean, scope: string, rows = 3): MemStore => {
		const store = new MemStore();
		const items = Array.from({ length: rows }, (_, i) => ({ id: `n${i}.md`, contentHash: "h", chunks: [Int8Array.from([1, 0, 0, 0])] }));
		store.buf = serializeIndex(items, 4, { complete, scope });
		return store;
	};
	const make = (store: MemStore) => new VaultRagService(
		fakeApp("hello") as never, () => settings(),
		() => { throw new Error("status must not construct the provider"); },
		() => store, DEPS,
	);

	it("reads a complete index on disk as ready — not 'builds on first use'", async () => {
		const probe = make(new MemStore());
		const svc = make(fileWith(true, scopeOf(probe)));
		expect(await svc.status()).toMatchObject({ state: "ready", count: 3 });
	});

	it("tells unfinished, out-of-date and missing apart", async () => {
		const scope = scopeOf(make(new MemStore()));
		expect((await make(fileWith(false, scope)).status()).state).toBe("partial");
		expect((await make(fileWith(true, "some other scope")).status()).state).toBe("outdated");
		expect((await make(new MemStore()).status()).state).toBe("notBuilt");
	});
});

describe("a variant reads the family's index as its own (ADR-200)", () => {
	const scopeOf = (svc: VaultRagService): string => (svc as unknown as { scopeSignature(): string }).scopeSignature();

	it("phone (variant) and desktop (full model) agree on the scope signature", () => {
		const mk = (modelId: "xenova-paraphrase-multilingual-MiniLM-L12-v2" | "xenova-paraphrase-multilingual-MiniLM-L12-v2-latin") =>
			new VaultRagService(fakeApp("hello") as never, () => settings(), () => new FakeProvider(), () => new MemStore(), { modelId: () => modelId });
		// Different, and the desktop's complete index would read as "outdated" on
		// the phone and be rebuilt — the exact work the variant exists to avoid.
		expect(scopeOf(mk("xenova-paraphrase-multilingual-MiniLM-L12-v2-latin"))).toBe(scopeOf(mk("xenova-paraphrase-multilingual-MiniLM-L12-v2")));
	});

	it("a complete index the desktop wrote is ready on the phone", async () => {
		const desktop = new VaultRagService(fakeApp("hello") as never, () => settings(), () => new FakeProvider(), () => new MemStore(), { modelId: () => "xenova-paraphrase-multilingual-MiniLM-L12-v2" });
		const store = new MemStore();
		store.buf = serializeIndex([{ id: "n.md", contentHash: "h", chunks: [Int8Array.from([1, 0, 0, 0])] }], 4, { complete: true, scope: scopeOf(desktop) });
		const phone = new VaultRagService(fakeApp("hello") as never, () => settings(), () => { throw new Error("must not load"); }, () => store, { modelId: () => "xenova-paraphrase-multilingual-MiniLM-L12-v2-latin" });
		expect((await phone.status()).state).toBe("ready");
	});
});

describe("paused means paused, whatever the file says (ADR-201)", () => {
	const scopeOf = (svc: VaultRagService): string => (svc as unknown as { scopeSignature(): string }).scopeSignature();

	it("reports paused — not ready — for a complete index while automatic builds are blocked", async () => {
		// A paused session never loads the model, so not even a complete index is
		// queried. Calling that "ready" hid a dead vault context behind a green
		// status and disabled the one button that recovers it.
		const { guard } = memGuard({ attempts: 2, startedAt: 1, modelId: DEFAULT_EMBEDDING_MODEL_ID });
		const probe = new VaultRagService(fakeApp("hello") as never, () => settings(), () => new FakeProvider(), () => new MemStore(), DEPS);
		const store = new MemStore();
		store.buf = serializeIndex([{ id: "n.md", contentHash: "h", chunks: [Int8Array.from([1, 0, 0, 0])] }], 4, { complete: true, scope: scopeOf(probe) });
		const svc = new VaultRagService(fakeApp("hello") as never, () => settings(), () => new FakeProvider(), () => store, { ...DEPS, guard });
		const status = await svc.status();
		expect(status).toMatchObject({ state: "paused", count: 1 });
		const { canBuildNow } = await import("../services/embedding/indexStatus");
		expect(canBuildNow(status.state)).toBe(true);
	});
});

describe("loading the model is its own state (ADR-201)", () => {
	it("says loading — not 'building 0 of 0' — until the model is ready", async () => {
		let release!: () => void;
		class Slow extends FakeProvider { ready(): Promise<void> { return new Promise((r) => { release = r; }); } }
		const svc = new VaultRagService(fakeApp("hello") as never, () => settings(), () => new Slow(), () => new MemStore(), DEPS);
		void svc.getRelevantNotes(conv, "anything");
		await settle();
		expect((await svc.status()).state).toBe("loading");
		release();
		await settle();
		expect((await svc.status()).state).toBe("ready");
	});
});

describe("a build marks its marker when Obsidian goes to the background (ADR-202)", () => {
	it("marks a running build, and only a running build", async () => {
		const { box, guard } = memGuard();
		let release!: () => void;
		class Slow extends FakeProvider { ready(): Promise<void> { return new Promise((r) => { release = r; }); } }
		const svc = new VaultRagService(fakeApp("hello") as never, () => settings(), () => new Slow(), () => new MemStore(), { ...DEPS, guard });
		svc.onBackground(true);
		expect(box.marker).toBeNull(); // idle: nothing to mark
		void svc.getRelevantNotes(conv, "anything");
		await settle();
		expect(svc.isBuilding()).toBe(true);
		svc.onBackground(true);
		expect(box.marker?.background).toBe(true);
		svc.onBackground(false);
		expect(box.marker?.background).toBeUndefined();
		release();
		await settle();
		expect(box.marker).toBeNull();
		expect(svc.isBuilding()).toBe(false);
	});
});

