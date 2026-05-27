import { App, Modal } from "obsidian";
import type { Conversation } from "../models/types";
import { t } from "../i18n";

export class ResumeModeModal extends Modal {
	private conversation: Conversation;
	private onChoose: (mode: "full" | "summary") => void;

	constructor(
		app: App,
		conversation: Conversation,
		onChoose: (mode: "full" | "summary") => void
	) {
		super(app);
		this.conversation = conversation;
		this.onChoose = onChoose;
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

		const summaryBtn = buttons.createEl("button", {
			text: t("summaryModeBtn"),
			cls: "mod-cta",
		});
		summaryBtn.title = t("summaryModeTitle");
		summaryBtn.addEventListener("click", () => {
			this.onChoose("summary");
			this.close();
		});

		const fullBtn = buttons.createEl("button", { text: t("fullModeBtn") });
		fullBtn.title = t("fullModeTitle");
		fullBtn.addEventListener("click", () => {
			this.onChoose("full");
			this.close();
		});

		const hint = contentEl.createEl("p", { cls: "pythia-modal-hint" });
		hint.setText(t("resumeHint"));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
