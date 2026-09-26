import { Menu, Notice, Platform, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { conversationCost, formatCost } from "../models/modelPricing";
import { abbreviateModel } from "../models/knownModels";
import { formatMonthYear } from "../services/messageUtils";
import { DeleteConversationModal } from "../suggest/DeleteConversationModal";
import { archiveFolderOf } from "../services/conversationArchive";
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
import { keyboardOverlap, readKeyboardHeight, watchViewport } from "./keyboardInset";
import { attachLongPress } from "./longPress";
import { attachOutsideDismiss } from "./outsideDismiss";
import { RelatedMode } from "./RelatedMode";

/**
 * Conversation rows drawn per page of the browse listing (ADR-174). A source
 * and its forks are always drawn together, so a page can overshoot slightly.
 *
 * 50, not 20: the page has to fill a desktop panel or the control appears
 * before the user has scrolled, and each row is ~8 nodes and three listeners —
 * the cost is the corpus behind it, not the page.
 */
const BROWSE_PAGE_ROWS = 50;

/** Newest first, tolerating a missing or malformed `updatedAt`. */
const byUpdatedAtDesc = (a: Conversation, b: Conversation): number =>
	(b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

/**
 * Using the history panel to choose a conversation rather than switch to one
 * (ADR-143). The destructive row controls are hidden while picking, and
 * `excludeId` drops the conversation the choice is being made from.
 */
export interface HistoryPick {
	excludeId?: string;
	placeholder?: string;
	onPick(conv: Conversation): void;
}

export interface HistoryDeps {
	plugin: PythiaPlugin;
	/** The view's content pane (`containerEl.children[1]`) — the overlay mounts here. */
	getContainer(): HTMLElement;
	getConversation(): Conversation | null;
	isStreaming(): boolean;
	setActiveConversation(conv: Conversation): Promise<void>;
	renderHeader(): void;
	/** Semantically related conversations for a source (ADR-109). When absent, the
	 *  relate affordance is not shown. `signal` aborts a cold index build the user
	 *  has walked away from (ADR-169). */
	getRelated?(sourceId: string, signal?: AbortSignal): Promise<{ id: string; score: number }[]>;
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
		const remove = async (): Promise<void> => {
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
		};
		new DeleteConversationModal(this.d.plugin.app, conv, {
			onDelete: () => void remove(),
			// The note first: a failed write leaves the conversation where it is,
			// and `archiveConversation` has already said why (ADR-173).
			onArchive: () => void (async () => {
				if (await this.d.plugin.archiveConversation(conv)) await remove();
			})(),
			archiveFolder: archiveFolderOf(this.d.plugin.settings),
		}).open();
	}

	/** Uppercase mono date-group label for the history view (HEUTE / GESTERN /
	 *  DIESE WOCHE / "SEP 2026"). */
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
		return formatMonthYear(iso);
	}

	/** The full-panel conversation overlay: a browse-by-date listing that doubles
	 *  as content search. Opened from the header loupe with the search input
	 *  focused. Empty query → conversations grouped by date, forks indented under
	 *  their source; a query → a flat relevance-ranked list with match snippets.
	 *  ↑/↓ move the selection, Enter opens it, Esc closes.
	 *
	 *  With `pick`, the same panel is used to CHOOSE a conversation instead of
	 *  switching to one (ADR-143). Anything that needs the user to name a
	 *  conversation — linking a passage, today; anything else, tomorrow — reuses
	 *  this surface rather than growing a second search. ADR-107 made this the
	 *  single in-view conversation search, and a picker is still a search. */
	openHistoryView(pick?: HistoryPick): void {
		// Toggle when reopening the same thing; when a picker is requested while the
		// browse panel is open, replace it rather than closing and doing nothing.
		if (this.historyCleanup) {
			this.historyCleanup();
			if (!pick) return;
		}
		const container = this.d.getContainer();
		const overlay = container.createDiv({ cls: "p-history" });

		const close = () => {
			// Forward reference, like `detachEscape` and `detachKeyboardInset` below:
			// close is defined early so the Escape binding and `historyCleanup` can
			// be registered synchronously, and nothing invokes it before the
			// constructors further down have run.
			related.cancel();
			overlay.remove();
			detachEscape();
			detachKeyboardInset();
			this.historyCleanup = null;
		};
		// Escape is bound a tick late so the keypress that opened the panel — if
		// it was a keypress — cannot immediately close it again; the helper drops
		// the registration if the panel is closed before that tick.
		const detachEscape = attachOutsideDismiss(() => true, close, { escape: true, pointer: false });
		// Registered synchronously, not in the focus timeout below: until this is
		// set, the panel is open but the controller does not know it, so a second
		// open in the same tick stacked a second overlay instead of toggling.
		this.historyCleanup = close;
		const openConv = (conv: Conversation) => {
			close();
			if (pick) pick.onPick(conv);
			else void this.d.setActiveConversation(conv);
		};
		/** In pick mode the passage's own conversation is not a valid target. */
		const selectable = (conv: Conversation) => !pick || conv.id !== pick.excludeId;

		// ── Search row (no separate header): back · loupe · input ────
		const searchRow = overlay.createDiv({ cls: "p-switcher-search" });
		const backBtn = searchRow.createEl("button", { cls: "pb pb-icon p-hdr-btn", attr: { title: t("backTooltip") } });
		setIcon(backBtn, "arrow-left");
		backBtn.addEventListener("click", () => close());
		setIcon(searchRow.createSpan({ cls: "p-switcher-search-icon" }), "search");
		const input = searchRow.createEl("input", {
			cls: "p-switcher-input",
			attr: { type: "text", placeholder: pick?.placeholder ?? t("switcherSearchPlaceholder") },
		});

		// Clear (✕), shown only while there is something to clear.
		//
		// An explicit control rather than `type="search"`: WebKit's native clear
		// button is the one this panel used to get for free, and `.pythia-view input
		// { -webkit-appearance: none }` (ADR-108's reset, which stops Obsidian's
		// form-field fill from greying our inline inputs) removes it. A native one
		// would also be WebKit-only and unstyleable, so the reset is not worth
		// unpicking — the control belongs to us.
		const clearBtn = searchRow.createEl("button", {
			cls: "pb pb-icon p-switcher-clear",
			attr: { "aria-label": t("switcherClear"), title: t("switcherClear") },
		});
		setIcon(clearBtn, "x");
		const syncClear = (): void => { clearBtn.hidden = input.value.length === 0; };
		syncClear();
		// mousedown, not click, to preventDefault: a button steals focus from the
		// input otherwise, which on a phone closes the keyboard the user is still
		// typing on. The clear then happens on click as usual.
		clearBtn.addEventListener("mousedown", (e) => e.preventDefault());
		clearBtn.addEventListener("click", () => {
			input.value = "";
			syncClear();
			if (related.isActive()) { related.clear(); renderChip(); }
			buildList("");
			// Only re-focus if the field already had it: tapping ✕ while the keyboard
			// is up should keep it up, but it must not raise one that was down.
			if (document.activeElement === input) input.focus();
		});

		// Related-conversations mode (ADR-109) lives in `ui/RelatedMode.ts`; it is
		// wired up after the list element exists, below.
		const chipEl = overlay.createDiv({ cls: "p-history-chip-wrap" });

		const listEl = overlay.createDiv({ cls: "p-history-list" });

		// The soft keyboard OVERLAYS the webview rather than resizing it, so the
		// overlay keeps its full height and its last rows sit underneath. Pad the
		// scroll area by whatever is covered so every conversation can be reached.
		//
		// Uses the shared, unit-tested `keyboardOverlap` rather than the arithmetic
		// this panel used to do itself. That copy had no MIN_KEYBOARD_INSET floor,
		// so it treated Obsidian's own bottom chrome as a keyboard and padded the
		// list at rest — which is the other half of why the last rows were hard to
		// reach (ADR-152).
		const applyKeyboardInset = (): void => {
			if (!overlay.isConnected) return;
			const vv = window.visualViewport;
			if (!vv) return;
			const covered = keyboardOverlap({
				containerBottom: overlay.getBoundingClientRect().bottom,
				layoutHeight: window.innerHeight,
				visualHeight: vv.height,
				visualOffsetTop: vv.offsetTop,
				keyboardHeight: readKeyboardHeight(),
			});
			listEl.style.paddingBottom = covered > 0 ? `${covered + 8}px` : "";
		};
		const detachKeyboardInset = watchViewport(applyKeyboardInset);

		// Searchable fields per conversation, built once and memoized for the life of
		// the panel so each keystroke only re-scores — never re-concatenates the
		// messages, and never re-tokenizes them, which on a 200-conversation vault
		// was the cost that made typing lag.
		const fieldsCache = new Map<string, ConversationFields>();
		const fieldsFor = (conv: Conversation): ConversationFields => {
			let f = fieldsCache.get(conv.id);
			if (f === undefined) {
				f = buildConversationFields(conv);
				fieldsCache.set(conv.id, f);
			}
			return f;
		};

		// Keyboard selection over the rendered conversation rows (group headers are
		// not selectable). Rebuilt on every buildList; ↑/↓ move, Enter opens.
		let rows: { conv: Conversation; el: HTMLElement }[] = [];
		// The pending question to Schreibstube (ADR-223), cancelled by the next build.
		let meaningTimer: ReturnType<typeof setTimeout> | null = null;
		let selectedIdx = 0;
		const paintSelection = () => {
			rows.forEach((r, i) => r.el.toggleClass("selected", i === selectedIdx));
			rows[selectedIdx]?.el.scrollIntoView({ block: "nearest" });
		};

		// ── Chip (ADR-109 related) ─────────────────
		const renderChip = () => {
			chipEl.empty();
			related.renderChip();
		};

		const related = new RelatedMode({
			chipEl,
			listEl,
			getRelated: this.d.getRelated?.bind(this.d),
			conversations: () => this.d.plugin.conversations,
			makeRow: (conv, isFork) => makeRow(conv, isFork, false),
			resetRows: () => { rows = []; selectedIdx = 0; },
			paintSelection: () => paintSelection(),
			renderChip: () => renderChip(),
			showNormalList: () => buildList(input.value),
		});

		/** Re-render whichever mode is active (used after a row delete). */
		const refreshList = () => (related.isActive() ? related.render() : buildList(input.value));

		// Long-press menu (touch): the hover-only row actions aren't reachable without
		// a pointer, so a long-press offers the same ones — show similar + delete
		// (delete omitted for the active conversation, matching the desktop row).
		const showRowMenu = (conv: Conversation, x: number, y: number) => {
			const menu = new Menu();
			let items = 0;
			if (this.d.getRelated) {
				menu.addItem((item) => item.setTitle(t("relatedTooltip")).setIcon("git-compare").onClick(() => void related.enter(conv)));
				items++;
			}
			if (conv.id !== this.d.getConversation()?.id) {
				menu.addItem((item) => item.setTitle(t("deleteConvTooltip")).setIcon("trash").onClick(() => this.deleteConversationWithConfirm(conv, () => refreshList())));
				items++;
			}
			if (items > 0) menu.showAtPosition({ x, y });
		};

		// The forks of every source, indexed once per build (ADR-174). Both readers
		// used to walk the whole corpus per row — `rowSub` for the ⑂ count and the
		// browse listing for the rows themselves — which made drawing the list
		// quadratic in the number of conversations: 28ms of pure filtering at 2,000,
		// 528ms at 5,000. One pass, and the count is the list's length.
		let forksBySource = new Map<string, Conversation[]>();
		const indexForks = (): void => {
			forksBySource = new Map();
			for (const c of this.d.plugin.conversations) {
				if (!c.forkedFromId) continue;
				const siblings = forksBySource.get(c.forkedFromId);
				if (siblings) siblings.push(c);
				else forksBySource.set(c.forkedFromId, [c]);
			}
			for (const siblings of forksBySource.values()) siblings.sort(byUpdatedAtDesc);
		};

		const rowSub = (conv: Conversation, isFork: boolean): HTMLElement => {
			const sub = createDiv({ cls: "p-history-sub" });
			if (isFork) {
				sub.appendText(`${t("branchLabel")} · ${t("msgCountShort", { n: String(conv.messages.length) })}`);
			} else {
				sub.appendText(`${abbreviateModel(conv.model)} · ${t("msgCountShort", { n: String(conv.messages.length) })}`);
				const forkCount = forksBySource.get(conv.id)?.length ?? 0;
				if (forkCount) sub.createSpan({ cls: "p-history-fork-count", text: ` ⑂ ${forkCount}` });
				const favCount = conv.favorites?.length ?? 0;
				if (favCount) sub.createSpan({ cls: "p-history-fav-count", text: ` ★ ${favCount}` });
				// Estimated spend so far (ADR-163). A "+" marks a floor: some answers
				// came from a model with no price row.
				if (this.d.plugin.settings.showCost) {
					const { usd, priced, unpriced } = conversationCost(conv.messages);
					if (priced) sub.createSpan({ cls: "p-history-cost", text: ` · ≈ ${formatCost(usd)}${unpriced ? "+" : ""}` });
				}
			}
			return sub;
		};

		// Shared row body for browse and search rows. `snippetTokens` (search mode)
		// appends the best-matching message line; browse rows keep the fork indent.
		const makeRow = (
			conv: Conversation,
			isFork: boolean,
			indentFork: boolean,
			snippetTokens?: string[]
		): void => {
			if (!selectable(conv)) return;
			const row = listEl.createDiv({ cls: indentFork ? "p-history-row fork" : "p-history-row" });
			if (conv.id === this.d.getConversation()?.id) row.addClass("active");
			if (isFork) setIcon(row.createSpan({ cls: "p-switcher-fork-icon" }), "git-branch");
			const main = row.createDiv({ cls: "p-history-main" });
			main.createDiv({ cls: "p-history-row-title", text: conv.name });
			main.appendChild(rowSub(conv, isFork));
			if (snippetTokens) {
				// fieldsFor is the panel-lifetime memo, so the line tokens behind the
				// snippet are built once per conversation, not once per keystroke.
				const snippet = bestMatchSnippet(snippetTokens, conv, fieldsFor(conv));
				if (snippet) main.createDiv({ cls: "p-history-snippet", text: snippet });
			}
			// Relate affordance (ADR-109): a hover-revealed icon on desktop; a
			// long-press on the row on touch devices. Both open related mode.
			if (this.d.getRelated && !pick) {
				const relate = row.createSpan({ cls: "p-history-relate", attr: { title: t("relatedTooltip") } });
				setIcon(relate, "git-compare");
				relate.addEventListener("click", (e) => { e.stopPropagation(); void related.enter(conv); });
			}
			if (conv.id === this.d.getConversation()?.id) {
				row.createSpan({ cls: "p-history-active", text: t("navActiveTag") });
			} else if (!pick) {
				// No delete control while picking: the panel is being used to name a
				// target, and a trash icon one thumb-width from every row is the wrong
				// thing to offer when the user's intent is "choose this one".
				const del = row.createSpan({ cls: "p-switcher-del", attr: { title: t("deleteConvTooltip") } });
				setIcon(del, "trash");
				del.addEventListener("click", (e) => {
					e.stopPropagation();
					this.deleteConversationWithConfirm(conv, () => refreshList());
				});
			}

			// Long-press on touch → the row's context menu (show similar + delete),
			// since the hover icons aren't reachable without a pointer. The ensuing
			// click is suppressed so the row doesn't also open. The shared gesture
			// (ui/longPress.ts) — touch only, because pointer users have the icons.
			let lpFired = false;
			if (!pick) {
				attachLongPress(row, ({ x, y }) => { lpFired = true; showRowMenu(conv, x, y); }, { delayMs: 500, touchOnly: true });
			}
			row.addEventListener("click", () => { if (lpFired) { lpFired = false; return; } openConv(conv); });
			rows.push({ conv, el: row });
		};

		const buildList = (query: string) => {
			listEl.empty();
			rows = [];
			selectedIdx = 0;
			const q = query.toLowerCase().trim();
			const all = this.d.plugin.conversations;
			const byId = new Map(all.map((c) => [c.id, c]));
			indexForks();

			// Active query → the conversations whose title holds every typed word,
			// best first, with match snippets (ADR-223). When Schreibstube can
			// answer, the conversations it finds by meaning join below them after
			// a pause in typing; the title rows never wait for it. The date-grouped
			// layout resumes when the box is empty.
			if (meaningTimer !== null) { clearTimeout(meaningTimer); meaningTimer = null; }
			const search = q ? searchTitles(query, all) : null;
			if (search && search.queryTokens.length > 0) {
				const addRow = (conv: Conversation) => {
					const isFork = !!conv.forkedFromId && byId.has(conv.forkedFromId);
					makeRow(conv, isFork, false, search.queryTokens);
				};
				for (const conv of search.hits) addRow(conv);
				const empty = listEl.createDiv({ cls: "p-nav-empty", text: t("navNoChapters") });
				empty.hidden = search.hits.length > 0;
				paintSelection();

				const text = meaningQuery(query);
				if (text) {
					meaningTimer = setTimeout(() => {
						meaningTimer = null;
						// Null when Schreibstube is not there to ask (ADR-223).
						const asked = this.d.plugin.searchConversationsByMeaning(text, SEARCH_RESULT_LIMIT);
						if (!asked) return;
						void asked.then((ids) => {
							// The box moved on, or the panel closed: this answer is stale.
							if (!overlay.isConnected || input.value !== query) return;
							const extra = meaningOnly(search.hits, ids, byId).filter(selectable);
							if (extra.length === 0) return;
							empty.hidden = true;
							listEl.createDiv({ cls: "p-history-group", text: t("histMeaningGroup") });
							for (const conv of extra) addRow(conv);
							paintSelection();
						});
					}, MEANING_DEBOUNCE_MS);
				}
				return;
			}
			renderChip();

			const sources = all
				.filter((c) => !c.forkedFromId || !byId.has(c.forkedFromId))
				.sort(byUpdatedAtDesc);

			// Paged (ADR-174). The browse listing is the one surface whose length was
			// the whole corpus — search has capped at SEARCH_RESULT_LIMIT since
			// ADR-170 — so opening the panel built a row, its sub-line and three
			// listeners for every conversation in the vault. A page is drawn; the
			// rest waits behind "show more", which appends rather than rebuilds.
			let nextSource = 0;
			let currentBucket = "";
			let moreEl: HTMLElement | null = null;
			const renderPage = (): void => {
				moreEl?.remove();
				moreEl = null;
				const startedAt = rows.length;
				while (nextSource < sources.length && rows.length - startedAt < BROWSE_PAGE_ROWS) {
					const src = sources[nextSource++];
					const bucket = this.historyBucket(src.updatedAt);
					if (bucket !== currentBucket) {
						currentBucket = bucket;
						listEl.createDiv({ cls: "p-history-group", text: bucket });
					}
					// A source and its forks are drawn together: the indent means
					// nothing once the parent is on the other side of a page break.
					makeRow(src, false, false);
					for (const f of forksBySource.get(src.id) ?? []) makeRow(f, true, true);
				}
				const left = sources.length - nextSource;
				if (left > 0) {
					moreEl = listEl.createDiv({ cls: "p-history-more", text: t("showMoreRows", { count: String(left) }) });
					moreEl.addEventListener("click", () => { renderPage(); paintSelection(); });
				}
			};
			renderPage();

			if (!listEl.hasChildNodes()) {
				listEl.createDiv({ cls: "p-nav-empty", text: t("navNoChapters") });
			}
			paintSelection();
		};

		// Rebuild a beat after the last keystroke, not on every one: with a large
		// corpus each build re-scores every conversation and repaints the list.
		let inputTimer: ReturnType<typeof setTimeout> | null = null;
		input.addEventListener("input", () => {
			if (related.isActive()) { related.clear(); renderChip(); } // typing exits related mode
			syncClear();
			if (inputTimer !== null) clearTimeout(inputTimer);
			inputTimer = setTimeout(() => {
				inputTimer = null;
				if (overlay.isConnected) buildList(input.value);
			}, 60);
		});
		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "ArrowDown") { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, rows.length - 1); paintSelection(); }
			else if (e.key === "ArrowUp") { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); paintSelection(); }
			else if (e.key === "Enter") { e.preventDefault(); const r = rows[selectedIdx]; if (r) openConv(r.conv); }
		});

		buildList("");
		setTimeout(() => {
			if (!overlay.isConnected) return; // closed before the tick
			// Desktop only (ADR-152). Auto-focus is a keyboard affordance: you open
			// the switcher and type. On a phone it raises the on-screen keyboard
			// unbidden, which covers the bottom of the very list the panel exists to
			// show — so the panel opens showing conversations, and the keyboard
			// arrives only when the user taps the field.
			if (!Platform.isMobile) input.focus();
			// The keyboard animates in; `visualViewport` fires resize when it lands,
			// but measure once here too in case it is already up (re-open).
			applyKeyboardInset();
		}, 0);
	}

	/** The header's delete: the active conversation, through the same confirm
	 *  flow the panel rows use (one copy of the after-delete rule). */
	async handleDeleteConversation(): Promise<void> {
		const active = this.d.getConversation();
		if (!active) return;
		this.deleteConversationWithConfirm(active);
	}
}
