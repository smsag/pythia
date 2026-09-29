// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import "./helpers/viewHarness"; // Obsidian's DOM helpers
import { DeleteConversationModal } from "../suggest/DeleteConversationModal";
import { NoteAnchorService, type NoteAnchorHost } from "../services/NoteAnchorService";
import { DEFAULT_SETTINGS } from "../models/settings";
import { t } from "../i18n";
import { decorateAnchorLinks, NoteAnchorHover } from "../ui/noteAnchorMarks";
import { resumeDeepLink } from "../utils";
import type { Conversation } from "../models/types";

const T = "2026-09-29T12:00:00.000Z";

function open(conv: Partial<Conversation>): HTMLElement {
	const modal = new DeleteConversationModal({} as never, { name: "Rent cap", ...conv } as Conversation, {
		onDelete: () => {}, onArchive: () => {}, archiveFolder: "Pythia/Archive",
	});
	const contentEl = document.createElement("div");
	Object.assign(modal, { contentEl, modalEl: document.createElement("div") });
	modal.onOpen();
	return contentEl;
}

describe("deleting a conversation notes link to (ADR-250)", () => {
	it("the dialog names the notes whose links stop working — once each", () => {
		const el = open({ noteAnchors: [
			{ path: "Docs/Vision.md", messageId: "a1", createdAt: T },
			{ path: "Docs/Vision.md", messageId: "a2", createdAt: T },
			{ path: "Notes/Rent.md", createdAt: T },
		] });
		expect(el.querySelector(".p-delete-linked")?.textContent)
			.toBe(t("deleteConvLinkedNotes", { count: "2", notes: "Vision, Rent" }));
	});

	it("says nothing extra when no note links here", () => {
		expect(open({}).querySelector(".p-delete-linked")).toBeNull();
	});
});

describe("a deleted document stops protecting its conversations", () => {
	it("forget drops every record at or under the path, and saves only what changed", async () => {
		const a = { id: "a", messages: [], noteAnchors: [
			{ path: "Docs/Vision.md", messageId: "x", createdAt: T }, { path: "Docs/Old/Plan.md", createdAt: T }, { path: "Keep.md", createdAt: T },
		] } as unknown as Conversation;
		const b = { id: "b", messages: [], noteAnchors: [{ path: "Docs/Old/Plan.md", createdAt: T }] } as unknown as Conversation;
		const c = { id: "c", messages: [], noteAnchors: [{ path: "Docsx.md", createdAt: T }] } as unknown as Conversation;
		const saved: string[] = [];
		const service = new NoteAnchorService({
			app: {} as NoteAnchorHost["app"],
			conversations: () => [a, b, c],
			getById: () => undefined,
			save: async (conv) => { saved.push(conv.id); },
			llm: () => ({}) as never,
			settings: () => DEFAULT_SETTINGS,
			notice: () => {}, log: () => {},
		});
		await service.forget("Docs/Vision.md");
		await service.forget("Docs/Old");
		expect(a.noteAnchors).toEqual([{ path: "Keep.md", createdAt: T }]);
		expect(b.noteAnchors).toBeUndefined();
		expect(c.noteAnchors).toHaveLength(1); // "Docsx.md" is not under "Docs"
		expect(saved).toEqual(["a", "a", "b"]);
	});
});

describe("a footnote's own link to an answer", () => {
	it("keeps the link look in Reading view, and still opens the card", () => {
		const url = resumeDeepLink("c1", "V", "a2");
		const root = document.createElement("div");
		root.innerHTML = `<p>Capped.</p><section class="footnotes"><ol><li id="fn-1"><p><a class="external-link" href="${url}">„Rent cap › New leases“</a> (Pythia, 29 Sep 2026)</p></li></ol></section>`;
		document.body.appendChild(root);
		decorateAnchorLinks(root);
		const a = root.querySelector("a")!;
		expect(a.classList.contains("p-note-anchor")).toBe(false);
		expect(a.classList.contains("p-note-anchor-ref")).toBe(true);
		const hover = new NoteAnchorHover({
			summary: () => ({ state: "none", conversationName: "Rent cap", chapterName: "New leases" }),
			status: () => "missing", messageCount: () => 4, refresh: async () => {}, open: async () => {},
		});
		hover.onMouseOver({ target: a } as unknown as MouseEvent);
		const popover = (hover as unknown as { parent: { hoverPopover: { hoverEl: HTMLElement } } }).parent.hoverPopover;
		expect(popover.hoverEl.querySelector(".p-anchor-card-title")?.textContent).toBe("Rent cap › New leases");
	});
});
