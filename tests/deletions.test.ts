// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import {
	applyDeletions, DELETION_LOG_LIMIT, DELETION_RETENTION_DAYS, isDeleted, mergeDeletionLogs, normalizeDeletionLog, recordDeletions,
} from "../services/deletions";
import { PluginDataStore } from "../services/PluginDataStore";
import { ConversationStore } from "../services/ConversationStore";
import type { Conversation } from "../models/types";

const NOW = "2026-09-30T12:00:00.000Z";
const conv = (id: string, updatedAt = "2026-09-29T10:00:00.000Z"): Conversation => ({
	id, name: id, createdAt: "2026-09-01T00:00:00.000Z", updatedAt, systemPrompt: "", contextNotes: [],
	resumeMode: "full", provider: "anthropic", model: "m", messages: [], favorites: [],
} as Conversation);

describe("deletion records (ADR-252)", () => {
	it("a record deletes a copy not edited after the delete, and keeps one that was", () => {
		const log = { x: "2026-09-29T12:00:00.000Z" };
		expect(isDeleted(conv("x", "2026-09-29T11:00:00.000Z"), log)).toBe(true);
		expect(isDeleted(conv("x", "2026-09-29T12:00:00.000Z"), log)).toBe(true);
		expect(isDeleted(conv("x", "2026-09-29T13:00:00.000Z"), log)).toBe(false);
		expect(isDeleted({ id: "x", updatedAt: undefined as unknown as string }, log)).toBe(true);
		expect(isDeleted(conv("y"), log)).toBe(false);
		expect(applyDeletions([conv("a"), conv("x"), conv("b")], log)).toEqual({ kept: [conv("a"), conv("b")], removed: ["x"] });
	});

	it("reads back only well-formed, unexpired records, in one spelling", () => {
		const old = new Date(Date.parse(NOW) - (DELETION_RETENTION_DAYS + 1) * 864e5).toISOString();
		expect(normalizeDeletionLog({
			ok: "2026-09-29T12:00:00Z",
			expired: old,
			notDate: "yesterday",
			num: 5,
			future: "2026-10-05T00:00:00.000Z",
			["x".repeat(201)]: NOW,
		}, NOW)).toEqual({ ok: "2026-09-29T12:00:00.000Z" });
		expect(normalizeDeletionLog(undefined, NOW)).toEqual({});
		expect(normalizeDeletionLog([["a", NOW]], NOW)).toEqual({});
		expect(normalizeDeletionLog("x", NOW)).toEqual({});
	});

	it("merges by union, the later delete winning, and stays bounded", () => {
		const a = { x: "2026-09-29T10:00:00.000Z", y: "2026-09-29T10:00:00.000Z" };
		const b = { x: "2026-09-29T11:00:00.000Z", z: "2026-09-29T09:00:00.000Z" };
		expect(mergeDeletionLogs(a, b, NOW)).toEqual({ x: "2026-09-29T11:00:00.000Z", y: a.y, z: b.z });
		expect(recordDeletions({}, ["p", "q"], NOW)).toEqual({ p: NOW, q: NOW });

		const many = Object.fromEntries(Array.from({ length: DELETION_LOG_LIMIT + 10 }, (_, i) =>
			[`c${i}`, new Date(Date.parse(NOW) - i * 1000).toISOString()]));
		const bounded = mergeDeletionLogs(many, {}, NOW);
		expect(Object.keys(bounded)).toHaveLength(DELETION_LOG_LIMIT);
		expect(bounded.c0).toBeDefined();
		expect(bounded[`c${DELETION_LOG_LIMIT + 5}`]).toBeUndefined();
	});
});

/** A plugin whose data.json is `disk`, written by saveData. */
function device(conversations: Conversation[], disk: { current: Record<string, unknown> }) {
	// eslint-disable-next-line prefer-const -- assigned after the plugin that holds it
	let store: PluginDataStore;
	const plugin = {
		conversations,
		settings: { maxConversations: 0, archiveBeforeEviction: false },
		loadData: vi.fn(async () => JSON.parse(JSON.stringify(disk.current))),
		saveData: vi.fn(async (data: Record<string, unknown>) => { disk.current = JSON.parse(JSON.stringify(data)); }),
		app: { workspace: { getLeavesOfType: () => [] }, secretStorage: { getSecret: async () => "" } },
		conversationStore: { markDirty: vi.fn(), snapshotDirty: () => new Map(), clearDirtySnapshot: () => {} },
		saveConversations: async () => { await store.saveConversations(); },
		pluginDataStore: undefined as unknown as PluginDataStore,
	};
	store = new PluginDataStore(plugin as never);
	plugin.pluginDataStore = store;
	return { plugin, store };
}

describe("a deleted conversation does not come back from another device", () => {
	it("the report: deleted here, still held there, written back — gone again on the next load", async () => {
		const disk = { current: {} as Record<string, unknown> };
		const here = device([conv("keep"), conv("doomed")], disk);
		const there = device([conv("keep"), conv("doomed")], disk);

		// Here: the delete records the id before the write that drops it.
		const convStore = new ConversationStore(here.plugin as never);
		convStore.setAll(here.plugin.conversations);
		here.plugin.conversationStore = convStore as never;
		await convStore.delete("doomed");
		expect(disk.current.deletedConversations).toHaveProperty("doomed");

		// There: it loads the file and drops its own copy instead of keeping it…
		await there.store.loadPluginData();
		expect(there.plugin.conversations.map((c) => c.id)).toEqual(["keep"]);
		expect(there.plugin.conversationStore.markDirty).not.toHaveBeenCalledWith("doomed");
	});

	it("an older Pythia that writes the file without the field cannot bring it back here", async () => {
		const disk = { current: {} as Record<string, unknown> };
		const here = device([conv("keep")], disk);
		here.store.recordDeletions(["doomed"]);
		// An old device writes its copy — conversation included, records dropped.
		disk.current = { conversations: [conv("keep"), conv("doomed")] };
		await here.store.loadPluginData();
		expect(here.plugin.conversations.map((c) => c.id)).toEqual(["keep"]);
		await here.store.persist();
		expect(disk.current.deletedConversations).toHaveProperty("doomed");
	});

	it("a copy edited on the other device after the delete is kept", async () => {
		const disk = { current: {} as Record<string, unknown> };
		const here = device([conv("keep")], disk);
		here.store.recordDeletions(["doomed"]);
		const later = new Date(Date.now() + 60_000).toISOString();
		disk.current = { conversations: [conv("keep"), conv("doomed", later)] };
		await here.store.loadPluginData();
		expect(here.plugin.conversations.map((c) => c.id)).toEqual(["keep", "doomed"]);
	});

	it("a conversation removed by the history limit is recorded too", async () => {
		const disk = { current: {} as Record<string, unknown> };
		const { plugin, store } = device([conv("a", "2026-01-01T00:00:00.000Z"), conv("b", "2026-02-01T00:00:00.000Z")], disk);
		plugin.settings.maxConversations = 1;
		await store.saveConversations();
		expect(plugin.conversations.map((c) => c.id)).toEqual(["b"]);
		expect(Object.keys(disk.current.deletedConversations as object)).toEqual(["a"]);
	});

	it("nothing deleted, nothing written: the field stays out of data.json", async () => {
		const disk = { current: {} as Record<string, unknown> };
		const { store } = device([conv("a")], disk);
		await store.persist();
		expect(disk.current).not.toHaveProperty("deletedConversations");
	});
});
