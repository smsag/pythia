import { App, Modal } from "obsidian";
import { t } from "../i18n";

export class PromptInputModal extends Modal {
	private resolve: (value: string | null) => void;
	private textareaEl!: HTMLTextAreaElement;

	constructor(app: App, resolve: (value: string | null) => void) {
		super(app);
		this.resolve = resolve;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("pythia-prompt-input-modal");

		contentEl.createEl("h2", { text: t("promptInputModalTitle") });

		this.textareaEl = contentEl.createEl("textarea", {
			cls: "pythia-prompt-input-textarea",
			attr: { placeholder: t("promptInputModalPlaceholder"), rows: "6" },
		});

		const btnRow = contentEl.createDiv({ cls: "pythia-modal-btn-row" });

		const cancelBtn = btnRow.createEl("button", { text: t("cancelBtn") });
		cancelBtn.addEventListener("click", () => this.cancel());

		const confirmBtn = btnRow.createEl("button", {
			text: t("promptInputModalConfirm"),
			cls: "mod-cta",
		});
		confirmBtn.addEventListener("click", () => this.confirm());

		this.textareaEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.confirm();
			}
		});

		this.textareaEl.focus();
	}

	onClose(): void {
		// Resolve with null if closed without confirming
		this.resolve(null);
		this.contentEl.empty();
	}

	private confirm(): void {
		const value = this.textareaEl.value.trim();
		if (!value) return;
		this.resolve(value);
		// Prevent onClose from resolving again
		this.resolve = () => {};
		this.close();
	}

	private cancel(): void {
		this.resolve(null);
		this.resolve = () => {};
		this.close();
	}
}
