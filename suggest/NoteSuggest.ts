import { App, TFile } from "obsidian";
import { t } from "../i18n";
import { FileSuggestModal } from "./FileSuggest";
import { isAttachable } from "../services/attachable";

export class NoteSuggestModal extends FileSuggestModal {
	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app, onChoose, {
			placeholder: t("searchNotes"),
			selectInstruction: t("instrAttach"),
		});
	}

	// Overrides the markdown-only base — notes can be attached as context
	// alongside spreadsheet exports and PDFs (sent as native document blocks, see ContextBuilder.ts).
	override getItems(): TFile[] {
		return this.app.vault.getFiles().filter(isAttachable);
	}
}
