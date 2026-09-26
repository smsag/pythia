import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	TFile: class { path = ""; extension = "md"; },
	Notice: class { constructor(public msg?: string) {} setMessage(): void {} hide(): void {} },
	normalizePath: (p: string) => p,
}));

import { catchUpIndex, CATCH_UP_THROTTLE, type CatchUpHost } from "../services/embedding/vaultCatchUp";
import { VaultIndexService, type IndexableNote } from "../services/embedding/VaultIndexService";
import { VaultRagService } from "../services/VaultRagService";
import type { IndexStore } from "../services/embedding/ConversationIndexService";
import { FakeProvider, settings, conv, DEPS, settle } from "./helpers/vaultRagFixtures";
import { deserializeIndex } from "../services/embedding/embeddingIndex";

/** A phone's backend: the model runs on the UI thread. */
class PhoneProvider extends FakeProvider {
	override isOffThread(): boolean { return false; }
}

class CountingStore implements IndexStore {
	buf: ArrayBuffer | null = null;
	writes = 0;
	async read(): Promise<ArrayBuffer | null> { return this.buf; }
	async write(b: ArrayBuffer): Promise<void> { this.buf = b; this.writes++; }
}

const note = (path: string, text: string): IndexableNote => ({ path, load: async () => text });
const SCOPE = "S";

/** A complete index of `notes` under SCOPE, as a previous session left it. */
async function builtIndex(notes: IndexableNote[]): Promise<CountingStore> {
	const store = new CountingStore();
	await new VaultIndexService(new FakeProvider(), store).sync(notes, undefined, {}, SCOPE);
	return store;
}

function host(store: IndexStore, notes: IndexableNote[], over: Partial<CatchUpHost> = {}) {
	const provider = new FakeProvider();
	const guardCalls: string[] = [];
	const h: CatchUpHost = {
		service: () => new VaultIndexService(provider, store),
		scope: () => SCOPE,
		notes: () => notes,
		modelId: () => "m",
		guard: { start: () => guardCalls.push("start"), end: () => guardCalls.push("end") },
		onProgress: () => {},
		...over,
	};
	return { h, provider, guardCalls };
}

describe("catchUpIndex — a complete index catches up with the vault (ADR-220)", () => {
	it("embeds only the note that changed while this device was not watching", async () => {
		const store = await builtIndex([note("a.md", "alpha"), note("b.md", "beta")]);
		const { h, provider } = host(store, [note("a.md", "alpha"), note("b.md", "beta, edited on the phone")]);
		expect(await catchUpIndex(h)).toEqual({ ran: true, notes: 2 });
		expect(provider.embedded).toEqual(["beta, edited on the phone"]);
	});

	it("drops a note deleted elsewhere", async () => {
		const store = await builtIndex([note("a.md", "alpha"), note("b.md", "beta")]);
		const svc = new VaultIndexService(new FakeProvider(), store);
		await catchUpIndex({ ...host(store, [note("a.md", "alpha")]).h, service: () => svc });
		expect(svc.size()).toBe(1);
	});

	it("when nothing changed, it never touches the model and writes nothing", async () => {
		const store = await builtIndex([note("a.md", "alpha")]);
		const writes = store.writes;
		const { h, provider } = host(store, [note("a.md", "alpha")]);
		await catchUpIndex(h);
		expect(provider.embedded).toEqual([]);
		expect(store.writes).toBe(writes);
	});

	it("leaves an unfinished or re-scoped index to a full build", async () => {
		for (const store of [new CountingStore(), await builtIndex([note("a.md", "alpha")])]) {
			const { h, provider, guardCalls } = host(store, [note("a.md", "changed")], { scope: () => "another scope" });
			expect(await catchUpIndex(h)).toEqual({ ran: false, reason: "incomplete" });
			expect(provider.embedded).toEqual([]);
			expect(guardCalls).toEqual([]);
		}
	});

	it("an index it leaves alone is not marked ready, so the next send still resumes the build", async () => {
		const svc = new VaultIndexService(new FakeProvider(), new CountingStore());
		await catchUpIndex({ ...host(new CountingStore(), []).h, service: () => svc });
		expect(svc.isReady()).toBe(false);
	});

	it("runs under the crash-loop guard, like any automatic build (ADR-199)", async () => {
		const store = await builtIndex([note("a.md", "alpha")]);
		const { h, guardCalls } = host(store, [note("a.md", "alpha")]);
		await catchUpIndex(h);
		expect(guardCalls).toEqual(["start", "end"]);
	});

	it("an ordinary failure closes the guard; out of memory leaves its marker to count", async () => {
		for (const [message, expected] of [["boom", ["start", "end"]], ["RangeError: Out of memory", ["start"]]] as const) {
			const store = await builtIndex([note("a.md", "alpha")]);
			const failing = new VaultIndexService(new FakeProvider(), store);
			vi.spyOn(failing, "sync").mockRejectedValue(new Error(message));
			const { h, guardCalls } = host(store, [note("a.md", "alpha")], { service: () => failing });
			await expect(catchUpIndex(h)).rejects.toThrow(message);
			expect(guardCalls).toEqual(expected);
		}
	});

	it("yields after every note: nothing is waiting on it", () => {
		expect(CATCH_UP_THROTTLE.yieldEveryNotes).toBe(1);
	});
});

