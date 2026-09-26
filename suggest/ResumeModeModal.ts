import { App, Modal } from "obsidian";
import type { Conversation } from "../models/types";
import { t } from "../i18n";

export type ResumeMode = Conversation["resumeMode"];

/**
 * Which choice the Resume dialog offers first (ADR-233, closing D-63): the
 * conversation's own mode when it has one other than full history — it was
 * resumed that way before, or its template names one — else the settings'
 * default. Pure, so the rule is tested.
 */
export function preselectedResumeMode(conv: Pick<Conversation, "resumeMode">, settingsDefault: ResumeMode): ResumeMode {
	return conv.resumeMode === "summary" || conv.resumeMode === "hybrid" ? conv.resumeMode : settingsDefault;
}

/** The three choices, the preselected one first (ADR-233). */
export function resumeChoiceOrder(preselected: ResumeMode): ResumeMode[] {
	const all: ResumeMode[] = ["summary", "hybrid", "full"];
	return [preselected, ...all.filter((m) => m !== preselected)];
}

export class ResumeModeModal extends Modal {
	constructor(
		app: App,
		private readonly conversation: Conversation,
		private readonly preselected: ResumeMode,
		private readonly onChoose: (mode: ResumeMode) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("pythia-modal");
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t("resumeConvTitle") });
		contentEl.createEl("p", {
			text: t("resumeConvDesc", { name: this.conversation.name }),
			cls: "pythia-modal-desc",
		});

		const buttons = contentEl.createDiv({ cls: "pythia-modal-buttons" });
		let first: HTMLButtonElement | null = null;
		for (const mode of resumeChoiceOrder(this.preselected)) {
			// The preselected choice leads, carries the dialog's call-to-action
			// fill and takes focus, so Enter picks it.
			const btn = buttons.createEl("button", {
				text: this.label(mode),
				cls: mode === this.preselected ? "mod-cta" : "",
			});
			btn.title = this.title(mode);
			btn.addEventListener("click", () => {
				this.onChoose(mode);
				this.close();
			});
			first ??= btn;
		}
		first?.focus();

		const hint = contentEl.createEl("p", { cls: "pythia-modal-hint" });
		hint.setText(t("resumeHint"));
	}

	/** Literal t() calls, so the dead-key check sees them. */
	private label(mode: ResumeMode): string {
		switch (mode) {
			case "summary": return t("summaryModeBtn");
			case "hybrid": return t("hybridModeBtn");
			case "full": return t("fullModeBtn");
		}
	}

	private title(mode: ResumeMode): string {
		switch (mode) {
			case "summary": return t("summaryModeTitle");
			case "hybrid": return t("hybridModeTitle");
			case "full": return t("fullModeTitle");
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
