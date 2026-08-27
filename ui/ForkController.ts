import { Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { debugLog, formatSummaryTimestamp } from "../services/messageUtils";
import { abbreviateModel } from "../models/knownModels";
import { repaintForkOrigins as paintForkOrigins } from "./HighlightPainter";

type DomEventRegistrar = (
	el: HTMLElement,
	type: string,
	callback: (ev: Event) => void,
	options?: boolean | AddEventListenerOptions,
) => void;

export interface ForkDeps {
	plugin: PythiaPlugin;
	getConversation(): Conversation | null;
	getMessagesEl(): HTMLElement;
	setActiveConversation(conv: Conversation): Promise<void>;
	scrollToMessage(id: string): void;
	expandBubbleIfCollapsed(row: HTMLElement): void;
	/** Render markdown into `el` using the view as the owning Component. */
	renderMarkdown(md: string, el: HTMLElement): void;
	/** Run the LLM favorites-summary call (SummaryController), persist, return text. */
	runFavoritesSummary(conv: Conversation): Promise<string>;
	/** The view's `registerDomEvent`, so long-press listeners auto-clean on unload. */
	registerDomEvent: DomEventRegistrar;
}

/**
 * The fork-origin display surfaces extracted from `PythiaSidebarView` (ADR-103,
 * engineering-review #120): the "branched from…" banner on a fork, the painted
 * fork-origin marks in a source message, and the inline anchor those marks open
 * (fork summary + Open-fork control + a long-press (re)generate menu).
 *
 * Creating a fork from a selection (`onForkConversation`) stays in the view — it
 * operates on the selection toolbar and moves with the Selection cluster.
 * Behaviour is identical to the inline methods this replaced.
 */
export class ForkController {
	private openForkAnchor: HTMLElement | null = null;
	private forkMenuCleanup: (() => void) | null = null;
	private suppressNextForkOpen = false;

	constructor(private readonly d: ForkDeps) {}

	/** Close the inline anchor and any open menu — teardown + pre-rebuild. */
	closeAnchor(): void {
		this.closeForkMenu();
		this.openForkAnchor?.remove();
		this.openForkAnchor = null;
	}

	renderForkBanner(): void {
		const conv = this.d.getConversation();
		if (!conv?.forkedFromId) return;
		const source = this.d.plugin.conversationStore.getById(conv.forkedFromId);

		const banner = this.d.getMessagesEl().createDiv({ cls: "pythia-fork-banner" });
		const header = banner.createDiv({ cls: "pythia-fork-header" });
		setIcon(header.createSpan({ cls: "pythia-fork-icon" }), "git-branch");
		const label = header.createEl("span", { cls: "pythia-fork-label", text: `${t("forkedFromLabel")}: ` });
		if (source) {
			// A span (not an <a>) — matches the extension's standard clickable-link
			// pattern (.p-source-web / .p-wikilink-name) and avoids Obsidian core's
			// anchor underline, which out-specifies a plugin text-decoration rule.
			const link = label.createSpan({
				cls: "pythia-fork-source-link",
				text: source.name,
			});
			const forkId = conv.id;
			link.addEventListener("click", async () => {
				await this.d.setActiveConversation(source);
				// Prefer landing on the fork-origin anchor (scrolls + expands it);
				// fall back to the branch message if the snippet can't be located.
				const mark = this.d.getMessagesEl().querySelector(`.p-fork-origin[data-fork-id="${forkId}"]`);
				if (mark) {
					this.revealForkOrigin(forkId);
				} else if (conv.forkedFromMessageId) {
					this.d.scrollToMessage(conv.forkedFromMessageId);
				}
			});
		} else {
			label.createEl("span", {
				cls: "pythia-fork-source-deleted",
				text: t("deletedConversation"),
			});
		}

		// Show the selected text that triggered the fork, truncated to a readable excerpt.
		const selection = conv.forkedFromSelection?.trim();
		if (selection) {
			const MAX = 220;
			const excerpt = selection.length > MAX
				? selection.slice(0, MAX).trimEnd() + "…"
				: selection;
			banner.createDiv({ cls: "pythia-fork-selection", text: excerpt });
		}
	}

	repaintForkOrigins(body: HTMLElement, messageId: string): void {
		const convId = this.d.getConversation()?.id;
		if (!convId) return;
		const forks = this.d.plugin.conversationStore.getAll()
			.filter((c) => c.forkedFromId === convId && c.forkedFromMessageId === messageId && c.forkedFromSelection)
			// Trim the stored selection when searching so forks saved before ADR-096
			// (with an untrimmed selection that findRange can't locate) still paint.
			.map((c) => ({ id: c.id, text: c.forkedFromSelection!.trim(), occurrenceIndex: c.forkedFromOccurrenceIndex }));
		paintForkOrigins(body, forks);
		// Diagnostic (debugMode only): shows each fork's stored text/index and whether
		// its origin mark actually landed — so a still-broken branch-back is traceable
		// without guessing (ADR-096).
		if (forks.length > 0) {
			debugLog(this.d.plugin.settings, "repaintForkOrigins", { messageId, forks: forks.map((f) => ({
				id: f.id,
				text: f.text,
				occurrenceIndex: f.occurrenceIndex,
				painted: !!body.querySelector(`.p-fork-origin[data-fork-id="${f.id}"]`),
			})) });
		}
	}

	/** Toggle the inline fork-summary anchor for a fork-origin snippet. */
	toggleForkAnchor(forkId: string, markEl: HTMLElement): void {
		// Tapping the already-open anchor's snippet closes it.
		if (this.openForkAnchor?.getAttribute("data-fork-id") === forkId) {
			this.closeAnchor();
			return;
		}
		this.closeAnchor();

		const fork = this.d.plugin.conversationStore.getById(forkId);
		if (!fork) return;

		// Insert the anchor immediately after the snippet's last mark fragment.
		const row = markEl.closest("[data-msg-id]");
		const marks = row?.querySelectorAll<HTMLElement>(`.p-fork-origin[data-fork-id="${forkId}"]`);
		const lastMark = marks && marks.length ? marks[marks.length - 1] : markEl;

		const anchor = createDiv({ cls: "p-fork-anchor", attr: { "data-fork-id": forkId } });
		lastMark.after(anchor);
		this.openForkAnchor = anchor;
		this.buildForkAnchor(anchor, fork);
	}

	/** Fill the anchor with the fork's summary and its Open-fork control.
	 *  `preferType` forces which summary shows (the one just generated); otherwise
	 *  favorites are preferred over the conversation summary. Long-pressing the
	 *  Open-fork button opens a menu to (re)generate either summary. */
	private buildForkAnchor(
		anchor: HTMLElement,
		fork: Conversation,
		preferType?: "conversation" | "favorites",
	): void {
		anchor.empty();
		this.closeForkMenu();

		const favText = fork.favoritesSummary?.text?.trim();
		const convText = fork.summaryText?.trim();
		let summary: string | undefined;
		// Track which summary is displayed so the meta line can show its generation
		// date (favorites is preferred unless "conversation" is forced).
		let summaryKind: "conversation" | "favorites" | undefined;
		const pickConv = () => { summary = convText; summaryKind = "conversation"; };
		const pickFav = () => { summary = favText; summaryKind = "favorites"; };
		if (preferType === "conversation") { if (convText) pickConv(); else if (favText) pickFav(); }
		else { if (favText) pickFav(); else if (convText) pickConv(); }

		// Header: branch icon + ABZWEIGUNG micro-label (F1).
		const head = anchor.createDiv({ cls: "p-fork-anchor-head" });
		setIcon(head.createSpan({ cls: "p-fork-anchor-icon" }), "git-branch");
		head.createSpan({ cls: "p-fork-anchor-label", text: t("forkAnchorLabel") });

		// Fork title.
		anchor.createDiv({ cls: "p-fork-anchor-title", text: fork.name });

		// One or more summary paragraphs (multi-paragraph is the norm — no clamp).
		if (summary) {
			const body = anchor.createDiv({ cls: "p-fork-anchor-body" });
			this.d.renderMarkdown(summary, body);
		}

		// Meta line: "N Nachrichten · Model · <generated date> · Öffnen →". Model and
		// date are shown only when a summary exists; the date reflects whichever
		// summary is displayed. The Öffnen link short-presses to open the fork,
		// long-presses for the summary menu.
		const meta = anchor.createDiv({ cls: "p-fork-anchor-meta" });
		const summaryTs = summaryKind === "favorites"
			? fork.favoritesSummary?.updatedAt
			: summaryKind === "conversation"
				? fork.summaryUpdatedAt
				: undefined;
		const metaParts = [t("msgCount", { n: String(fork.messages.length) })];
		if (summaryTs) {
			metaParts.push(abbreviateModel(fork.model));
			metaParts.push(formatSummaryTimestamp(summaryTs));
		}
		meta.createSpan({
			cls: "p-fork-anchor-metatext",
			text: `${metaParts.join(" · ")} · `,
		});
		const openWrap = meta.createSpan({ cls: "p-fork-open-wrap" });
		const open = openWrap.createEl("button", { cls: "p-fork-anchor-open", text: t("forkOpenShort") });
		open.addEventListener("click", (e) => {
			e.stopPropagation();
			if (this.suppressNextForkOpen) {
				this.suppressNextForkOpen = false;
				return;
			}
			void this.d.setActiveConversation(fork);
		});
		this.attachForkLongPress(open, openWrap, anchor, fork);
	}

	/** 450 ms touch+mouse long-press on the Open-fork button → summary menu. */
	private attachForkLongPress(
		btn: HTMLElement,
		wrap: HTMLElement,
		anchor: HTMLElement,
		fork: Conversation,
	): void {
		let timer: ReturnType<typeof setTimeout> | null = null;
		const cancel = () => {
			if (timer !== null) { clearTimeout(timer); timer = null; }
		};
		const fire = () => {
			timer = null;
			this.suppressNextForkOpen = true;
			this.openForkMenu(wrap, anchor, fork);
		};
		this.d.registerDomEvent(btn, "touchstart", () => { timer = setTimeout(fire, 450); }, { passive: true });
		this.d.registerDomEvent(btn, "touchend", cancel, { passive: true });
		this.d.registerDomEvent(btn, "touchcancel", cancel, { passive: true });
		this.d.registerDomEvent(btn, "touchmove", cancel, { passive: true });
		this.d.registerDomEvent(btn, "mousedown", (e) => { if ((e as MouseEvent).button === 0) timer = setTimeout(fire, 450); });
		this.d.registerDomEvent(btn, "mouseup", cancel);
		this.d.registerDomEvent(btn, "mouseleave", cancel);
	}

	/** The fork anchor's long-press menu — a popover above the Open-fork button.
	 *  "Summarize favorites" is offered only when the fork carries favorites. */
	private openForkMenu(wrap: HTMLElement, anchor: HTMLElement, fork: Conversation): void {
		if (this.forkMenuCleanup) { this.closeForkMenu(); return; } // toggle off

		const menu = wrap.createDiv({ cls: "p-send-menu p-fork-menu" });
		const hasFavorites = (fork.favorites?.length ?? 0) > 0;

		const addItem = (label: string, icon: string, disabled: boolean, action: () => void) => {
			const item = menu.createDiv({
				cls: `p-send-menu-item${disabled ? " p-send-menu-item-disabled" : ""}`,
			});
			const ic = item.createSpan({ cls: "p-send-menu-icon" });
			setIcon(ic, icon);
			item.createSpan({ cls: "p-send-menu-label", text: label });
			if (disabled) return;
			item.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.closeForkMenu();
				action();
			});
		};

		addItem(t("menuSummarizeConversation"), "align-left", fork.messages.length === 0,
			() => void this.generateForkSummary(anchor, fork, "conversation"));
		if (hasFavorites) {
			addItem(t("menuSummarizeFavorites"), "star", false,
				() => void this.generateForkSummary(anchor, fork, "favorites"));
		}

		const onOutside = (e: Event) => {
			if (!wrap.contains(e.target as Node)) this.closeForkMenu();
		};
		window.setTimeout(() => {
			document.addEventListener("mousedown", onOutside, true);
			document.addEventListener("touchstart", onOutside, true);
		}, 0);
		this.forkMenuCleanup = () => {
			document.removeEventListener("mousedown", onOutside, true);
			document.removeEventListener("touchstart", onOutside, true);
			menu.remove();
		};
	}

	private closeForkMenu(): void {
		this.forkMenuCleanup?.();
		this.forkMenuCleanup = null;
	}

	/** Generate (or regenerate) a fork's conversation or favorites summary, then
	 *  re-render the anchor showing the type just generated. */
	private async generateForkSummary(
		anchor: HTMLElement,
		fork: Conversation,
		type: "conversation" | "favorites",
	): Promise<void> {
		if (type === "favorites") {
			const text = await this.d.runFavoritesSummary(fork);
			if (text && this.openForkAnchor === anchor) this.buildForkAnchor(anchor, fork, "favorites");
			return;
		}
		if (fork.messages.length === 0) { new Notice(t("noMessagesToSummarize")); return; }
		const notice = new Notice(t("generatingSummary"), 0);
		try {
			// Use generateSummaryWithTitle (not generateSummary) so summarizing a fork
			// from its source-side anchor also RETITLES the fork — matching the in-fork
			// path (generateConversationSummary). Without this, a fork summarized from
			// the origin keeps its generic "Fork of X" name while one summarized from
			// inside gets a real title.
			const { title, summary } = await this.d.plugin.llmRouter.generateSummaryWithTitle(fork);
			if (summary) {
				fork.summaryText = summary;
				fork.summaryUpdatedAt = new Date().toISOString();
				if (title) {
					fork.name = title;
					void this.d.plugin.renameConversationFile(fork);
				}
				await this.d.plugin.conversationStore.save(fork);
				if (this.openForkAnchor === anchor) this.buildForkAnchor(anchor, fork, "conversation");
			}
		} catch (err) {
			new Notice(t("summaryFailed", { error: err instanceof Error ? err.message : String(err) }));
		} finally {
			notice.hide();
		}
	}

	/** From a fork's banner: scroll to its origin snippet in the source and expand its anchor. */
	revealForkOrigin(forkId: string): void {
		const messagesEl = this.d.getMessagesEl();
		const mark = messagesEl.querySelector<HTMLElement>(
			`.p-fork-origin[data-fork-id="${forkId}"]`
		);
		if (!mark) return;
		const row = mark.closest("[data-msg-id]") as HTMLElement | null;
		if (row) this.d.expandBubbleIfCollapsed(row);
		this.toggleForkAnchor(forkId, mark);
		const top = mark.offsetTop - messagesEl.offsetTop;
		messagesEl.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
	}
}
