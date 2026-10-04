// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { Notice } from "obsidian";
import { makePlugin, mountView, seedConversation, aiMsg } from "./helpers/viewHarness";
import { previewSystemPrompt } from "../services/sendPreview";
import type { Conversation } from "../models/types";
import { t } from "../i18n";

// Fork from favorites, end to end through the view (ADR-255): the card's
// action, the fork it opens, the pill, and the explicit ↻.

type Plugin = Awaited<ReturnType<typeof makePlugin>>;
const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup(over: Partial<Conversation>) {
	const plugin = await makePlugin();
	const source = await seedConversation(plugin, {
		name: "Rent research",
		messages: [aiMsg("a1", "Rents follow wages.")],
		favorites: [{ id: "f1", messageId: "a1", name: "Rents", text: "Rents follow wages." }],
		...over,
	} as Partial<Conversation>);
	const { view, pane } = await mountView(plugin);
	(plugin as unknown as { activateView: () => Promise<unknown> }).activateView = async () => view;
	return { plugin, source, view, pane };
}

const forks = (plugin: Plugin, sourceId: string) => plugin.conversations.filter((c) => c.forkedFromId === sourceId);

describe("Fork from favorites (ADR-255)", () => {
	beforeEach(() => { document.body.innerHTML = ""; (Notice as unknown as { shown: string[] }).shown = []; });

	it("the card's action opens an empty fork carrying the summary, and nothing else from the source", async () => {
		const { plugin, source, pane } = await setup({
			summaryText: "The whole conversation.",
			favoritesSummary: { text: "## Key learnings\n- Rents follow wages.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f1" },
		});
		pane().querySelector<HTMLElement>(".p-summary-card[data-kind=favorites] .p-summary-card-fork")!.click();
		await flush(); await flush();

		const [fork] = forks(plugin, source.id);
		expect(fork.messages).toEqual([]);
		expect(fork.forkedFromFavorites).toEqual({ text: "## Key learnings\n- Rents follow wages.", sourceUpdatedAt: "2026-10-01T10:00:00.000Z", favoriteCount: 1 });
		expect(fork.forkedFromSummary).toBeUndefined();
		expect(fork.forkedFromSelection).toBeUndefined();

		// What Pythia sends shows it — the preview reads the same builder as the send.
		const prompt = previewSystemPrompt(fork, plugin.settings);
		expect(prompt).toContain("Rents follow wages.");
		expect(prompt).not.toContain("The whole conversation.");

		// The fork says what it carries: banner line and pill.
		expect(pane().querySelector(".pythia-fork-favorites")!.textContent).toContain("1");
		const pill = pane().querySelector(".p-wikilink--favorites")!;
		expect(pill.textContent).toContain(t("favoritesSeedPill", { name: "Rent research" }));
		expect(pill.querySelector(".p-wikilink-update")).toBeNull();
	});

	it("an outdated summary is regenerated before the fork — never forked from as it was", async () => {
		const { plugin, source, pane } = await setup({
			favoritesSummary: { text: "Old.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f0" },
		});
		(plugin.llmRouter as unknown as { generateFavoritesSummary: () => Promise<string> }).generateFavoritesSummary = async () => "New.";
		pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush(); await flush();

		const [fork] = forks(plugin, source.id);
		expect(fork.forkedFromFavorites?.text).toBe("New.");
		expect(plugin.conversationStore.getById(source.id)!.favoritesSummary?.favoriteIds).toBe("f1");
	});

	it("an empty regeneration says so and creates no fork", async () => {
		const { plugin, source, pane } = await setup({
			favoritesSummary: { text: "Old.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f0" },
		});
		(plugin.llmRouter as unknown as { generateFavoritesSummary: () => Promise<string> }).generateFavoritesSummary = async () => "";
		pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush();

		expect(forks(plugin, source.id)).toEqual([]);
		expect((Notice as unknown as { shown: string[] }).shown).toContain(t("summaryEmpty"));
	});

	it("a newer source summary is offered on the pill and taken only on ↻", async () => {
		const { plugin, source, view, pane } = await setup({
			favoritesSummary: { text: "First.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f1" },
		});
		pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush();
		const [fork] = forks(plugin, source.id);

		// The source is summarized again, elsewhere. The fork does not follow on its own.
		source.favoritesSummary = { text: "Second.", updatedAt: "2026-10-02T10:00:00.000Z", favoriteIds: "f1" };
		await view.setActiveConversation(fork);
		expect(fork.forkedFromFavorites?.text).toBe("First.");
		const update = pane().querySelector<HTMLElement>(".p-wikilink--favorites .p-wikilink-update")!;
		expect(update.classList.contains("is-stale")).toBe(true);

		update.click();
		await flush(); await flush();
		expect(plugin.conversationStore.getById(fork.id)!.forkedFromFavorites).toMatchObject({ text: "Second.", sourceUpdatedAt: "2026-10-02T10:00:00.000Z" });
		expect(pane().querySelector(".p-wikilink--favorites .p-wikilink-update")).toBeNull();
	});

	it("× stops sending it", async () => {
		const { plugin, source, pane } = await setup({
			favoritesSummary: { text: "First.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f1" },
		});
		pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush();
		const [fork] = forks(plugin, source.id);
		pane().querySelector<HTMLElement>(".p-wikilink--favorites .p-wikilink-x")!.click();
		await flush();
		expect(plugin.conversationStore.getById(fork.id)!.forkedFromFavorites).toBeUndefined();
		expect(previewSystemPrompt(fork, plugin.settings)).not.toContain("First.");
	});
});

describe("the fork tree marks a fork from favorites (ADR-255, S6)", () => {
	it("a ★ on the favorites fork, none on a passage fork", async () => {
		const { NavigatorController } = await import("../ui/NavigatorController");
		const base = { messages: [], contextNotes: [], favorites: [] };
		const source = { ...base, id: "s", name: "Source" } as unknown as Conversation;
		const favFork = { ...base, id: "f", name: "Fav fork", forkedFromId: "s", forkedFromFavorites: { text: "S", sourceUpdatedAt: "T", favoriteCount: 1 } } as unknown as Conversation;
		const passageFork = { ...base, id: "p", name: "Passage fork", forkedFromId: "s" } as unknown as Conversation;
		const navigatorEl = document.body.createDiv();
		const noop = () => {};
		const nav = new NavigatorController({
			plugin: { conversationStore: { getAll: () => [source, favFork, passageFork], getById: () => undefined } },
			navigatorEl, indexTriggerEl: document.createElement("button"),
			getConversation: () => source, setActiveConversation: async () => {}, scrollToMessage: noop, scrollToFavorite: noop,
			removeFavorite: async () => {}, revealMergeLink: noop, removeMergeLink: async () => {}, goToFavoritesSummary: noop,
			forkFromFavorites: async () => {},
		} as never);
		nav.toggle();
		// Forks is collapsed by default; its rows are built on the first expand.
		navigatorEl.querySelector<HTMLElement>(".p-nav-group-header")!
			.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
		const rows = [...navigatorEl.querySelectorAll<HTMLElement>(".p-nav-tree-item")];
		const row = (name: string) => rows.find((r) => r.textContent?.includes(name))!;
		expect(row("Fav fork").querySelector(".p-nav-fork-kind")?.getAttribute("title")).toBe(t("forkedFromFavoritesTag"));
		expect(row("Passage fork").querySelector(".p-nav-fork-kind")).toBeNull();
		nav.close();
	});
});
