import { MarkdownView, Notice } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation, Favorite } from "../models/types";
import { t } from "../i18n";
import { readEntitySelection } from "./entitySelection";
import { resolveMarkTap } from "./markTap";
import { todayISO, withConversationBacklink } from "../utils";
import {
	findRange,
	computeOccurrenceIndex,
	repaintBody,
	flashHighlight,
	clearHighlights,
	removeHighlightById,
	rangeForHighlight,
} from "./HighlightPainter";
import { scrollChatTo } from "./chatScroll";

type DomEventRegistrar = (
	el: HTMLElement | Document | Window,
	type: string,
	callback: (ev: Event) => void,
	options?: boolean | AddEventListenerOptions,
) => void;

export interface SelectionDeps {
	plugin: PythiaPlugin;
	getConversation(): Conversation | null;
	getMessagesEl(): HTMLElement;
	/** Last markdown view the user was in (for "Insert into note"). */
	getLastMarkdownView(): MarkdownView | null;
	/** Expand a collapsed long bubble so a favorite's offset is measurable. */
	expandBubbleIfCollapsed(row: HTMLElement): void;
	/** Open a fork-origin anchor (ForkController) — a fork-origin tap wins over favorites. */
	toggleForkAnchor(forkId: string, markEl: HTMLElement): void;
	/** Open a merge anchor (MergeController) — ranks between fork origins and favorites. */
	toggleMergeAnchor(mergeId: string, markEl: HTMLElement): void;
	/** Open a glossary definition (GlossaryController) — lowest precedence of the marks. */
	toggleTermAnchor(term: string, markEl: HTMLElement): void;
	/** Define the selected term and mark it everywhere (ADR-136). */
	defineTerm(term: string, passage: string): void;
	describePerson(name: string, passage: string): void;
	/** Pin the selected passage to the top of the conversation (ADR-216). */
	pinText(text: string, messageId: string, occurrenceIndex: number | undefined): void;
	/** The view's `registerDomEvent`, so toolbar/selection listeners auto-clean on unload. */
	registerDomEvent: DomEventRegistrar;
}

/**
 * The text-selection toolbar and span-favorites surfaces extracted from
 * `PythiaSidebarView` (ADR-103, engineering-review #120): the floating toolbar
 * (Copy / Favorite / Branch / Merge / Define / Insert / Inbox), favorite highlight create/remove/
 * repaint/scroll, and the tap-a-highlight interaction. `mount()` builds the
 * toolbar and wires the selection listeners; the view calls the public
 * `repaintFavorites` (during message render), `scrollToFavorite`/`removeFavorite`
 * (NavigatorController). Behaviour is identical to the inline methods it replaced.
 */
export class SelectionController {
	private selectionToolbar!: HTMLElement;
	private favBtn!: HTMLButtonElement;
	private forkBtn!: HTMLButtonElement;
	private mergeBtn!: HTMLButtonElement;
	private pinBtn!: HTMLButtonElement;
	private defineBtn!: HTMLButtonElement;
	private personBtn!: HTMLButtonElement;
	private tappedFavId: string | null = null;

	constructor(private readonly d: SelectionDeps) {}

