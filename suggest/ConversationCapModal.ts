import { App, Modal } from "obsidian";
import { t } from "../i18n";

/**
 * Lowering the conversation history limit deletes conversations from data.json
 * and there is no undo, so it is a distinct, named operation rather than a side
 * effect of typing a number (ADR-171, engineering principle "a write that can
 * destroy content is a distinct operation").
 *
 * Dismissing the dialog any way — Escape, the outside press, Cancel — counts as
 * "no": `onClose` runs `onCancel` unless the removal was explicitly confirmed.
 */
export class ConversationCapModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private readonly count: number,
		private readonly cap: number,
		private readonly onConfirm: () => void,
		private readonly onCancel: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("pythia-modal");
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t("capConfirmTitle") });
		contentEl.createEl("p", {
			text: t("capConfirmBody", { count: String(this.count), cap: String(this.cap) }),
			cls: "pythia-modal-desc",
		});
		contentEl.createEl("p", { text: t("capConfirmKept"), cls: "pythia-modal-desc" });

		const buttons = contentEl.createDiv({ cls: "pythia-modal-buttons" });

		const removeBtn = buttons.createEl("button", {
			text: t("capConfirmRemove", { count: String(this.count) }),
			cls: "mod-warning",
		});
		removeBtn.addEventListener("click", () => {
			this.confirmed = true;
			this.onConfirm();
			this.close();
		});

		const cancelBtn = buttons.createEl("button", { text: t("cancelBtn") });
		cancelBtn.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.confirmed) this.onCancel();
	}
}
