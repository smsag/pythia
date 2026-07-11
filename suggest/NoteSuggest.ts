import { App, TFile } from "obsidian";
import { t } from "../i18n";
import { FileSuggestModal } from "./FileSuggest";

export class NoteSuggestModal extends FileSuggestModal {
	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app, onChoose, {
			placeholder: t("searchNotes"),
			selectInstruction: t("instrAttach"),
		});
	}

	// Overrides the markdown-only base — notes can be attached as context
	// alongside PDFs (sent as native document blocks, see ContextBuilder.ts).
	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((f) => f.extension === "md" || f.extension === "pdf");
	}
}
