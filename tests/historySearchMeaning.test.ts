// @vitest-environment happy-dom
//
// The conversation panel's search: titles, and meaning through Schreibstube
// (ADR-223), and the panel's part in asking one question at a time (ADR-257).
// Split out of `tests/historyPanel.test.ts` under the ADR-097 ratchet.

import { describe, it, expect, beforeEach } from "vitest";
import { makePlugin, mountView, seedConversation, userMsg } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { PythiaSidebarView } from "../sidebar";
import type { Conversation } from "../models/types";

const panelInput = (pane: () => Element): HTMLInputElement =>
	pane().querySelector<HTMLInputElement>(".p-history .p-switcher-input")!;
const historyRows = (pane: () => Element): HTMLElement[] =>
	Array.from(pane().querySelectorAll<HTMLElement>(".p-history-row"));
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** The search input rebuilds the list 60 ms after the last keystroke. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 90));

// ── Titles, and meaning through Schreibstube (ADR-223) ───────────────────────
//
// Without Schreibstube the box searches titles and nothing else. With it, the
// conversations it finds by meaning join below the title hits after a pause in
// typing, under their own header, and an answer for a query that moved on is
// dropped.
describe("title search and search by meaning (ADR-223)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;

	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	async function seed(): Promise<void> {
		await seedConversation(plugin, { name: "Einrichtung Seestraße", messages: [userMsg("e1", "die Küche soll hell werden")] } as Partial<Conversation>);
		await seedConversation(plugin, { name: "Tax filing", messages: [userMsg("t1", "quarterly deadlines")] } as Partial<Conversation>);
		await seedConversation(plugin, { name: "Quartz watches", messages: [userMsg("q1", "the seiko astron")] } as Partial<Conversation>);
	}

	const idOf = (name: string): string => plugin.conversations.find((c) => c.name === name)!.id;
	const open = (view: PythiaSidebarView): void =>
		(view as unknown as { historyController: { openHistoryView(): void } }).historyController.openHistoryView();
	/** Past the meaning pause (300 ms) and the answer's microtask. */
	const afterMeaning = (): Promise<void> => new Promise((r) => setTimeout(r, 380));

	async function search(pane: () => Element, text: string): Promise<void> {
		const input = panelInput(pane);
		input.value = text;
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await settle();
	}

	it("without Schreibstube, a word only in a message finds nothing", async () => {
		await seed();
		plugin.searchConversationsByMeaning = () => null;
		const { view, pane } = await mountView(plugin);
		open(view);
		await search(pane, "küche");
		await afterMeaning();

		expect(historyRows(pane)).toHaveLength(0);
		expect(pane().querySelector(".p-history-group")).toBeNull();
	});

	it("with Schreibstube, what it finds by meaning joins below the titles", async () => {
		await seed();
		const asked: string[] = [];
		plugin.searchConversationsByMeaning = (text) => {
			asked.push(text);
			return Promise.resolve([idOf("Einrichtung Seestraße")]);
		};
		const { view, pane } = await mountView(plugin);
		open(view);
		await search(pane, "küche");
		expect(historyRows(pane)).toHaveLength(0);                  // titles answer at once: nothing

		await afterMeaning();
		expect(asked).toEqual(["küche"]);
		expect(pane().querySelector(".p-history-group")?.textContent).toBe("BY MEANING · SCHREIBSTUBE");
		expect(historyRows(pane).map((r) => r.querySelector(".p-history-row-title")?.textContent))
			.toEqual(["Einrichtung Seestraße"]);
		expect(pane().querySelector(".p-nav-empty")?.hasAttribute("hidden") ?? true).toBe(true);
	});

	it("does not repeat a title hit under meaning", async () => {
		await seed();
		plugin.searchConversationsByMeaning = () => Promise.resolve([idOf("Quartz watches")]);
		const { view, pane } = await mountView(plugin);
		open(view);
		await search(pane, "quartz");
		await afterMeaning();

		expect(historyRows(pane)).toHaveLength(1);
		expect(pane().querySelector(".p-history-group")).toBeNull();
	});

	it("drops an answer for a query that moved on", async () => {
		await seed();
		let answer: (ids: string[]) => void = () => undefined;
		plugin.searchConversationsByMeaning = () => new Promise((r) => (answer = r));
		const { view, pane } = await mountView(plugin);
		open(view);
		await search(pane, "küche");
		await afterMeaning();
		panelInput(pane).value = "kitchen";                           // typed on, not yet rebuilt
		answer([idOf("Einrichtung Seestraße")]);
		await tick();

		expect(historyRows(pane)).toHaveLength(0);
	});

	/** A stub that records each question and its signal, and answers when told. */
	function recordQuestions(): { asked: { text: string; signal?: AbortSignal; answer(ids: string[]): void }[] } {
		const asked: { text: string; signal?: AbortSignal; answer(ids: string[]): void }[] = [];
		plugin.searchConversationsByMeaning = (text, _limit, signal) =>
			new Promise((r) => asked.push({ text, signal, answer: r }));
		return { asked };
	}

	it("closing the panel drops its question (ADR-257)", async () => {
		await seed();
		const { asked } = recordQuestions();
		const { view, pane } = await mountView(plugin);
		open(view);
		await search(pane, "küche");
		await afterMeaning();
		open(view);                                                   // toggles shut

		expect(asked.map((q) => q.signal?.aborted)).toEqual([true]);
	});

	it("typing on drops the question for the old text (ADR-257)", async () => {
		await seed();
		const { asked } = recordQuestions();
		const { view, pane } = await mountView(plugin);
		open(view);
		await search(pane, "küche");
		await afterMeaning();
		await search(pane, "küchenplan");

		expect(asked[0].signal?.aborted).toBe(true);
	});

	it("a rebuild for the same text reuses the question, and its answer still shows (ADR-257)", async () => {
		await seed();
		const { asked } = recordQuestions();
		const { view, pane } = await mountView(plugin);
		open(view);
		await search(pane, "küche");
		await afterMeaning();
		await search(pane, "küche");                                  // e.g. a row deleted: same text
		await afterMeaning();
		asked[0].answer([idOf("Einrichtung Seestraße")]);
		await tick();

		expect(asked).toHaveLength(1);
		expect(asked[0].signal?.aborted).toBe(false);
		expect(historyRows(pane).map((r) => r.querySelector(".p-history-row-title")?.textContent))
			.toEqual(["Einrichtung Seestraße"]);
	});

	it("related mode taking the list drops the question (ADR-257)", async () => {
		await seed();
		const { asked } = recordQuestions();
		(plugin as unknown as { getRelatedConversations: () => Promise<unknown[]> }).getRelatedConversations = async () => [];
		const { view, pane } = await mountView(plugin);
		open(view);
		await search(pane, "tax");
		await afterMeaning();
		pane().querySelector<HTMLElement>(".p-history-relate")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(asked[0].signal?.aborted).toBe(true);
	});

	it("does not draw a conversation that was deleted while the answer was on its way", async () => {
		await seed();
		const { asked } = recordQuestions();
		const { view, pane } = await mountView(plugin);
		open(view);
		await search(pane, "küche");
		await afterMeaning();
		const gone = idOf("Tax filing");
		plugin.conversations = plugin.conversations.filter((c) => c.id !== gone);
		asked[0].answer([gone, idOf("Einrichtung Seestraße")]);
		await tick();

		expect(historyRows(pane).map((r) => r.querySelector(".p-history-row-title")?.textContent))
			.toEqual(["Einrichtung Seestraße"]);
	});

	it("never offers the conversation being linked from, whoever found it (ADR-143)", async () => {
		await seed();
		const self = idOf("Einrichtung Seestraße");
		plugin.searchConversationsByMeaning = () => Promise.resolve([self, idOf("Tax filing")]);
		const { view, pane } = await mountView(plugin);
		view.pickConversation({ excludeId: self, onPick: () => {}, placeholder: "Link with conversation…" });
		await search(pane, "küche");
		await afterMeaning();

		expect(historyRows(pane).map((r) => r.querySelector(".p-history-row-title")?.textContent))
			.toEqual(["Tax filing"]);
	});
});
