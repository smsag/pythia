import { App, Component, MarkdownRenderer, Notice } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";

export interface OptimizationDeps {
	app: App;
	/** The parent Component — passed to MarkdownRenderer for proper lifecycle tracking. */
	component: Component;
	plugin: PythiaPlugin;
	messagesEl: HTMLElement;
	inputEl: HTMLTextAreaElement;
	sendBtn: HTMLButtonElement;
	optimizeBtnEl: HTMLButtonElement;
	getConversation(): Conversation | null;
	isStreaming(): boolean;
	scrollToBottom(): void;
	autoResizeTextarea(): void;
	sendMessage(): Promise<void>;
	/** Bound to the parent Component so Obsidian tracks listener cleanup. */
	registerDomEvent<K extends keyof HTMLElementEventMap>(
		el: HTMLElement,
		event: K,
		cb: (e: HTMLElementEventMap[K]) => unknown
	): void;
}

type OptState = {
	originalText: string;
	previewEl: HTMLElement;
	indicatorEl: HTMLElement | null;
	resultEl: HTMLElement | null;
	actionRowEl: HTMLElement | null;
};

export class OptimizationController {
	private state: OptState | null = null;
	/** Incremented on every start()/retry()/cancel() so a stale in-flight
	 *  optimizeText() call (from a cancelled or superseded session) can tell
	 *  it's no longer current and must not overwrite a newer session's DOM. */
	private generation = 0;

	constructor(private readonly d: OptimizationDeps) {}

	get isActive(): boolean {
		return this.state !== null;
	}

	setOptimizingState(active: boolean): void {
		this.d.optimizeBtnEl.disabled = active;
		this.d.sendBtn.disabled = active;
		this.d.inputEl.disabled = active;
		if (active) this.d.optimizeBtnEl.addClass("active");
		else this.d.optimizeBtnEl.removeClass("active");
	}

	async start(): Promise<void> {
		if (this.state || this.d.isStreaming()) return;
		const conv = this.d.getConversation();
		if (!conv) return;
		const text = this.d.inputEl.value.trim();
		if (!text) return;

		if (!this.d.plugin.settings.promptOptimizerTemplateId) {
			new Notice(t("optimizeNoTemplate"));
			return;
		}

		const previewEl = this.d.messagesEl.createDiv({ cls: "p-msg-user p-msg-optimize-preview" });
		const bubble = previewEl.createDiv({ cls: "p-bubble" });
		await MarkdownRenderer.render(this.d.app, text, bubble, "", this.d.component);

		const framework = this.d.plugin.settings.defaultPromptFramework;
		const indicatorEl = this.d.messagesEl.createDiv({ cls: "p-optimize-indicator" });
		indicatorEl.setText(
			framework !== "none"
				? t("optimizingIndicatorFramework", { framework })
				: t("optimizingIndicator")
		);

		this.state = { originalText: text, previewEl, indicatorEl, resultEl: null, actionRowEl: null };
		this.setOptimizingState(true);
		this.d.scrollToBottom();

		const myGen = ++this.generation;
		try {
			const result = await this.d.plugin.promptOptimizerService.optimizeText(
				text, framework, conv.provider, conv.model
			);
			if (myGen !== this.generation) return; // superseded by a newer session
			await this.showResult(result, myGen);
		} catch (err) {
			if (myGen !== this.generation) return;
			new Notice(t("optimizeFailed", { error: String(err) }));
			this.cancel();
		}
	}

	async showResult(optimizedText: string, myGen: number): Promise<void> {
		if (!this.state || myGen !== this.generation) return;

		this.state.indicatorEl?.remove();
		this.state.indicatorEl = null;
		this.d.optimizeBtnEl.removeClass("active");

		const resultEl = this.d.messagesEl.createDiv({ cls: "p-msg-optimize-result" });
		await MarkdownRenderer.render(this.d.app, optimizedText, resultEl, "", this.d.component);
		this.state.resultEl = resultEl;

		const actionRowEl = this.d.messagesEl.createDiv({ cls: "p-optimize-actions" });
		const confirmBtn = actionRowEl.createEl("button", { cls: "p-opt-confirm", text: t("useThisBtn") });
		const discardBtn = actionRowEl.createEl("button", { cls: "p-opt-discard", text: t("discardBtn") });
		const retryBtn   = actionRowEl.createEl("button", { cls: "p-opt-retry",   text: t("anotherVersionBtn") });
		this.state.actionRowEl = actionRowEl;

		this.d.registerDomEvent(confirmBtn, "click", () => this.confirm(optimizedText));
		this.d.registerDomEvent(discardBtn, "click", () => this.cancel());
		this.d.registerDomEvent(retryBtn,   "click", () => void this.retry());

		this.d.scrollToBottom();
	}

	confirm(optimizedText: string): void {
		if (!this.state) return;
		this.state.previewEl.remove();
		this.state.resultEl?.remove();
		this.state.actionRowEl?.remove();
		this.state = null;
		this.setOptimizingState(false);
		this.d.inputEl.value = optimizedText;
		this.d.autoResizeTextarea();
		void this.d.sendMessage();
	}

	cancel(): void {
		this.generation++;
		if (!this.state) return;
		const original = this.state.originalText;
		this.state.previewEl.remove();
		this.state.indicatorEl?.remove();
		this.state.resultEl?.remove();
		this.state.actionRowEl?.remove();
		this.state = null;
		this.setOptimizingState(false);
		this.d.inputEl.value = original;
		this.d.autoResizeTextarea();
	}

	async retry(): Promise<void> {
		if (!this.state) return;
		this.state.resultEl?.remove();
		this.state.resultEl = null;
		this.state.actionRowEl?.remove();
		this.state.actionRowEl = null;

		const framework = this.d.plugin.settings.defaultPromptFramework;
		const indicatorEl = this.d.messagesEl.createDiv({ cls: "p-optimize-indicator" });
		indicatorEl.setText(
			framework !== "none"
				? t("optimizingIndicatorFramework", { framework })
				: t("optimizingIndicator")
		);
		this.state.indicatorEl = indicatorEl;
		this.setOptimizingState(true);
		this.d.scrollToBottom();

		const conv = this.d.getConversation();
		if (!conv) { this.cancel(); return; }
		const myGen = ++this.generation;
		try {
			const result = await this.d.plugin.promptOptimizerService.optimizeText(
				this.state.originalText, framework, conv.provider, conv.model
			);
			if (myGen !== this.generation) return; // superseded by a newer session
			await this.showResult(result, myGen);
		} catch (err) {
			if (myGen !== this.generation) return;
			new Notice(t("optimizeFailed", { error: String(err) }));
			this.cancel();
		}
	}
}
