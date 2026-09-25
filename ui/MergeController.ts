import { Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation, MergeLink } from "../models/types";
import { t } from "../i18n";
import { debugLog, formatSummaryTimestamp } from "../services/messageUtils";
import { abbreviateModel } from "../models/knownModels";
import { repaintMergeLinks as paintMergeLinks } from "./HighlightPainter";
import { REGENERATE_ICON } from "./icons";
import { scrollChatTo } from "./chatScroll";

type DomEventRegistrar = (
	el: HTMLElement,
	type: string,
	callback: (ev: Event) => void,
	options?: boolean | AddEventListenerOptions,
) => void;

export interface MergeDeps {
	plugin: PythiaPlugin;
	getConversation(): Conversation | null;
	getMessagesEl(): HTMLElement;
	setActiveConversation(conv: Conversation): Promise<void>;
	scrollToMessage(id: string): void;
	expandBubbleIfCollapsed(row: HTMLElement): void;
	/** Render markdown into `el` using the view as the owning Component. */
	renderMarkdown(md: string, el: HTMLElement): void;
	/** The view's `registerDomEvent`, so listeners auto-clean on unload. */
	registerDomEvent: DomEventRegistrar;
}

/** One inbound merge link: a conversation that points at the one being rendered. */
export interface IncomingMerge {
	source: Conversation;
	link: MergeLink;
}

/**
 * Every merge link across `conversations` that points AT `targetId`.
 *
 * Derived on read rather than stored as a back-reference on the target, exactly
 * as fork origins are (`ForkController.repaintForkOrigins` scans for
 * `forkedFromId === convId`). One record, one owner: deleting a link or the
 * conversation that holds it can never leave a stale pointer on the other side,
 * because there is no other side to update.
 *
 * Self-links are excluded so a passage merged with its own conversation — which
 * the picker does not offer, but data could carry — cannot make a conversation
 * list itself as its own source.
 */
export function incomingMergeLinks(
	conversations: Conversation[],
	targetId: string,
): IncomingMerge[] {
	const incoming: IncomingMerge[] = [];
	for (const source of conversations) {
		if (source.id === targetId) continue;
		for (const link of source.merges ?? []) {
			if (link.conversationId === targetId) incoming.push({ source, link });
		}
	}
	return incoming;
}

/**
 * Merge links — the inverse of a fork (ADR-130).
 *
 * A fork takes a selected passage OUT of a conversation into a new one and shows
 * the *source* summary in the child. A merge points a selected passage AT an
 * existing conversation and shows *that* conversation's summary right where the
 * passage sits, as an inline anchor — the same reading affordance as the
 * fork-origin anchor (ADR-058/128), mirrored.
 *
 * Deliberately display-only: a merge never reaches the model. `ContextBuilder`
 * injects no merged summary, so linking conversations costs zero tokens per turn.
 *
 * Creating a merge from a selection lives in `SelectionController` +
 * `ConversationService.cmdMergeConversation`, mirroring how fork creation is
 * split from `ForkController`.
 */
export class MergeController {
	private openMergeAnchor: HTMLElement | null = null;

	constructor(private readonly d: MergeDeps) {}

	/** Close the inline anchor — teardown + pre-rebuild. */
	closeAnchor(): void {
		this.openMergeAnchor?.remove();
		this.openMergeAnchor = null;
	}

	/**
	 * Render the "merged from" banner at the top of a conversation other
	 * conversations have merged with — the far half of the link, so the
	 * relationship is visible from both ends the way a fork's is.
	 *
	 * A fork states this with a banner on the child and a painted passage in the
	 * source. A merge is the same shape reflected: the painted passage lives in
	 * the conversation that made the link, and this banner lives in the one it
	 * points at. Without it, only one side would know.
	 *
	 * Renders nothing when there are no inbound links, so a conversation nobody
	 * merged with looks exactly as it did before.
	 */
	renderIncomingBanner(): void {
		const conv = this.d.getConversation();
		if (!conv) return;
		const incoming = incomingMergeLinks(this.d.plugin.conversationStore.getAll(), conv.id);
		if (incoming.length === 0) return;

		const banner = this.d.getMessagesEl().createDiv({ cls: "pythia-merge-banner" });
		const header = banner.createDiv({ cls: "pythia-merge-header" });
		setIcon(header.createSpan({ cls: "pythia-merge-icon" }), "link");
		header.createSpan({ cls: "pythia-merge-label", text: t("mergedFromLabel") });

		for (const { source, link } of incoming) {
			const entry = banner.createDiv({ cls: "pythia-merge-entry" });
			// A span, not an <a> — same reason as the fork banner (ADR-083): Obsidian
			// core's anchor underline out-specifies a plugin text-decoration rule.
			const nameEl = entry.createSpan({ cls: "pythia-merge-source-link", text: source.name });
			nameEl.addEventListener("click", async () => {
				await this.d.setActiveConversation(source);
				// Prefer landing on the passage itself (scrolls + expands its anchor);
				// fall back to the message when the mark can't be located.
				const mark = this.d.getMessagesEl().querySelector(
					`.p-merge-link[data-merge-id="${link.id}"]`
				);
				if (mark) this.revealMergeLink(link.id);
				else this.d.scrollToMessage(link.messageId);
			});
			// Shorter excerpt than the fork banner's 220: a conversation can be merged
			// with from many passages, so each row has to stay one or two lines.
			const MAX = 120;
			const text = link.text.trim();
			entry.createDiv({
				cls: "pythia-merge-selection",
				text: text.length > MAX ? text.slice(0, MAX).trimEnd() + "…" : text,
			});
		}
	}

