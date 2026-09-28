// @vitest-environment happy-dom
// Regression tests for the UI-layer review fixes (2026-09 quality review):
// each fails in the direction the defect went.
import { describe, it, expect, vi } from "vitest";
import { makePlugin, mountView, seedConversation, userMsg, aiMsg } from "./helpers/viewHarness";
import { ActionSheet } from "../ui/ActionSheet";
import { NavigatorController, type NavigatorDeps } from "../ui/NavigatorController";
import { nameAfterCommit } from "../ui/postCommitNaming";
import type { Conversation, Message } from "../models/types";

function pointer(type: string, x: number, y: number): Event {
	const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
	return e;
}

describe("ActionSheet — a swipe that starts on a row is not a tap", () => {
	const open = () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const onSelect = vi.fn();
		new ActionSheet(host).open([{ label: "Delete", icon: "trash", onSelect }]);
		return { row: host.querySelector<HTMLElement>(".p-sheet-item")!, onSelect };
	};

	it("runs the row on a tap", () => {
		const { row, onSelect } = open();
		row.dispatchEvent(pointer("pointerdown", 10, 10));
		row.dispatchEvent(pointer("pointerup", 12, 13));
		expect(onSelect).toHaveBeenCalledTimes(1);
	});

	it("does not run it when the pointer moved more than 10px", () => {
		const { row, onSelect } = open();
		row.dispatchEvent(pointer("pointerdown", 10, 10));
		row.dispatchEvent(pointer("pointerup", 10, 60));
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("does not run it on a pointerup with no pointerdown on the row", () => {
		const { row, onSelect } = open();
		row.dispatchEvent(pointer("pointerup", 10, 10));
		expect(onSelect).not.toHaveBeenCalled();
	});
});

describe("NavigatorController — removing the last favorite says so", () => {
	function mount(favs: { id: string; name: string }[]) {
		const navigatorEl = document.createElement("div");
		document.body.appendChild(navigatorEl);
		const conv = { id: "c", name: "C", messages: [], favorites: favs } as unknown as Conversation;
		const removeFavorite = vi.fn(async (id: string) => { conv.favorites = conv.favorites!.filter((f) => f.id !== id); });
		const deps = {
			plugin: { conversationStore: { getAll: () => [conv], getById: () => undefined } },
			navigatorEl,
			indexTriggerEl: document.createElement("button"),
			getConversation: () => conv,
			setActiveConversation: vi.fn(),
			scrollToMessage: vi.fn(),
			scrollToFavorite: vi.fn(),
			removeFavorite,
			revealMergeLink: vi.fn(),
			removeMergeLink: vi.fn(),
			goToFavoritesSummary: vi.fn(),
		} as unknown as NavigatorDeps;
		const nav = new NavigatorController(deps);
		nav.toggle();
		return { navigatorEl, nav };
	}
	const flush = () => new Promise((r) => setTimeout(r, 0));
	const del = (el: HTMLElement, i: number) => el.querySelectorAll<HTMLElement>(".p-nav-del")[i];

	it("shows the empty line only after the LAST one is removed", async () => {
		const { navigatorEl, nav } = mount([{ id: "a", name: "A" }, { id: "b", name: "B" }]);
		const section = del(navigatorEl, 0).closest<HTMLElement>(".p-nav-section-body")!;
		del(navigatorEl, 0).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
		await flush();
		expect(section.querySelectorAll(".p-nav-item")).toHaveLength(1);
		expect(section.querySelector(".p-nav-empty")).toBeNull();
		del(navigatorEl, 0).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
		await flush();
		expect(section.querySelectorAll(".p-nav-empty")).toHaveLength(1);
		nav.close();
	});

	it("rows and ✕ are keyboard controls with a name", async () => {
		const { navigatorEl, nav } = mount([{ id: "a", name: "A" }]);
		const x = del(navigatorEl, 0);
		expect(x.getAttribute("role")).toBe("button");
		expect(x.getAttribute("tabindex")).toBe("0");
		expect(x.getAttribute("aria-label")).toBeTruthy();
		expect(navigatorEl.querySelector(".p-nav-item")!.getAttribute("tabindex")).toBe("0");
		x.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		await flush();
		expect(navigatorEl.querySelector(".p-nav-del")).toBeNull();
		nav.close();
	});
});

describe("nameAfterCommit — a rename made while the title generated wins", () => {
	it("does not overwrite the user's name", async () => {
		const conv = { id: "c", name: "New conversation 2026-09-28", messages: [{}, {}], provider: "anthropic" } as unknown as Conversation;
		let resolveTitle!: (t: string) => void;
		const renameConversation = vi.fn(async (c: Conversation, n: string) => { c.name = n; });
		const plugin = {
			llmRouter: {
				generateConversationTitle: () => new Promise<string>((r) => { resolveTitle = r; }),
				generateChapterName: async () => "",
			},
			conversationStore: { getById: () => conv, save: vi.fn() },
			renameConversation,
		};
		const userMsg = { id: "u", role: "user", content: "q", timestamp: "", chapterName: "x" } as Message;
		nameAfterCommit({ plugin: plugin as never, activeId: () => "c", setConvName: vi.fn() }, conv, userMsg, "a");
		conv.name = "My own name"; // renamed by hand meanwhile
		resolveTitle("Generated title");
		await new Promise((r) => setTimeout(r, 0));
		expect(renameConversation).not.toHaveBeenCalled();
		expect(conv.name).toBe("My own name");
	});
});

describe("renderMessages — two rebuilds never interleave", () => {
	it("switching mid-render leaves only the new conversation's messages", async () => {
		const plugin = await makePlugin();
		const a = await seedConversation(plugin, { name: "A", messages: [userMsg("a1", "qa1"), aiMsg("a2", "aa2"), userMsg("a3", "qa3"), aiMsg("a4", "aa4")] } as Partial<Conversation>);
		const b = await seedConversation(plugin, { name: "B", messages: [userMsg("b1", "qb1"), aiMsg("b2", "ab2")] } as Partial<Conversation>);
		const { view, pane } = await mountView(plugin);
		const first = view.setActiveConversation(a);   // not awaited: still rendering
		const second = view.setActiveConversation(b);
		await Promise.all([first, second]);
		const ids = Array.from(pane().querySelectorAll("[data-msg-id]")).map((e) => e.getAttribute("data-msg-id"));
		expect(ids).toEqual(["b1", "b2"]);
	});
});
