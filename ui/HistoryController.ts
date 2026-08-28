import { Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { abbreviateModel } from "../models/knownModels";
import { InputModal } from "../suggest/InputModal";
import { DeleteConversationModal } from "../suggest/DeleteConversationModal";
import {
	buildConversationHaystack,
	rankConversations,
	bestMatchSnippet,
} from "../services/conversationSearch";
import { tokenize } from "../services/noteRelevance";

export interface HistoryDeps {
	plugin: PythiaPlugin;
	/** The view's content pane (`containerEl.children[1]`) — popovers/overlays mount here. */
	getContainer(): HTMLElement;
	/** The header title element, so the quick switcher's outside-click ignores it. */
	getConvNameEl(): HTMLElement;
	getConversation(): Conversation | null;
	isStreaming(): boolean;
	setActiveConversation(conv: Conversation): Promise<void>;
	renderHeader(): void;
}

/**
 * The conversation-history surfaces extracted from `PythiaSidebarView` (ADR-103,
 * engineering-review #120): the anchored quick switcher (opened from the header
 * title), the full-panel history overlay, and the shared delete-with-confirm
 * flow. Follows the `NavigatorController`/`OptimizationController` pattern — a
 * `Deps` interface carrying the plugin, view elements, and callbacks. Behaviour
 * is identical to the inline methods it replaced.
 */
export class HistoryController {
	private quickSwitcherCleanup: (() => void) | null = null;
	private historyCleanup: (() => void) | null = null;

	constructor(private readonly d: HistoryDeps) {}

	/** Close any open switcher/history surface — called on view teardown/rebuild. */
	close(): void {
		this.quickSwitcherCleanup?.();
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

	/** Short relative date for switcher/history sub-lines: today, yesterday,
	 *  else a localized "12 Aug"-style date. */
	private formatConvDate(iso: string | undefined): string {
		if (!iso) return "";
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return "";
		const now = new Date();
		const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
		const dayDiff = Math.round((startOf(now) - startOf(d)) / 86_400_000);
		if (dayDiff <= 0) return t("dateToday");
		if (dayDiff === 1) return t("dateYesterday");
		return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
	}

	/** Anchored quick switcher (F9) opened from the header title. Search over
	 *  conversations with forks indented under their source; keyboard nav;
	 *  hover-delete. The command-palette fuzzy modal remains a separate surface. */
	openQuickSwitcher(): void {
		if (this.d.plugin.conversations.length === 0) return;
		if (this.quickSwitcherCleanup) { this.quickSwitcherCleanup(); return; } // toggle

		const container = this.d.getContainer();
		const headerEl = container.querySelector<HTMLElement>(".p-header");
		if (!headerEl) return;
		const panel = container.createDiv({ cls: "p-switcher" });
		const cRect = container.getBoundingClientRect();
		const rect = headerEl.getBoundingClientRect();
		const top = rect.bottom - cRect.top + 4;
		panel.style.position = "absolute";
		panel.style.top = `${top}px`;
		panel.style.left = `${rect.left - cRect.left + 16}px`;
		panel.style.width = `${Math.max(180, rect.width - 32)}px`;
		panel.style.maxHeight = `${Math.max(160, cRect.height - top - 8)}px`;

		const searchRow = panel.createDiv({ cls: "p-switcher-search" });
		setIcon(searchRow.createSpan({ cls: "p-switcher-search-icon" }), "search");
		const input = searchRow.createEl("input", {
			cls: "p-switcher-input",
			attr: { type: "text", placeholder: t("switcherSearchPlaceholder") },
		});
		const listEl = panel.createDiv({ cls: "p-switcher-list" });
		panel.createDiv({ cls: "p-switcher-footer", text: t("switcherHint") });

		let rows: { conv: Conversation; el: HTMLElement }[] = [];
		let selectedIdx = 0;

		// Searchable text per conversation, memoized for the life of the popover.
		const haystackCache = new Map<string, string>();
		const haystackFor = (conv: Conversation): string => {
			let h = haystackCache.get(conv.id);
			if (h === undefined) {
				h = buildConversationHaystack(conv);
				haystackCache.set(conv.id, h);
			}
			return h;
		};

		const closeSw = () => {
			panel.remove();
			document.removeEventListener("mousedown", onOutside, true);
			this.quickSwitcherCleanup = null;
		};
		const openConv = (conv: Conversation) => { closeSw(); void this.d.setActiveConversation(conv); };
		const onOutside = (e: MouseEvent) => {
			if (!panel.contains(e.target as Node) && e.target !== this.d.getConvNameEl()) closeSw();
		};

		const paintSelection = () => {
			rows.forEach((r, i) => r.el.toggleClass("selected", i === selectedIdx));
			rows[selectedIdx]?.el.scrollIntoView({ block: "nearest" });
		};

		const addRow = (conv: Conversation, isFork: boolean, q: string, snippetTokens?: string[]) => {
			// In ranked search mode (snippetTokens given) relevance already decided
			// inclusion, so skip the title-substring gate — it would drop content-only
			// matches. Otherwise keep the plain title filter for the grouped listing.
			if (q && !snippetTokens && !conv.name.toLowerCase().includes(q)) return;
			const row = listEl.createDiv({ cls: isFork ? "p-switcher-row fork" : "p-switcher-row" });
			const main = row.createDiv({ cls: "p-switcher-main" });
			// Fork icon sits inline with the title text (not stacked above it).
			const titleRow = main.createDiv({ cls: "p-switcher-title-row" });
			if (isFork) setIcon(titleRow.createSpan({ cls: "p-switcher-fork-icon" }), "git-branch");
			const titleEl = titleRow.createDiv({ cls: "p-switcher-title" });
			// Highlight the matched substring.
			const name = conv.name;
			const idx = q ? name.toLowerCase().indexOf(q) : -1;
			if (idx >= 0) {
				titleEl.appendText(name.slice(0, idx));
				titleEl.createEl("b", { cls: "p-switcher-hl", text: name.slice(idx, idx + q.length) });
				titleEl.appendText(name.slice(idx + q.length));
			} else {
				titleEl.setText(name);
			}
			const subEl = main.createDiv({ cls: "p-switcher-sub" });
			if (isFork) {
				subEl.appendText(`${t("branchLabel")} · ${t("msgCount", { n: String(conv.messages.length) })}`);
			} else {
				subEl.appendText(`${abbreviateModel(conv.model)} · ${t("msgCount", { n: String(conv.messages.length) })} · ${this.formatConvDate(conv.updatedAt)}`);
				// Fork + favorite counts per conversation, matching the F10 concept.
				const forkCount = this.d.plugin.conversations.filter((c) => c.forkedFromId === conv.id).length;
				if (forkCount) subEl.createSpan({ cls: "p-switcher-fork-count", text: ` ⑂ ${forkCount}` });
				const favCount = conv.favorites?.length ?? 0;
				if (favCount) subEl.createSpan({ cls: "p-switcher-fav-count", text: ` ★ ${favCount}` });
			}
			if (snippetTokens) {
				const snippet = bestMatchSnippet(snippetTokens, conv);
				if (snippet) main.createDiv({ cls: "p-switcher-snippet", text: snippet });
			}

			// Rename affordance (the header pencil is easy to miss): opens an input to
			// rename THIS conversation. Discoverable via the title dropdown users
			// already open, and works for any conversation, not just the active one.
			const rename = row.createSpan({ cls: "p-switcher-rename", text: "✎", attr: { title: t("renameConvTooltip") } });
			rename.addEventListener("mousedown", (e) => {
				e.preventDefault(); e.stopPropagation();
				closeSw(); // rename happens in its own modal; close the popover first
				new InputModal(this.d.plugin.app, t("renameConvTooltip"), t("renameConvPlaceholder"), conv.name, (value) => {
					const newName = value.trim();
					if (!newName || newName === conv.name) return;
					conv.name = newName;
					void this.d.plugin.conversationStore.save(conv);
					void this.d.plugin.renameConversationFile(conv);
					if (this.d.getConversation()?.id === conv.id) this.d.renderHeader();
				}).open();
			});

			const del = row.createSpan({ cls: "p-switcher-del", text: "✕", attr: { title: t("deleteConvTooltip") } });
			del.addEventListener("mousedown", (e) => {
				e.preventDefault(); e.stopPropagation();
				this.deleteConversationWithConfirm(conv, () => buildList(input.value));
			});
			row.addEventListener("mousedown", (e) => {
				e.preventDefault(); e.stopPropagation();
				openConv(conv);
			});
			rows.push({ conv, el: row });
		};

		const buildList = (query: string) => {
			listEl.empty();
			rows = [];
			const q = query.toLowerCase().trim();
			const all = this.d.plugin.conversations;
			const byId = new Map(all.map((c) => [c.id, c]));

			// Active query → flat, relevance-ranked (content match + snippet); empty
			// box → the source/fork listing in recency order.
			if (q) {
				const queryTokens = tokenize(query);
				const ranked = rankConversations(queryTokens, all, all.map(haystackFor));
				for (const { conversation } of ranked) {
					const isFork = !!conversation.forkedFromId && byId.has(conversation.forkedFromId);
					addRow(conversation, isFork, q, queryTokens);
				}
				selectedIdx = 0;
				paintSelection();
				return;
			}

			const sources = all
				.filter((c) => !c.forkedFromId || !byId.has(c.forkedFromId))
				.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
			for (const src of sources) {
				addRow(src, false, q);
				const forks = all
					.filter((c) => c.forkedFromId === src.id)
					.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
				for (const f of forks) addRow(f, true, q);
			}
			selectedIdx = 0;
			paintSelection();
		};

		input.addEventListener("input", () => buildList(input.value));
		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "ArrowDown") { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, rows.length - 1); paintSelection(); }
			else if (e.key === "ArrowUp") { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); paintSelection(); }
			else if (e.key === "Enter") { e.preventDefault(); const r = rows[selectedIdx]; if (r) openConv(r.conv); }
			else if (e.key === "Escape") { e.preventDefault(); closeSw(); }
		});

		buildList("");
		setTimeout(() => {
			document.addEventListener("mousedown", onOutside, true);
			this.quickSwitcherCleanup = closeSw;
			input.focus();
		}, 0);
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

	/** In-panel history view (F10): a full-panel overlay listing conversations
	 *  grouped by date, forks indented under their source with fork/favorite
	 *  counts, the active conversation highlighted. */
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

		const addRow = (conv: Conversation, isFork: boolean, q: string): boolean => {
			if (q && !conv.name.toLowerCase().includes(q)) return false;
			const row = listEl.createDiv({ cls: isFork ? "p-history-row fork" : "p-history-row" });
			if (conv.id === this.d.getConversation()?.id) row.addClass("active");
			if (isFork) setIcon(row.createSpan({ cls: "p-switcher-fork-icon" }), "git-branch");
			const main = row.createDiv({ cls: "p-history-main" });
			main.createDiv({ cls: "p-history-row-title", text: conv.name });
			main.appendChild(rowSub(conv, isFork));
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
			return true;
		};

		// Search-mode row: flat (no date bucket, no fork indent), with a snippet of
		// the best-matching message line so the user sees why it surfaced. A fork
		// still shows its branch icon.
		const addSearchRow = (conv: Conversation, queryTokens: string[], isFork: boolean): void => {
			const row = listEl.createDiv({ cls: "p-history-row" });
			if (conv.id === this.d.getConversation()?.id) row.addClass("active");
			if (isFork) setIcon(row.createSpan({ cls: "p-switcher-fork-icon" }), "git-branch");
			const main = row.createDiv({ cls: "p-history-main" });
			main.createDiv({ cls: "p-history-row-title", text: conv.name });
			main.appendChild(rowSub(conv, isFork));
			const snippet = bestMatchSnippet(queryTokens, conv);
			if (snippet) main.createDiv({ cls: "p-history-snippet", text: snippet });
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
		};

		const buildList = (query: string) => {
			listEl.empty();
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
					addSearchRow(conversation, queryTokens, isFork);
				}
				if (!listEl.hasChildNodes()) {
					listEl.createDiv({ cls: "p-nav-empty", text: t("navNoChapters") });
				}
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
				addRow(src, false, "");
				for (const f of forks) addRow(f, true, "");
			}
			if (!listEl.hasChildNodes()) {
				listEl.createDiv({ cls: "p-nav-empty", text: t("navNoChapters") });
			}
		};

		input.addEventListener("input", () => buildList(input.value));
		buildList("");
		setTimeout(() => {
			document.addEventListener("keydown", onKey, true);
			this.historyCleanup = close;
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
