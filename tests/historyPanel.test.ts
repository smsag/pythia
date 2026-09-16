// @vitest-environment happy-dom
//
// The in-view conversation search panel: browse and content search (ADR-107),
// related conversations (ADR-109), and using the panel to pick a conversation
// rather than switch to one (ADR-143). Split out of
// `tests/viewRender.test.ts` under the ADR-097 ratchet, which asked for exactly
// this — per-feature describes in their own files over one growing monolith.

import { describe, it, expect, beforeEach } from "vitest";
import { makePlugin, mountView, seedConversation, userMsg } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { PythiaSidebarView } from "../sidebar";
import type { Conversation } from "../models/types";
import { Platform } from "obsidian";

// ── Conversation search / history panel (ADR-107) ─────────────────────────────
//
// The panel folded in the former quick switcher: the header loupe opens it with
// the search input focused; ↑/↓ move the selection and Enter opens it; an empty
// box browses (date groups) while a query searches (flat TF-IDF list + snippets).
// This is the DOM path ADR-107 introduced, which otherwise has no coverage.

/** Far-left header button — created first, so it's the search loupe (HeaderController). */
const loupeBtn = (pane: () => Element): HTMLElement =>
	pane().querySelector<HTMLElement>(".p-header .p-hdr-btn")!;
const panelEl = (pane: () => Element): HTMLElement | null =>
	pane().querySelector<HTMLElement>(".p-history");
const panelInput = (pane: () => Element): HTMLInputElement =>
	pane().querySelector<HTMLInputElement>(".p-history .p-switcher-input")!;
const clearBtn = (pane: () => Element): HTMLButtonElement =>
	pane().querySelector<HTMLButtonElement>(".p-history .p-switcher-clear")!;
const historyRows = (pane: () => Element): HTMLElement[] =>
	Array.from(pane().querySelectorAll<HTMLElement>(".p-history-row"));
