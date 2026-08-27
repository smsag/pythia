import { Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { formatSummaryTimestamp } from "../services/messageUtils";

export interface SummaryDeps {
	plugin: PythiaPlugin;
	getConversation(): Conversation | null;
	/** The summary-cards container (`p-summary-cards`), created by the view in
	 *  buildChatArea so it keeps its DOM position between the fork banner and the
	 *  messages. Null before the chat area is built. */
	getCardsEl(): HTMLElement | null;
	/** The scroll viewport — the auto-collapse observer's root and the reveal scroll. */
	getMessagesEl(): HTMLElement;
	/** Render markdown into `el` using the view as the owning Component. */
	renderMarkdown(md: string, el: HTMLElement): void;
	/** Re-render the header after a summary generation renames the conversation. */
	renderHeader(): void;
}

/**
 * The conversation/favorites summary surfaces extracted from `PythiaSidebarView`
 * (ADR-103, engineering-review #120): the top-of-conversation "Speisekarte"
 * summary cards (render/build/open/reveal/save) and the LLM summary-generation
 * flows. The Send long-press menu and the context-inspector button still live in
 * the view; they call `generateConversationSummary`/`summarizeFavorites` here.
 * Behaviour is identical to the inline methods it replaced.
 */
export class SummaryController {
	private summaryCardObserver: IntersectionObserver | null = null;

	constructor(private readonly d: SummaryDeps) {}

	/** Disconnect the auto-collapse observer (view teardown). */
	dispose(): void {
		this.summaryCardObserver?.disconnect();
		this.summaryCardObserver = null;
	}

	renderSummaryCards(): void {
		const cardsEl = this.d.getCardsEl();
		if (!cardsEl) return;
		cardsEl.empty();
		this.summaryCardObserver?.disconnect();
		this.summaryCardObserver = null;

		const conv = this.d.getConversation();
		const cards: HTMLElement[] = [];
		if (conv?.summaryText?.trim()) {
			cards.push(this.buildSummaryCard("conversation", conv.summaryText.trim(), conv.summaryUpdatedAt));
		}
		if (conv?.favoritesSummary?.text?.trim()) {
			cards.push(this.buildSummaryCard("favorites", conv.favoritesSummary.text.trim(), conv.favoritesSummary.updatedAt));
		}
		cardsEl.style.display = cards.length ? "" : "none";

		// Auto-collapse an expanded card once it scrolls out of the message viewport.
		if (cards.length) {
			this.summaryCardObserver = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						const card = entry.target as HTMLElement;
						if (!entry.isIntersecting && card.hasClass("open")) {
							this.setSummaryCardOpen(card, false);
						}
					}
				},
				{ root: this.d.getMessagesEl(), threshold: 0 }
			);
			for (const card of cards) this.summaryCardObserver.observe(card);
		}
	}

	private buildSummaryCard(
		kind: "conversation" | "favorites",
		text: string,
		updatedAt?: string
	): HTMLElement {
		const card = this.d.getCardsEl()!.createDiv({
			cls: "p-summary-card",
			attr: { "data-kind": kind },
		});
		const header = card.createDiv({ cls: "p-summary-card-header" });
		const icon = header.createSpan({ cls: "p-summary-card-icon" });
		setIcon(icon, kind === "favorites" ? "star" : "align-left");
		header.createSpan({
			cls: "p-summary-card-title",
			text: kind === "favorites" ? t("favoritesSummaryTitle") : t("conversationSummaryTitle"),
		});
		// Timestamp lives in the header now (right-aligned, faint).
		if (updatedAt) {
			header.createSpan({ cls: "p-summary-ts", text: formatSummaryTimestamp(updatedAt) });
		}
		// Regenerate icon — re-runs the summary matching this card's kind.
		const regen = header.createEl("button", {
			cls: "p-summary-card-regen",
			attr: { title: kind === "favorites" ? t("menuSummarizeFavorites") : t("menuSummarizeConversation") },
		});
		setIcon(regen, "refresh-cw");
		regen.addEventListener("click", (e) => {
			e.stopPropagation();
			if (kind === "favorites") void this.summarizeFavorites();
			else void this.generateConversationSummary();
		});
		const chevron = header.createSpan({ cls: "p-summary-card-chevron", text: "▸" });
		header.addEventListener("click", () =>
			this.setSummaryCardOpen(card, !card.hasClass("open"))
		);

		const body = card.createDiv({ cls: "p-summary-card-body" });
		const md = body.createDiv({ cls: "p-summary-card-md" });
		this.d.renderMarkdown(text, md);

		const footer = body.createDiv({ cls: "p-summary-card-footer" });
		const copyBtn = footer.createEl("button", { cls: "p-summary-card-action", text: t("copyBtn") });
		copyBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			navigator.clipboard.writeText(text).then(
				() => new Notice(t("copied")),
				() => new Notice(t("copyFailed")),
			);
		});
		const saveBtn = footer.createEl("button", { cls: "p-summary-card-action", text: t("saveToNoteBtn") });
		saveBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.onSaveSummaryToNote(kind, text);
		});

		void chevron; // chevron text is updated via setSummaryCardOpen
		return card;
	}

	private setSummaryCardOpen(card: HTMLElement, open: boolean): void {
		card.toggleClass("open", open);
		const chevron = card.querySelector<HTMLElement>(".p-summary-card-chevron");
		if (chevron) chevron.setText(open ? "▾" : "▸");
	}

	private async onSaveSummaryToNote(kind: "conversation" | "favorites", text: string): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv) return;
		try {
			const path = kind === "favorites"
				? await this.d.plugin.noteWriter.saveFavoritesSummaryNote(conv, text)
				: await this.d.plugin.noteWriter.saveSummaryNote(conv, text);
			new Notice(t("savedToPath", { path }));
		} catch (e) {
			new Notice(t("saveFailed", { error: e instanceof Error ? e.message : String(e) }));
		}
	}

	/** Expand a summary card and scroll it to the top of the viewport. */
	private revealSummaryCard(kind: "conversation" | "favorites"): void {
		const card = this.d.getCardsEl()?.querySelector<HTMLElement>(
			`.p-summary-card[data-kind="${kind}"]`
		);
		if (!card) return;
		this.setSummaryCardOpen(card, true);
		// Instant scroll so the card is in view before the observer evaluates it
		// (a smooth scroll would let the observer collapse it mid-flight).
		const messagesEl = this.d.getMessagesEl();
		const top = card.offsetTop - messagesEl.offsetTop;
		messagesEl.scrollTo({ top: Math.max(0, top - 8) });
	}

	/** Nav: jump to and expand the favorites summary card. */
	goToFavoritesSummary(): void {
		if (!this.d.getConversation()?.favoritesSummary?.text?.trim()) return;
		requestAnimationFrame(() => this.revealSummaryCard("favorites"));
	}

	async generateConversationSummary(): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv || conv.messages.length === 0) {
			new Notice(t("noMessagesToSummarize"));
			return;
		}
		const notice = new Notice(t("generatingSummary"), 0);
		try {
			const { title, summary } = await this.d.plugin.llmRouter.generateSummaryWithTitle(conv);
			if (summary) {
				conv.summaryText = summary;
				conv.summaryUpdatedAt = new Date().toISOString();
				if (title) {
					conv.name = title;
					void this.d.plugin.renameConversationFile(conv);
				}
				await this.d.plugin.conversationStore.save(conv);
				// Only touch UI if the user hasn't switched conversations meanwhile.
				if (this.d.getConversation()?.id === conv.id) {
					if (title) this.d.renderHeader();
					this.renderSummaryCards();
					this.revealSummaryCard("conversation");
				}
			}
		} catch (e) {
			new Notice(t("summaryFailed", { error: e instanceof Error ? e.message : String(e) }));
		} finally {
			notice.hide();
		}
	}

	/** Generate (or regenerate) the favorites synthesis, then reveal its card. */
	async summarizeFavorites(): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv || (conv.favorites?.length ?? 0) === 0) {
			new Notice(t("noFavoritesToSummarize"));
			return;
		}
		const text = await this.runFavoritesSummary(conv);
		if (text && this.d.getConversation()?.id === conv.id) {
			this.renderSummaryCards();
			this.revealSummaryCard("favorites");
		}
	}

	/** Run the LLM favorites-summary call, persist the result, and return it.
	 *  Public because the fork flow reuses it to summarize a source conversation. */
	async runFavoritesSummary(conv: Conversation): Promise<string> {
		const notice = new Notice(t("generatingFavoritesSummary"), 0);
		try {
			const text = await this.d.plugin.llmRouter.generateFavoritesSummary(conv);
			if (text) {
				conv.favoritesSummary = { text, updatedAt: new Date().toISOString() };
				await this.d.plugin.conversationStore.save(conv);
			}
			return text;
		} catch (e) {
			new Notice(t("favoritesSummaryFailed", { error: e instanceof Error ? e.message : String(e) }));
			return "";
		} finally {
			notice.hide();
		}
	}
}
