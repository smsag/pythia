import { Notice } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";

export interface OptimizationDeps {
	plugin: PythiaPlugin;
	inputEl: HTMLTextAreaElement;
	sendBtn: HTMLButtonElement;
	getConversation(): Conversation | null;
	isStreaming(): boolean;
	autoResizeTextarea(): void;
	/** Restores the Send button's normal label after the busy state clears. */
	updateSendBtnLabel(): void;
}

/**
 * In-place prompt optimizer (ADR-093).
 *
 * Flow: read the prompt input → ask the LLM to rewrite it with the framework
 * configured in settings → replace the textarea content in place. No preview
 * bubbles or confirm/discard/retry UI — the user either keeps it (click Send) or
 * reverts (⌘Z on desktop, shake-to-undo on iOS; see replaceInput). Re-running the
 * optimizer just optimizes whatever the input currently holds, so "another
 * version" is simply running it again.
 */
export class OptimizationController {
	private active = false;
	/** Bumped by cancel() so a stale in-flight optimizeText() (from a view teardown
	 *  or conversation switch) knows not to touch the input when it resolves. */
	private generation = 0;

	constructor(private readonly d: OptimizationDeps) {}

	get isActive(): boolean {
		return this.active;
	}

	async start(): Promise<void> {
		if (this.active || this.d.isStreaming()) return;
		const conv = this.d.getConversation();
		if (!conv) return;
		const text = this.d.inputEl.value.trim();
		if (!text) return;
		if (!this.d.plugin.settings.promptOptimizerTemplateId) {
			new Notice(t("optimizeNoTemplate"));
			return;
		}

		const framework = this.d.plugin.settings.defaultPromptFramework;
		const myGen = ++this.generation;
		this.setBusy(true);
		try {
			const result = await this.d.plugin.promptOptimizerService.optimizeText(
				text, framework, conv.provider, conv.model,
			);
			if (myGen !== this.generation) return; // superseded (view torn down / conversation switched)
			// Clear the busy state BEFORE replacing: execCommand needs the textarea
			// enabled and focusable.
			this.setBusy(false);
			const optimized = result?.trim();
			if (optimized) this.replaceInput(optimized);
		} catch (err) {
			if (myGen !== this.generation) return;
			this.setBusy(false);
			new Notice(t("optimizeFailed", { error: String(err) }));
		}
	}

	/** Discard any in-flight optimization (view teardown / conversation switch). The
	 *  input is left as-is — a resolving stale call will no-op via the generation guard. */
	cancel(): void {
		this.generation++;
		if (this.active) this.setBusy(false);
	}

	private setBusy(busy: boolean): void {
		this.active = busy;
		this.d.inputEl.disabled = busy;
		this.d.sendBtn.disabled = busy;
		if (busy) {
			// Inline progress cue: the Send button doubles as the optimizing indicator
			// (mirrors how it shows "Stopp" while streaming).
			this.d.sendBtn.setText(t("optimizingIndicator"));
		} else {
			this.d.updateSendBtnLabel();
		}
	}

	/**
	 * Replace the whole textarea with `text` via `execCommand("insertText")` (after
	 * selecting all) rather than assigning `inputEl.value`. Only the former enters
	 * the textarea's native undo stack, so ⌘Z (desktop) and iOS shake-to-undo revert
	 * to the original. Falls back to a direct assignment (no native undo — e.g.
	 * Android, or if execCommand is unavailable). Leaves focus in the textarea so the
	 * undo is immediately available and the user can send right away.
	 */
	private replaceInput(text: string): void {
		const el = this.d.inputEl;
		el.focus();
		el.setSelectionRange(0, el.value.length);
		let inserted = false;
		try {
			inserted = document.execCommand("insertText", false, text);
		} catch {
			inserted = false;
		}
		if (!inserted) el.value = text; // fallback: works everywhere, but no native undo
		this.d.autoResizeTextarea();
	}
}
