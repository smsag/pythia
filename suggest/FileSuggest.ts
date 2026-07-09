import { App, FuzzySuggestModal, TFile } from "obsidian";
import { t } from "../i18n";

export interface FileSuggestModalOptions {
	placeholder?: string;
	selectInstruction?: string;
}

export class FileSuggestModal extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;

	constructor(app: App, onChoose: (file: TFile) => void, opts: FileSuggestModalOptions = {}) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder(opts.placeholder ?? t("searchFiles"));
		this.setInstructions([
			{ command: "↑↓", purpose: t("instrNavigate") },
			{ command: "↵",  purpose: opts.selectInstruction ?? t("instrSelect") },
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
