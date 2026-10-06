// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Notice } from "obsidian";
import { makePlugin, mountView, seedConversation, aiMsg } from "./helpers/viewHarness";
import { previewSystemPrompt } from "../services/sendPreview";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { forkKind } from "../services/favoritesFork";

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
	(plugin as unknown as { viewShowing: () => Promise<unknown> }).viewShowing = async () => view;
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
		expect(fork.forkedFromFavorites).toEqual({ text: "## Key learnings\n- Rents follow wages.", sourceUpdatedAt: "2026-10-01T10:00:00.000Z", favoriteCount: 1, fromId: source.id });
		expect(fork.forkedFromSummary).toBeUndefined();
		expect(fork.forkedFromSelection).toBeUndefined();

		// What Pythia sends shows it — the preview reads the same builder as the send.
		const prompt = previewSystemPrompt(fork, plugin.settings);
		expect(prompt).toContain("Rents follow wages.");
		expect(prompt).not.toContain("The whole conversation.");

		// The fork says what it carries: banner line (singular for one) and pill.
		expect(pane().querySelector(".pythia-fork-favorites")!.textContent).toContain(t("forkedFromFavoritesLineOne", { date: "" }).split("·")[0].trim());
		const pill = pane().querySelector(".p-wikilink--favorites")!;
		expect(pill.textContent).toContain(t("favoritesSeedPill", { name: "Rent research" }));
		expect(pill.querySelector(".p-wikilink-update")).toBeNull();
	});

	it("one source, 1 … n forks: every press makes another, each with its own copy, all marked", async () => {
		const { plugin, source, view, pane } = await setup({
			favoritesSummary: { text: "Ground.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f1" },
		});
		const generate = vi.fn(async () => "never asked");
		(plugin.llmRouter as unknown as { generateFavoritesSummary: () => Promise<string> }).generateFavoritesSummary = generate;
		for (let i = 0; i < 3; i++) {
			await view.setActiveConversation(source);
			pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
			await flush(); await flush();
		}
		const made = forks(plugin, source.id);
		expect(made).toHaveLength(3);
		expect(new Set(made.map((f) => f.id)).size).toBe(3);
		for (const f of made) {
			expect(f.forkedFromFavorites?.text).toBe("Ground.");
			expect(forkKind(f)).toBe("favorites");
		}
		// A copy each: switching one off leaves the others sending.
		await plugin.setForkedFavoritesSent(made[0].id, false);
		expect(made.slice(1).every((f) => !f.forkedFromFavorites?.off)).toBe(true);
		// The summary was current, so it was taken as it is — never summarized again.
		expect(generate).not.toHaveBeenCalled();
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

	it("× switches it off — kept, not sent, the fork still a fork from favorites — and it can be sent again", async () => {
		const { plugin, source, pane } = await setup({
			favoritesSummary: { text: "First.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f1" },
		});
		pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush();
		const [fork] = forks(plugin, source.id);

		pane().querySelector<HTMLElement>(".p-wikilink--favorites .p-wikilink-x")!.click();
		await flush(); await flush();
		const live = plugin.conversationStore.getById(fork.id)!;
		expect(live.forkedFromFavorites).toMatchObject({ text: "First.", off: true });
		expect(previewSystemPrompt(live, plugin.settings)).not.toContain("First.");
		expect(forkKind(live)).toBe("favorites");
		// The pill and the banner both say so at once — no rebuild needed.
		expect(pane().querySelector(".p-wikilink--favorites")!.classList.contains("is-off")).toBe(true);
		expect(pane().querySelector(".pythia-fork-favorites")!.textContent).toContain(t("favoritesSeedOff"));

		pane().querySelector<HTMLElement>(".p-wikilink--favorites .p-wikilink-x")!.click();
		await flush(); await flush();
		expect(plugin.conversationStore.getById(fork.id)!.forkedFromFavorites?.off).toBeUndefined();
		expect(previewSystemPrompt(plugin.conversationStore.getById(fork.id)!, plugin.settings)).toContain("First.");
		expect(pane().querySelector(".pythia-fork-favorites")!.textContent).not.toContain(t("favoritesSeedOff"));
	});

	it("↻ repaints the banner line with the new count and date", async () => {
		const { plugin, source, view, pane } = await setup({
			favoritesSummary: { text: "First.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f1" },
		});
		pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush();
		const [fork] = forks(plugin, source.id);
		source.favorites!.push({ id: "f2", messageId: "a1", name: "More", text: "follow" });
		source.favoritesSummary = { text: "Second.", updatedAt: "2026-10-02T10:00:00.000Z", favoriteIds: "f1,f2" };
		await view.setActiveConversation(fork);
		pane().querySelector<HTMLElement>(".p-wikilink-update")!.click();
		await flush(); await flush();
		expect(pane().querySelector(".pythia-fork-favorites")!.textContent).toContain("2");
	});

	it("↻ with nothing newer to take says so", async () => {
		const { plugin, source, pane, view } = await setup({
			favoritesSummary: { text: "First.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f1" },
		});
		pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush();
		const [fork] = forks(plugin, source.id);
		source.favoritesSummary = { text: "Second.", updatedAt: "2026-10-02T10:00:00.000Z", favoriteIds: "f1" };
		await view.setActiveConversation(fork);
		// The source loses its summary between the drawing and the tap.
		delete source.favoritesSummary;
		pane().querySelector<HTMLElement>(".p-wikilink-update")!.click();
		await flush(); await flush();
		expect((Notice as unknown as { shown: string[] }).shown).toContain(t("favoritesSummaryMissing"));
	});

	it("the fork's first write already holds everything that makes it a fork", async () => {
		const { plugin, source, pane } = await setup({
			favoritesSummary: { text: "First.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f1" },
			temperature: 0.3,
		});
		const writes: Conversation[][] = [];
		const save = plugin.saveConversations.bind(plugin);
		(plugin as unknown as { saveConversations: () => Promise<void> }).saveConversations = async () => {
			writes.push(JSON.parse(JSON.stringify(plugin.conversations)));
			return save();
		};
		pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush();
		const first = writes[0].find((c) => c.forkedFromId === source.id)!;
		expect(first.forkedFromFavorites?.text).toBe("First.");
		expect(first.theme).toBeTruthy();
		expect(first.temperature).toBe(0.3);
	});

	it("a summary without a fingerprint is regenerated before forking — it cannot say a favorite was removed", async () => {
		const { plugin, source, pane } = await setup({
			favoritesSummary: { text: "Old, covers an unstarred passage.", updatedAt: "2026-10-01T10:00:00.000Z" },
		});
		(plugin.llmRouter as unknown as { generateFavoritesSummary: () => Promise<string> }).generateFavoritesSummary = async () => "Fresh.";
		pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush(); await flush();
		expect(forks(plugin, source.id)[0].forkedFromFavorites?.text).toBe("Fresh.");
	});

	it("a failure after the summary is a Notice, not a silent rejection", async () => {
		const { plugin, pane } = await setup({
			favoritesSummary: { text: "First.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f1" },
		});
		(plugin as unknown as { viewShowing: () => Promise<unknown> }).viewShowing = async () => { throw new Error("leaf gone"); };
		pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush();
		expect((Notice as unknown as { shown: string[] }).shown.some((m) => m.includes("leaf gone"))).toBe(true);
	});
});

