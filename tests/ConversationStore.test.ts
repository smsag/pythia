import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ConversationStore } from "../services/ConversationStore";
import type { Conversation } from "../models/types";

// ConversationStore only imports PythiaPlugin and Conversation as types,
// both erased at runtime, so no Obsidian API mocking is needed here.

// ── Minimal plugin mock ───────────────────────────────────────────────────────

const makePlugin = () => ({
	conversations: [] as Conversation[],
	saveConversations: vi.fn().mockResolvedValue(undefined),
	settings: { debugMode: false },
});

const makeConv = (id: string, name = "Test"): Conversation => ({
	id,
	name,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	systemPrompt: "",
	contextNotes: [],
	resumeMode: "full",
	provider: "anthropic",
	model: "claude-sonnet-4-6",
	messages: [],
	favorites: [],
});

let plugin: ReturnType<typeof makePlugin>;
let store: ConversationStore;

beforeEach(() => {
	vi.useFakeTimers();
	plugin = makePlugin();
	store = new ConversationStore(plugin as never);
});

afterEach(() => {
	vi.useRealTimers();
});

// ── getAll ────────────────────────────────────────────────────────────────────

describe("getAll", () => {
	it("returns the plugin conversations array", () => {
		const conv = makeConv("a");
		plugin.conversations.push(conv);
		expect(store.getAll()).toContain(conv);
	});

	it("returns an empty array when there are no conversations", () => {
		expect(store.getAll()).toHaveLength(0);
	});
});

// ── getById ───────────────────────────────────────────────────────────────────

describe("getById", () => {
	it("returns the matching conversation", () => {
		plugin.conversations.push(makeConv("abc"));
		expect(store.getById("abc")).toBeDefined();
		expect(store.getById("abc")!.id).toBe("abc");
	});

	it("returns undefined for an unknown id", () => {
		expect(store.getById("nope")).toBeUndefined();
	});
});

// ── save ──────────────────────────────────────────────────────────────────────

describe("save", () => {
	it("upserts an existing conversation by id", async () => {
		const conv = makeConv("x", "Original");
		plugin.conversations.push(conv);
		await store.save({ ...conv, name: "Updated" });
		expect(plugin.conversations).toHaveLength(1);
		expect(plugin.conversations[0].name).toBe("Updated");
	});

	it("sets updatedAt to the current time", async () => {
		vi.setSystemTime(new Date("2030-06-01T12:00:00.000Z"));
		const conv = makeConv("ts");
		plugin.conversations.push(conv);
		await store.save(conv);
		expect(conv.updatedAt).toBe("2030-06-01T12:00:00.000Z");
	});

	it("schedules a debounced persist (not immediate)", async () => {
		const conv = makeConv("d");
		plugin.conversations.push(conv);
		await store.save(conv);
		expect(plugin.saveConversations).not.toHaveBeenCalled();
		vi.advanceTimersByTime(300);
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1);
	});

	it("resets the debounce timer on rapid successive saves", async () => {
		const r1 = makeConv("r1");
		const r2 = makeConv("r2");
		plugin.conversations.push(r1, r2);
		await store.save(r1);
		vi.advanceTimersByTime(200);
		await store.save(r2);
		vi.advanceTimersByTime(200); // only 200 ms after second save → not yet
		expect(plugin.saveConversations).not.toHaveBeenCalled();
		vi.advanceTimersByTime(100); // now 300 ms after second save → fires
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1);
	});

	// ── no-resurrect (regression for delete-during-in-flight-save bug) ──────────

	it("does not resurrect a conversation that no longer exists in the store", async () => {
		await store.save(makeConv("deleted"));
		expect(plugin.conversations).toHaveLength(0);
	});

	it("does not schedule a persist when the conversation is unknown", async () => {
		await store.save(makeConv("deleted"));
		vi.advanceTimersByTime(300);
		expect(plugin.saveConversations).not.toHaveBeenCalled();
	});
});

