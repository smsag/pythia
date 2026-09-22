// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginDataStore } from "../services/PluginDataStore";
import type { Conversation } from "../models/types";

// The regression this suite exists for (ADR-171): lowering the conversation cap
// used to delete conversations from inside a SETTINGS save, because `persist()`
// evicted on every write. A settings field commits a value; only a conversation
// write may apply it.

const makeConv = (id: string, updatedAt = "2026-01-01T00:00:00.000Z"): Conversation => ({
	id,
	name: id,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt,
	systemPrompt: "",
	contextNotes: [],
	resumeMode: "full",
	provider: "anthropic",
	model: "claude-sonnet-4-6",
	messages: [],
	favorites: [],
});

const makePlugin = (cap: number, over: Record<string, unknown> = {}) => ({
	conversations: [
		makeConv("a", "2026-01-01T00:00:00.000Z"),
		makeConv("b", "2026-02-01T00:00:00.000Z"),
		makeConv("c", "2026-03-01T00:00:00.000Z"),
	],
	settings: { maxConversations: cap, archiveBeforeEviction: false, archiveFolder: "Pythia/Archive" },
	saveData: vi.fn().mockResolvedValue(undefined),
	noteWriter: {
		archiveConversationNote: vi.fn().mockResolvedValue("Pythia/Archive/x.md"),
		updateSettings: vi.fn(),
	},
	app: { workspace: { getLeavesOfType: () => [] } },
	...over,
});

let plugin: ReturnType<typeof makePlugin>;
let store: PluginDataStore;

beforeEach(() => {
	plugin = makePlugin(1);
	store = new PluginDataStore(plugin as never);
});

describe("PluginDataStore.persist", () => {
	it("does not evict when saving settings — a typed number is not a deletion", async () => {
		await store.saveSettings();
		expect(plugin.conversations.map((c) => c.id)).toEqual(["a", "b", "c"]);
		expect(plugin.saveData).toHaveBeenCalledTimes(1);
	});

	it("does not evict on a bare persist (the secret-store path)", async () => {
		await store.persist();
		expect(plugin.conversations).toHaveLength(3);
	});

	it("applies the cap when a conversation write asks for it", async () => {
		await store.saveConversations();
		expect(plugin.conversations.map((c) => c.id)).toEqual(["c"]);
	});

	it("still writes data.json on every path", async () => {
		await store.saveConversations();
		expect(plugin.saveData).toHaveBeenCalledWith({
			settings: plugin.settings,
			conversations: plugin.conversations,
		});
	});
});

describe("PluginDataStore.pendingEvictionCount", () => {
	it("reports what a lower cap would delete, before anything is stored", () => {
		expect(store.pendingEvictionCount(1)).toBe(2);
		expect(store.pendingEvictionCount(3)).toBe(0);
		expect(store.pendingEvictionCount(0)).toBe(0);
		// Reading the count must not itself delete anything.
		expect(plugin.conversations).toHaveLength(3);
	});
});

// ── the archive (ADR-172) ─────────────────────────────────────────────────────

describe("PluginDataStore — archive before eviction", () => {
	it("writes a note for every conversation it removes", async () => {
		plugin = makePlugin(1);
		plugin.settings.archiveBeforeEviction = true;
		store = new PluginDataStore(plugin as never);

		await store.saveConversations();

		expect(plugin.noteWriter.archiveConversationNote).toHaveBeenCalledTimes(2);
		const archived = plugin.noteWriter.archiveConversationNote.mock.calls.map((c) => c[0].id);
		expect(archived.sort()).toEqual(["a", "b"]);
		expect(plugin.noteWriter.archiveConversationNote.mock.calls[0][1]).toBe("Pythia/Archive");
		expect(plugin.conversations.map((c) => c.id)).toEqual(["c"]);
	});

	it("KEEPS a conversation whose note could not be written", async () => {
		// The whole point of the archive: a failed write must never become a
		// deletion. The list stays over the cap until the vault can be written.
		plugin = makePlugin(1);
		plugin.settings.archiveBeforeEviction = true;
		plugin.noteWriter.archiveConversationNote = vi.fn()
			.mockRejectedValueOnce(new Error("vault is read-only"))
			.mockResolvedValue("Pythia/Archive/b.md");
		store = new PluginDataStore(plugin as never);

		await store.saveConversations();

		expect(plugin.conversations.map((c) => c.id)).toEqual(["a", "c"]);
		expect(plugin.saveData).toHaveBeenCalledTimes(1);
	});

	it("does not write notes when the setting is off", async () => {
		plugin = makePlugin(1);
		store = new PluginDataStore(plugin as never);

		await store.saveConversations();

		expect(plugin.noteWriter.archiveConversationNote).not.toHaveBeenCalled();
		expect(plugin.conversations.map((c) => c.id)).toEqual(["c"]);
	});

	it("archives nothing when the cap is not exceeded, and nothing at no limit", async () => {
		plugin = makePlugin(0);
		plugin.settings.archiveBeforeEviction = true;
		store = new PluginDataStore(plugin as never);

		await store.saveConversations();

		expect(plugin.noteWriter.archiveConversationNote).not.toHaveBeenCalled();
		expect(plugin.conversations).toHaveLength(3);
	});
});

describe("the data.json watcher does not re-trigger itself (#356)", () => {
	it("one external change → one reload, even though the reload's flush writes the file", async () => {
		vi.useFakeTimers();
		try {
			let mtime = 1_000;
			const p = makePlugin(0, {
				manifest: { dir: ".obsidian/plugins/pythia", id: "pythia" },
				register: () => {},
				// Every write bumps the file's mtime, the way a real save does.
				saveData: vi.fn(async () => { mtime += 1_000; }),
				app: {
					workspace: { getLeavesOfType: () => [] },
					vault: { configDir: ".obsidian", adapter: { stat: async () => ({ mtime }) } },
				},
			});
			const s = new PluginDataStore(p as never);
			// Stand-in for reloadFromDisk: what the real one does to the file — a
			// flush that writes it (the write that used to loop).
			const reload = vi.spyOn(s, "reloadFromDisk").mockImplementation(async () => { await s.persist(); });
			s.watchDataJson();
			const poll = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(5_000); };

			await poll();                  // seeds the baseline
			mtime += 1_000;                // another device writes data.json
			await vi.advanceTimersByTimeAsync(4_000); // outside the 3 s own-write window
			await poll();                  // → one reload, whose flush writes again
			for (let i = 0; i < 6; i++) {  // 30 s of further polling
				await vi.advanceTimersByTimeAsync(4_000);
				await poll();
			}
			expect(reload).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});