	/** Build the selection toolbar into `container` and wire the selection listeners. */
	mount(container: HTMLElement): void {
		const messagesEl = this.d.getMessagesEl();
		this.selectionToolbar = container.createDiv({ cls: "pythia-sel-toolbar" });
		this.selectionToolbar.style.display = "none";

		let savedSelRange: Range | null = null;
		let selTouchStartX = 0;
		this.d.registerDomEvent(this.selectionToolbar, "touchstart", (e) => {
			const ev = e as TouchEvent;
			const sel = window.getSelection();
			savedSelRange = (sel && sel.rangeCount > 0)
				? sel.getRangeAt(0).cloneRange()
				: null;
			selTouchStartX = ev.touches[0].clientX;
		}, { passive: true });

		const makeSelTouch = (action: () => void) => (e: Event) => {
			const ev = e as TouchEvent;
			if (Math.abs(ev.changedTouches[0].clientX - selTouchStartX) > 12) return;
			ev.preventDefault();
			if (savedSelRange) {
				const sel = window.getSelection();
				if (sel) { sel.removeAllRanges(); sel.addRange(savedSelRange); }
				savedSelRange = null;
			}
			action();
		};

		// One button, one action — mousedown keeps the selection alive on desktop,
		// touchend restores the range saved on touchstart on a phone.
		const addBtn = (label: string, action: () => void): HTMLButtonElement => {
			const btn = this.selectionToolbar.createEl("button", { cls: "pb pb-quiet pythia-sel-btn", text: label, attr: { title: label } });
			this.d.registerDomEvent(btn, "mousedown", (e) => { e.preventDefault(); action(); });
			this.d.registerDomEvent(btn, "touchend", makeSelTouch(action));
			return btn;
		};

		// Toolbar order (left → right): Copy, Favorite/Unfavorite, Branch (Fork),
		// Merge, Pin, Define, Person, Insert into note, Save to inbox. Merge sits next
		// to Branch because the two are inverses of each other (ADR-130).
		addBtn(t("copyBtn"), () => this.onCopySelection());
		this.favBtn = addBtn(t("favoriteBtn"), () => void this.onFavoriteSelection());
		this.forkBtn = addBtn(t("forkBtn"), () => this.onForkConversation());
		this.mergeBtn = addBtn(t("mergeBtn"), () => this.onMergeConversation());
		this.pinBtn = addBtn(t("pinBtn"), () => this.onPinSelection());
		this.defineBtn = addBtn(t("defineBtn"), () => this.onEntityAction("term"));
		this.personBtn = addBtn(t("personBtn"), () => this.onEntityAction("person"));
		addBtn(t("insertBtn"), () => this.onInsertIntoNote());
		addBtn(t("inboxBtn"), () => void this.onSaveToInbox());

		let selDebounce: ReturnType<typeof setTimeout> | null = null;
		const onSelectionChange = () => {
			if (selDebounce !== null) clearTimeout(selDebounce);
			selDebounce = setTimeout(() => {
				selDebounce = null;
				this.handleSelectionChange();
			}, 150);
		};
		this.d.registerDomEvent(document, "selectionchange", onSelectionChange);
		this.d.registerDomEvent(messagesEl, "mouseup", () =>
			setTimeout(() => this.handleSelectionChange(), 10)
		);
		this.d.registerDomEvent(messagesEl, "touchend", () =>
			setTimeout(() => this.handleSelectionChange(), 300)
		);
		// Tapping a highlight (no drag) selects its whole span and surfaces the
		// toolbar with the favorite button acting as "Unfavorite".
		this.d.registerDomEvent(messagesEl, "click", (e) =>
			this.onMessageClick(e as MouseEvent)
		);
	}

	private favoriteLabel(text: string): string {
		const clean = text.replace(/\s+/g, " ").trim();
		const words = clean.split(" ").slice(0, 6).join(" ");
		const label = words.length > 40 ? words.slice(0, 40).trimEnd() + "…" : words;
		return label || clean.slice(0, 40);
	}

	/** Re-apply every stored highlight for `messageId` onto its rendered body. */
	repaintFavorites(body: HTMLElement, messageId: string): void {
		const favs = this.d.getConversation()?.favorites?.filter(
			(f) => f.messageId === messageId
		);
		if (!favs || favs.length === 0) {
			// No favorites left for this message — strip any stale marks.
			clearHighlights(body);
			return;
		}
		repaintBody(body, favs);
	}

