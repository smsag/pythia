import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ConversationStore } from "../services/ConversationStore";
import type { Conversation } from "../models/types";

// ConversationStore only imports PythiaPlugin and Conversation as types,
// both erased at runtime, so no Obsidian API mocking is needed here.

// ── Minimal plugin mock ───────────────────────────────────────────────────────

const makePlugin = () => ({
	conversations: [] as Conversation[],
	saveConversations: vi.fn().mockResolvedValue(undefined),
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
	store = new ConversationStore(plugin as unknown as Parameters<typeof ConversationStore.prototype.constructor>[0]);
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
	it("adds a new conversation to the array", async () => {
		await store.save(makeConv("new"));
		expect(plugin.conversations).toHaveLength(1);
		expect(plugin.conversations[0].id).toBe("new");
	});

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
		await store.save(conv);
		expect(conv.updatedAt).toBe("2030-06-01T12:00:00.000Z");
	});

	it("schedules a debounced persist (not immediate)", async () => {
		await store.save(makeConv("d"));
		expect(plugin.saveConversations).not.toHaveBeenCalled();
		vi.advanceTimersByTime(300);
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1);
	});

	it("resets the debounce timer on rapid successive saves", async () => {
		await store.save(makeConv("r1"));
		vi.advanceTimersByTime(200);
		await store.save(makeConv("r2"));
		vi.advanceTimersByTime(200); // only 200 ms after second save → not yet
		expect(plugin.saveConversations).not.toHaveBeenCalled();
		vi.advanceTimersByTime(100); // now 300 ms after second save → fires
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1);
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

// ── flush ─────────────────────────────────────────────────────────────────────

describe("flush", () => {
	it("calls saveConversations immediately", async () => {
		await store.flush();
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1);
	});

	it("cancels any pending debounced save before flushing", async () => {
		await store.save(makeConv("f"));
		await store.flush();
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(300);
		expect(plugin.saveConversations).toHaveBeenCalledTimes(1); // still 1
	});
});
