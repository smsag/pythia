import { App, FuzzySuggestModal } from "obsidian";
import type { PythiaTemplate } from "../models/types";

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
		this.setPlaceholder("Search templates…");
		this.setInstructions([
			{ command: "↑↓", purpose: "to navigate" },
			{ command: "↵", purpose: "to use template" },
			{ command: "esc", purpose: "to dismiss" },
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
