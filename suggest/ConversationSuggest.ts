import { App, FuzzySuggestModal } from "obsidian";
import type { Conversation, Favorite } from "../models/types";

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

interface FavoriteEntry {
	conversation: Conversation;
	favorite: Favorite;
}

export class FavoritesSuggestModal extends FuzzySuggestModal<FavoriteEntry> {
	private entries: FavoriteEntry[];
	private onChoose: (conv: Conversation, messageId: string) => void;

	constructor(
		app: App,
		conversations: Conversation[],
		onChoose: (conv: Conversation, messageId: string) => void
	) {
		super(app);
		this.onChoose = onChoose;
		this.entries = conversations.flatMap((conv) =>
			(conv.favorites ?? []).map((fav) => ({ conversation: conv, favorite: fav }))
		);
		this.setPlaceholder("Search favorites…");
		this.setInstructions([
			{ command: "↑↓", purpose: "to navigate" },
			{ command: "↵", purpose: "to open" },
			{ command: "esc", purpose: "to dismiss" },
		]);
	}

	getItems(): FavoriteEntry[] {
		return this.entries;
	}

	getItemText(item: FavoriteEntry): string {
		return `★ ${item.favorite.name}  [${item.conversation.name}]`;
	}

	onChooseItem(item: FavoriteEntry): void {
		this.onChoose(item.conversation, item.favorite.messageId);
	}
}
