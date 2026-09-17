import { App, FuzzySuggestModal, SuggestModal, setIcon } from "obsidian";
import type { Conversation, Favorite } from "../models/types";
import { t } from "../i18n";
import {
	buildConversationFields,
	searchConversations,
	bestMatchSnippet,
	type ConversationFields,
} from "../services/conversationSearch";
import { noteBasename } from "../services/pathUtils";
import { formatDate } from "../services/messageUtils";

export class ConversationSuggestModal extends SuggestModal<Conversation> {
	private conversations: Conversation[];
	private onChoose: (conv: Conversation) => void;
	private onDelete?: (conv: Conversation) => void;
	/** Searchable fields per conversation, aligned by index to `conversations`.
	 *  Built once here so each keystroke only re-scores, never re-concatenates. */
	private fields: ConversationFields[];
	/** Query tokens from the latest getSuggestions call, reused to compute the
	 *  match snippet while rendering each row. */
	private queryTokens: string[] = [];
	/** Why each row surfaced, when it surfaced through an attached or cited note
	 *  (ADR-168) — the palette's equivalent of the panel's `via …` line. A row the
	 *  user cannot explain is worse than no row. */
	private matchedNotes = new Map<string, string[]>();

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
		this.fields = conversations.map(buildConversationFields);
		this.setPlaceholder(t("searchConversations"));
		this.setInstructions([
			{ command: "↑↓", purpose: t("instrNavigate") },
			{ command: "↵",  purpose: t("instrOpen") },
			{ command: "esc", purpose: t("instrDismiss") },
		]);
	}

	getSuggestions(query: string): Conversation[] {
		// The same scope grammar and the same auto-widening as the in-view panel
		// (ADR-168) — one search, two entry points. Widened rows come last and each
		// says which note put it there.
		const outcome = searchConversations(query, this.conversations, this.fields);
		this.queryTokens = outcome.queryTokens;
		this.matchedNotes = new Map();
		const rows = [...outcome.primary, ...outcome.widened];
		for (const r of rows) {
			if (r.matchedNotes.length > 0) this.matchedNotes.set(r.conversation.id, r.matchedNotes);
		}
		return rows.map((r) => r.conversation);
	}

	renderSuggestion(conv: Conversation, el: HTMLElement): void {
		el.addClass("pythia-conv-suggest-item");
		const text = el.createDiv({ cls: "pythia-conv-suggest-text" });
		// The one UI date format (ADR-139), not a raw ISO slice.
		const date = formatDate(conv.updatedAt);
		text.createDiv({
			cls: "pythia-conv-suggest-title",
			text: date ? `${conv.name}  [${date}]` : conv.name,
		});
		const via = this.matchedNotes.get(conv.id);
		if (via?.length) {
			const extra = via.length > 1 ? ` +${via.length - 1}` : "";
			text.createDiv({
				cls: "pythia-conv-suggest-snippet",
				text: `${t("viaNote", { name: noteBasename(via[0]) })}${extra}`,
			});
		}
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
