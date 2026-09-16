import { Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation, Message, StreamFinish } from "../models/types";
import { t } from "../i18n";
import { effectiveMaxTokens, isThinkingModel, raisedMaxTokens } from "../services/settingsAdvice";
import { spliceExchange } from "../services/conversationEdits";
import { ModelSuggestModal } from "../suggest/ModelSuggest";

export interface TruncationDeps {
	plugin: PythiaPlugin;
	getConversation(): Conversation | null;
	isStreaming(): boolean;
	/** Send `text` as a new user turn through the normal send path. */
	sendText(text: string): Promise<void>;
	/** Full rebuild of the message list (after the retry splice). */
	rerender(): Promise<void> | void;
	/** Open a model comparison on the exchange (ADR-160) — the Learn action. */
	startComparison(userMessageId: string, assistantMessageId: string): void;
}

/**
 * The recovery card under an answer that stopped at the token cap (ADR-162).
 * A reply cut at `max_tokens` reads exactly like a finished one; the provider
 * knows the difference and, until this card, Pythia dropped that fact on the
 * floor. The card names the cause and offers the three things a user can do
 * about it without understanding tokens: continue where it stopped, retry
 * with a bigger budget, or compare with another model.
 *
 * Only the *last* answer gets the actions — Continue and Retry on an answer
 * in the middle of a conversation would rewrite history. Earlier truncated
 * answers keep a one-line note so the record stays honest.
 */
export class TruncationController {
	constructor(private readonly d: TruncationDeps) {}

	/** Paint (or repaint) the card under `row` for `msg`; a no-op for a
	 *  finished answer. */
	paint(row: HTMLElement, msg: Message): void {
		row.querySelector(".p-trunc")?.remove();
		if (!msg.truncated) return;
		const conv = this.d.getConversation();
		if (!conv) return;

		const card = row.createDiv({ cls: "p-trunc" });
		const head = card.createDiv({ cls: "p-trunc-head" });
		const icon = head.createSpan({ cls: "p-trunc-icon" });
		setIcon(icon, "alert-triangle");
		head.createSpan({ cls: "p-trunc-label", text: t("truncLabel") });

		const max = effectiveMaxTokens(conv.model, conv.maxTokens, this.d.plugin.settings.maxTokens);
		const meta = card.createDiv({ cls: "p-trunc-meta" });
		meta.setText(t("truncMeta", { max: String(max) }));
		if (isThinkingModel(conv.model)) meta.appendText(` ${t("truncReasoningNote")}`);

		const isLast = conv.messages.at(-1)?.id === msg.id;
		if (!isLast || conv.comparison) return;

		const actions = card.createDiv({ cls: "p-trunc-actions" });
		const on = (btn: HTMLElement, fn: () => void): void => {
			btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
		};
		const cont = actions.createEl("button", { cls: "p-trunc-btn", text: t("truncContinueBtn") });
		on(cont, () => void this.continueAnswer());

		// Retry re-sends the prompt with a bigger budget, which means removing
		// this answer. A star or a merge link on it would go with it, so the
		// action is withheld rather than made destructive; Continue still works.
		const referenced =
			(conv.favorites ?? []).some((f) => f.messageId === msg.id) ||
			(conv.merges ?? []).some((l) => l.messageId === msg.id);
		if (!referenced) {
			const raised = raisedMaxTokens(conv.model, max);
			const retry = actions.createEl("button", { cls: "p-trunc-btn", text: t("truncRetryBtn", { n: String(raised) }) });
			on(retry, () => void this.retryWithRaisedLimit(msg, raised));
		}

		const cmp = actions.createEl("button", { cls: "p-trunc-btn p-trunc-btn--quiet", text: t("compareBtn") });
		on(cmp, () => this.compare(msg));
	}

	/** A reply that streamed nothing: say why, if the provider said why. Silence
	 *  here is the empty-reasoning-reply bug — the budget went on thinking and
	 *  the user saw the bubble vanish. */
	noticeEmptyReply(finish: StreamFinish | undefined): void {
		const conv = this.d.getConversation();
		if (finish?.truncated && conv) {
			const max = effectiveMaxTokens(conv.model, conv.maxTokens, this.d.plugin.settings.maxTokens);
			new Notice(t("emptyReplyTruncated", { max: String(max) }), 10000);
			return;
		}
		new Notice(t("emptyReply"), 6000);
	}

	private async continueAnswer(): Promise<void> {
		if (this.d.isStreaming()) return;
		await this.d.sendText(t("truncContinuePrompt"));
	}

	private async retryWithRaisedLimit(msg: Message, raised: number): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv || this.d.isStreaming()) return;
		const idx = conv.messages.findIndex((m) => m.id === msg.id);
		const user = idx > 0 ? conv.messages[idx - 1] : undefined;
		if (!user || user.role !== "user") return;
		conv.maxTokens = raised;
		if (!spliceExchange(conv, user.id, msg.id)) return;
		await this.d.plugin.conversationStore.save(conv);
		await this.d.rerender();
		new Notice(t("truncRetryNotice", { n: String(raised) }));
		await this.d.sendText(user.content);
	}

	private compare(msg: Message): void {
		const conv = this.d.getConversation();
		if (!conv) return;
		const idx = conv.messages.findIndex((m) => m.id === msg.id);
		const user = idx > 0 ? conv.messages[idx - 1] : undefined;
		if (!user || user.role !== "user") return;
		const others = ModelSuggestModal.candidates((p) => this.d.plugin.hasApiKeyFor(p), [conv.model]);
		if (others.length === 0) { new Notice(t("compareNoOtherModel")); return; }
		this.d.startComparison(user.id, msg.id);
	}
}