/** openHistoryView() focuses the input inside a 0 ms timeout — let it run. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** The search input rebuilds the list 60 ms after the last keystroke. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 90));

describe("conversation search panel (ADR-107)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;

	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	// Three independent conversations; the last seeded ("Quartz watches") is the one
	// mountView auto-opens. "seiko" appears only in its message body, not any title.
	async function seedThree(): Promise<void> {
		await seedConversation(plugin, { name: "Kayak trip planning", messages: [userMsg("k1", "we rented a kayak on the lake")] } as Partial<Conversation>);
		await seedConversation(plugin, { name: "Tax filing", messages: [userMsg("t1", "quarterly filing deadlines")] } as Partial<Conversation>);
		await seedConversation(plugin, { name: "Quartz watches", messages: [userMsg("q1", "the seiko astron was the first quartz wristwatch")] } as Partial<Conversation>);
	}

	it("header shows the search loupe and an inert, chevron-free title", async () => {
		await seedConversation(plugin, { name: "Solo", messages: [userMsg("m1", "hi")] } as Partial<Conversation>);
		const { pane } = await mountView(plugin);

		expect(loupeBtn(pane)).not.toBeNull();             // far-left search button present
		const title = pane().querySelector<HTMLElement>(".p-title")!;
		expect(title.tagName).toBe("DIV");                 // no longer a <button>
		expect(title.textContent ?? "").not.toContain("▾"); // dropdown chevron removed
	});

	it("the loupe opens the panel with the search input focused", async () => {
		await seedThree();
		const { pane } = await mountView(plugin);

		expect(panelEl(pane)).toBeNull();                  // closed initially
		loupeBtn(pane).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(panelEl(pane)).not.toBeNull();              // opened by the click wiring
		await tick();
		expect(document.activeElement).toBe(panelInput(pane)); // search input focused
	});

	it("does not focus the input on mobile, where that would raise a keyboard over the list", async () => {
		// ADR-152: auto-focus is a keyboard affordance. On a phone it covers the
		// bottom of the very list the panel exists to show.
		await seedThree();
		const { pane } = await mountView(plugin);
		Platform.isMobile = true;
		try {
			loupeBtn(pane).dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await tick();
			expect(panelEl(pane)).not.toBeNull();                   // panel still opens
			expect(document.activeElement).not.toBe(panelInput(pane));
		} finally {
			Platform.isMobile = false;
		}
	});

	it("shows a clear control only once there is something to clear", async () => {
		await seedThree();
		const { pane } = await mountView(plugin);
		loupeBtn(pane).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await tick();

		expect(clearBtn(pane).hidden).toBe(true);
		const input = panelInput(pane);
		input.value = "seiko";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		expect(clearBtn(pane).hidden).toBe(false);
	});

	it("clearing empties the query and returns the full browse list", async () => {
		await seedThree();
		const { pane } = await mountView(plugin);
		loupeBtn(pane).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await tick();

		const input = panelInput(pane);
		input.value = "seiko";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await settle();
		expect(historyRows(pane)).toHaveLength(1);       // search narrowed it

		clearBtn(pane).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(input.value).toBe("");
		expect(clearBtn(pane).hidden).toBe(true);        // nothing left to clear
		expect(historyRows(pane).length).toBeGreaterThan(1);
	});

	it("empty box browses (date groups); a query switches to a flat ranked list with a snippet", async () => {
		await seedThree();
		const { view, pane } = await mountView(plugin);
		(view as unknown as { historyController: { openHistoryView(): void } }).historyController.openHistoryView();

		// Empty query → the date-grouped browse listing, all conversations, no snippets.
		expect(pane().querySelector(".p-history-group")).not.toBeNull();
		expect(historyRows(pane)).toHaveLength(3);
		expect(pane().querySelector(".p-history-snippet")).toBeNull();

		// Query a word that lives only in one conversation's message body → flat list,
		// that one result, with a snippet of the matching line (content search, not title).
		const input = panelInput(pane);
		input.value = "seiko";
		input.dispatchEvent(new Event("input"));
		await settle();

		expect(pane().querySelector(".p-history-group")).toBeNull(); // flat — no date buckets
		expect(historyRows(pane)).toHaveLength(1);
		expect(pane().querySelector(".p-history-snippet")?.textContent).toContain("seiko");
	});

	it("↑/↓ move the selection and Enter opens the selected conversation", async () => {
		await seedThree();
		const { view, pane } = await mountView(plugin);
		(view as unknown as { historyController: { openHistoryView(): void } }).historyController.openHistoryView();
		const input = panelInput(pane);

		// First row selected by default.
		expect(historyRows(pane)[0].classList.contains("selected")).toBe(true);

		// ArrowDown → second row selected, first deselected.
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
		expect(historyRows(pane)[0].classList.contains("selected")).toBe(false);
		expect(historyRows(pane)[1].classList.contains("selected")).toBe(true);

		// ArrowUp → back to the first.
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
		expect(historyRows(pane)[0].classList.contains("selected")).toBe(true);

		// Enter opens the selected conversation → the panel closes.
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		expect(panelEl(pane)).toBeNull();
	});
});

// ── Related conversations (ADR-109 M3) ────────────────────────────────────────
//
// The relate icon (hover/long-press) switches the panel into "related mode": a
// "Related to X" chip and only the conversations getRelated() returned. The
// embedding runtime is stubbed via plugin.getRelatedConversations so these tests
// never touch the real model/iframe.

const openPanel = (view: PythiaSidebarView): void =>
	(view as unknown as { historyController: { openHistoryView(): void } }).historyController.openHistoryView();
const stubRelated = (plugin: InstanceType<typeof PythiaPlugin>, fn: (id: string) => Promise<{ id: string; score: number }[]>): void => {
	(plugin as unknown as { getRelatedConversations: typeof fn }).getRelatedConversations = fn;
};
const rowTitles = (pane: () => Element): string[] =>
	Array.from(pane().querySelectorAll<HTMLElement>(".p-history-row-title")).map((e) => e.textContent ?? "");

describe("related conversations (ADR-109 M3)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;

	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	async function seedPair(): Promise<void> {
		await seedConversation(plugin, { id: "src", name: "Source topic", messages: [userMsg("m1", "hello")] } as Partial<Conversation>);
		await seedConversation(plugin, { id: "rel", name: "Related topic", messages: [userMsg("m2", "world")] } as Partial<Conversation>);
	}

	it("shows a relate icon on rows", async () => {
		await seedPair();
		const { view, pane } = await mountView(plugin);
		openPanel(view);
		expect(pane().querySelector(".p-history-relate")).not.toBeNull();
	});

	it("clicking relate opens related mode: a chip plus only the returned conversations", async () => {
		await seedPair();
		stubRelated(plugin, async () => [{ id: "rel", score: 0.9 }]);
		const { view, pane } = await mountView(plugin);
		openPanel(view);

		pane().querySelector<HTMLElement>(".p-history-relate")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await tick(); await tick();

		expect(pane().querySelector(".p-history-chip")).not.toBeNull(); // "Related to …" chip
		expect(pane().querySelector(".p-history-group")).toBeNull();      // flat, no date buckets
		expect(rowTitles(pane)).toEqual(["Related topic"]);              // only the related result
	});

	it("clearing the chip returns to the normal browse list", async () => {
		await seedPair();
		stubRelated(plugin, async () => [{ id: "rel", score: 0.9 }]);
		const { view, pane } = await mountView(plugin);
		openPanel(view);
		pane().querySelector<HTMLElement>(".p-history-relate")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await tick(); await tick();

		pane().querySelector<HTMLElement>(".p-history-chip-clear")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(pane().querySelector(".p-history-chip")).toBeNull();  // chip gone
		expect(pane().querySelector(".p-history-group")).not.toBeNull(); // browse view restored
		expect(rowTitles(pane).length).toBeGreaterThanOrEqual(2);
	});

	it("typing exits related mode", async () => {
		await seedPair();
		stubRelated(plugin, async () => [{ id: "rel", score: 0.9 }]);
		const { view, pane } = await mountView(plugin);
		openPanel(view);
		pane().querySelector<HTMLElement>(".p-history-relate")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await tick(); await tick();
		expect(pane().querySelector(".p-history-chip")).not.toBeNull();

		const input = panelInput(pane);
		input.value = "source";
		input.dispatchEvent(new Event("input"));
		await settle();
		expect(pane().querySelector(".p-history-chip")).toBeNull(); // typing cleared related mode
	});

	it("long-press offers both show-similar and delete on a non-active conversation", async () => {
		await seedPair();
		stubRelated(plugin, async () => []);
		const { view, pane } = await mountView(plugin);
		openPanel(view);
		(globalThis as unknown as { __lastMenu?: unknown }).__lastMenu = undefined;

		// A non-active row (delete is offered only for non-active conversations).
		const nonActive = pane().querySelector<HTMLElement>(".p-history-row:not(.active)")!;
		const ev = new Event("touchstart");
		(ev as unknown as { touches: { clientX: number; clientY: number }[] }).touches = [{ clientX: 5, clientY: 5 }];
		nonActive.dispatchEvent(ev);
		await new Promise((r) => setTimeout(r, 560)); // past the 500 ms long-press threshold

		const menu = (globalThis as unknown as { __lastMenu?: { items: { icon?: string }[] } }).__lastMenu;
		expect(menu).toBeDefined();
		expect(menu!.items.map((i) => i.icon)).toEqual(["git-compare", "trash"]); // show similar + delete
	});
});

// ── Picking a conversation in the panel (ADR-143) ─────────────────────────────

describe("conversation picker (ADR-143)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;

	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	/** Three conversations; "Quartz watches" is the one mountView auto-opens. */
	async function seedThree(): Promise<void> {
		await seedConversation(plugin, { name: "Kayak trip planning", messages: [userMsg("k1", "we rented a kayak on the lake")] } as Partial<Conversation>);
		await seedConversation(plugin, { name: "Tax filing", messages: [userMsg("t1", "quarterly filing deadlines")] } as Partial<Conversation>);
		await seedConversation(plugin, { name: "Quartz watches", messages: [userMsg("q1", "the seiko astron was the first quartz wristwatch")] } as Partial<Conversation>);
	}

	const pick = (view: PythiaSidebarView, onPick: (c: Conversation) => void, excludeId?: string): void =>
		view.pickConversation({ onPick, excludeId, placeholder: "Link with conversation…" });

	it("opens the same panel, not a modal of its own", async () => {
		await seedThree();
		const { view, pane } = await mountView(plugin);

		pick(view, () => {});
		expect(panelEl(pane)).not.toBeNull();
		expect(document.querySelector(".modal-container")).toBeNull();
	});

	it("uses the caller's placeholder, so the panel says what it is being used for", async () => {
		await seedThree();
		const { view, pane } = await mountView(plugin);

		pick(view, () => {});
		expect(panelInput(pane).placeholder).toBe("Link with conversation…");
	});

	it("chooses instead of switching: the active conversation does not change", async () => {
		await seedThree();
		const { view, pane } = await mountView(plugin);
		const before = view.getActiveConversation()?.id;

		const chosen: Conversation[] = [];
		pick(view, (c) => chosen.push(c), before);
		historyRows(pane)[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(chosen).toHaveLength(1);
		expect(view.getActiveConversation()?.id).toBe(before); // still where the user was
		expect(panelEl(pane)).toBeNull();                      // and the panel closed
	});

	it("excludes the conversation the choice is being made from", async () => {
		await seedThree();
		const { view, pane } = await mountView(plugin);
		const active = view.getActiveConversation()!;

		pick(view, () => {}, active.id);
		const names = historyRows(pane).map((r) => r.querySelector(".p-history-row-title")?.textContent);
		expect(names).toHaveLength(2);
		expect(names).not.toContain(active.name);
	});

	it("still searches by content while picking", async () => {
		await seedThree();
		const { view, pane } = await mountView(plugin);

		pick(view, () => {});
		const input = panelInput(pane);
		input.value = "kayak";
		input.dispatchEvent(new Event("input"));
		await settle();

		expect(historyRows(pane)).toHaveLength(1);
		expect(historyRows(pane)[0].textContent).toContain("Kayak");
	});

	it("hides the delete control — picking a target must not offer to destroy one", async () => {
		await seedThree();
		const { view, pane } = await mountView(plugin);
		const active = view.getActiveConversation()!;

		pick(view, () => {}, active.id);
		expect(pane().querySelector(".p-history .p-switcher-del")).toBeNull();
	});

	it("keeps the delete control in normal browse mode", async () => {
		await seedThree();
		const { view, pane } = await mountView(plugin);

		(view as unknown as { historyController: { openHistoryView(): void } }).historyController.openHistoryView();
		expect(pane().querySelector(".p-history .p-switcher-del")).not.toBeNull();
	});

	it("replaces an already-open browse panel rather than toggling it shut", async () => {
		// The picker is opened from a selection toolbar that can be used while the
		// panel is open; a plain toggle would close it and drop the request.
		await seedThree();
		const { view, pane } = await mountView(plugin);

		(view as unknown as { historyController: { openHistoryView(): void } }).historyController.openHistoryView();
		pick(view, () => {});

		expect(panelEl(pane)).not.toBeNull();
		expect(pane().querySelectorAll(".p-history")).toHaveLength(1);
		expect(panelInput(pane).placeholder).toBe("Link with conversation…");
	});
});
