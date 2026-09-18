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

const makePlugin = (cap: number) => ({
	conversations: [
		makeConv("a", "2026-01-01T00:00:00.000Z"),
		makeConv("b", "2026-02-01T00:00:00.000Z"),
		makeConv("c", "2026-03-01T00:00:00.000Z"),
	],
	settings: { maxConversations: cap },
	saveData: vi.fn().mockResolvedValue(undefined),
	app: { workspace: { getLeavesOfType: () => [] } },
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
