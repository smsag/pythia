import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	TFile: class {},
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

describe("VaultRagService — chunk sizing (ADR-179)", () => {
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

describe("VaultRagService — backend visibility (ADR-179)", () => {
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

describe("VaultRagService — the send path stops rescanning the vault (ADR-179)", () => {
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

describe("VaultRagService — privacy and scope (ADR-180)", () => {
	const vaultOf = (files: { path: string; mtime?: number; frontmatter?: unknown }[], body = "alpha") => {
		const seen: string[] = [];
		return {
			seen,
			app: {
				vault: {
					getMarkdownFiles: () => files.map((f) => ({ path: f.path, stat: { mtime: f.mtime ?? 0 } })),
					cachedRead: async (f: { path: string }) => { seen.push(f.path); return body; },
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

describe("VaultRagService — the retrieval query (ADR-180)", () => {
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

describe("VaultRagService.applyChanges — the opt-out holds on edits too (ADR-180)", () => {
	const withCache = (frontmatter: Record<string, unknown> | undefined) => ({
		vault: {
			getMarkdownFiles: () => [{ path: "Notes/seed.md", stat: { mtime: 1 } }],
			cachedRead: async () => "alpha seed",
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