describe("a fork opens in the leaf showing its source (ADR-255 review)", () => {
	it("with two Pythia leaves, not in the first one", async () => {
		const plugin = await makePlugin();
		const other = await seedConversation(plugin, { name: "Other" });
		const source = await seedConversation(plugin, {
			name: "Source",
			messages: [aiMsg("a1", "x")],
			favorites: [{ id: "f1", messageId: "a1", name: "x", text: "x" }],
			favoritesSummary: { text: "S.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f1" },
		} as Partial<Conversation>);
		const a = (await mountView(plugin)).view;
		const b = (await mountView(plugin)).view;
		await a.setActiveConversation(other);
		await b.setActiveConversation(source);
		const ws = (plugin as unknown as { app: { workspace: Record<string, unknown> } }).app.workspace;
		ws.getLeavesOfType = () => [{ view: a }, { view: b }];

		await b.summaryController.forkFromFavorites();
		const fork = forks(plugin, source.id)[0];
		expect(b.activeConversationId).toBe(fork.id);
		expect(a.activeConversationId).toBe(other.id);
	});

	it("the command acts on the focused leaf", async () => {
		const plugin = await makePlugin();
		const a = (await mountView(plugin)).view;
		const b = (await mountView(plugin)).view;
		const ws = (plugin as unknown as { app: { workspace: Record<string, unknown> } }).app.workspace;
		ws.getLeavesOfType = () => [{ view: a }, { view: b }];
		ws.getActiveViewOfType = () => b;
		expect(await plugin.commandView()).toBe(b);
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

describe("a passage fork's generated summary lands on the live source (ADR-255 review, principle 7)", () => {
	it("survives the source object being replaced during the call, and is saved through the store", async () => {
		const plugin = await makePlugin();
		const source = await seedConversation(plugin, { name: "Src", messages: [aiMsg("a1", "x")] });
		const { view } = await mountView(plugin);
		(plugin as unknown as { viewShowing: () => Promise<unknown> }).viewShowing = async () => view;
		(plugin.llmRouter as unknown as { generateSummary: () => Promise<string> }).generateSummary = async () => {
			// A reload swaps the object while the summary is being written.
			const i = plugin.conversations.findIndex((c) => c.id === source.id);
			plugin.conversations[i] = { ...plugin.conversations[i] };
			return "Sum.";
		};
		const before = source.updatedAt;
		await plugin.cmdForkConversation(source.id, "x", "a1", 0);
		const live = plugin.conversationStore.getById(source.id)!;
		expect(live).not.toBe(source);
		expect(live.summaryText).toBe("Sum.");
		expect(live.updatedAt >= before).toBe(true);
		expect(forks(plugin, source.id)[0].forkedFromSummary).toBe("Sum.");
	});
});

describe("second review of PR #290 (ADR-255 addendum 2)", () => {
	beforeEach(() => { document.body.innerHTML = ""; (Notice as unknown as { shown: string[] }).shown = []; });
	const shown = () => (Notice as unknown as { shown: string[] }).shown;
	const stale = { favoritesSummary: { text: "Old.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f0" } };

	it("a command's view and a fork's view are revealed, as activateView does", async () => {
		const plugin = await makePlugin();
		const shownConv = await seedConversation(plugin, { name: "Shown" });
		const a = (await mountView(plugin)).view;
		await a.setActiveConversation(shownConv);
		const ws = (plugin as unknown as { app: { workspace: Record<string, unknown> } }).app.workspace;
		const revealed: unknown[] = [];
		ws.getLeavesOfType = () => [{ view: a }];
		ws.revealLeaf = async (leaf: unknown) => { revealed.push(leaf); };
		await plugin.commandView();
		await plugin.viewShowing(shownConv.id);
		expect(revealed).toHaveLength(2);
		expect(revealed.every((l) => l === a.leaf)).toBe(true);
	});

	it("switching the leaf during the regenerate: no fork, and the conversation moved to stays", async () => {
		const { plugin, source, view, pane } = await setup(stale);
		const other = await seedConversation(plugin, { name: "Elsewhere" });
		(plugin.llmRouter as unknown as { generateFavoritesSummary: () => Promise<string> }).generateFavoritesSummary = async () => {
			await view.setActiveConversation(other);
			return "New.";
		};
		pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush(); await flush();
		expect(forks(plugin, source.id)).toEqual([]);
		expect(view.activeConversationId).toBe(other.id);
		expect(shown()).toContain(t("forkSourceLeft"));
	});

	it("a favorite removed during the regenerate: no fork from a summary that still covers it", async () => {
		const { plugin, source, pane } = await setup(stale);
		(plugin.llmRouter as unknown as { generateFavoritesSummary: () => Promise<string> }).generateFavoritesSummary = async () => {
			source.favorites = [];
			return "New.";
		};
		pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush(); await flush();
		expect(forks(plugin, source.id)).toEqual([]);
		expect(shown()).toContain(t("favoritesChangedWhileSummarizing"));
	});

	it("a second tap while a fork is being made makes no second fork and no second call", async () => {
		const { plugin, source, pane } = await setup(stale);
		let calls = 0;
		let release!: () => void;
		const gate = new Promise<void>((r) => { release = r; });
		(plugin.llmRouter as unknown as { generateFavoritesSummary: () => Promise<string> }).generateFavoritesSummary = async () => {
			calls++;
			await gate;
			return "New.";
		};
		const btn = () => pane().querySelector<HTMLElement>(".p-summary-card-fork")!;
		btn().click();
		btn().click();
		release();
		await flush(); await flush(); await flush();
		expect(calls).toBe(1);
		expect(forks(plugin, source.id)).toHaveLength(1);
		expect(shown()).toContain(t("forkInProgress"));
	});

	it("a fork keeps the source's pinned answer language; an inherited one stays inherited", async () => {
		const { plugin, source, pane } = await setup({
			outputLanguage: "de",
			favoritesSummary: { text: "S.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f1" },
		} as Partial<Conversation>);
		pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush();
		expect(forks(plugin, source.id)[0].outputLanguage).toBe("de");

		const plain = await setup({ favoritesSummary: { text: "S.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f1" } });
		plain.pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush();
		expect(forks(plain.plugin, plain.source.id)[0].outputLanguage).toBeUndefined();
	});

	it("an empty summary for a passage fork says so; the fork still opens", async () => {
		const plugin = await makePlugin();
		const source = await seedConversation(plugin, { name: "Src", messages: [aiMsg("a1", "x")] });
		const { view } = await mountView(plugin);
		(plugin as unknown as { viewShowing: () => Promise<unknown> }).viewShowing = async () => view;
		(plugin.llmRouter as unknown as { generateSummary: () => Promise<string> }).generateSummary = async () => "";
		await plugin.cmdForkConversation(source.id, "x", "a1", 0);
		expect(forks(plugin, source.id)).toHaveLength(1);
		expect(shown()).toContain(t("forkSummaryEmpty"));
	});

	it("a passage fork of a fork from favorites keeps the favorites — as a passage fork naming the original source", async () => {
		const { plugin, source, view, pane } = await setup({
			favoritesSummary: { text: "Ground.", updatedAt: "2026-10-01T10:00:00.000Z", favoriteIds: "f1" },
		});
		pane().querySelector<HTMLElement>(".p-summary-card-fork")!.click();
		await flush(); await flush();
		const parent = forks(plugin, source.id)[0];
		parent.messages.push(aiMsg("p1", "an answer in the fork"));
		parent.summaryText = "Parent summary.";
		await plugin.cmdForkConversation(parent.id, "an answer", "p1", 0);
		const child = forks(plugin, parent.id)[0];

		expect(child.forkedFromFavorites).toMatchObject({ text: "Ground.", fromId: source.id });
		expect(forkKind(child)).toBe("passage");
		expect(previewSystemPrompt(child, plugin.settings)).toContain("Ground.");
		await view.setActiveConversation(child);
		expect(pane().querySelector(".p-wikilink--favorites")!.textContent).toContain(t("favoritesSeedPill", { name: "Rent research" }));
	});
});
