import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n";

export class InputModal extends Modal {
	private heading: string;
	private label: string;
	private initialValue: string;
	private onSubmit: (value: string) => void;

	constructor(
		app: App,
		heading: string,
		label: string,
		initialValue: string,
		onSubmit: (value: string) => void
	) {
		super(app);
		this.heading = heading;
		this.label = label;
		this.initialValue = initialValue;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		this.modalEl.addClass("pythia-modal");
		const { contentEl } = this;
		contentEl.createEl("h2", { text: this.heading });

		let inputEl: HTMLInputElement;

		new Setting(contentEl).setName(this.label).addText((text) => {
			inputEl = text.inputEl;
			text.setValue(this.initialValue);
			text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
				if (e.key === "Enter") {
					e.preventDefault();
					this.submit(inputEl.value);
				}
			});
			// Focus and select on next tick so the modal is rendered first
			setTimeout(() => {
				inputEl.focus();
				inputEl.select();
			}, 0);
		});

		const footer = contentEl.createDiv({ cls: "pythia-modal-buttons" });
		const okBtn = footer.createEl("button", {
			text: t("okBtn"),
			cls: "mod-cta",
		});
		okBtn.addEventListener("click", () => this.submit(inputEl.value));

		const cancelBtn = footer.createEl("button", { text: t("cancelBtn") });
		cancelBtn.addEventListener("click", () => this.close());
	}

	private submit(value: string): void {
		const trimmed = value.trim();
		if (trimmed) {
			this.onSubmit(trimmed);
			this.close();
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