// ── delete ────────────────────────────────────────────────────────────────────

describe("delete", () => {
	it("removes the conversation with the given id", async () => {
		plugin.conversations.push(makeConv("del"));
		await store.delete("del");
		expect(plugin.conversations).toHaveLength(0);
	});

	it("leaves other conversations intact", async () => {
		plugin.conversations.push(makeConv("a"), makeConv("b"), makeConv("c"));
		await store.delete("b");
		expect(plugin.conversations.map(c => c.id)).toEqual(["a", "c"]);
	});

	it("calls saveConversations immediately (no debounce)", async () => {
		plugin.conversations.push(makeConv("x"));
		await store.delete("x");
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1);
	});

	it("cancels any pending debounced save before the immediate flush", async () => {
		plugin.conversations.push(makeConv("y"));
		await store.save(makeConv("z")); // schedules debounce
		await store.delete("y");         // should cancel then flush immediately
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(300);     // debounce timer should be gone
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1); // still 1
	});
});

// ── dirty-flag behavior ──────────────────────────────────────────────────────

describe("dirty-flag tracking", () => {
	it("save() marks the conversation dirty and the debounce fires a persist", async () => {
		const conv = makeConv("d1");
		plugin.conversations.push(conv);
		await store.save(conv);
		vi.advanceTimersByTime(300);
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1);
	});

	it("snapshotDirty() + clearDirtySnapshot() prevents the debounced persist from writing", async () => {
		const conv = makeConv("d2");
		plugin.conversations.push(conv);
		await store.save(conv);
		const snapshot = store.snapshotDirty();
		store.clearDirtySnapshot(snapshot);
		vi.advanceTimersByTime(300);
		expect(plugin.saveConversations).not.toHaveBeenCalled();
	});

	it("clearDirtySnapshot() only clears IDs from the snapshot, not later additions", async () => {
		const c1 = makeConv("d2a");
		const c2 = makeConv("d2b");
		plugin.conversations.push(c1, c2);
		await store.save(c1);
		const snapshot = store.snapshotDirty();
		await store.save(c2);
		store.clearDirtySnapshot(snapshot);
		vi.advanceTimersByTime(300);
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1);
	});

	it("markDirty() makes the next debounced persist write", async () => {
		const conv = makeConv("d3");
		plugin.conversations.push(conv);
		await store.save(conv);
		const snapshot = store.snapshotDirty();
		store.clearDirtySnapshot(snapshot);
		store.markDirty(conv.id);
		vi.advanceTimersByTime(300);
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1);
	});

	it("delete() removes the ID from the dirty set", async () => {
		const conv = makeConv("d4");
		plugin.conversations.push(conv);
		await store.save(conv);
		await store.delete(conv.id);
		// After delete + immediate flush, advance past the debounce timer
		// The debounced save from save() should not fire because delete() cancelled it
		vi.advanceTimersByTime(300);
		// Only the immediate save from delete() should have happened
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1);
	});
});

// ── flush ─────────────────────────────────────────────────────────────────────

describe("flush", () => {
	it("skips saveConversations when nothing is dirty", async () => {
		await store.flush();
		expect(plugin.saveConversations).not.toHaveBeenCalled();
	});

	it("calls saveConversations when dirty IDs exist", async () => {
		const conv = makeConv("f");
		plugin.conversations.push(conv);
		await store.save(conv);
		await store.flush();
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1);
	});

	it("cancels any pending debounced save before flushing", async () => {
		const conv = makeConv("f2");
		plugin.conversations.push(conv);
		await store.save(conv);
		await store.flush();
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(300);
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1); // still 1
	});
});

describe("cancelPendingPersist", () => {
	it("cancels any scheduled debounced persist", async () => {
		const conv = makeConv("cp");
		plugin.conversations.push(conv);
		await store.save(conv);
		store.cancelPendingPersist();
		vi.advanceTimersByTime(300);
		expect(plugin.saveConversations).not.toHaveBeenCalled();
	});
});
