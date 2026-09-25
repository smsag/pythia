import { Notice } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import type { Difficulty } from "../services/modelRecommendation";
import { t } from "../i18n";
import type { ComposerField } from "./ComposerField";

export interface OptimizationDeps {
	plugin: PythiaPlugin;
	inputEl: ComposerField;
	sendBtn: HTMLButtonElement;
	getConversation(): Conversation | null;
	isStreaming(): boolean;
	/** Restores the Send button's normal label after the busy state clears. */
	updateSendBtnLabel(): void;
	/** The optimizer's difficulty rating, when the model-suggestion setting asked
	 *  for one (ADR-181). Null: not asked, or the model left the line out. */
	onRated(difficulty: Difficulty | null): void;
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
			const rate = this.d.plugin.settings.optimizerSuggestsModel;
			const result = await this.d.plugin.promptOptimizerService.optimizeText(
				text, framework, conv.provider, conv.model, rate,
			);
			if (myGen !== this.generation) return; // superseded (view torn down / conversation switched)
			// Clear the busy state BEFORE replacing: execCommand needs the textarea
			// enabled and focusable.
			this.setBusy(false);
			const optimized = result.prompt.trim();
			if (optimized) this.replaceInput(optimized);
			if (rate) this.d.onRated(optimized ? result.difficulty : null);
		} catch (err) {
			if (myGen !== this.generation) return;
			this.setBusy(false);
			new Notice(t("optimizeFailed", { error: err instanceof Error ? err.message : String(err) }));
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
	 * Replace the whole composer with `text` as one edit, so ⌘Z (desktop) and iOS
	 * shake-to-undo revert to the original — `ComposerField.replaceRange` goes
	 * through `execCommand`, the only edit that enters the native undo stack, and
	 * falls back to a direct assignment where that is unavailable (no undo). A note
	 * link the rewrite kept comes back as its chip. Leaves focus in the field so the
	 * undo is immediately available and the user can send right away.
	 */
	private replaceInput(text: string): void {
		const field = this.d.inputEl;
		field.focus();
		field.replaceRange(0, field.value.length, text);
	}
}
