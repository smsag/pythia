import { App, FuzzySuggestModal } from "obsidian";
import type { PythiaTemplate } from "../models/types";
import { t } from "../i18n";

export class TemplateSuggestModal extends FuzzySuggestModal<PythiaTemplate> {
	private templates: PythiaTemplate[];
	private onChoose: (template: PythiaTemplate) => void;

	constructor(
		app: App,
		templates: PythiaTemplate[],
		onChoose: (template: PythiaTemplate) => void
	) {
		super(app);
		this.templates = templates;
		this.onChoose = onChoose;
		this.setPlaceholder(t("searchTemplates"));
		this.setInstructions([
			{ command: "↑↓", purpose: t("instrNavigate") },
			{ command: "↵",  purpose: t("instrUseTemplate") },
			{ command: "esc", purpose: t("instrDismiss") },
		]);
	}

	getItems(): PythiaTemplate[] {
		return this.templates;
	}

	getItemText(item: PythiaTemplate): string {
		return item.name;
	}

	onChooseItem(item: PythiaTemplate): void {
		this.onChoose(item);
	}
}
