// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makePlugin, mountView, seedConversation, userMsg, aiMsg } from "./helpers/viewHarness";
import { Notice } from "obsidian";
import { decorateAnchorLinks, NoteAnchorHover, renderAnchorCard, type AnchorCardHost } from "../ui/noteAnchorMarks";
import { linkSelectionToChapter, startLinkedConversation } from "../ui/noteAnchorEntries";
import { anchorMarkup } from "../services/noteAnchors";
import { resumeDeepLink } from "../utils";
import { t } from "../i18n";
import type { AnchorSummary } from "../services/chapterSummary";

const url = (id: string, msg?: string) => resumeDeepLink(id, "vault", msg);
const notices = Notice as unknown as { shown: string[] };

function clipboard(): string[] {
	const written: string[] = [];
	Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (s: string) => { written.push(s); } } });
	return written;
}

/** An editor over one line of text, enough for the two commands. */
function editor(line: string, from: number, to: number) {
	const doc = { text: line };
	return {
		doc,
		getSelection: () => doc.text.slice(from, to),
		listSelections: () => [{ anchor: { line: 0, ch: from }, head: { line: 0, ch: to } }],
		getRange: (a: { ch: number }, b: { ch: number }) => doc.text.slice(a.ch, b.ch),
		replaceRange: (text: string, a: { ch: number }, b: { ch: number }) => { doc.text = doc.text.slice(0, a.ch) + text + doc.text.slice(b.ch); },
		replaceSelection: (text: string) => { doc.text = doc.text.slice(0, from) + text + doc.text.slice(to); },
	};
}

describe("copy a chapter's link from the panel (ADR-249)", () => {
	beforeEach(() => { document.body.innerHTML = ""; notices.shown = []; });

	it("every user message carries the control, and it copies a chapter link", async () => {
		const plugin = await makePlugin();
		const conv = await seedConversation(plugin, { name: "Rent cap", messages: [userMsg("u1", "Index clause?"), aiMsg("a1", "Lags."), userMsg("u2", "New leases?")] });
		const { pane } = await mountView(plugin);
		const buttons = pane().querySelectorAll<HTMLButtonElement>(".p-msg-user .p-turn-label .p-chapter-link");
		expect(buttons).toHaveLength(2);
		expect(buttons[0].className).toContain("pb pb-icon");
		expect(pane().querySelector(".p-msg-ai .p-chapter-link")).toBeNull();

		const written = clipboard();
		buttons[1].click();
		await vi.waitFor(() => expect(written).toEqual([url(conv.id, "u2")]));
		expect(plugin.noteAnchors.copied).toMatchObject({ ref: { id: conv.id, msg: "u2" }, name: "Rent cap › New leases?" });
		await vi.waitFor(() => expect(notices.shown.at(-1)).toBe(t("chapterLinkCopied", { name: "Rent cap › New leases?" })));
	});

	it("a chapter link opens its chapter; a chapter that is gone is said", async () => {
		const plugin = await makePlugin();
		const conv = await seedConversation(plugin, { messages: [userMsg("u1", "q"), aiMsg("a1", "a")] });
		const { view } = await mountView(plugin);
		vi.spyOn(plugin, "activateView").mockResolvedValue(view);
		const scroll = vi.spyOn(view, "scrollToMessage");
		expect(await plugin.openConversationAt(conv.id, "u1")).toBe("ok");
		expect(scroll).toHaveBeenCalledWith("u1");
		expect(await plugin.openConversationAt(conv.id, "a1")).toBe("ok"); // an answer link (ADR-250)
		expect(scroll).toHaveBeenLastCalledWith("a1");
		expect(await plugin.openConversationAt(conv.id, "gone")).toBe("no-message");
		expect(await plugin.openConversationAt("nope")).toBe("no-conversation");
	});
});

