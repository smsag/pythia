import { App, Modal } from "obsidian";
import { t } from "../i18n";

export class DeleteFileModal extends Modal {
	private fileName: string;
	private onConfirm: () => void;

	constructor(app: App, fileName: string, onConfirm: () => void) {
		super(app);
		this.fileName = fileName;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		this.modalEl.addClass("pythia-modal");
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t("deleteFileTitle") });
		contentEl.createEl("p", {
			text: t("deleteFileConfirm", { name: this.fileName }),
			cls: "pythia-modal-desc",
		});
		const buttons = contentEl.createDiv({ cls: "pythia-modal-buttons" });
		const deleteBtn = buttons.createEl("button", { text: t("deleteBtn"), cls: "mod-warning" });
		deleteBtn.addEventListener("click", () => { this.onConfirm(); this.close(); });
		const cancelBtn = buttons.createEl("button", { text: t("cancelBtn") });
		cancelBtn.addEventListener("click", () => this.close());
	}

	onClose(): void { this.contentEl.empty(); }
}
