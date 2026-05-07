import { App, Modal } from "obsidian";
import type { Conversation } from "../models/types";

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
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Resume conversation" });
		contentEl.createEl("p", {
			text: `How would you like to resume "${this.conversation.name}"?`,
			cls: "pythia-modal-desc",
		});

		const buttons = contentEl.createDiv({ cls: "pythia-modal-buttons" });

		const summaryBtn = buttons.createEl("button", {
			text: "Summary",
			cls: "mod-cta",
		});
		summaryBtn.title =
			"Send an AI-generated summary as context — lower token cost";
		summaryBtn.addEventListener("click", () => {
			this.onChoose("summary");
			this.close();
		});

		const fullBtn = buttons.createEl("button", { text: "Full history" });
		fullBtn.title =
			"Re-send all previous messages — higher fidelity, higher token cost";
		fullBtn.addEventListener("click", () => {
			this.onChoose("full");
			this.close();
		});

		const hint = contentEl.createEl("p", { cls: "pythia-modal-hint" });
		hint.setText(
			"Summary is recommended for long conversations. Full history preserves all nuance."
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