describe("a note anchor in Reading view", () => {
	it("marks a started conversation's flagged link without any == around it (ADR-253)", () => {
		const root = document.createElement("div");
		root.innerHTML = `<p><a class="external-link" href="${url("c1")}&amp;anchor=1">started</a>`
			+ ` <a class="external-link" href="${url("c2")}">↗ backlink</a></p>`;
		decorateAnchorLinks(root);
		expect([...root.querySelectorAll("a")].map((a) => a.classList.contains("p-note-anchor"))).toEqual([true, false]);
	});

	it("marks a chapter link or a wrapped link, with its == wrapper — and not an old backlink", () => {
		const root = document.createElement("div");
		root.innerHTML = `<p><mark><a class="external-link" href="${url("c1", "m1")}">cap</a></mark>`
			+ ` <a class="external-link" href="${url("c2", "m2")}">pasted chapter</a>`
			+ ` <mark><a class="external-link" href="${url("c4")}">wrapped conversation</a></mark>`
			+ ` <a class="external-link" href="${url("c2")}">↗ old backlink</a>`
			+ ` <mark>more <a class="external-link" href="${url("c3")}">x</a></mark>`
			+ ` <a class="external-link" href="obsidian://pythia?vault=v">open</a></p>`;
		decorateAnchorLinks(root);
		const links = root.querySelectorAll("a");
		expect([...links].map((a) => a.classList.contains("p-note-anchor"))).toEqual([true, true, true, false, false, false]);
		expect([...root.querySelectorAll("mark")].map((m) => m.classList.contains("p-note-anchor-mark"))).toEqual([true, true, false]);
	});
});

describe("the anchor's card", () => {
	const host = (summary: AnchorSummary, status: ReturnType<AnchorCardHost["status"]>): AnchorCardHost & { opened: unknown[] } => {
		const opened: unknown[] = [];
		return {
			opened,
			summary: () => summary,
			status: () => status,
			messageCount: () => 4,
			refresh: async () => {},
			open: async (ref) => { opened.push(ref); },
		};
	};

	it("shows the chapter, its summary as text, and opens the chapter", () => {
		const el = document.createElement("div");
		const h = host({ state: "ok", conversationName: "Rent cap", chapterName: "Index", summary: "<b>not markup</b>", date: "2026-09-29T12:00:00.000Z" }, "ok");
		renderAnchorCard(el, { id: "c1", msg: "u1" }, h);
		expect(el.querySelector(".p-anchor-card-title")!.textContent).toBe("Rent cap › Index");
		expect(el.querySelector(".p-anchor-card-body")!.textContent).toBe("<b>not markup</b>");
		expect(el.querySelector(".p-anchor-card-body b")).toBeNull();
		expect(el.querySelector(".p-anchor-card-meta")!.textContent).toContain(t("msgCount", { n: "4" }));
		el.querySelector<HTMLButtonElement>(".p-anchor-card-open")!.click();
		expect(h.opened).toEqual([{ id: "c1", msg: "u1" }]);
	});

	it("says a conversation is deleted and offers nothing to open", () => {
		const el = document.createElement("div");
		renderAnchorCard(el, { id: "gone" }, host({ state: "deleted" }, "deleted"));
		expect(el.textContent).toContain(t("noteAnchorDeleted"));
		expect(el.querySelector(".p-anchor-card-open")).toBeNull();
	});

	it("an outdated summary carries the accent regenerate and says outdated", () => {
		const el = document.createElement("div");
		renderAnchorCard(el, { id: "c1", msg: "u1" }, host({ state: "ok", conversationName: "C", summary: "S.", date: "2026-09-29T12:00:00.000Z" }, "outdated"));
		expect(el.querySelector(".p-anchor-card-refresh")!.classList.contains("is-stale")).toBe(true);
		expect(el.querySelector(".p-anchor-card-meta")!.textContent).toContain(t("forkSummaryStale"));
	});

	it("opens on hover over any anchor, in Reading view or the editor", () => {
		const hover = new NoteAnchorHover(host({ state: "none", conversationName: "C" }, "missing"));
		for (const html of [`<a class="p-note-anchor" href="${url("c1")}">x</a>`, `<span class="p-note-anchor-lp" data-pythia-anchor="${url("c1", "m")}"><span>x</span></span>`]) {
			const root = document.createElement("div");
			root.innerHTML = html;
			document.body.appendChild(root);
			const target = root.querySelector("a, span span") as HTMLElement;
			hover.onMouseOver({ target } as unknown as MouseEvent);
			const popover = (hover as unknown as { parent: { hoverPopover: { targetEl: HTMLElement; hoverEl: HTMLElement } } }).parent.hoverPopover;
			expect(popover.targetEl).toBe(target.closest(".p-note-anchor, .p-note-anchor-lp"));
			expect(popover.hoverEl.querySelector(".p-anchor-card-title")!.textContent).toBe("C");
		}
		// A plain element opens nothing.
		expect(() => hover.onMouseOver({ target: document.body } as unknown as MouseEvent)).not.toThrow();
	});
});

