import { Notice } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { attachLongPress } from "./longPress";
import { ModelSuggestModal } from "../suggest/ModelSuggest";

export interface ExchangeActionsDeps {
	plugin: PythiaPlugin;
	getConversation(): Conversation | null;
	getMessagesEl(): HTMLElement;
	isStreaming(): boolean;
	/** The exchange's rows were removed and `conv.messages` spliced; the view
	 *  fixes its incremental-render bookkeeping and re-attaches the gesture. */
	onExchangeDeleted(): void;
	/** Open a model comparison on the last exchange (ADR-160). */
	startComparison(userMessageId: string, assistantMessageId: string): void;
}

/**
 * The long-press on the last user bubble and the action bar it opens
 * (extracted from `PythiaSidebarView` under the ADR-097 ratchet when the bar
 * gained its third action). Two things can happen to the last exchange from
 * here: delete it (the original gesture), or re-run its prompt on another
 * model — a comparison (ADR-160).
 *
 * The gesture is the shared `attachLongPress` with `preventTouchDefault`, so a
 * long touch on the bubble opens the bar instead of iOS's magnifier. The bubble
 * is rebuilt with the message list, so the direct-listener cleanup is kept and
 * `attach()` is idempotent: it always detaches first.
 */
export class ExchangeActionsController {
	private longPressCleanup: (() => void) | null = null;
	private preview: {
		userRow: HTMLElement;
		assistantRow: HTMLElement;
		bar: HTMLElement;
		outsideHandler: EventListener;
	} | null = null;

	constructor(private readonly d: ExchangeActionsDeps) {}

	/** Arm the gesture on the last user bubble (no-op while streaming or when
	 *  the last exchange is incomplete). */
	attach(): void {
		this.detach();
		if (!this.d.getConversation() || this.d.isStreaming()) return;

		const rows = Array.from(this.d.getMessagesEl().querySelectorAll<HTMLElement>(".p-msg-user"));
		const lastUserRow = rows[rows.length - 1];
		if (!lastUserRow) return;
		const assistantRow = lastUserRow.nextElementSibling as HTMLElement | null;
		if (!assistantRow?.classList.contains("p-msg-ai")) return;
		const bubble = lastUserRow.querySelector<HTMLElement>(".p-bubble");
		if (!bubble) return;

		this.longPressCleanup = attachLongPress(
			bubble,
			() => { if (!this.preview) this.showPreview(lastUserRow, assistantRow); },
			{ preventTouchDefault: true },
		);
	}

	/** Disarm the gesture (before a rebuild, or when streaming starts). */
	detach(): void {
		this.longPressCleanup?.();
		this.longPressCleanup = null;
	}

	private showPreview(userRow: HTMLElement, assistantRow: HTMLElement): void {
		this.hidePreview();
		userRow.addClass("p-del-preview");
		assistantRow.addClass("p-del-preview");

		const bar = createDiv({ cls: "p-del-bar" });
		const confirmBtn = bar.createEl("button", { cls: "p-del-confirm", text: t("deleteExchangeBtn") });
		const compareBtn = bar.createEl("button", { cls: "p-del-compare", text: t("compareBtn") });
		const cancelBtn  = bar.createEl("button", { cls: "p-del-cancel",  text: t("cancelBtn") });

		const on = (btn: HTMLElement, fn: () => void) => {
			const handler = (e: Event) => { e.preventDefault(); e.stopPropagation(); fn(); };
			btn.addEventListener("mousedown",  handler);
			btn.addEventListener("touchstart", handler, { passive: false });
		};
		on(confirmBtn, () => void this.confirmDelete(userRow, assistantRow));
		on(compareBtn, () => this.compare(userRow, assistantRow));
		on(cancelBtn, () => this.hidePreview());

		assistantRow.insertAdjacentElement("beforebegin", bar);

		const outsideHandler: EventListener = (e) => {
			const target = (e as MouseEvent | TouchEvent).target as Node | null;
			if (target && !bar.contains(target) && !userRow.contains(target) && !assistantRow.contains(target)) {
				this.hidePreview();
			}
		};
		document.addEventListener("mousedown",  outsideHandler, { capture: true });
		document.addEventListener("touchstart", outsideHandler, { capture: true });
		this.preview = { userRow, assistantRow, bar, outsideHandler };
	}

	hidePreview(): void {
		if (!this.preview) return;
		const { userRow, assistantRow, bar, outsideHandler } = this.preview;
		userRow.removeClass("p-del-preview");
		assistantRow.removeClass("p-del-preview");
		bar.remove();
		document.removeEventListener("mousedown",  outsideHandler, { capture: true });
		document.removeEventListener("touchstart", outsideHandler, { capture: true });
		this.preview = null;
	}

	/** Third action (ADR-160): hand the exchange to the comparison flow. Declines
	 *  with a notice when no other keyed model exists, rather than opening an
	 *  empty picker. */
	private compare(userRow: HTMLElement, assistantRow: HTMLElement): void {
		const conv = this.d.getConversation();
		const userId = userRow.getAttribute("data-msg-id");
		const assistantId = assistantRow.getAttribute("data-msg-id");
		this.hidePreview();
		if (!conv || !userId || !assistantId) return;
		const others = ModelSuggestModal.candidates((p) => this.d.plugin.hasApiKeyFor(p), [conv.model]);
		if (others.length === 0) { new Notice(t("compareNoOtherModel")); return; }
		this.d.startComparison(userId, assistantId);
	}

	private async confirmDelete(userRow: HTMLElement, assistantRow: HTMLElement): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv) return;
		const userId      = userRow.getAttribute("data-msg-id");
		const assistantId = assistantRow.getAttribute("data-msg-id");
		if (!userId) return;
		const userIdx = conv.messages.findIndex((m) => m.id === userId);
		if (userIdx === -1) return;

		const removeCount = assistantId ? 2 : 1;
		conv.messages.splice(userIdx, removeCount);
		// Keep the save-boundary accurate
		if (conv.lastSavedMessageCount !== undefined && conv.lastSavedMessageCount > userIdx) {
			conv.lastSavedMessageCount = Math.max(0, conv.lastSavedMessageCount - removeCount);
		}
		// Remove the starred entry for the deleted assistant message
		if (assistantId && conv.favorites?.length) {
			conv.favorites = conv.favorites.filter((f) => f.messageId !== assistantId);
		}

		this.hidePreview();
		userRow.remove();
		assistantRow.remove();
		await this.d.plugin.conversationStore.save(conv);
		new Notice(t("exchangeDeleted"));
		this.d.onExchangeDeleted();
	}
}
