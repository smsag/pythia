import { App, FuzzySuggestModal, TFile } from "obsidian";
import { t } from "../i18n";

export class NoteSuggestModal extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;

	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder(t("searchNotes"));
		this.setInstructions([
			{ command: "↑↓", purpose: t("instrNavigate") },
			{ command: "↵",  purpose: t("instrAttach") },
			{ command: "esc", purpose: t("instrDismiss") },
		]);
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		this.onChoose(item);
	}
}