describe("VaultRagService.catchUp — once per session, desktop only (ADR-220)", () => {
	/** A vault whose note text can change between sessions. */
	const vault = (text: { value: string }) => ({
		vault: {
			getMarkdownFiles: () => [{ path: "Notes/a.md", stat: { mtime: 1 } }],
			cachedRead: async () => text.value,
			getAbstractFileByPath: () => null,
		},
		metadataCache: { getFileCache: () => ({ frontmatter: undefined }) },
	});

	/** Session one builds the index; the note then changes while Pythia is closed. */
	async function yesterday(): Promise<{ store: CountingStore; text: { value: string } }> {
		const store = new CountingStore();
		const text = { value: "alpha as it was" };
		const first = new VaultRagService(vault(text) as never, () => settings(), () => new FakeProvider(), () => store, DEPS);
		await first.getRelevantNotes(conv, "alpha");
		await settle();
		text.value = "alpha as the phone left it";
		return { store, text };
	}

	it("a desktop re-embeds what changed while it was closed, before anyone asks", async () => {
		const { store, text } = await yesterday();
		const provider = new FakeProvider();
		const svc = new VaultRagService(vault(text) as never, () => settings(), () => provider, () => store, DEPS);
		svc.catchUp();
		await settle();
		expect(provider.embedded).toEqual(["alpha as the phone left it"]);
		expect(svc.isReady()).toBe(true); // and retrieval can use it at once
	});

	it("runs once a session, however often it is asked", async () => {
		const { store, text } = await yesterday();
		const provider = new FakeProvider();
		const svc = new VaultRagService(vault(text) as never, () => settings(), () => provider, () => store, DEPS);
		svc.catchUp();
		await settle();
		text.value = "changed again";
		svc.catchUp();
		await settle();
		expect(provider.embedded).toEqual(["alpha as the phone left it"]);
	});

	it("a phone never runs it", async () => {
		const { store, text } = await yesterday();
		const provider = new FakeProvider();
		const svc = new VaultRagService(vault(text) as never, () => settings(), () => provider, () => store, { ...DEPS, mobile: true });
		svc.catchUp();
		await settle();
		expect(provider.embedded).toEqual([]);
		expect(svc.isReady()).toBe(false);
	});
});

describe("a phone takes a desktop's index over with Build now (ADR-220)", () => {
	const vault = (text: { value: string }) => ({
		vault: {
			getMarkdownFiles: () => [{ path: "Notes/a.md", stat: { mtime: 1 } }],
			cachedRead: async () => text.value,
			getAbstractFileByPath: () => null,
		},
		metadataCache: { getFileCache: () => ({ frontmatter: undefined }) },
	});

	it("reports the desktop as keeper, then Build now embeds what moved and signs the file", async () => {
		const store = new CountingStore();
		const text = { value: "alpha" };
		const desktop = new VaultRagService(vault(text) as never, () => settings(), () => new FakeProvider(), () => store, DEPS);
		await desktop.getRelevantNotes(conv, "alpha");
		await settle();

		text.value = "alpha, written on the trip";
		const provider = new PhoneProvider();
		const phone = new VaultRagService(vault(text) as never, () => settings(), () => provider, () => store, { ...DEPS, mobile: true });
		const before = await phone.status();
		expect(before.keeper).toBe("desktop");
		expect(before.writtenAt).toBeGreaterThan(0);

		phone.buildNow();
		await settle();
		// The UI-thread shortcut used to return on a complete index and do nothing.
		expect(provider.embedded).toEqual(["alpha, written on the trip"]);
		expect(deserializeIndex(store.buf!).meta.keeper).toBe("mobile");
		expect((await phone.status()).keeper).toBe("mobile");
	});
});