	/**
	 * Tap (no drag) inside a highlight → select its whole span and open the toolbar
	 * with the favorite button acting as "Unfavorite". A dragged selection is left
	 * alone here so it flows through the normal add path.
	 * A fork-origin mark takes precedence over a favorite (the fork wins).
	 */
	private onMessageClick(e: MouseEvent): void {
		const sel = window.getSelection();
		// Only react to a plain tap — a drag leaves a non-collapsed selection.
		// A fresh drag also invalidates any prior tapped-favorite context: e.g. the
		// user taps a favorite (which selects its whole span and flips the toolbar
		// button to "Unfavorite"), then drags a smaller sub-selection to fork or
		// re-favorite. Clear tappedFavId so the toolbar acts on the NEW selection —
		// otherwise the button stays "Unfavorite" and would remove the tapped favorite
		// instead of favoriting the fresh selection.
		if (sel && sel.rangeCount > 0 && !sel.isCollapsed) { this.tappedFavId = null; return; }
		const target = e.target instanceof Element ? e.target : null;

		// Innermost mark wins where they nest (ADR-157) — see ui/markTap.ts.
		const tapped = resolveMarkTap(target);
		if (tapped) {
			if (tapped.kind === "fork") this.d.toggleForkAnchor(tapped.id, tapped.el);
			else if (tapped.kind === "merge") this.d.toggleMergeAnchor(tapped.id, tapped.el);
			else this.d.toggleTermAnchor(tapped.term, tapped.el);
			return;
		}

		this.tappedFavId = null;
		const mark = target?.closest(".p-highlight");
		const favId = mark?.getAttribute("data-fav-id");
		if (!favId) return;

		const row = mark?.closest("[data-msg-id]") as HTMLElement | null;
		const body = row?.querySelector<HTMLElement>(".p-ai-body, .p-bubble") ?? row;
		if (!body) return;
		const range = rangeForHighlight(body, favId);
		if (!range || !sel) return;

		this.tappedFavId = favId;
		sel.removeAllRanges();
		sel.addRange(range);
		this.handleSelectionChange();
	}

	/**
	 * Favorite the current text selection as a highlighted span, or unfavorite the
	 * tapped highlight when `tappedFavId` is set. Selections must stay within a
	 * single message; cross-message selections are rejected.
	 */
	private async onFavoriteSelection(): Promise<void> {
		const conv = this.d.getConversation();
		const sel = window.getSelection();
		const text = sel?.toString().trim() ?? "";

		// Tapped an existing highlight → remove exactly that one.
		if (this.tappedFavId) {
			const id = this.tappedFavId;
			this.tappedFavId = null;
			this.selectionToolbar.style.display = "none";
			window.getSelection()?.removeAllRanges();
			await this.removeFavorite(id);
			return;
		}

		if (!conv || !sel || sel.rangeCount === 0 || !text) return;

		// Resolve the single owning message. Reject selections that span messages.
		const startEl = sel.anchorNode instanceof Element
			? sel.anchorNode
			: sel.anchorNode?.parentElement;
		const endEl = sel.focusNode instanceof Element
			? sel.focusNode
			: sel.focusNode?.parentElement;
		const startMsg = startEl?.closest("[data-msg-id]");
		const endMsg = endEl?.closest("[data-msg-id]");
		if (!startMsg || startMsg !== endMsg) {
			this.selectionToolbar.style.display = "none";
			new Notice(t("favoriteSpanSingleMessage"));
			return;
		}
		const messageId = startMsg.getAttribute("data-msg-id");
		if (!messageId) return;

		// Favorites apply to assistant content only. The toolbar already hides the
		// button over a user bubble; guard here too so it's never possible.
		if (startMsg.classList.contains("p-msg-user")) {
			this.selectionToolbar.style.display = "none";
			window.getSelection()?.removeAllRanges();
			return;
		}

		// Compute the occurrence index within the message body so re-find later
		// paints the same span when the text appears more than once.
		const body = startMsg.querySelector<HTMLElement>(".p-ai-body, .p-bubble")
			?? (startMsg as HTMLElement);
		const range = sel.getRangeAt(0);
		const occurrenceIndex = computeOccurrenceIndex(body, range);

		const fav: Favorite = {
			id: crypto.randomUUID(),
			messageId,
			name: this.favoriteLabel(text),
			text,
			occurrenceIndex,
			createdAt: todayISO(),
		};
		if (!conv.favorites) conv.favorites = [];
		conv.favorites.push(fav);
		await this.d.plugin.conversationStore.save(conv);

		this.selectionToolbar.style.display = "none";
		window.getSelection()?.removeAllRanges();
		// Repaint the whole message body so the new mark is applied cleanly.
		this.repaintFavorites(body, messageId);
	}

