import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	TFile: class { path = ""; extension = "md"; },
	Notice: class { constructor(public msg?: string) {} setMessage(): void {} hide(): void {} },
	normalizePath: (p: string) => p,
}));

import { VaultRagService } from "../services/VaultRagService";
import { BuildGuard, type BuildMarker } from "../services/embedding/buildGuard";
import { FakeProvider, MemStore, fakeApp, settings, conv, DEPS, settle } from "./helpers/vaultRagFixtures";

// What the index does after something went wrong, and what a phone does with an
// index that is already finished (ADR-203). Every case here was found by reading
// the ADR-199..202 work back; each one reproduces on a phone.

/** The mobile backend: no Worker, so `refresh` takes the hydrate short-circuit. */
class UiProvider extends FakeProvider {
	isOffThread(): boolean { return false; }
}

/** A guard over a plain variable — what Obsidian's localStorage is in production. */
const memGuard = () => {
	const box = { marker: null as BuildMarker | null };
	return { box, guard: new BuildGuard({ load: () => box.marker, save: (m) => { box.marker = m; } }, () => 1000) };
};

/** One seed note, plus whatever the test edits. */
const vault = (read: (path: string) => string) => ({
	vault: {
		getMarkdownFiles: () => [{ path: "Notes/seed.md", stat: { mtime: 1 } }],
		cachedRead: async (f: { path: string }) => read(f.path),
		getAbstractFileByPath: () => null,
	},
	metadataCache: { getFileCache: () => ({ frontmatter: undefined }) },
});

describe("one failed load is one failed load (#358)", () => {
	/** Fails to load, and keeps failing — a provider that has memoized its rejection. */
	class OomProvider extends FakeProvider {
		loads = 0;
		async ready(): Promise<void> { this.loads++; throw new Error("RangeError: Out of memory"); }
	}

	it("does not count later sends as further dead builds", async () => {
		const { box, guard } = memGuard();
		const provider = new OomProvider();
		const svc = new VaultRagService(
			fakeApp("hello") as never, () => settings(), () => provider, () => new MemStore(), { ...DEPS, guard },
		);

		await svc.getRelevantNotes(conv, "first send");
		await settle();
		expect((await svc.status()).outOfMemory).toBe(true);
		expect(box.marker?.attempts).toBe(1);

		// Before: each of these re-entered the build, failed on the memoized
		// rejection and left another marker — so the THIRD send reported "the last 2
		// builds ended without finishing" and paused a build that failed once.
		await svc.getRelevantNotes(conv, "second send");
		await svc.getRelevantNotes(conv, "third send");
		await settle();
		expect(box.marker?.attempts).toBe(1);
		expect(guard.mayAutoBuild()).toBe(true);
		expect((await svc.status()).state).toBe("failed");
	});

	it("does not hammer a provider that cannot load", async () => {
		const provider = new OomProvider();
		const svc = new VaultRagService(fakeApp("hello") as never, () => settings(), () => provider, () => new MemStore(), DEPS);
		for (const q of ["one", "two", "three", "four"]) await svc.getRelevantNotes(conv, q);
		await settle();
		expect(provider.loads).toBe(1);
	});

	it("but Build now still tries again — the user asked (#357)", async () => {
		const { guard } = memGuard();
		let fail = true;
		class Flaky extends FakeProvider {
			loads = 0;
			async ready(): Promise<void> { this.loads++; if (fail) throw new Error("RangeError: Out of memory"); }
		}
		const provider = new Flaky();
		const svc = new VaultRagService(
			fakeApp("hello") as never, () => settings(), () => provider, () => new MemStore(), { ...DEPS, guard },
		);
		await svc.getRelevantNotes(conv, "send");
		await settle();
		fail = false; // the user closed Obsidian's other tabs, or just pressed again
		svc.buildNow();
		await settle();
		expect(provider.loads).toBe(2);
		expect((await svc.status()).state).toBe("ready");
	});
});

describe("edits made before the first send reach a finished index (#360)", () => {
	it("replays them on the phone's short-circuit, not only after a build", async () => {
		// Session one: a complete index, written by this device or synced from the
		// desktop (ADR-200 shares the file).
		const store = new MemStore();
		const first = new VaultRagService(
			vault(() => "seed alpha") as never, () => settings(), () => new UiProvider(), () => store, DEPS,
		);
		await first.getRelevantNotes(conv, "seed");
		await settle();

		// Session two, on a phone: the user edits a note, THEN sends. The edit is
		// buffered because the index is not hydrated yet — and the hydrate path
		// returned without replaying it, so the note kept its old vector until it
		// was edited again after a build.
		const provider = new UiProvider();
		const svc = new VaultRagService(
			vault((p) => (p === "Notes/edited.md" ? "REPLAYED EDIT alpha" : "seed alpha")) as never,
			() => settings(), () => provider, () => store, DEPS,
		);
		await svc.applyChanges([{ path: "Notes/edited.md", extension: "md" } as never], []);
		expect(provider.embedded.join(" ")).not.toContain("REPLAYED EDIT");

		await svc.getRelevantNotes(conv, "seed");
		await settle();
		expect(svc.isReady()).toBe(true);
		expect(provider.embedded.join(" ")).toContain("REPLAYED EDIT");
	});

	it("does not replay them twice", async () => {
		const store = new MemStore();
		const first = new VaultRagService(
			vault(() => "seed alpha") as never, () => settings(), () => new UiProvider(), () => store, DEPS,
		);
		await first.getRelevantNotes(conv, "seed");
		await settle();

		const provider = new UiProvider();
		const svc = new VaultRagService(
			vault((p) => (p === "Notes/edited.md" ? "REPLAYED EDIT alpha" : "seed alpha")) as never,
			() => settings(), () => provider, () => store, DEPS,
		);
		await svc.applyChanges([{ path: "Notes/edited.md", extension: "md" } as never], []);
		await svc.getRelevantNotes(conv, "seed");
		await settle();
		await svc.getRelevantNotes(conv, "another turn");
		await settle();
		expect(provider.embedded.filter((t) => t.includes("REPLAYED EDIT")).length).toBe(1);
	});
});

describe("the status line does not re-read the whole index (#361)", () => {
	/** Counts what the status path costs: `read()` returns the WHOLE binary. */
	class CountingStore extends MemStore {
		reads = 0;
		async read(): Promise<ArrayBuffer | null> { this.reads++; return super.read(); }
	}

	it("reads the file once, however often the settings row asks", async () => {
		const store = new CountingStore();
		const svc = new VaultRagService(fakeApp("hello") as never, () => settings(), () => new FakeProvider(), () => store, DEPS);
		await svc.status();
		await svc.status();
		await svc.status();
		expect(store.reads).toBe(1);
	});

	it("reads it again once a build could have changed it", async () => {
		const store = new CountingStore();
		const svc = new VaultRagService(fakeApp("hello") as never, () => settings(), () => new FakeProvider(), () => store, DEPS);
		await svc.status();
		const before = store.reads;
		svc.buildNow();
		await settle();
		// A completed build answers from the service, so force the file path: a new
		// session over the same store must see what the build wrote.
		const next = new VaultRagService(fakeApp("hello") as never, () => settings(), () => new FakeProvider(), () => store, DEPS);
		expect((await next.status()).state).toBe("ready");
		expect(store.reads).toBeGreaterThan(before);
	});
});
