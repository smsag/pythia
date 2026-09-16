import { Notice, Platform, setIcon } from "obsidian";
import type { Conversation } from "../models/types";
import { abbreviateModel } from "../models/knownModels";
import { maxTokensAdvice } from "../services/settingsAdvice";
import { t } from "../i18n";

export interface SendHintDeps {
	getConversation(): Conversation | null;
	getGlobalMaxTokens(): number | undefined;
	registerDomEvent(el: HTMLElement, type: "click", cb: () => void): void;
	/** Open the conversation settings — the advice line under the token field
	 *  there explains the same fact and offers the fix (ADR-162). */
	openSettings(): void;
}

/**
 * The warning triangle beside Send (moved out of `PythiaSidebarView` under the
 * ADR-097 ratchet). It shows exactly when `maxTokensAdvice` has something to
 * say — the same rule the settings modal and the recovery card read — so the
 * three never disagree about when a token limit is too low.
 *
 * The explanation used to live only in the `title` tooltip, which a phone
 * never shows: the user saw an orange icon and nothing else. On mobile the
 * text is announced once per conversation-and-model in a Notice, and the tap
 * opens the settings modal, where the advice line repeats it with a button.
 */
export class SendHintController {
	private el!: HTMLButtonElement;
	/** `${conversationId}:${model}` pairs already announced on touch. */
	private readonly announced = new Set<string>();

	constructor(private readonly d: SendHintDeps) {}

	mount(toolbar: HTMLElement): void {
		this.el = toolbar.createEl("button", { cls: "p-send-hint" });
		setIcon(this.el, "alert-triangle");
		this.el.style.display = "none";
		this.d.registerDomEvent(this.el, "click", () => this.d.openSettings());
	}

	update(): void {
		if (!this.el) return;
		const conv = this.d.getConversation();
		const advice = conv ? maxTokensAdvice(conv.model, conv.maxTokens, this.d.getGlobalMaxTokens()) : null;
		if (!conv || !advice) {
			this.el.style.display = "none";
			return;
		}
		const text = t("sendMaxTokensHint", {
			max: String(advice.effective),
			model: abbreviateModel(conv.model),
			recommended: String(advice.recommended),
		});
		this.el.setAttribute("title", text);
		this.el.setAttribute("aria-label", text);
		this.el.style.display = "";
		const key = `${conv.id}:${conv.model}`;
		if (Platform.isMobile && !this.announced.has(key)) {
			this.announced.add(key);
			new Notice(text, 8000);
		}
	}
}
