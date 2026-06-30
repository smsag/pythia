import { App, FuzzyMatch, FuzzySuggestModal, setIcon } from "obsidian";
import type { Conversation, Favorite } from "../models/types";
import { t } from "../i18n";

export class ConversationSuggestModal extends FuzzySuggestModal<Conversation> {
	private conversations: Conversation[];
	private onChoose: (conv: Conversation) => void;
	private onDelete?: (conv: Conversation) => void;

	constructor(
		app: App,
		conversations: Conversation[],
		onChoose: (conv: Conversation) => void,
		onDelete?: (conv: Conversation) => void
	) {
		super(app);
		this.conversations = conversations;
		this.onChoose = onChoose;
		this.onDelete = onDelete;
		this.setPlaceholder(t("searchConversations"));
		this.setInstructions([
			{ command: "↑↓", purpose: t("instrNavigate") },
			{ command: "↵",  purpose: t("instrOpen") },
			{ command: "esc", purpose: t("instrDismiss") },
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

	renderSuggestion(match: FuzzyMatch<Conversation>, el: HTMLElement): void {
		super.renderSuggestion(match, el);
		if (!this.onDelete) return;
		el.addClass("pythia-conv-suggest-item");
		const trashBtn = el.createEl("button", { cls: "pythia-conv-suggest-delete" });
		setIcon(trashBtn, "trash");
		trashBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			e.preventDefault();
			this.close();
			this.onDelete!(match.item);
		});
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
		this.setPlaceholder(t("searchFavorites"));
		this.setInstructions([
			{ command: "↑↓", purpose: t("instrNavigate") },
			{ command: "↵",  purpose: t("instrOpen") },
			{ command: "esc", purpose: t("instrDismiss") },
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
