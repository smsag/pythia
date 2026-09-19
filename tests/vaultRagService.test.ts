import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	TFile: class { path = ""; extension = "md"; },
	Notice: class { constructor(public msg?: string) {} setMessage(): void {} hide(): void {} },
	normalizePath: (p: string) => p,
}));

import { VaultRagService } from "../services/VaultRagService";
import type { IndexStore } from "../services/embedding/ConversationIndexService";
import type { EmbeddingProvider, EmbeddingBackend } from "../services/embedding/EmbeddingProvider";
import { embedChunkChars, DEFAULT_EMBEDDING_MODEL_ID } from "../models/embeddingModels";
import { DEFAULT_SETTINGS } from "../models/settings";
import type { PythiaSettings } from "../models/settings";
import type { Conversation } from "../models/types";
import { TFile } from "obsidian";

class FakeProvider implements EmbeddingProvider {
	readonly dim = 4;
	embedded: string[] = [];
	constructor(private readonly reported: EmbeddingBackend | null = "worker (blob)") {}
	async ready(): Promise<void> {}
	async embed(texts: string[]): Promise<Float32Array[]> {
		this.embedded.push(...texts);
		return texts.map(() => Float32Array.from([1, 0, 0, 0]));
	}
	isOffThread(): boolean { return true; }
	backend(): EmbeddingBackend | null { return this.reported; }
	unload(): void {}
}

class MemStore implements IndexStore {
	buf: ArrayBuffer | null = null;
	async read(): Promise<ArrayBuffer | null> { return this.buf; }
	async write(b: ArrayBuffer): Promise<void> { this.buf = b; }
}

/** A vault of one very long note, so the chunk WIDTH is observable. */
const fakeApp = (body: string) => ({
	vault: {
		getMarkdownFiles: () => [{ path: "Notes/long.md", stat: { mtime: 1 } }],
		cachedRead: async () => body,
		getAbstractFileByPath: () => null,
	},
	metadataCache: { getFileCache: () => ({ frontmatter: undefined }) },
});

const settings = (over: Partial<PythiaSettings> = {}): PythiaSettings => ({
	...DEFAULT_SETTINGS,
	vaultContextEnabled: true,
	...over,
});

const conv = { id: "c1" } as Conversation;

