import { App, Modal } from "obsidian";
import type { Conversation } from "../models/types";
import { t } from "../i18n";

export interface DeleteConversationActions {
	/** Remove the conversation. */
	onDelete: () => void;
	/** Write it to a note first, then remove it. The callback is responsible for
	 *  NOT deleting when the note could not be written (ADR-172/173). */
	onArchive: () => void;
	/** The archive folder, named in the hint so the button is not a mystery. */
	archiveFolder: string;
}

/**
 * Confirm deleting one conversation — with the archive offered beside it
 * (ADR-173).
 *
 * The deliberate delete is the last path that could destroy a conversation with
 * no copy left anywhere, and the moment of deciding is the only moment the user
 * knows whether this one mattered. So it is a choice in the dialog, not a
 * setting: `archiveBeforeEviction` governs the automatic path, where nobody is
 * there to be asked.
 *
 * Archive leads and carries `mod-cta`; Delete keeps `mod-warning`. Both are one
 * tap — an offered safe option that costs an extra step is an option people
 * learn to skip.
 */
export class DeleteConversationModal extends Modal {
	constructor(
		app: App,
		private readonly conversation: Conversation,
		private readonly actions: DeleteConversationActions,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("pythia-modal");
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t("deleteConvTitle") });
		contentEl.createEl("p", {
			text: t("deleteConvConfirm", { name: this.conversation.name }),
			cls: "pythia-modal-desc",
		});
		contentEl.createEl("p", {
			text: t("archiveConvHint", { folder: this.actions.archiveFolder }),
			cls: "pythia-modal-hint",
		});

		const buttons = contentEl.createDiv({ cls: "pythia-modal-buttons" });

		const archiveBtn = buttons.createEl("button", { text: t("archiveConvBtn"), cls: "mod-cta" });
		archiveBtn.addEventListener("click", () => {
			this.actions.onArchive();
			this.close();
		});

		const deleteBtn = buttons.createEl("button", { text: t("deleteBtn"), cls: "mod-warning" });
		deleteBtn.addEventListener("click", () => {
			this.actions.onDelete();
			this.close();
		});

		const cancelBtn = buttons.createEl("button", { text: t("cancelBtn") });
		cancelBtn.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
