import { HoverPopover, setIcon, type HoverParent } from "obsidian";
import { Decoration, MatchDecorator, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { AnchorRef } from "../services/noteAnchors";
import { parseAnchorUrl } from "../services/noteAnchors";
import type { AnchorStatus, AnchorSummary } from "../services/chapterSummary";
import { formatSummaryTimestamp } from "../services/messageUtils";
import { NOTE_ANCHOR_ICON, REGENERATE_ICON } from "./icons";
import { t } from "../i18n";

/**
 * How a note anchor looks and what it shows in a note (ADR-249) — in Reading
 * view, in Live Preview and source mode, and in the card a hover opens.
 *
 * Recognised by the link's ADDRESS, never by its markup: a copied chapter link
 * pasted by hand is an anchor like one Pythia wrapped. Both views paint it with
 * the fork origin's accent ink (`styles.css`, "Note anchors"), and `==` around
 * it loses its yellow — the highlight is there for a reader without Pythia.
 */

/** Reading view: mark every Pythia resume link, and the `==` highlight that is
 *  exactly its wrapper. Idempotent. */
export function decorateAnchorLinks(root: HTMLElement): void {
	for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href^="obsidian://pythia"]'))) {
		if (!parseAnchorUrl(a.getAttribute("href") ?? "")) continue;
		a.addClass("p-note-anchor");
		const parent = a.parentElement;
		if (parent?.tagName === "MARK" && parent.childNodes.length === 1) parent.addClass("p-note-anchor-mark");
	}
}

const LINK_RE = /\[(?:\\.|[^\]\\\n])+\]\((obsidian:\/\/pythia\?[^)\s]+)\)/g;

const matcher = new MatchDecorator({
	regexp: LINK_RE,
	decoration: (m) => parseAnchorUrl(m[1])
		? Decoration.mark({ class: "p-note-anchor-lp", attributes: { "data-pythia-anchor": m[1] } })
		: null,
});

/** Live Preview and source mode: the same links, found in the text itself. */
export const noteAnchorEditorExtension = ViewPlugin.fromClass(class {
	decorations: DecorationSet;
	constructor(view: EditorView) { this.decorations = matcher.createDeco(view); }
	update(update: ViewUpdate): void { this.decorations = matcher.updateDeco(update, this.decorations); }
}, { decorations: (v) => v.decorations });

/** What the card asks of the plugin: read, refresh, open. */
export interface AnchorCardHost {
	summary(ref: AnchorRef): AnchorSummary;
	status(ref: AnchorRef): AnchorStatus;
	messageCount(ref: AnchorRef): number | null;
	refresh(ref: AnchorRef): Promise<void>;
	open(ref: AnchorRef): Promise<void>;
}

/**
 * The card: the fork anchor's grammar (label, title, summary in full, meta
 * line with ↻ and Open →) in Obsidian's own hover popover. The summary is set
 * as TEXT — model output is data, never rendered Markdown here (principle 9).
 */
export function renderAnchorCard(el: HTMLElement, ref: AnchorRef, host: AnchorCardHost): void {
	el.empty();
	// `pythia-modal` brings the button roles (ADR-188), which are scoped to
	// Pythia's own surfaces; `p-anchor-card` undoes the modal's sheet padding.
	const card = el.createDiv({ cls: "pythia-modal p-anchor-card" });
	const head = card.createDiv({ cls: "p-anchor-card-head" });
	setIcon(head.createSpan({ cls: "p-anchor-card-icon" }), NOTE_ANCHOR_ICON);
	head.createSpan({ cls: "p-anchor-card-label", text: t("noteAnchorLabel") });

	const info = host.summary(ref);
	const status = host.status(ref);
	const title = info.conversationName
		? (info.chapterName ? `${info.conversationName} › ${info.chapterName}` : info.conversationName)
		: "";
	if (title) card.createDiv({ cls: "p-anchor-card-title", text: title });

	if (info.state === "ok" && info.summary) card.createDiv({ cls: "p-anchor-card-body", text: info.summary });
	else card.createDiv({
		cls: "p-anchor-card-empty",
		text: status === "deleted" ? t("noteAnchorDeleted") : status === "unanswered" ? t("noteAnchorUnanswered") : t("noteAnchorNoSummary"),
	});
	if (status === "deleted") return;

	const meta = card.createDiv({ cls: "p-anchor-card-meta" });
	const parts: string[] = [];
	const count = host.messageCount(ref);
	if (count !== null) parts.push(t("msgCount", { n: String(count) }));
	if (info.date) parts.push(formatSummaryTimestamp(info.date));
	if (status === "outdated") parts.push(t("forkSummaryStale"));
	if (parts.length) meta.createSpan({ cls: "p-anchor-card-metatext", text: `${parts.join(" · ")} · ` });

	if (status !== "unanswered") {
		const refresh = meta.createEl("button", {
			cls: `pb pb-icon is-inline p-anchor-card-refresh${status === "outdated" || status === "missing" ? " is-stale" : ""}`,
			attr: { "aria-label": t("noteAnchorRefresh"), title: t("noteAnchorRefresh") },
		});
		setIcon(refresh, REGENERATE_ICON);
		refresh.addEventListener("click", (e) => {
			e.stopPropagation();
			refresh.disabled = true;
			void host.refresh(ref).then(() => renderAnchorCard(el, ref, host));
		});
		meta.createSpan({ cls: "p-anchor-card-metatext", text: " · " });
	}
	const open = meta.createEl("button", { cls: "pb pb-link p-anchor-card-open", text: t("forkOpenShort") });
	open.addEventListener("click", (e) => {
		e.stopPropagation();
		void host.open(ref);
	});
}

/** Delay before the card opens, like Obsidian's own page preview. */
const HOVER_DELAY_MS = 300;

/**
 * One delegated `mouseover` for every anchor in every note — Reading view and
 * the editor alike, so no listener is added per link and none outlives its
 * element. Obsidian's `HoverPopover` owns showing and hiding. Phones have no
 * hover: a tap opens the chapter (D-72).
 */
export class NoteAnchorHover {
	private readonly parent: HoverParent = { hoverPopover: null };
	private target: HTMLElement | null = null;

	constructor(private readonly host: AnchorCardHost) {}

	onMouseOver(e: MouseEvent): void {
		const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".p-note-anchor, .p-note-anchor-lp");
		if (!el) return;
		if (el === this.target && this.parent.hoverPopover) return;
		const ref = parseAnchorUrl(el.getAttribute("href") ?? el.getAttribute("data-pythia-anchor") ?? "");
		if (!ref) return;
		this.target = el;
		const popover = new HoverPopover(this.parent, el, HOVER_DELAY_MS);
		renderAnchorCard(popover.hoverEl, ref, this.host);
	}
}
