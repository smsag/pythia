import { App, FuzzySuggestModal, SuggestModal, setIcon } from "obsidian";
import type { Conversation, Favorite } from "../models/types";
import { t } from "../i18n";
import {
	buildConversationHaystack,
	rankConversations,
	bestMatchSnippet,
} from "../services/conversationSearch";
import { tokenize } from "../services/noteRelevance";

export class ConversationSuggestModal extends SuggestModal<Conversation> {
	private conversations: Conversation[];
	private onChoose: (conv: Conversation) => void;
	private onDelete?: (conv: Conversation) => void;
	/** Searchable text per conversation, aligned by index to `conversations`.
	 *  Built once here so each keystroke only re-scores, never re-concatenates. */
	private haystacks: string[];
	/** Query tokens from the latest getSuggestions call, reused to compute the
	 *  match snippet while rendering each row. */
	private queryTokens: string[] = [];

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
		this.haystacks = conversations.map(buildConversationHaystack);
		this.setPlaceholder(t("searchConversations"));
		this.setInstructions([
			{ command: "↑↓", purpose: t("instrNavigate") },
			{ command: "↵",  purpose: t("instrOpen") },
			{ command: "esc", purpose: t("instrDismiss") },
		]);
	}

	getSuggestions(query: string): Conversation[] {
		this.queryTokens = tokenize(query);
		return rankConversations(this.queryTokens, this.conversations, this.haystacks).map(
			(r) => r.conversation
		);
	}

	renderSuggestion(conv: Conversation, el: HTMLElement): void {
		el.addClass("pythia-conv-suggest-item");
		const text = el.createDiv({ cls: "pythia-conv-suggest-text" });
		const date = conv.updatedAt.slice(0, 10);
		text.createDiv({
			cls: "pythia-conv-suggest-title",
			text: `${conv.name}  [${date}]`,
		});
		const snippet = bestMatchSnippet(this.queryTokens, conv);
		if (snippet) {
			text.createDiv({ cls: "pythia-conv-suggest-snippet", text: snippet });
		}

		if (!this.onDelete) return;
		const trashBtn = el.createEl("button", { cls: "pythia-conv-suggest-delete" });
		setIcon(trashBtn, "trash");
		trashBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			e.preventDefault();
			this.close();
			this.onDelete!(conv);
		});
	}

	onChooseSuggestion(item: Conversation): void {
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
