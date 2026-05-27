import { App, FuzzySuggestModal, TFolder } from "obsidian";
import { t } from "../i18n";

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	private onChoose: (folder: TFolder) => void;

	constructor(app: App, onChoose: (folder: TFolder) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder(t("searchFolders"));
		this.setInstructions([
			{ command: "↑↓", purpose: t("instrNavigate") },
			{ command: "↵",  purpose: t("instrSelect") },
			{ command: "esc", purpose: t("instrDismiss") },
		]);
	}

	getItems(): TFolder[] {
		const folders: TFolder[] = [];
		const walk = (folder: TFolder) => {
			folders.push(folder);
			for (const child of folder.children) {
				if (child instanceof TFolder) walk(child);
			}
		};
		walk(this.app.vault.getRoot());
		return folders;
	}

	getItemText(item: TFolder): string {
		return item.isRoot() ? "/" : item.path;
	}

	onChooseItem(item: TFolder): void {
		this.onChoose(item);
	}
}
