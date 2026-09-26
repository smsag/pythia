import { App, FuzzySuggestModal, SuggestModal, setIcon } from "obsidian";
import type { Conversation, Favorite } from "../models/types";
import { t } from "../i18n";
import {
	buildConversationFields,
	bestMatchSnippet,
	type ConversationFields,
} from "../services/conversationSearch";
import {
	MEANING_DEBOUNCE_MS,
	meaningOnly,
	meaningQuery,
	searchTitles,
	SEARCH_RESULT_LIMIT,
} from "../services/conversationFinder";
import { formatDate } from "../services/messageUtils";

export class ConversationSuggestModal extends SuggestModal<Conversation> {
	private conversations: Conversation[];
	private byId: Map<string, Conversation>;
	private onChoose: (conv: Conversation) => void;
	private onDelete?: (conv: Conversation) => void;
	/** Schreibstube's search by meaning, or null when it is not there (ADR-223). */
	private searchByMeaning?: (text: string, limit: number) => Promise<string[]> | null;
	/** Searchable fields by conversation id, built on first use: the snippet
	 *  needs a conversation's tokenized lines, and most rows are never drawn. */
	private fieldsById = new Map<string, ConversationFields>();
	/** Query tokens from the latest getSuggestions call, reused to compute the
	 *  match snippet while rendering each row. */
	private queryTokens: string[] = [];
	/** The latest query, so an answer that arrives after the next keystroke is dropped. */
	private latest = "";

	constructor(
		app: App,
		conversations: Conversation[],
		onChoose: (conv: Conversation) => void,
		onDelete?: (conv: Conversation) => void,
		searchByMeaning?: (text: string, limit: number) => Promise<string[]> | null
	) {
		super(app);
		this.conversations = conversations;
		this.byId = new Map(conversations.map((c) => [c.id, c]));
		this.onChoose = onChoose;
		this.onDelete = onDelete;
		this.searchByMeaning = searchByMeaning;
		this.setPlaceholder(t("searchConversations"));
		this.setInstructions([
			{ command: "↑↓", purpose: t("instrNavigate") },
			{ command: "↵",  purpose: t("instrOpen") },
			{ command: "esc", purpose: t("instrDismiss") },
		]);
	}

	/** The same search as the panel (ADR-223): titles at once; with Schreibstube,
	 *  after a pause in typing, what it finds by meaning below them. */
	getSuggestions(query: string): Conversation[] | Promise<Conversation[]> {
		this.latest = query;
		const { queryTokens, hits } = searchTitles(query, this.conversations);
		this.queryTokens = queryTokens;
		// Nothing typed: the newest, as the palette always opened.
		if (queryTokens.length === 0) {
			return [...this.conversations]
				.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
				.slice(0, SEARCH_RESULT_LIMIT);
		}
		const text = meaningQuery(query);
		if (!text || !this.searchByMeaning) return hits;
		return new Promise((resolve) => {
			setTimeout(() => {
				// Superseded: never settle, so an old list cannot land over a newer one.
				if (this.latest !== query) return;
				const asked = this.searchByMeaning?.(text, SEARCH_RESULT_LIMIT);
				if (!asked) return resolve(hits);
				void asked
					.then((ids) => resolve([...hits, ...meaningOnly(hits, ids, this.byId)]))
					.catch(() => resolve(hits));
			}, MEANING_DEBOUNCE_MS);
		});
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
		let fields = this.fieldsById.get(conv.id);
		if (!fields) {
			fields = buildConversationFields(conv);
			this.fieldsById.set(conv.id, fields);
		}
		const snippet = bestMatchSnippet(this.queryTokens, conv, fields);
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
