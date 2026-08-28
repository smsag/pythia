import { Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { abbreviateModel } from "../models/knownModels";
import { DeleteConversationModal } from "../suggest/DeleteConversationModal";
import {
	buildConversationHaystack,
	rankConversations,
	bestMatchSnippet,
} from "../services/conversationSearch";
import { tokenize } from "../services/noteRelevance";

export interface HistoryDeps {
	plugin: PythiaPlugin;
	/** The view's content pane (`containerEl.children[1]`) — the overlay mounts here. */
	getContainer(): HTMLElement;
	getConversation(): Conversation | null;
	isStreaming(): boolean;
	setActiveConversation(conv: Conversation): Promise<void>;
	renderHeader(): void;
}

/**
 * The conversation-history surface extracted from `PythiaSidebarView` (ADR-103,
 * engineering-review #120): the full-panel history overlay — a browse-by-date
 * listing that doubles as content search — plus the shared delete-with-confirm
 * flow. Follows the `NavigatorController`/`OptimizationController` pattern — a
 * `Deps` interface carrying the plugin, view elements, and callbacks.
 *
 * The overlay is the single conversation-search surface (ADR-107): opened from
 * the header search (loupe) icon with the search input auto-focused. Empty box →
 * the date-grouped, fork-indented browse listing; a query → a flat, relevance-
 * ranked list with match snippets. ↑/↓ move the selection, Enter opens it. The
 * former anchored quick switcher (header-title click) was folded into this.
 */
export class HistoryController {
	private historyCleanup: (() => void) | null = null;

	constructor(private readonly d: HistoryDeps) {}

	/** Close the history surface — called on view teardown/rebuild. */
	close(): void {
		this.historyCleanup?.();
	}

	deleteConversationWithConfirm(conv: Conversation, onDone?: () => void): void {
		if (this.d.isStreaming()) {
			new Notice(t("cannotDeleteWhileStreaming"));
			return;
		}
		new DeleteConversationModal(this.d.plugin.app, conv, async () => {
			await this.d.plugin.conversationStore.delete(conv.id);
			new Notice(t("conversationDeleted"));
			if (this.d.getConversation()?.id === conv.id) {
				const remaining = this.d.plugin.conversations;
				if (remaining.length > 0) {
					await this.d.setActiveConversation(remaining[remaining.length - 1]);
				} else {
					await this.d.plugin.cmdNewConversation();
				}
			}
			onDone?.();
		}).open();
	}

	/** Uppercase mono date-group label for the history view (HEUTE / GESTERN /
	 *  DIESE WOCHE / "August 2026"). */
	private historyBucket(iso: string | undefined): string {
		if (!iso) return "—";
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return "—";
		const now = new Date();
		const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
		const dayDiff = Math.round((startOf(now) - startOf(d)) / 86_400_000);
		if (dayDiff <= 0) return t("histToday");
		if (dayDiff === 1) return t("histYesterday");
		if (dayDiff < 7) return t("histThisWeek");
		return d.toLocaleDateString(undefined, { month: "long", year: "numeric" }).toUpperCase();
	}

	/** The full-panel conversation overlay: a browse-by-date listing that doubles
	 *  as content search. Opened from the header loupe with the search input
	 *  focused. Empty query → conversations grouped by date, forks indented under
	 *  their source; a query → a flat relevance-ranked list with match snippets.
	 *  ↑/↓ move the selection, Enter opens it, Esc closes. */
	openHistoryView(): void {
		if (this.historyCleanup) { this.historyCleanup(); return; } // toggle
		const container = this.d.getContainer();
		const overlay = container.createDiv({ cls: "p-history" });

		const close = () => {
			overlay.remove();
			document.removeEventListener("keydown", onKey, true);
			this.historyCleanup = null;
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
		const openConv = (conv: Conversation) => { close(); void this.d.setActiveConversation(conv); };

		// ── Header ───────────────────────────────────────────────────
		const head = overlay.createDiv({ cls: "p-history-head" });
		const backBtn = head.createEl("button", { cls: "p-hdr-btn", attr: { title: t("backTooltip") } });
		setIcon(backBtn, "arrow-left");
		backBtn.addEventListener("click", () => close());
		head.createDiv({ cls: "p-history-title", text: t("histTitle") });
		const newBtn = head.createEl("button", { cls: "p-hdr-btn", attr: { title: t("newConvTooltip") } });
		setIcon(newBtn, "plus");
		newBtn.addEventListener("click", () => { close(); void this.d.plugin.cmdNewConversation(); });

		// ── Search ───────────────────────────────────────────────────
		const searchRow = overlay.createDiv({ cls: "p-switcher-search" });
		setIcon(searchRow.createSpan({ cls: "p-switcher-search-icon" }), "search");
		const input = searchRow.createEl("input", {
			cls: "p-switcher-input",
			attr: { type: "text", placeholder: t("switcherSearchPlaceholder") },
		});

		const listEl = overlay.createDiv({ cls: "p-history-list" });

		// Searchable text per conversation, built once and memoized for the life of
		// the panel so each keystroke only re-scores, never re-concatenates messages.
		const haystackCache = new Map<string, string>();
		const haystackFor = (conv: Conversation): string => {
			let h = haystackCache.get(conv.id);
			if (h === undefined) {
				h = buildConversationHaystack(conv);
				haystackCache.set(conv.id, h);
			}
			return h;
		};

		// Keyboard selection over the rendered conversation rows (group headers are
		// not selectable). Rebuilt on every buildList; ↑/↓ move, Enter opens.
		let rows: { conv: Conversation; el: HTMLElement }[] = [];
		let selectedIdx = 0;
		const paintSelection = () => {
			rows.forEach((r, i) => r.el.toggleClass("selected", i === selectedIdx));
			rows[selectedIdx]?.el.scrollIntoView({ block: "nearest" });
		};

		const rowSub = (conv: Conversation, isFork: boolean): HTMLElement => {
			const sub = createDiv({ cls: "p-history-sub" });
			if (isFork) {
				sub.appendText(`${t("branchLabel")} · ${t("msgCountShort", { n: String(conv.messages.length) })}`);
				return sub;
			}
			sub.appendText(`${abbreviateModel(conv.model)} · ${t("msgCountShort", { n: String(conv.messages.length) })}`);
			const forkCount = this.d.plugin.conversations.filter((c) => c.forkedFromId === conv.id).length;
			if (forkCount) sub.createSpan({ cls: "p-history-fork-count", text: ` ⑂ ${forkCount}` });
			const favCount = conv.favorites?.length ?? 0;
			if (favCount) sub.createSpan({ cls: "p-history-fav-count", text: ` ★ ${favCount}` });
			return sub;
		};

		// Shared row body for browse and search rows. `snippetTokens` (search mode)
		// appends the best-matching message line; browse rows keep the fork indent.
		const makeRow = (conv: Conversation, isFork: boolean, indentFork: boolean, snippetTokens?: string[]): void => {
			const row = listEl.createDiv({ cls: indentFork ? "p-history-row fork" : "p-history-row" });
			if (conv.id === this.d.getConversation()?.id) row.addClass("active");
			if (isFork) setIcon(row.createSpan({ cls: "p-switcher-fork-icon" }), "git-branch");
			const main = row.createDiv({ cls: "p-history-main" });
			main.createDiv({ cls: "p-history-row-title", text: conv.name });
			main.appendChild(rowSub(conv, isFork));
			if (snippetTokens) {
				const snippet = bestMatchSnippet(snippetTokens, conv);
				if (snippet) main.createDiv({ cls: "p-history-snippet", text: snippet });
			}
			if (conv.id === this.d.getConversation()?.id) {
				row.createSpan({ cls: "p-nav-tag", text: t("navActiveTag") });
			} else {
				const del = row.createSpan({ cls: "p-switcher-del", text: "✕", attr: { title: t("deleteConvTooltip") } });
				del.addEventListener("click", (e) => {
					e.stopPropagation();
					this.deleteConversationWithConfirm(conv, () => buildList(input.value));
				});
			}
			row.addEventListener("click", () => openConv(conv));
			rows.push({ conv, el: row });
		};

		const buildList = (query: string) => {
			listEl.empty();
			rows = [];
			selectedIdx = 0;
			const q = query.toLowerCase().trim();
			const all = this.d.plugin.conversations;
			const byId = new Map(all.map((c) => [c.id, c]));

			// Active query → flat list ranked by content relevance (TF-IDF over
			// title + summary + messages), best match first, with match snippets.
			// The date-grouped/fork-indented layout resumes when the box is empty.
			if (q) {
				const queryTokens = tokenize(query);
				const ranked = rankConversations(queryTokens, all, all.map(haystackFor));
				for (const { conversation } of ranked) {
					const isFork = !!conversation.forkedFromId && byId.has(conversation.forkedFromId);
					makeRow(conversation, isFork, false, queryTokens);
				}
				if (!listEl.hasChildNodes()) {
					listEl.createDiv({ cls: "p-nav-empty", text: t("navNoChapters") });
				}
				paintSelection();
				return;
			}

			const sources = all
				.filter((c) => !c.forkedFromId || !byId.has(c.forkedFromId))
				.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
			let currentBucket = "";
			for (const src of sources) {
				const forks = all
					.filter((c) => c.forkedFromId === src.id)
					.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
				const bucket = this.historyBucket(src.updatedAt);
				if (bucket !== currentBucket) {
					currentBucket = bucket;
					listEl.createDiv({ cls: "p-history-group", text: bucket });
				}
				makeRow(src, false, false);
				for (const f of forks) makeRow(f, true, true);
			}
			if (!listEl.hasChildNodes()) {
				listEl.createDiv({ cls: "p-nav-empty", text: t("navNoChapters") });
			}
			paintSelection();
		};

		input.addEventListener("input", () => buildList(input.value));
		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "ArrowDown") { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, rows.length - 1); paintSelection(); }
			else if (e.key === "ArrowUp") { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); paintSelection(); }
			else if (e.key === "Enter") { e.preventDefault(); const r = rows[selectedIdx]; if (r) openConv(r.conv); }
		});

		buildList("");
		setTimeout(() => {
			document.addEventListener("keydown", onKey, true);
			this.historyCleanup = close;
			input.focus();
		}, 0);
	}

	async handleDeleteConversation(): Promise<void> {
		const active = this.d.getConversation();
		if (!active) return;
		if (this.d.isStreaming()) {
			new Notice(t("cannotDeleteWhileStreaming"));
			return;
		}
		const toDelete = active;

		new DeleteConversationModal(this.d.plugin.app, toDelete, async () => {
			await this.d.plugin.conversationStore.delete(toDelete.id);
			new Notice(t("conversationDeleted"));

			const remaining = this.d.plugin.conversations;
			if (remaining.length > 0) {
				const next = remaining[remaining.length - 1];
				await this.d.setActiveConversation(next);
			} else {
				await this.d.plugin.cmdNewConversation();
			}
		}).open();
	}
}