/** Let the fire-and-forget `refresh()` inside `getRelevantNotes` finish. */
const settle = async (): Promise<void> => {
	for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("VaultRagService — chunk sizing (ADR-182)", () => {
	it("chunks vault notes to the MODEL's window, not a shared 500", async () => {
		const provider = new FakeProvider();
		// One 2 000-char paragraph, no headings: chunking is pure width.
		const svc = new VaultRagService(
			fakeApp("x".repeat(2000)) as never,
			() => settings(),
			() => provider,
			() => new MemStore(),
		);
		await svc.getRelevantNotes(conv, "anything");
		await settle();

		const expected = embedChunkChars(DEFAULT_EMBEDDING_MODEL_ID);
		expect(expected).toBeLessThan(500); // the constant this replaced
		const noteChunks = provider.embedded.filter((t) => t.startsWith("x"));
		expect(noteChunks.length).toBeGreaterThan(0);
		// Every chunk fits the window the model will actually read.
		expect(Math.max(...noteChunks.map((t) => t.length))).toBeLessThanOrEqual(expected);
		// And it really is the model's number, not just "under 500".
		expect(noteChunks.filter((t) => t.length === expected).length).toBeGreaterThan(0);
	});
});

describe("VaultRagService — backend visibility (ADR-182)", () => {
	it("names the backend in the status line once a build has run", async () => {
		const svc = new VaultRagService(
			fakeApp("hello world") as never,
			() => settings(),
			() => new FakeProvider("iframe (UI thread)"),
			() => new MemStore(),
		);
		expect(svc.getStatus()).not.toContain("iframe");
		await svc.getRelevantNotes(conv, "anything");
		await settle();
		// `iframe (UI thread)` in the settings tab is the single fact that explains
		// a slow build, and it used to be invisible.
		expect(svc.getStatus()).toContain("iframe (UI thread)");
	});

	it("says nothing about a backend it has not resolved yet", () => {
		const svc = new VaultRagService(
			fakeApp("hello") as never,
			() => settings(),
			() => new FakeProvider(null),
			() => new MemStore(),
		);
		expect(svc.getStatus()).not.toContain("Engine");
	});

	it("forgets the backend on reset, so a model switch cannot show a stale one", async () => {
		const svc = new VaultRagService(
			fakeApp("hello world") as never,
			() => settings(),
			() => new FakeProvider("worker (blob)"),
			() => new MemStore(),
		);
		await svc.getRelevantNotes(conv, "anything");
		await settle();
		expect(svc.getStatus()).toContain("worker (blob)");
		svc.reset();
		expect(svc.getStatus()).not.toContain("worker (blob)");
	});
});

describe("VaultRagService — the send path stops rescanning the vault (ADR-182)", () => {
	/** Counts whole-corpus scans: `getMarkdownFiles` is the first thing a full
	 *  build does, and the thing the watcher exists to avoid repeating. */
	const countingApp = (body: string) => {
		const state = { scans: 0 };
		return {
			state,
			app: {
				vault: {
					getMarkdownFiles: () => { state.scans++; return [{ path: "Notes/a.md", stat: { mtime: 1 } }]; },
					cachedRead: async () => body,
					getAbstractFileByPath: () => null,
				},
				metadataCache: { getFileCache: () => ({ frontmatter: undefined }) },
			},
		};
	};

	it("builds once, then leaves later turns alone", async () => {
		const { state, app } = countingApp("alpha content");
		const svc = new VaultRagService(
			app as never,
			() => settings(),
			() => new FakeProvider(),
			() => new MemStore(),
		);
		await svc.getRelevantNotes(conv, "first turn");
		await settle();
		expect(state.scans).toBe(1);
		expect(svc.isReady()).toBe(true);

		// Ten more sends. Before this, each one re-read, re-chunked and re-hashed
		// every in-scope note on the host thread — and flashed a build notice.
		for (let i = 0; i < 10; i++) await svc.getRelevantNotes(conv, `turn ${i}`);
		await settle();
		expect(state.scans).toBe(1);
	});

	it("an explicit reindex still rebuilds", async () => {
		const { state, app } = countingApp("alpha content");
		const svc = new VaultRagService(
			app as never,
			() => settings(),
			() => new FakeProvider(),
			() => new MemStore(),
		);
		await svc.getRelevantNotes(conv, "first turn");
		await settle();
		expect(state.scans).toBe(1);

		await svc.reindex();
		await settle();
		expect(state.scans).toBe(2); // the one caller that must never be skipped
	});
});

describe("VaultRagService — privacy and scope (ADR-183)", () => {
	const vaultOf = (files: { path: string; mtime?: number; frontmatter?: unknown }[], body = "alpha") => {
		const seen: string[] = [];
		return {
			seen,
			app: {
				vault: {
					getMarkdownFiles: () => files.map((f) => ({ path: f.path, stat: { mtime: f.mtime ?? 0 } })),
					cachedRead: async (f: { path: string }) => { seen.push(f.path); return body; },
					getAbstractFileByPath: () => null,
				},
				metadataCache: {
					getFileCache: (f: { path: string }) => ({
						frontmatter: files.find((x) => x.path === f.path)?.frontmatter,
					}),
				},
			},
		};
	};

	it("never indexes a note marked `pythia: false`", async () => {
		// Folder scope answers "which parts of the vault"; a single sensitive note
		// inside an indexed folder had no answer at all before this.
		const { seen, app } = vaultOf([
			{ path: "Notes/public.md" },
			{ path: "Notes/private.md", frontmatter: { pythia: false } },
		]);
		const svc = new VaultRagService(app as never, () => settings(), () => new FakeProvider(), () => new MemStore());
		await svc.getRelevantNotes(conv, "anything");
		await settle();
		expect(seen).toContain("Notes/public.md");
		expect(seen).not.toContain("Notes/private.md"); // its text was never even read
	});

	it("indexes a note whose frontmatter says anything else", async () => {
		const { seen, app } = vaultOf([
			{ path: "Notes/a.md", frontmatter: { pythia: true } },
			{ path: "Notes/b.md", frontmatter: { tags: ["x"] } },
			{ path: "Notes/c.md" },
		]);
		const svc = new VaultRagService(app as never, () => settings(), () => new FakeProvider(), () => new MemStore());
		await svc.getRelevantNotes(conv, "anything");
		await settle();
		expect(seen.sort()).toEqual(["Notes/a.md", "Notes/b.md", "Notes/c.md"]);
	});

	it("caps by most-recently-modified, not by adapter order", async () => {
		// The cap's membership used to depend on `getMarkdownFiles()` order, which is
		// not stable between sessions — so notes silently entered and left retrieval,
		// re-embedding each time they came back.
		const { seen, app } = vaultOf([
			{ path: "Notes/old.md", mtime: 1 },
			{ path: "Notes/newest.md", mtime: 900 },
			{ path: "Notes/middle.md", mtime: 500 },
		]);
		const svc = new VaultRagService(
			app as never,
			() => settings({ vaultContextMaxIndexedNotes: 2 }),
			() => new FakeProvider(),
			() => new MemStore(),
		);
		await svc.getRelevantNotes(conv, "anything");
		await settle();
		expect(seen).toEqual(["Notes/newest.md", "Notes/middle.md"]);
	});
});

describe("VaultRagService — the retrieval query (ADR-183)", () => {
	it("carries the previous answer into a short follow-up", async () => {
		const provider = new FakeProvider();
		const svc = new VaultRagService(
			fakeApp("alpha note body") as never,
			() => settings(),
			() => provider,
			() => new MemStore(),
		);
		await svc.getRelevantNotes(conv, "seed the index");
		await settle();
		provider.embedded.length = 0;

		const withHistory = {
			id: "c1",
			messages: [
				{ role: "user", content: "what are the retrieval floors?" },
				{ role: "assistant", content: "The floors are measured per embedding model." },
			],
		} as unknown as Conversation;
		await svc.getRelevantNotes(withHistory, "and the second one?");
		// The embedded query carries the topic, not just four tokens.
		expect(provider.embedded.join(" ")).toContain("measured per embedding model");
	});

	it("does not dilute a question that stands on its own", async () => {
		const provider = new FakeProvider();
		const svc = new VaultRagService(
			fakeApp("alpha note body") as never,
			() => settings(),
			() => provider,
			() => new MemStore(),
		);
		await svc.getRelevantNotes(conv, "seed");
		await settle();
		provider.embedded.length = 0;

		const long = "Explain in detail how the vault retrieval floors were chosen ".repeat(5);
		const withHistory = {
			id: "c1",
			messages: [{ role: "assistant", content: "UNRELATED EARLIER ANSWER" }],
		} as unknown as Conversation;
		await svc.getRelevantNotes(withHistory, long);
		expect(provider.embedded.join(" ")).not.toContain("UNRELATED EARLIER ANSWER");
	});
});

describe("VaultRagService.applyChanges — the opt-out holds on edits too (ADR-183)", () => {
	const withCache = (frontmatter: Record<string, unknown> | undefined) => ({
		vault: {
			getMarkdownFiles: () => [{ path: "Notes/seed.md", stat: { mtime: 1 } }],
			cachedRead: async () => "alpha seed",
			getAbstractFileByPath: () => null,
		},
		metadataCache: { getFileCache: () => ({ frontmatter }) },
	});

	const edited = { path: "Notes/secret.md", extension: "md" };

	const built = async (app: unknown, provider: FakeProvider) => {
		const svc = new VaultRagService(app as never, () => settings(), () => provider, () => new MemStore());
		await svc.getRelevantNotes(conv, "seed");
		await settle();
		provider.embedded.length = 0;
		return svc;
	};

	it("does not index an opted-out note when it is edited", async () => {
		// The full scan and the watcher are two different paths into the index;
		// honouring `pythia: false` in only one of them leaks the note on the first
		// edit after it was written.
		const provider = new FakeProvider();
		const svc = await built(withCache({ pythia: false }), provider);
		await svc.applyChanges([edited as never], []);
		expect(provider.embedded).toEqual([]);
	});

	it("still indexes an edited note that has not opted out", async () => {
		const provider = new FakeProvider();
		const svc = await built(withCache(undefined), provider);
		await svc.applyChanges([edited as never], []);
		expect(provider.embedded.length).toBeGreaterThan(0);
	});
});

// ── ADR-184 ─────────────────────────────────────────────────────────────────
/** A provider that reports the UI-thread backend, so the hydrate short-circuit
 *  in `refresh()` is actually exercised. */
class UiThreadProvider extends FakeProvider {
	constructor() { super("iframe (UI thread)"); }
	isOffThread(): boolean { return false; }
}

const countingVault = (paths: string[]) => {
	const state = { scans: 0 };
	return {
		state,
		app: {
			vault: {
				getMarkdownFiles: () => { state.scans++; return paths.map((p) => ({ path: p, stat: { mtime: 1 } })); },
				cachedRead: async () => "alpha content",
				getAbstractFileByPath: () => null,
			},
			metadataCache: { getFileCache: () => ({ frontmatter: undefined }) },
		},
	};
};

describe("VaultRagService — an unfinished index is not a finished one (ADR-184)", () => {
	/** Dies for good after one embed. Enough notes follow that the failure streak
	 *  trips ADR-182's dead-backend guard and the build really throws — a single
	 *  skipped note is a COMPLETED build, which is the whole point of that guard. */
	class DyingProvider extends FakeProvider {
		async embed(texts: string[]): Promise<Float32Array[]> {
			if (this.embedded.length >= 1) throw new Error("gone");
			return super.embed(texts);
		}
	}
	const eightNotes = Array.from({ length: 8 }, (_, i) => `Notes/n${i}.md`);
	class DyingUiProvider extends DyingProvider {
		isOffThread(): boolean { return false; }
	}

	it("resumes an interrupted build instead of serving the fragment forever", async () => {
		const store = new MemStore();
		const { state, app } = countingVault(eightNotes);
		const first = new VaultRagService(app as never, () => settings(), () => new DyingProvider(), () => store);
		await first.getRelevantNotes(conv, "seed");
		await settle();
		expect(state.scans).toBe(1);

		const svc = new VaultRagService(app as never, () => settings(), () => new FakeProvider(), () => store);
		await svc.getRelevantNotes(conv, "later turn");
		await settle();
		expect(state.scans).toBe(2);
	});

	it("resumes it on the UI-THREAD backend too, where the short-circuit lives", async () => {
		// ADR-125 skips the rebuild when the persisted index "has notes", so the app
		// is not frozen every session. ADR-182's partial persistence made that test
		// true for a fragment — so on this backend an interrupted build was served
		// as complete, permanently. Only `isComplete` distinguishes them.
		const store = new MemStore();
		const { state, app } = countingVault(eightNotes);
		const first = new VaultRagService(app as never, () => settings(), () => new DyingUiProvider(), () => store);
		await first.getRelevantNotes(conv, "seed");
		await settle();
		expect(state.scans).toBe(1);

		const svc = new VaultRagService(app as never, () => settings(), () => new UiThreadProvider(), () => store);
		await svc.getRelevantNotes(conv, "later session");
		await settle();
		expect(state.scans).toBe(2); // resumed, not short-circuited
	});

	it("DOES short-circuit on the UI thread once the build really finished", async () => {
		// The other half of the rule: a complete index must still not be rebuilt
		// every session on this backend, or ADR-125's freeze comes back.
		const store = new MemStore();
		const { state, app } = countingVault(["Notes/a.md"]);
		const first = new VaultRagService(app as never, () => settings(), () => new UiThreadProvider(), () => store);
		await first.getRelevantNotes(conv, "seed");
		await settle();
		expect(state.scans).toBe(1);

		const svc = new VaultRagService(app as never, () => settings(), () => new UiThreadProvider(), () => store);
		await svc.getRelevantNotes(conv, "next session");
		await settle();
		expect(state.scans).toBe(1);
	});

	it("rebuilds when the folder scope narrows, and not before", async () => {
		const store = new MemStore();
		const { state, app } = countingVault(["Work/a.md", "Private/b.md"]);
		let folders: string[] = [];
		const svc = new VaultRagService(app as never, () => settings({ vaultContextFolders: folders }), () => new FakeProvider(), () => store);
		await svc.getRelevantNotes(conv, "seed");
		await settle();
		expect(state.scans).toBe(1);

		await svc.getRelevantNotes(conv, "same settings");
		await settle();
		expect(state.scans).toBe(1);

		folders = ["Work"];
		await svc.getRelevantNotes(conv, "after narrowing");
		await settle();
		expect(state.scans).toBe(2);
	});

	it("rebuilds when the note cap changes", async () => {
		const store = new MemStore();
		const { state, app } = countingVault(["Notes/a.md"]);
		let cap = 5000;
		const svc = new VaultRagService(app as never, () => settings({ vaultContextMaxIndexedNotes: cap }), () => new FakeProvider(), () => store);
		await svc.getRelevantNotes(conv, "seed");
		await settle();
		cap = 10;
		await svc.getRelevantNotes(conv, "after cap change");
		await settle();
		expect(state.scans).toBe(2);
	});
});

describe("VaultRagService — the live scope wins over the index (ADR-184)", () => {
	/** The index keeps its rows; only the frontmatter changes, which is NOT part of
	 *  the scope signature — so no rebuild is triggered and the query-time filter
	 *  is the only thing that can drop the note. */
	const vaultWith = (paths: string[], optedOut: () => string[]) => ({
		vault: {
			getMarkdownFiles: () => paths.map((p) => ({ path: p, stat: { mtime: 1 } })),
			cachedRead: async () => "alpha content",
			// Must be the MOCKED TFile: the opt-out read gates on `instanceof`.
			getAbstractFileByPath: (p: string) => Object.assign(new TFile(), { path: p }),
		},
		metadataCache: {
			getFileCache: (f: { path: string }) => ({
				frontmatter: optedOut().includes(f.path) ? { pythia: false } : undefined,
			}),
		},
	});

	it("drops a note whose opt-out appeared after it was indexed", async () => {
		let excluded: string[] = [];
		const svc = new VaultRagService(
			vaultWith(["Notes/a.md"], () => excluded) as never,
			() => settings(),
			() => new FakeProvider(),
			() => new MemStore(),
		);
		await svc.getRelevantNotes(conv, "alpha");
		await settle();
		expect((await svc.getRelevantNotes(conv, "alpha")).length).toBeGreaterThan(0);

		// Same service, same index, same scope — only the note opted out.
		excluded = ["Notes/a.md"];
		expect(await svc.getRelevantNotes(conv, "alpha")).toEqual([]);
		expect(svc.getAutoContext(conv.id)).toEqual([]); // and the pills agree
	});

	it("drops a note the CURRENT folder scope excludes, before the rebuild lands", async () => {
		// `refresh()` is fire-and-forget, so the turn that immediately follows a
		// scope change still ranks against the old rows. That window is exactly what
		// the query-time filter is for.
		let folders: string[] = [];
		const svc = new VaultRagService(
			vaultWith(["Work/a.md"], () => []) as never,
			() => settings({ vaultContextFolders: folders }),
			() => new FakeProvider(),
			() => new MemStore(),
		);
		await svc.getRelevantNotes(conv, "alpha");
		await settle();
		expect((await svc.getRelevantNotes(conv, "alpha")).length).toBeGreaterThan(0);

		folders = ["Somewhere/else"];
		expect(await svc.getRelevantNotes(conv, "alpha")).toEqual([]);
	});

	it("survives a vault that cannot resolve a path, rather than disabling retrieval", async () => {
		const app = vaultWith(["Notes/a.md"], () => []);
		app.vault.getAbstractFileByPath = () => { throw new Error("no such API"); };
		const svc = new VaultRagService(app as never, () => settings(), () => new FakeProvider(), () => new MemStore());
		await svc.getRelevantNotes(conv, "alpha");
		await settle();
		expect((await svc.getRelevantNotes(conv, "alpha")).length).toBeGreaterThan(0);
	});
});

describe("VaultRagService — edits during the first build are not lost (ADR-184)", () => {
	it("replays a mid-build edit once the index lands", async () => {
		// Asserts on content ONLY the replay can produce: the build never reads
		// `Notes/edited.md`, so its text can only reach the provider via the replay.
		const provider = new FakeProvider();
		const app = {
			vault: {
				getMarkdownFiles: () => [{ path: "Notes/seed.md", stat: { mtime: 1 } }],
				cachedRead: async (f: { path: string }) =>
					f.path === "Notes/edited.md" ? "REPLAYED EDIT alpha" : "seed alpha",
				getAbstractFileByPath: () => null,
			},
			metadataCache: { getFileCache: () => ({ frontmatter: undefined }) },
		};
		const svc = new VaultRagService(app as never, () => settings(), () => provider, () => new MemStore());

		await svc.applyChanges([{ path: "Notes/edited.md", extension: "md" } as never], []);
		expect(svc.isReady()).toBe(false);
		expect(provider.embedded.join(" ")).not.toContain("REPLAYED EDIT");

		await svc.getRelevantNotes(conv, "seed");
		await settle();
		expect(provider.embedded.join(" ")).toContain("REPLAYED EDIT");
	});

	it("does not replay the same edit twice", async () => {
		const provider = new FakeProvider();
		const app = {
			vault: {
				getMarkdownFiles: () => [{ path: "Notes/seed.md", stat: { mtime: 1 } }],
				cachedRead: async (f: { path: string }) =>
					f.path === "Notes/edited.md" ? "REPLAYED EDIT alpha" : "seed alpha",
				getAbstractFileByPath: () => null,
			},
			metadataCache: { getFileCache: () => ({ frontmatter: undefined }) },
		};
		const svc = new VaultRagService(app as never, () => settings(), () => provider, () => new MemStore());
		await svc.applyChanges([{ path: "Notes/edited.md", extension: "md" } as never], []);
		await svc.getRelevantNotes(conv, "seed");
		await settle();
		const after = provider.embedded.length;
		await svc.reindex();
		await settle();
		// The buffer was cleared on the first replay; the rebuild re-reads the vault
		// on its own terms and must not resurrect a stale deferred entry.
		expect(provider.embedded.filter((t) => t.includes("REPLAYED EDIT")).length).toBe(1);
		expect(provider.embedded.length).toBeGreaterThanOrEqual(after);
	});
});
