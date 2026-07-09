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
}