describe("writing an anchor into a note", () => {
	beforeEach(() => { document.body.innerHTML = ""; notices.shown = []; });

	it("Link selection wraps the selection in the copied chapter link and records it", async () => {
		const plugin = await makePlugin();
		const conv = await seedConversation(plugin, { name: "Rent cap", messages: [userMsg("u1", "q"), aiMsg("a1", "a")] });
		const ed = editor("The index is capped for now.", 13, 19);
		linkSelectionToChapter(plugin, ed as never, "N.md");
		expect(notices.shown.at(-1)).toBe(t("noChapterCopied"));
		expect(ed.doc.text).toBe("The index is capped for now.");

		plugin.noteAnchors.copied = { ref: { id: conv.id, msg: "u1" }, url: url(conv.id, "u1"), name: "Rent cap › q" };
		vi.spyOn(plugin.noteAnchors, "refresh").mockResolvedValue({ refreshed: 0, failed: [] });
		linkSelectionToChapter(plugin, ed as never, "N.md");
		expect(ed.doc.text).toBe(`The index is ${anchorMarkup("capped", url(conv.id, "u1"))} for now.`);
		await vi.waitFor(() => expect(conv.noteAnchors).toEqual([{ path: "N.md", messageId: "u1", createdAt: expect.any(String) }]));
	});

	it("refuses a selection that cannot carry a link, and writes nothing", async () => {
		const plugin = await makePlugin();
		plugin.noteAnchors.copied = { ref: { id: "c", msg: "m" }, url: url("c", "m"), name: "C" };
		const ed = editor("see [this](x) here", 4, 13);
		linkSelectionToChapter(plugin, ed as never, "N.md");
		expect(notices.shown.at(-1)).toBe(t("anchorSelectionMarkup"));
		expect(ed.doc.text).toBe("see [this](x) here");
	});

	it("Start a linked conversation writes the anchor to the new conversation — only over unchanged text", async () => {
		const plugin = await makePlugin();
		const { view } = await mountView(plugin);
		vi.spyOn(plugin, "activateView").mockResolvedValue(view);
		const send = vi.spyOn(view, "triggerAutoPrompt").mockImplementation(() => {});

		const ed = editor("The index is capped for now.", 13, 19);
		await startLinkedConversation(plugin, ed as never, "N.md");
		const conv = plugin.conversations.find((c) => c.noteAnchors?.length)!;
		expect(ed.doc.text).toBe(`The index is ${anchorMarkup("capped", `${url(conv.id)}&anchor=1`)} for now.`);
		expect(conv.noteAnchors).toEqual([{ path: "N.md", createdAt: expect.any(String) }]);
		expect(send).toHaveBeenCalledWith("capped");

		// The note changed while the conversation was being created.
		const moving = editor("The index is capped for now.", 13, 19);
		const create = plugin.createConversation.bind(plugin);
		vi.spyOn(plugin, "createConversation").mockImplementation(async (o) => { moving.doc.text = "Changed."; return create(o); });
		await startLinkedConversation(plugin, moving as never, "N.md");
		expect(moving.doc.text).toBe("Changed.");
		expect(notices.shown).toContain(t("anchorSelectionChanged"));
		expect(send).toHaveBeenLastCalledWith("capped");
	});
});