	/** Remove a favorite by its id and strip its highlight from the DOM. */
	async removeFavorite(favId: string): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv) return;
		const fav = conv.favorites?.find((f) => f.id === favId);
		conv.favorites = (conv.favorites ?? []).filter((f) => f.id !== favId);
		await this.d.plugin.conversationStore.save(conv);
		// Surgically unwrap only this favorite's marks so other highlights in the
		// same message are never affected (no clear-all-then-repaint).
		if (fav) {
			const row = this.d.getMessagesEl().querySelector(
				`[data-msg-id="${fav.messageId}"]`
			) as HTMLElement | null;
			const body = row?.querySelector<HTMLElement>(".p-ai-body, .p-bubble") ?? row;
			if (body) removeHighlightById(body, favId);
		}
	}

	/**
	 * Jump to a favorite. Prefers the painted highlight mark (scrolls its start to
	 * the top), re-finds the text if the mark is missing, and falls back to the
	 * message top for legacy favorites or text that can no longer be located.
	 */
	scrollToFavorite(fav: Favorite): void {
		const messagesEl = this.d.getMessagesEl();
		const row = messagesEl.querySelector(
			`[data-msg-id="${fav.messageId}"]`
		) as HTMLElement | null;
		if (!row) return;

		// Expand a collapsed long bubble first so the highlight mark is laid out and
		// its offset is measurable. Reading offsetTop below forces synchronous layout,
		// so no requestAnimationFrame is needed — mirrors scrollToMessage (Chapters),
		// which navigates correctly on the first tap.
		this.d.expandBubbleIfCollapsed(row);

		const scrollToOffsetTop = (top: number) => scrollChatTo(messagesEl, top);

		// 1) Painted mark — the common case.
		const mark = row.querySelector<HTMLElement>(
			`.p-highlight[data-fav-id="${fav.id}"]`
		);
		if (mark) {
			scrollToOffsetTop(mark.offsetTop - messagesEl.offsetTop);
			flashHighlight(fav.id, row);
			return;
		}

		// 2) Re-find the text (e.g. legacy favorite, or mark not painted).
		if (fav.text) {
			const body = row.querySelector<HTMLElement>(".p-ai-body, .p-bubble") ?? row;
			const range = findRange(body, fav.text, fav.occurrenceIndex ?? 0);
			if (range) {
				const rect = range.getBoundingClientRect();
				const containerRect = messagesEl.getBoundingClientRect();
				const top = messagesEl.scrollTop + (rect.top - containerRect.top);
				scrollToOffsetTop(top);
				return;
			}
		}

		// 3) Legacy / not-found — scroll to the message top.
		scrollToOffsetTop(row.offsetTop - messagesEl.offsetTop);
	}

	private handleSelectionChange(): void {
		const sel = window.getSelection();
		const text = sel?.toString().trim() ?? "";

		if (!text || !sel || sel.rangeCount === 0) {
			this.selectionToolbar.style.display = "none";
			this.tappedFavId = null;
			this.setFavButtonMode(false);
			return;
		}

		const range = sel.getRangeAt(0);
		if (!this.d.getMessagesEl().contains(range.commonAncestorContainer)) {
			this.selectionToolbar.style.display = "none";
			this.tappedFavId = null;
			this.setFavButtonMode(false);
			return;
		}

		// Favorite and Fork apply to assistant content only, and only to a span that
		// lives entirely inside ONE assistant message — the same constraint
		// onFavoriteSelection / onForkConversation enforce. Resolve the owning
		// assistant message from each selection endpoint (anchor + focus) rather than
		// the range's commonAncestorContainer: when a drag overshoots a bubble's text
		// the common ancestor bubbles up to `.p-chat`, whose `.closest(".p-msg-user")`
		// is null, which previously re-showed both buttons over a user prompt. Show
		// them only when both endpoints resolve to the same `.p-msg-ai`; hide otherwise
		// (selection in a user bubble, or crossing a message boundary). Copy / Insert /
		// Inbox stay available for any selection.
		const ownerAiMsg = (node: Node | null | undefined): Element | null => {
			const el = node instanceof Element ? node : node?.parentElement;
			return el?.closest(".p-msg-ai") ?? null;
		};
		const startAi = ownerAiMsg(sel.anchorNode);
		const inSingleAssistant = startAi !== null && startAi === ownerAiMsg(sel.focusNode);
		this.favBtn.style.display = inSingleAssistant ? "" : "none";
		this.forkBtn.style.display = inSingleAssistant ? "" : "none";
		this.mergeBtn.style.display = inSingleAssistant ? "" : "none";
		this.pinBtn.style.display = inSingleAssistant ? "" : "none";
		this.defineBtn.style.display = inSingleAssistant ? "" : "none";
		// Person follows the same rule as Define; it was the one button that stayed
		// visible over a user bubble, where its handler then silently declined.
		this.personBtn.style.display = inSingleAssistant ? "" : "none";

		// Tapped-highlight selection → the button unfavorites; otherwise it favorites.
		this.setFavButtonMode(this.tappedFavId !== null);
		this.selectionToolbar.style.display = "flex";
	}

	/** Relabel the toolbar's favorite button between "Favorite" and "Unfavorite". */
	private setFavButtonMode(unfavorite: boolean): void {
		if (!this.favBtn) return;
		const label = unfavorite ? t("unfavoriteBtn") : t("favoriteBtn");
		this.favBtn.setText(label);
		this.favBtn.title = label;
	}

	private onCopySelection(): void {
		const text = window.getSelection()?.toString() ?? "";
		if (!text) return;
		navigator.clipboard.writeText(text).then(() => {
			new Notice(t("copied"));
			this.selectionToolbar.style.display = "none";
		}).catch(() => {
			new Notice(t("copyFailed"));
		});
	}

	private onInsertIntoNote(): void {
		const text = window.getSelection()?.toString() ?? "";
		if (!text) return;
		// The remembered view may belong to a leaf the user has since closed; its
		// editor is detached and `replaceSelection` would throw or write nowhere.
		const remembered = this.d.getLastMarkdownView();
		const stillOpen = remembered && this.d.plugin.app.workspace
			.getLeavesOfType("markdown").some((leaf) => leaf.view === remembered);
		const view = (stillOpen ? remembered : null)
			?? this.d.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice(t("noActiveNoteToInsert"));
			return;
		}
		const insertion = withConversationBacklink(text, this.d.getConversation(), this.d.plugin.app.vault.getName());
		view.editor.replaceSelection(insertion);
		this.selectionToolbar.style.display = "none";
		new Notice(t("insertedIntoNote"));
	}

	private onForkConversation(): void {
		const conv = this.d.getConversation();
		if (!conv) return;
		const picked = this.readAssistantSelection();
		if (!picked) return;
		this.dismiss();
		void this.d.plugin.cmdForkConversation(conv.id, picked.text, picked.messageId, picked.occurrenceIndex);
	}

	/**
	 * The selection as Fork, Merge and Pin need it: the text TRIMMED — `toString()`
	 * can carry whitespace or a block-boundary newline the body's text nodes never
	 * contain, and an untrimmed span can never be re-found (ADR-096) — the message
	 * it sits in, and which occurrence of the text it is there. Null, with the
	 * toolbar dismissed, for a selection in a user bubble: these act on answers.
	 */
	private readAssistantSelection(): { text: string; messageId?: string; occurrenceIndex?: number } | null {
		const sel = window.getSelection();
		const text = (sel?.toString() ?? "").trim();
		const anchor = sel?.anchorNode;
		const msgEl = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest("[data-msg-id]");
		if (msgEl?.classList.contains("p-msg-user")) { this.dismiss(); return null; }
		let occurrenceIndex: number | undefined;
		if (msgEl && sel && sel.rangeCount > 0) {
			const body = msgEl.querySelector<HTMLElement>(".p-ai-body, .p-bubble") ?? (msgEl as HTMLElement);
			occurrenceIndex = computeOccurrenceIndex(body, sel.getRangeAt(0));
		}
		return { text, messageId: msgEl?.getAttribute("data-msg-id") ?? undefined, occurrenceIndex };
	}

	private dismiss(): void {
		this.selectionToolbar.style.display = "none";
		window.getSelection()?.removeAllRanges();
	}

	/** Pin the passage (ADR-216). A streaming answer has no message id until it
	 *  commits — say so rather than pin something that cannot be jumped back to. */
	private onPinSelection(): void {
		const picked = this.readAssistantSelection();
		if (!picked?.text) return;
		if (!picked.messageId) { new Notice(t("pinNotYet")); return; }
		this.dismiss();
		this.d.pinText(picked.text, picked.messageId, picked.occurrenceIndex);
	}

	/**
	 * Merge the selected passage with an existing conversation (ADR-130) — the
	 * inverse of Fork. Same assistant-only, single-message, trimmed-selection
	 * constraints as `onForkConversation`; the conversation search and the link
	 * itself are handled by `cmdMergeConversation`.
	 */
	private onMergeConversation(): void {
		const conv = this.d.getConversation();
		const picked = conv ? this.readAssistantSelection() : null;
		if (!conv || !picked?.text) return;
		if (!picked.messageId) { this.dismiss(); return; }
		this.dismiss();
		void this.d.plugin.cmdMergeConversation(conv.id, picked.text, picked.messageId, picked.occurrenceIndex);
	}

	/**
	 * Define the selected term (ADR-136) or describe the selected person
	 * (ADR-151). One handler: the two differ only in the word cap, the rejection
	 * message and which resolver they hand the span to.
	 *
	 * The person cap is looser by one word, and only because of titles and
	 * multi-part surnames ("van der Berg").
	 */
	private onEntityAction(kind: "term" | "person"): void {
		const result = readEntitySelection(kind === "person" ? 6 : 5);
		this.selectionToolbar.style.display = "none";
		window.getSelection()?.removeAllRanges();
		if (!result.ok) {
			if (result.reason === "too-long") new Notice(kind === "person" ? t("personNoName") : t("glossaryNoTerm"));
			return;
		}
		const { text, passage } = result.selection;
		if (kind === "person") this.d.describePerson(text, passage);
		else this.d.defineTerm(text, passage);
	}

	private async onSaveToInbox(): Promise<void> {
		const text = window.getSelection()?.toString() ?? "";
		if (!text) return;
		const inboxPath = this.d.plugin.settings.inboxNote || "Pythia/Inbox.md";
		const entry = withConversationBacklink(text, this.d.getConversation(), this.d.plugin.app.vault.getName());
		try {
			await this.d.plugin.noteWriter.prependToInbox(entry, inboxPath);
			this.selectionToolbar.style.display = "none";
			new Notice(t("savedToInbox"));
		} catch (e) {
			new Notice(t("failedSaveToInbox", { error: e instanceof Error ? e.message : String(e) }));
		}
	}
}
