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
		getMarkdownFiles: () => [{ path: "Notes/long.md" }],
		cachedRead: async () => body,
	},
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
					getMarkdownFiles: () => { state.scans++; return [{ path: "Notes/a.md" }]; },
					cachedRead: async () => body,
				},
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
