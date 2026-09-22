// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PluginDataStore } from "../services/PluginDataStore";
import { ViewManager, loadedPythiaViews } from "../services/ViewManager";
import { PythiaSidebarView } from "../sidebar";
import type { Conversation } from "../models/types";

// #342: since Obsidian 1.7.2 a leaf that is not visible (the phone's closed
// drawer, a background tab) is DEFERRED — getLeavesOfType returns it, but its
// `view` is a placeholder with none of our methods. The data.json watcher cast
// that placeholder to PythiaSidebarView and threw on every external sync:
// "A.setActiveConversation is not a function".

const makeConv = (id: string, updatedAt: string): Conversation => ({
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

/** What Obsidian puts in a deferred leaf: a view, but not ours. */
const deferredLeaf = () => ({ view: { getViewType: () => "pythia" } });

/** A loaded view without running the constructor (which builds the whole UI). */
function liveView(active: Conversation | null): PythiaSidebarView {
	const view = Object.create(PythiaSidebarView.prototype) as PythiaSidebarView;
	// `activeConversation` is private; the `activeConversationId` getter reads it.
	Object.assign(view, {
		activeConversation: active,
		setActiveConversation: vi.fn().mockResolvedValue(undefined),
		renderEmptyState: vi.fn(),
	});
	return view;
}

function makePlugin(memory: Conversation[], disk: Conversation[], leaves: unknown[]) {
	return {
		conversations: memory,
		settings: {},
		manifest: { id: "pythia", dir: ".obsidian/plugins/pythia" },
		loadData: vi.fn().mockResolvedValue({ settings: {}, conversations: disk }),
		saveData: vi.fn().mockResolvedValue(undefined),
		app: {
			workspace: { getLeavesOfType: () => leaves },
			secretStorage: { getSecret: vi.fn().mockResolvedValue("") },
			vault: { adapter: { stat: vi.fn().mockResolvedValue(null) } },
		},
	};
}

describe("reloadFromDisk with a deferred Pythia leaf (#342)", () => {
	it("does not throw, and still refreshes the loaded view behind it", async () => {
		const memA = makeConv("a", "2026-01-01T00:00:00.000Z");
		const diskA = makeConv("a", "2026-02-01T00:00:00.000Z");   // disk is newer: it wins the merge
		const live = liveView(memA);
		const plugin = makePlugin([memA], [diskA], [deferredLeaf(), { view: live }]);
		const store = new PluginDataStore(plugin as never);

		await expect(store.reloadFromDisk({ notify: false })).resolves.toBeUndefined();

		// The half-applied state this guards against: the merge replaced `a`, and a
		// view left holding the old object would save it back over the newer one.
		expect(live.setActiveConversation).toHaveBeenCalledTimes(1);
		const [conv, focus] = (live.setActiveConversation as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(conv).toBe(plugin.conversations[0]);
		expect(conv).not.toBe(memA);
		expect(focus).toBe(false);
	});

	it("does not throw when the only Pythia leaf is deferred", async () => {
		const conv = makeConv("a", "2026-01-01T00:00:00.000Z");
		const plugin = makePlugin([conv], [conv], [deferredLeaf()]);
		const store = new PluginDataStore(plugin as never);
		await expect(store.reloadFromDisk({ notify: false })).resolves.toBeUndefined();
	});
});

describe("loadedPythiaViews", () => {
	it("returns only loaded views, never a deferred placeholder", () => {
		const live = liveView(null);
		const ws = { getLeavesOfType: () => [deferredLeaf(), { view: live }] };
		expect(loadedPythiaViews(ws as never)).toEqual([live]);
	});

	it("getSidebarView skips a deferred first leaf", () => {
		const live = liveView(null);
		const vm = new ViewManager({ app: { workspace: { getLeavesOfType: () => [deferredLeaf(), { view: live }] } } } as never);
		expect(vm.getSidebarView()).toBe(live);
		const none = new ViewManager({ app: { workspace: { getLeavesOfType: () => [deferredLeaf()] } } } as never);
		expect(none.getSidebarView()).toBeNull();
	});

	it("eviction protection reads only loaded views", () => {
		const a = makeConv("a", "2026-01-01T00:00:00.000Z");
		const b = makeConv("b", "2026-02-01T00:00:00.000Z");
		const c = makeConv("c", "2026-03-01T00:00:00.000Z");
		const leaves = [deferredLeaf(), { view: liveView(a) }, { view: liveView(b) }];
		const plugin = makePlugin([a, b, c], [], leaves);
		// `a` and `b` are open, so both survive a cap of 1 and only `c` goes.
		expect(new PluginDataStore(plugin as never).pendingEvictionCount(1)).toBe(1);
		// With nothing loaded there is nothing to protect.
		const onlyDeferred = makePlugin([a, b, c], [], [deferredLeaf()]);
		expect(new PluginDataStore(onlyDeferred as never).pendingEvictionCount(1)).toBe(2);
	});
});

describe("no bare cast of leaf.view (#342)", () => {
	// The forbidden direction: a new `leaf.view as PythiaSidebarView` reintroduces
	// the crash on any deferred leaf. Go through `loadedPythiaViews` instead.
	const roots = ["main.ts", "sidebar.ts", "settings.ts", "services", "ui", "suggest"];
	const files: string[] = [];
	const walk = (p: string): void => {
		if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
		else if (p.endsWith(".ts")) files.push(p);
	};
	for (const r of roots) walk(r);

	it("no source file casts a leaf's view to PythiaSidebarView", () => {
		const offenders = files.filter((f) => /\.view\s+as\s+PythiaSidebarView/.test(readFileSync(f, "utf8")));
		expect(offenders).toEqual([]);
	});
});