	/** Paint every merge link of `messageId` onto its freshly rendered body. */
	repaintMergeLinks(body: HTMLElement, messageId: string): void {
		const conv = this.d.getConversation();
		if (!conv) return;
		const store = this.d.plugin.conversationStore;
		const merges = (conv.merges ?? [])
			.filter((m) => m.messageId === messageId && m.text)
			// A link whose target was deleted stops painting, mirroring how a
			// fork-origin mark disappears with its fork. The record is kept rather
			// than pruned so the link returns if the target is restored.
			.filter((m) => !!store.getById(m.conversationId))
			.map((m) => ({ id: m.id, text: m.text.trim(), occurrenceIndex: m.occurrenceIndex }));
		paintMergeLinks(body, merges);
		if (merges.length > 0) {
			debugLog(this.d.plugin.settings, "repaintMergeLinks", { messageId, merges: merges.map((m) => ({
				id: m.id,
				text: m.text,
				occurrenceIndex: m.occurrenceIndex,
				painted: !!body.querySelector(`.p-merge-link[data-merge-id="${m.id}"]`),
			})) });
		}
	}

	/** Repaint the merge marks of one message without re-rendering the whole chat. */
	repaintMessage(messageId: string): void {
		const row = this.d.getMessagesEl().querySelector<HTMLElement>(
			`[data-msg-id="${messageId}"]`
		);
		if (!row) return;
		const body = row.querySelector<HTMLElement>(".p-ai-body") ?? row;
		this.repaintMergeLinks(body, messageId);
	}

	/** Toggle the inline merge anchor for a linked passage. */
	toggleMergeAnchor(mergeId: string, markEl: HTMLElement): void {
		// Tapping the already-open anchor's passage closes it.
		if (this.openMergeAnchor?.getAttribute("data-merge-id") === mergeId) {
			this.closeAnchor();
			return;
		}
		this.closeAnchor();

		const link = this.d.getConversation()?.merges?.find((m) => m.id === mergeId);
		if (!link) return;
		const target = this.d.plugin.conversationStore.getById(link.conversationId);
		if (!target) return;

		// Insert the anchor immediately after the passage's last mark fragment.
		const row = markEl.closest("[data-msg-id]");
		const marks = row?.querySelectorAll<HTMLElement>(`.p-merge-link[data-merge-id="${mergeId}"]`);
		const lastMark = marks && marks.length ? marks[marks.length - 1] : markEl;

		const anchor = createDiv({ cls: "p-merge-anchor", attr: { "data-merge-id": mergeId } });
		lastMark.after(anchor);
		this.openMergeAnchor = anchor;
		this.buildMergeAnchor(anchor, link, target);
	}

	/** Scroll to a merge link's passage and expand its anchor. */
	revealMergeLink(mergeId: string): void {
		const messagesEl = this.d.getMessagesEl();
		const mark = messagesEl.querySelector<HTMLElement>(
			`.p-merge-link[data-merge-id="${mergeId}"]`
		);
		if (!mark) return;
		const row = mark.closest("[data-msg-id]") as HTMLElement | null;
		if (row) this.d.expandBubbleIfCollapsed(row);
		this.toggleMergeAnchor(mergeId, mark);
		scrollChatTo(messagesEl, mark);
	}

