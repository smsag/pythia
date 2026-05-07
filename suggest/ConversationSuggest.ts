import { App, FuzzySuggestModal } from "obsidian";
import type { Conversation } from "../models/types";

export class ConversationSuggestModal extends FuzzySuggestModal<Conversation> {
	private conversations: Conversation[];
	private onChoose: (conv: Conversation) => void;

	constructor(
		app: App,
		conversations: Conversation[],
		onChoose: (conv: Conversation) => void
	) {
		super(app);
		this.conversations = conversations;
		this.onChoose = onChoose;
		this.setPlaceholder("Search conversations…");
		this.setInstructions([
			{ command: "↑↓", purpose: "to navigate" },
			{ command: "↵", purpose: "to open" },
			{ command: "esc", purpose: "to dismiss" },
		]);
	}

	getItems(): Conversation[] {
		// Most recently updated first
		return [...this.conversations].sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() -
				new Date(a.updatedAt).getTime()
		);
	}

	getItemText(item: Conversation): string {
		const date = item.updatedAt.slice(0, 10);
		return `${item.name}  [${date}]`;
	}

	onChooseItem(item: Conversation): void {
		this.onChoose(item);
	}
}
