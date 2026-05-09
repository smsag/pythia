import { App, Modal } from "obsidian";
import type { Conversation } from "../models/types";

export class DeleteConversationModal extends Modal {
	private conversation: Conversation;
	private onConfirm: () => void;

	constructor(app: App, conversation: Conversation, onConfirm: () => void) {
		super(app);
		this.conversation = conversation;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		this.modalEl.addClass("pythia-modal");
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Delete conversation" });
		contentEl.createEl("p", {
			text: `Delete "${this.conversation.name}"? This cannot be undone.`,
			cls: "pythia-modal-desc",
		});

		const buttons = contentEl.createDiv({ cls: "pythia-modal-buttons" });

		const deleteBtn = buttons.createEl("button", {
			text: "Delete",
			cls: "mod-warning",
		});
		deleteBtn.addEventListener("click", () => {
			this.onConfirm();
			this.close();
		});

		const cancelBtn = buttons.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