	/** Remove a merge link, unpaint its marks, and close its anchor. */
	async removeMergeLink(mergeId: string): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv?.merges) return;
		const link = conv.merges.find((m) => m.id === mergeId);
		if (!link) return;
		conv.merges = conv.merges.filter((m) => m.id !== mergeId);
		if (conv.merges.length === 0) delete conv.merges;
		await this.d.plugin.conversationStore.save(conv);
		if (this.openMergeAnchor?.getAttribute("data-merge-id") === mergeId) this.closeAnchor();
		this.repaintMessage(link.messageId);
	}

	/**
	 * Fill the anchor with the merged conversation's summary plus its meta line.
	 *
	 * Only the conversation summary is shown — unlike the fork anchor, which
	 * prefers a favorites summary. A merge target is an existing, independently
	 * named conversation; its own recap is what the reader asked to see here.
	 */
	private buildMergeAnchor(anchor: HTMLElement, link: MergeLink, target: Conversation): void {
		anchor.empty();

		const summary = target.summaryText?.trim();

		// Header: merge icon + micro-label.
		const head = anchor.createDiv({ cls: "p-merge-anchor-head" });
		// The link icon, not `git-merge`: the meta line's control is `unlink`, and the
		// header is the same relationship stated positively (ADR-142). It is also the
		// one thing that distinguishes this card from a fork's, so it has to name
		// what the user calls it — a Verknüpfung, not a developer's merge.
		setIcon(head.createSpan({ cls: "p-merge-anchor-icon" }), "link");
		head.createSpan({ cls: "p-merge-anchor-label", text: t("mergeAnchorLabel") });

		anchor.createDiv({ cls: "p-merge-anchor-title", text: target.name });

		// In full, like the fork anchor (ADR-142/189).
		if (summary) {
			const body = anchor.createDiv({ cls: "p-merge-anchor-body" });
			this.d.renderMarkdown(summary, body);
		} else {
			anchor.createDiv({ cls: "p-merge-anchor-empty", text: t("mergeNoSummary") });
		}

		// Meta line: "N messages · MODEL · <date> [· outdated]" then regenerate,
		// unlink and open controls. Model and date appear only once a summary exists.
		const meta = anchor.createDiv({ cls: "p-merge-anchor-meta" });
		const summaryTs = summary ? target.summaryUpdatedAt : undefined;
		// Stale when the target has newer activity than the summary being shown, so
		// the passage flags that a fresher recap can be generated. ISO 8601 strings
		// sort chronologically, so a plain compare is enough (same rule as ADR-128).
		const lastActivityTs = target.messages.length
			? target.messages[target.messages.length - 1].timestamp
			: target.updatedAt;
		const stale = !!(summaryTs && lastActivityTs && lastActivityTs > summaryTs);
		const metaParts = [t("msgCount", { n: String(target.messages.length) })];
		if (summaryTs) {
			metaParts.push(abbreviateModel(target.model));
			metaParts.push(formatSummaryTimestamp(summaryTs));
			if (stale) metaParts.push(t("forkSummaryStale"));
		}
		meta.createSpan({ cls: "p-merge-anchor-metatext", text: `${metaParts.join(" · ")} · ` });

		const refresh = meta.createEl("button", {
			cls: `pb pb-icon is-inline p-merge-anchor-refresh${stale ? " is-stale" : ""}`,
			attr: { "aria-label": t("mergeRefreshSummary"), title: t("mergeRefreshSummary") },
		});
		setIcon(refresh, REGENERATE_ICON);
		refresh.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.generateMergeSummary(anchor, link, target);
		});
		meta.createSpan({ cls: "p-merge-anchor-metatext", text: " · " });

		const unlink = meta.createEl("button", {
			cls: "pb pb-icon is-inline p-merge-anchor-unlink",
			attr: { "aria-label": t("mergeRemove"), title: t("mergeRemove") },
		});
		setIcon(unlink, "unlink");
		unlink.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.removeMergeLink(link.id);
		});
		meta.createSpan({ cls: "p-merge-anchor-metatext", text: " · " });

		const open = meta.createEl("button", { cls: "pb pb-link p-merge-anchor-open", text: t("forkOpenShort") });
		open.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.d.setActiveConversation(target);
		});
	}

	/**
	 * Generate (or regenerate) the merged conversation's summary, then re-render
	 * the anchor. Uses `generateSummary`, not `generateSummaryWithTitle`: a merge
	 * target is a conversation the user already named, so summarizing it from
	 * someone else's passage must never rename it (the fork anchor deliberately
	 * does rename, because a fork starts out as a generic "Fork of X").
	 */
	async generateMergeSummary(
		anchor: HTMLElement,
		link: MergeLink,
		target: Conversation,
	): Promise<void> {
		if (target.messages.length === 0) { new Notice(t("noMessagesToSummarize")); return; }
		const notice = new Notice(t("generatingSummary"), 0);
		try {
			const summary = await this.d.plugin.llmRouter.generateSummary(target);
			if (!summary) { new Notice(t("summaryEmpty")); return; } // ADR-158: "" is not a result
			target.summaryText = summary;
			target.summaryUpdatedAt = new Date().toISOString();
			await this.d.plugin.conversationStore.save(target);
			if (this.openMergeAnchor === anchor) this.buildMergeAnchor(anchor, link, target);
		} catch (err) {
			new Notice(t("summaryFailed", { error: err instanceof Error ? err.message : String(err) }));
		} finally {
			notice.hide();
		}
	}
}
