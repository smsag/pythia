import { Menu, Notice, Platform, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { conversationCost, formatCost } from "../models/modelPricing";
import { abbreviateModel } from "../models/knownModels";
import { formatMonthYear } from "../services/messageUtils";
import { DeleteConversationModal } from "../suggest/DeleteConversationModal";
import {
	buildConversationFields,
	searchConversations,
	bestMatchSnippet,
	type ConversationFields,
} from "../services/conversationSearch";
import { noteBasename } from "../services/pathUtils";
import { keyboardOverlap, readKeyboardHeight, watchViewport } from "./keyboardInset";
import { attachLongPress } from "./longPress";
import { attachOutsideDismiss } from "./outsideDismiss";

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
			cancelRelated();
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
		const backBtn = searchRow.createEl("button", { cls: "p-hdr-btn", attr: { title: t("backTooltip") } });
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
			cls: "p-switcher-clear",
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
			if (related) { related = null; renderChip(); }
			buildList("");
			// Only re-focus if the field already had it: tapping ✕ while the keyboard
			// is up should keep it up, but it must not raise one that was down.
			if (document.activeElement === input) input.focus();
		});

		// Related-conversations mode (ADR-109): a source conversation's semantic
		// neighbours, behind a dismissible chip. null = normal browse/search.
		const chipEl = overlay.createDiv({ cls: "p-history-chip-wrap" });
		let related: { sourceId: string; sourceName: string; results: { id: string; score: number }[]; loading: boolean } | null = null;
		// Aborts the in-flight related query. Cancelling matters because the query
		// syncs the index first, and a cold build is minutes of embedding — on the
		// iframe fallback, minutes of UI thread. Leaving related mode, typing, or
		// closing the panel must stop paying for a result nobody will see.
		let relatedRun: AbortController | null = null;
		const cancelRelated = (): void => {
			relatedRun?.abort();
			relatedRun = null;
		};

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

		// Auto-widening into the note dimension (ADR-168) is something the user did
		// not ask for, so it is never silent: a chip, a group header, a `via …` line
		// on every widened row — and on a phone, where the chip is easiest to miss,
		// one Notice per panel open.
		let widenActive = false;
		let widenAnnounced = false;
		const announceWiden = (): void => {
			if (!Platform.isMobile || widenAnnounced) return;
			widenAnnounced = true;
			new Notice(t("widenedNotice"));
		};

		// Keyboard selection over the rendered conversation rows (group headers are
		// not selectable). Rebuilt on every buildList; ↑/↓ move, Enter opens.
		let rows: { conv: Conversation; el: HTMLElement }[] = [];
		let selectedIdx = 0;
		const paintSelection = () => {
			rows.forEach((r, i) => r.el.toggleClass("selected", i === selectedIdx));
			rows[selectedIdx]?.el.scrollIntoView({ block: "nearest" });
		};

		// ── Related mode (ADR-109) ────────────────────────────────────
		const makeChip = (label: string, tooltip: string, onClear: () => void): void => {
			const chip = chipEl.createDiv({ cls: "p-history-chip" });
			chip.createSpan({ cls: "p-history-chip-label", text: label });
			const clear = chip.createSpan({ cls: "p-history-chip-clear", attr: { title: tooltip } });
			setIcon(clear, "x");
			clear.addEventListener("click", () => onClear());
		};

		const renderChip = () => {
			chipEl.empty();
			if (related) {
				makeChip(t("relatedChip", { name: related.sourceName }), t("relatedClearTooltip"), () => exitRelated());
				return;
			}
			// Undoing an automatic widening writes the scope into the box rather than
			// flipping a hidden flag: the grammar is the control, so the ✕ is also
			// where the user learns it exists.
			if (widenActive) {
				makeChip(t("widenedChip"), t("widenedClearTooltip"), () => {
					input.value = `conv: ${input.value.trim()}`;
					syncClear();
					buildList(input.value);
				});
			}
		};

		const renderRelated = () => {
			listEl.empty();
			rows = [];
			selectedIdx = 0;
			renderChip();
			if (!related) return;
			if (related.loading) {
				listEl.createDiv({ cls: "p-nav-empty", text: t("relatedLoading") });
				return;
			}
			const byId = new Map(this.d.plugin.conversations.map((c) => [c.id, c]));
			let shown = 0;
			for (const r of related.results) {
				const conv = byId.get(r.id);
				if (!conv) continue; // deleted since the query ran
				const isFork = !!conv.forkedFromId && byId.has(conv.forkedFromId);
				makeRow(conv, isFork, false);
				shown++;
			}
			if (shown === 0) listEl.createDiv({ cls: "p-nav-empty", text: t("relatedEmpty") });
			paintSelection();
		};

		const enterRelated = async (conv: Conversation) => {
			if (!this.d.getRelated) return;
			cancelRelated();
			const run = new AbortController();
			relatedRun = run;
			related = { sourceId: conv.id, sourceName: conv.name, results: [], loading: true };
			renderRelated();
			try {
				const results = await this.d.getRelated(conv.id, run.signal);
				if (related?.sourceId === conv.id) {
					related.results = results;
					related.loading = false;
					renderRelated();
				}
			} catch (e) {
				// An abort is this panel's own doing — the user left, and there is
				// nothing to report. Anything else is a real failure and says so.
				if (run.signal.aborted) return;
				new Notice(t("relatedFailed", { error: e instanceof Error ? e.message : String(e) }));
				related = null;
				renderChip();
				buildList(input.value);
			} finally {
				if (relatedRun === run) relatedRun = null;
			}
		};

		const exitRelated = () => {
			cancelRelated();
			related = null;
			renderChip();
			buildList(input.value);
		};

		/** Re-render whichever mode is active (used after a row delete). */
		const refreshList = () => (related ? renderRelated() : buildList(input.value));

		// Long-press menu (touch): the hover-only row actions aren't reachable without
		// a pointer, so a long-press offers the same ones — show similar + delete
		// (delete omitted for the active conversation, matching the desktop row).
		const showRowMenu = (conv: Conversation, x: number, y: number) => {
			const menu = new Menu();
			let items = 0;
			if (this.d.getRelated) {
				menu.addItem((item) => item.setTitle(t("relatedTooltip")).setIcon("git-compare").onClick(() => void enterRelated(conv)));
				items++;
			}
			if (conv.id !== this.d.getConversation()?.id) {
				menu.addItem((item) => item.setTitle(t("deleteConvTooltip")).setIcon("trash").onClick(() => this.deleteConversationWithConfirm(conv, () => refreshList())));
				items++;
			}
			if (items > 0) menu.showAtPosition({ x, y });
		};

		// Fork counts once per build, not one filter over every conversation per row.
		let forkCounts = new Map<string, number>();
		const countForks = (): void => {
			forkCounts = new Map();
			for (const c of this.d.plugin.conversations) {
				if (c.forkedFromId) forkCounts.set(c.forkedFromId, (forkCounts.get(c.forkedFromId) ?? 0) + 1);
			}
		};

		const rowSub = (conv: Conversation, isFork: boolean, viaNotes?: string[]): HTMLElement => {
			const sub = createDiv({ cls: "p-history-sub" });
			if (isFork) {
				sub.appendText(`${t("branchLabel")} · ${t("msgCountShort", { n: String(conv.messages.length) })}`);
			} else {
				sub.appendText(`${abbreviateModel(conv.model)} · ${t("msgCountShort", { n: String(conv.messages.length) })}`);
				const forkCount = forkCounts.get(conv.id) ?? 0;
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
			// Why this row is here (ADR-168): the query was found in a note the
			// conversation attached or cited, not in anything visible on the row. A
			// bare vault name, no brackets, as in the sources row (ADR-153).
			if (viaNotes?.length) {
				const extra = viaNotes.length > 1 ? ` +${viaNotes.length - 1}` : "";
				sub.createSpan({
					cls: "p-history-via",
					text: ` · ${t("viaNote", { name: noteBasename(viaNotes[0]) })}${extra}`,
				});
			}
			return sub;
		};

		// Shared row body for browse and search rows. `snippetTokens` (search mode)
		// appends the best-matching message line; browse rows keep the fork indent.
		const makeRow = (
			conv: Conversation,
			isFork: boolean,
			indentFork: boolean,
			snippetTokens?: string[],
			viaNotes?: string[]
		): void => {
			if (!selectable(conv)) return;
			const row = listEl.createDiv({ cls: indentFork ? "p-history-row fork" : "p-history-row" });
			if (conv.id === this.d.getConversation()?.id) row.addClass("active");
			if (isFork) setIcon(row.createSpan({ cls: "p-switcher-fork-icon" }), "git-branch");
			const main = row.createDiv({ cls: "p-history-main" });
			main.createDiv({ cls: "p-history-row-title", text: conv.name });
			main.appendChild(rowSub(conv, isFork, viaNotes));
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
				relate.addEventListener("click", (e) => { e.stopPropagation(); void enterRelated(conv); });
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
			countForks();

			// Active query → flat list ranked by content relevance (TF-IDF over
			// title + summary + messages, and over attached/cited note names when
			// the scope asks for it), best match first, with match snippets. The
			// date-grouped/fork-indented layout resumes when the box is empty — and
			// a bare scope prefix ("note:") counts as empty until something is typed
			// after it.
			const outcome = q ? searchConversations(query, all, all.map(fieldsFor), { picking: !!pick }) : null;
			widenActive = (outcome?.widened.length ?? 0) > 0;
			if (outcome && outcome.queryTokens.length > 0) {
				renderChip();
				const addRow = (r: { conversation: Conversation; matchedNotes: string[] }) => {
					const isFork = !!r.conversation.forkedFromId && byId.has(r.conversation.forkedFromId);
					makeRow(r.conversation, isFork, false, outcome.queryTokens, r.matchedNotes);
				};
				for (const r of outcome.primary) addRow(r);
				if (outcome.widened.length > 0) {
					listEl.createDiv({ cls: "p-history-group", text: t("histNotesGroup") });
					for (const r of outcome.widened) addRow(r);
					announceWiden();
				}
				if (!listEl.hasChildNodes()) {
					listEl.createDiv({ cls: "p-nav-empty", text: t("navNoChapters") });
				}
				paintSelection();
				return;
			}
			renderChip();

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

		// Rebuild a beat after the last keystroke, not on every one: with a large
		// corpus each build re-scores every conversation and repaints the list.
		let inputTimer: ReturnType<typeof setTimeout> | null = null;
		input.addEventListener("input", () => {
			if (related) { cancelRelated(); related = null; renderChip(); } // typing exits related mode
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
