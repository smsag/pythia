import {
	App,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	setIcon,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import { todayISO } from "./utils";
import { estimateTokensFromBytes, estimateTokensFromText, formatClockTime, debugLog } from "./services/messageUtils";
import { buildSystemPrompt } from "./services/ContextBuilder";
import { parseRgb, readableOnAccent, type Rgb } from "./services/color";
import { parseCitations, eachCitationSegment, stripForeignCitations, appendWebSources } from "./services/citations";
import { parseWebSourcesFromResult } from "./services/WebSearchService";
import { t } from "./i18n";
import { InlineSuggest } from "./ui/InlineSuggest";
import { OptimizationController } from "./ui/OptimizationController";
import { NavigatorController } from "./ui/NavigatorController";
import { decorateCodeBlocks } from "./ui/CodeBlockDecorator";
import {
	findRange,
	computeOccurrenceIndex,
	repaintBody,
	flashHighlight,
	clearHighlights,
	removeHighlightById,
	rangeForHighlight,
	repaintForkOrigins,
} from "./ui/HighlightPainter";
import type { Conversation, Favorite, Message, MessageSource, ToolCall, TokenUsage } from "./models/types";
import type PythiaPlugin from "./main";
import { NoteSuggestModal } from "./suggest/NoteSuggest";
import { InputModal } from "./suggest/InputModal";
import { ConversationSettingsModal } from "./suggest/ConversationSettingsModal";
import { buildStreamErrorMessage } from "./services/apiError";
import { ToolHandler } from "./services/ToolHandler";
import { DeleteConversationModal } from "./suggest/DeleteConversationModal";
import { DeleteFileModal } from "./suggest/DeleteFileModal";
import { TemplateSuggestModal } from "./suggest/TemplateSuggest";
import { MODEL_ABBREVIATIONS, isReasoningModel, isMistralReasoningModel, getContextWindow, MODEL_CATALOG } from "./models/knownModels";
import type { ModelInfo } from "./models/knownModels";
import { DEFAULT_MAX_TOKENS_REASONING } from "./services/promptConstants";

export const PYTHIA_VIEW_TYPE = "pythia";

function formatSummaryTimestamp(iso: string): string {
	const d = new Date(iso);
	const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
	const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	return `${date} · ${time}`;
}


function abbreviateModel(model: string): string {
	if (MODEL_ABBREVIATIONS[model]) return MODEL_ABBREVIATIONS[model];
	// Auto-derive a readable label for unknown/future model IDs (#13)
	return model
		.replace(/^claude-/, "")
		.replace(/^gpt-/, "GPT-")
		.replace(/-(\d)/g, " $1")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

export class PythiaSidebarView extends ItemView {
	private plugin: PythiaPlugin;
	private activeConversation: Conversation | null = null;
	/** Exposes the active conversation ID for eviction protection in persistData(). */
	get activeConversationId(): string | null { return this.activeConversation?.id ?? null; }
	private isStreaming = false;
	private autoScroll = true;
	/** Conversation IDs currently running a chapter-name backfill — prevents
	 *  overlapping serial backfill runs on rapid re-open of the same conversation. */
	private backfillInFlight = new Set<string>();
	/** Cached getComputedStyle(inputEl).lineHeight — invalidated when inputEl is recreated. */
	private cachedLineHeight: number | null = null;
	// Incremental DOM rendering — track what is already in the DOM so renderMessages
	// can skip a full rebuild when the same conversation gains only new messages.
	private renderedConvId: string | null = null;
	private lastRenderedMsgId: string | null = null;
	private longPressCleanup: (() => void) | null = null;
	private activeDeletePreview: {
		userRow: HTMLElement;
		assistantRow: HTMLElement;
		bar: HTMLElement;
		outsideHandler: EventListener;
	} | null = null;
	private isScrolling = false;
	// pendingAttachedNotes removed — all note attachments go to conv.contextNotes
	private navigatorController!: NavigatorController;
	/** Tracks active observers per diagram element so stale ones are
	 *  disconnected before new ones are armed on DOM rebuild (#20). */
	private readonly diagObservers = new WeakMap<HTMLElement, { mo: MutationObserver; ro: ResizeObserver }>();

	private convNameEl!: HTMLElement;
	private templateLabelEl!: HTMLElement;
	private modelBadgeEl!: HTMLButtonElement;
	private copyLinkBtn!: HTMLButtonElement;
	// Context-budget bar under the header + the >=80% warning percent chip.
	private ctxBarEl!: HTMLElement;
	private ctxBarFillEl!: HTMLElement;
	private ctxChipEl!: HTMLElement;
	// Mono next-send token estimate shown left of the Send button.
	private sendEstimateEl!: HTMLElement;
	// Anchored model popover (F7) teardown.
	private modelPopoverCleanup: (() => void) | null = null;
	// Anchored quick switcher (F9) teardown.
	private quickSwitcherCleanup: (() => void) | null = null;
	// In-panel history view (F10) teardown.
	private historyCleanup: (() => void) | null = null;
	// Web-search sources captured (deterministically) during the current send,
	// so the sources row reflects the real Tavily results regardless of how the
	// model chooses to cite them.
	private pendingWebSources: { title: string; url: string }[] = [];
	private referencePillsEl!: HTMLElement;
	private referenceSectionEl!: HTMLElement;
	private referenceRowHasEntries = false;

	// attachedPillsEl removed — notes shown in reference row only
	private messagesEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private selectionToolbar!: HTMLElement;
	private favBtn!: HTMLButtonElement;
	private forkBtn!: HTMLButtonElement;
	/** When set, the current selection came from tapping this favorite's highlight,
	 *  so the toolbar's favorite button acts as "Unfavorite" targeting this id. */
	private tappedFavId: string | null = null;
	private onSelectionChange!: () => void;
	private lastMarkdownView: MarkdownView | null = null;

	// Currently-open inline fork-origin anchor (only one at a time).
	private openForkAnchor: HTMLElement | null = null;
	// Long-press "generate summary" menu on a fork anchor's Open-fork button.
	private forkMenuCleanup: (() => void) | null = null;
	private suppressNextForkOpen = false;
	// Summary "Speisekarte" cards at the top of the message list.
	private summaryCardsEl: HTMLElement | null = null;
	private summaryCardObserver: IntersectionObserver | null = null;
	// Context inspector card (F2/F3) — lives just under the summary cards.
	private inspectorEl: HTMLElement | null = null;
	private inspectorOpen = false; // preserved across rebuilds within a session
	private sendLongPressCleanup: (() => void) | null = null;
	private suppressNextSendClick = false;
	private sendMenuWrap!: HTMLElement;
	private sendMenuCleanup: (() => void) | null = null;
	// Warning shown beside Send when the effective max-tokens looks too low for
	// the selected reasoning model (its reasoning budget can truncate the reply).
	private sendHintEl!: HTMLButtonElement;

	private inputAreaEl!: HTMLElement;
	private inputCollapseBtn!: HTMLButtonElement;
	private inputAreaCollapsed = false;

	private inlineSuggest!: InlineSuggest;
	private indexTriggerEl!: HTMLButtonElement;
	private navigatorEl!: HTMLElement;
	private onViewportResize: (() => void) | null = null;

	private renameBtn!: HTMLButtonElement;
	private renameWrapEl!: HTMLElement;
	private renameInputEl!: HTMLInputElement;
	private renameLLMBtn!: HTMLButtonElement;

	private researchBtnEl!: HTMLButtonElement;
	private optimizationController!: OptimizationController;

	constructor(leaf: WorkspaceLeaf, plugin: PythiaPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return PYTHIA_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Pythia";
	}

	getIcon(): string {
		return "bot";
	}

	async onOpen(): Promise<void> {
		this.buildUI();

		// iOS keyboard avoidance: the layout viewport doesn't shrink when the
		// soft keyboard appears, but visualViewport does. Compensate by applying
		// padding-bottom equal to the overlap between the container bottom and
		// the visible area bottom. Also corrects the at-rest gap from Obsidian's
		// own bottom chrome (tab bar, home indicator).
		if (window.visualViewport) {
			this.onViewportResize = () => this.adjustForKeyboard();
			window.visualViewport.addEventListener("resize", this.onViewportResize);
			window.visualViewport.addEventListener("scroll", this.onViewportResize);
			// Run once immediately to fix at-rest gap; double-rAF guards against
			// iOS WKWebView applying safe-area insets after the first paint.
			requestAnimationFrame(() => {
				this.adjustForKeyboard();
				requestAnimationFrame(() => this.adjustForKeyboard());
			});
		}

		// Recompute the on-accent label color when the user changes their accent
		// or theme in Appearance settings (Obsidian fires css-change) — no reopen.
		this.registerEvent(
			this.app.workspace.on("css-change", () => this.applyAccentContrast())
		);

		// Track the most-recently-active MarkdownView so insert-into-note
		// works even after focus has shifted to this sidebar.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.lastMarkdownView = leaf.view as MarkdownView;
				}
			})
		);
		const current = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (current) this.lastMarkdownView = current;

		const convs = this.plugin.conversations;
		if (convs.length > 0) {
			await this.setActiveConversation(
				convs[convs.length - 1],
				false
			);
		} else {
			this.renderEmptyState();
		}
	}

	async onClose(): Promise<void> {
		this.plugin.llmRouter.abort();

		// Summaries are generated only via the Send-button menu — no auto-save on close.

		this.summaryCardObserver?.disconnect();
		this.summaryCardObserver = null;
		this.sendLongPressCleanup?.();
		this.sendLongPressCleanup = null;
		this.closeSummaryMenu();

		// Discard any pending optimization state.
		this.optimizationController?.cancel();

		// Clean up navigator outside-click listener if view is closed while open (#26).
		this.navigatorController?.close();
		this.modelPopoverCleanup?.();
		this.quickSwitcherCleanup?.();
		this.historyCleanup?.();

		// The selectionchange listener is registered via registerDomEvent and is
		// cleaned up automatically on view unload — no manual removal needed.
		if (window.visualViewport && this.onViewportResize) {
			window.visualViewport.removeEventListener("resize", this.onViewportResize);
			window.visualViewport.removeEventListener("scroll", this.onViewportResize);
			this.onViewportResize = null;
		}
		this.inlineSuggest.dismiss();
	}

	async setActiveConversation(
		conversation: Conversation,
		focus = true,
		scrollTo: "bottom" | "top" = "bottom"
	): Promise<void> {
		// Streaming/abort state is view-global (one AbortController per provider),
		// so switching away mid-stream would let "Stop" on the new conversation
		// abort a different conversation's generation. Block the switch instead.
		if (this.isStreaming && conversation.id !== this.activeConversation?.id) {
			new Notice(t("cannotSwitchWhileStreaming"));
			return;
		}
		this.exitRenameMode(false);                   // discard any in-progress rename
		this.optimizationController?.cancel();
		this.activeConversation = conversation;
		// autoScroll is NOT reset here — renderMessages sets it based on scrollTo.
		// Resetting to true here was the root cause of conversations always scrolling
		// to the bottom on open: anything calling scrollToBottom() during rendering
		// would fire because autoScroll was still true.
		this.navigatorController?.close();            // #26 — detach stale outside-click listener
		this.renderHeader();
		this.updateModelBadge();
		this.updateResearchButton();
		this.renderReferencePills();
		this.updateSendBtnLabel();
		await this.renderMessages(scrollTo);
		if (focus) this.inputEl?.focus();
		this.backfillChapterNames(conversation);
	}

	getActiveConversation(): Conversation | null {
		return this.activeConversation;
	}

	attachNoteToInput(path: string): void {
		const conv = this.activeConversation;
		if (!conv) return;
		conv.contextNotes ??= [];
		if (!conv.contextNotes.includes(path)) {
			conv.contextNotes.push(path);
			void this.plugin.conversationStore.save(conv);
			this.renderReferencePills();
		}
	}

	private backfillChapterNames(conversation: Conversation): void {
		const missing = conversation.messages.filter(
			(m) => m.role === "user" && !m.chapterName
		);
		if (missing.length === 0) return;
		if (this.backfillInFlight.has(conversation.id)) return;
		this.backfillInFlight.add(conversation.id);
		// Serial loop to avoid firing 40+ simultaneous API requests for
		// imported conversations (#2 — was Promise.all fan-out).
		void (async () => {
			try {
				for (const msg of missing) {
					try {
						const name = await this.plugin.llmRouter.generateChapterName(
							msg.content,
							conversation.provider
						);
						if (name) msg.chapterName = name;
					} catch (e) {
						console.warn("[Pythia] chapter name backfill failed:", e);
					}
				}
				if (missing.some((m) => m.chapterName)) {
					await this.plugin.conversationStore.save(conversation);
				}
			} finally {
				this.backfillInFlight.delete(conversation.id);
			}
		})();
	}

	prefillInput(text: string): void {
		if (!this.inputEl) return;
		this.inputEl.value = text;
		this.autoResizeTextarea();
		this.inputEl.focus();
	}

	triggerAutoPrompt(text: string): void {
		if (!this.inputEl) return;
		this.inputEl.value = text;
		this.autoResizeTextarea();
		void this.sendMessage();
	}

	private buildUI(): void {
		this.modelPopoverCleanup?.();
		this.quickSwitcherCleanup?.();
		this.historyCleanup?.();
		this.renderedConvId = null;
		this.lastRenderedMsgId = null;
		this.cachedLineHeight = null; // inputEl is about to be recreated below
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("pythia-view");
		this.applyAccentContrast();

		this.buildHeader(container);

		// Context-budget bar: a 3px track directly under the header row. Fill
		// width = context usage / model window; turns warning-colored at >=80%.
		this.ctxBarEl = container.createDiv({ cls: "p-ctx-bar" });
		this.ctxBarFillEl = this.ctxBarEl.createDiv({ cls: "p-ctx-bar-fill" });
		this.registerDomEvent(this.ctxBarEl, "click", () => this.revealContextInspector());
		this.ctxBarEl.style.display = "none";

		this.buildChatArea(container);

		this.referenceSectionEl = container.createDiv({ cls: "p-ref-row" });
		this.referencePillsEl = this.referenceSectionEl.createDiv({ cls: "p-pills" });
		this.referenceSectionEl.style.display = "none";

		this.buildInputArea(container);

		this.optimizationController = new OptimizationController({
			plugin: this.plugin,
			inputEl: this.inputEl,
			sendBtn: this.sendBtn,
			getConversation: () => this.activeConversation,
			isStreaming: () => this.isStreaming,
			autoResizeTextarea: () => this.autoResizeTextarea(),
			updateSendBtnLabel: () => this.updateSendBtnLabel(),
		});

		this.navigatorController = new NavigatorController({
			plugin: this.plugin,
			navigatorEl: this.navigatorEl,
			indexTriggerEl: this.indexTriggerEl,
			getConversation: () => this.activeConversation,
			setActiveConversation: (conv) => this.setActiveConversation(conv),
			scrollToMessage: (id) => this.scrollToMessage(id),
			scrollToFavorite: (fav) => this.scrollToFavorite(fav),
			removeFavorite: (favId) => this.removeFavorite(favId),
			goToFavoritesSummary: () => this.goToFavoritesSummary(),
		});
	}

	private buildHeader(container: HTMLElement): void {
		const header = container.createDiv({ cls: "p-header" });

		const titleGroup = header.createDiv({ cls: "p-title-group" });

		this.convNameEl = titleGroup.createEl("button", {
			cls: "p-title",
			text: t("noConversation"),
		});
		this.registerDomEvent(this.convNameEl, "click", () => this.onConvNameClick());

		this.renameWrapEl = titleGroup.createDiv({ cls: "p-rename-wrap" });
		this.renameWrapEl.style.display = "none";

		this.renameLLMBtn = this.renameWrapEl.createEl("button", {
			cls: "p-hdr-btn p-rename-refresh",
			attr: { title: t("renameLLMTooltip") },
		});
		setIcon(this.renameLLMBtn, "refresh-cw");
		this.registerDomEvent(this.renameLLMBtn, "mousedown", (e) => {
			e.preventDefault();
			void this.onRenameLLM();
		});

		this.renameInputEl = this.renameWrapEl.createEl("input", {
			cls: "p-rename-input",
			attr: { type: "text", placeholder: t("renameConvPlaceholder") },
		});
		this.registerDomEvent(this.renameInputEl, "keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") { e.preventDefault(); this.exitRenameMode(true); }
			if (e.key === "Escape") { e.preventDefault(); this.exitRenameMode(false); }
		});
		this.registerDomEvent(this.renameInputEl, "blur", () => this.exitRenameMode(true));

		this.renameBtn = titleGroup.createEl("button", {
			cls: "p-hdr-btn p-rename-btn",
			attr: { title: t("renameConvTooltip") },
		});
		setIcon(this.renameBtn, "pencil");
		this.renameBtn.style.display = "none";
		this.registerDomEvent(this.renameBtn, "click", () => this.enterRenameMode());

		// Context-budget warning chip (e.g. "94%"), shown only at >=80% usage.
		// Clicking it scrolls to the top of the conversation (context inspector
		// lands there in a later phase).
		this.ctxChipEl = header.createEl("button", { cls: "p-ctx-chip" });
		this.ctxChipEl.style.display = "none";
		this.registerDomEvent(this.ctxChipEl, "click", () => this.revealContextInspector());

		this.modelBadgeEl = header.createEl("button", {
			cls: "p-model",
			text: "",
			attr: { title: t("changeModelTooltip") },
		});
		this.modelBadgeEl.style.display = "none";
		this.registerDomEvent(this.modelBadgeEl, "click", () => this.openModelPopover());

		this.copyLinkBtn = header.createEl("button", {
			cls: "p-hdr-btn",
			attr: { title: t("copyConvLinkTooltip") },
		});
		setIcon(this.copyLinkBtn, "link");
		this.copyLinkBtn.style.display = "none";
		this.registerDomEvent(this.copyLinkBtn, "click", () => this.onCopyConversationLink());

		const historyBtn = header.createEl("button", {
			cls: "p-hdr-btn",
			attr: { title: t("historyTooltip") },
		});
		setIcon(historyBtn, "history");
		this.registerDomEvent(historyBtn, "click", () => this.openHistoryView());

		const deleteConvBtn = header.createEl("button", {
			cls: "p-hdr-btn",
			attr: { title: t("deleteConvTooltip") },
		});
		setIcon(deleteConvBtn, "trash");
		this.registerDomEvent(deleteConvBtn, "click", () => this.handleDeleteConversation());

		const newConvBtn = header.createEl("button", {
			cls: "p-hdr-btn",
			attr: { title: t("newConvTooltip") },
		});
		setIcon(newConvBtn, "plus");
		this.registerDomEvent(newConvBtn, "click", () => this.plugin.cmdNewConversation());

		this.templateLabelEl = header.createDiv({ cls: "pythia-template-label" });
		this.templateLabelEl.style.display = "none";
	}

	private buildChatArea(container: HTMLElement): void {
		const messagesWrapper = container.createDiv({ cls: "pythia-messages-wrapper" });

		this.messagesEl = messagesWrapper.createDiv({ cls: "p-chat" });
		this.registerDomEvent(this.messagesEl, "scroll", () => {
			if (this.isScrolling) return;
			const el = this.messagesEl;
			const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
			if (distFromBottom > 50) this.autoScroll = false;
		});
		this.selectionToolbar = container.createDiv({ cls: "pythia-sel-toolbar" });
		this.selectionToolbar.style.display = "none";

		let savedSelRange: Range | null = null;
		let selTouchStartX = 0;
		this.registerDomEvent(this.selectionToolbar, "touchstart", (e: TouchEvent) => {
			const sel = window.getSelection();
			savedSelRange = (sel && sel.rangeCount > 0)
				? sel.getRangeAt(0).cloneRange()
				: null;
			selTouchStartX = e.touches[0].clientX;
		}, { passive: true });

		const makeSelTouch = (action: () => void) => (e: TouchEvent) => {
			if (Math.abs(e.changedTouches[0].clientX - selTouchStartX) > 12) return;
			e.preventDefault();
			if (savedSelRange) {
				const sel = window.getSelection();
				if (sel) { sel.removeAllRanges(); sel.addRange(savedSelRange); }
				savedSelRange = null;
			}
			action();
		};

		// Toolbar order (left → right): Copy, Favorite/Unfavorite, Branch (Fork),
		// Insert into note, Save to inbox.
		const copyBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: t("copyBtn"),
			attr: { title: t("copyBtn") },
		});
		this.registerDomEvent(copyBtn, "mousedown", (e) => { e.preventDefault(); this.onCopySelection(); });
		this.registerDomEvent(copyBtn, "touchend", makeSelTouch(() => this.onCopySelection()));

		this.favBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: t("favoriteBtn"),
			attr: { title: t("favoriteBtn") },
		});
		this.registerDomEvent(this.favBtn, "mousedown", (e) => { e.preventDefault(); void this.onFavoriteSelection(); });
		this.registerDomEvent(this.favBtn, "touchend", makeSelTouch(() => void this.onFavoriteSelection()));

		this.forkBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: t("forkBtn"),
			attr: { title: t("forkBtn") },
		});
		this.registerDomEvent(this.forkBtn, "mousedown", (e) => { e.preventDefault(); this.onForkConversation(); });
		this.registerDomEvent(this.forkBtn, "touchend", makeSelTouch(() => this.onForkConversation()));

		const insertBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: t("insertBtn"),
			attr: { title: t("insertBtn") },
		});
		this.registerDomEvent(insertBtn, "mousedown", (e) => { e.preventDefault(); this.onInsertIntoNote(); });
		this.registerDomEvent(insertBtn, "touchend", makeSelTouch(() => this.onInsertIntoNote()));

		const inboxBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: t("inboxBtn"),
			attr: { title: t("inboxBtn") },
		});
		this.registerDomEvent(inboxBtn, "mousedown", (e) => { e.preventDefault(); void this.onSaveToInbox(); });
		this.registerDomEvent(inboxBtn, "touchend", makeSelTouch(() => this.onSaveToInbox()));

		{
			let selDebounce: ReturnType<typeof setTimeout> | null = null;
			this.onSelectionChange = () => {
				if (selDebounce !== null) clearTimeout(selDebounce);
				selDebounce = setTimeout(() => {
					selDebounce = null;
					this.handleSelectionChange();
				}, 150);
			};
		}
		this.registerDomEvent(document, "selectionchange", this.onSelectionChange);
		this.registerDomEvent(this.messagesEl, "mouseup", () =>
			setTimeout(() => this.handleSelectionChange(), 10)
		);
		this.registerDomEvent(this.messagesEl, "touchend", () =>
			setTimeout(() => this.handleSelectionChange(), 300)
		);
		// Tapping a highlight (no drag) selects its whole span and surfaces the
		// toolbar with the favorite button acting as "Unfavorite".
		this.registerDomEvent(this.messagesEl, "click", (e) =>
			this.onMessageClick(e)
		);

		const indexWrap = messagesWrapper.createDiv({ cls: "p-index-wrap" });
		this.navigatorEl = indexWrap.createDiv({ cls: "p-navigator" });
		this.indexTriggerEl = indexWrap.createEl("button", {
			cls: "p-index-trigger",
			text: "#",
			attr: { title: t("showChaptersTooltip") },
		});
		this.registerDomEvent(this.indexTriggerEl, "click", (e) => {
			e.stopPropagation();
			this.navigatorController.toggle();
		});
	}

	private buildInputArea(container: HTMLElement): void {
		const inputArea = container.createDiv({ cls: "p-input-area" });
		this.inputAreaEl = inputArea;

		this.inputEl = inputArea.createEl("textarea", {
			cls: "p-textarea",
			attr: { placeholder: t("inputPlaceholder"), rows: "2" },
		});
		this.inlineSuggest = new InlineSuggest(
			this.app,
			this.inputEl,
			inputArea,
			(paths) => {
				const conv = this.activeConversation;
				if (!conv) return;
				let changed = false;
				for (const p of paths) {
					if (!conv.contextNotes.includes(p)) { conv.contextNotes.push(p); changed = true; }
				}
				if (changed) {
					void this.plugin.conversationStore.save(conv);
					this.renderReferencePills();
				}
			}
		);
		this.registerDomEvent(this.inputEl, "keydown", (e: KeyboardEvent) => {
			if (this.inlineSuggest.handleKeydown(e)) return;
			if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				void this.sendMessage();
			}
		});
		{
			let tokenDebounce: ReturnType<typeof setTimeout> | null = null;
			this.registerDomEvent(this.inputEl, "input", () => {
				this.autoResizeTextarea();
				this.inlineSuggest.handleInput();
				if (tokenDebounce !== null) clearTimeout(tokenDebounce);
				tokenDebounce = setTimeout(() => {
					tokenDebounce = null;
					this.updateSendBtnLabel();
				}, 250);
			});
		}

		this.registerDomEvent(this.inputEl, "focus", () => {
			setTimeout(() => this.adjustForKeyboard(), 300);
		});
		this.registerDomEvent(this.inputEl, "blur", () => {
			setTimeout(() => this.adjustForKeyboard(), 300);
		});

		const toolbar = inputArea.createDiv({ cls: "p-toolbar" });
		const toolbarLeft = toolbar.createDiv({ cls: "p-toolbar-left" });

		const attachBtn = toolbarLeft.createEl("button", {
			cls: "p-tool-btn",
			attr: { title: t("attachNoteTooltip") },
		});
		const attachSvg = attachBtn.createSvg("svg", {
			attr: { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.6" },
		});
		attachSvg.createSvg("path", {
			attr: { d: "M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" },
		});
		this.registerDomEvent(attachBtn, "click", () => {
			this.ensureInputExpanded();
			this.onAttachNote();
		});

		const saveBtn = toolbarLeft.createEl("button", {
			cls: "p-tool-btn",
			attr: { title: t("saveResponseTooltip") },
		});
		const saveSvg = saveBtn.createSvg("svg", {
			attr: { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.6" },
		});
		saveSvg.createSvg("path", {
			attr: { d: "M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" },
		});
		saveSvg.createSvg("polyline", { attr: { points: "17 21 17 13 7 13 7 21" } });
		saveSvg.createSvg("polyline", { attr: { points: "7 3 7 8 15 8" } });
		this.registerDomEvent(saveBtn, "click", () => {
			this.ensureInputExpanded();
			void this.onSaveResponse();
		});

		// Prompt optimization now lives as a third entry in the Send long-press menu
		// (openSummaryMenu) rather than a toolbar icon.

		const applyTemplateBtn = toolbarLeft.createEl("button", {
			cls: "p-tool-btn",
			attr: { title: t("applyTemplateTooltip") },
		});
		setIcon(applyTemplateBtn, "layout-template");
		this.registerDomEvent(applyTemplateBtn, "click", () => {
			this.ensureInputExpanded();
			void this.onApplyTemplate();
		});

		this.researchBtnEl = toolbarLeft.createEl("button", {
			cls: "p-tool-btn",
			attr: { title: t("researchToggleTooltip") },
		});
		setIcon(this.researchBtnEl, "globe");
		this.registerDomEvent(this.researchBtnEl, "click", () => this.toggleResearchMode());
		this.updateResearchButton();

		this.inputCollapseBtn = toolbarLeft.createEl("button", {
			cls: "p-tool-btn",
			attr: { title: t("minimizeInputTooltip") },
		});
		setIcon(this.inputCollapseBtn, "arrow-down");
		this.registerDomEvent(this.inputCollapseBtn, "click", () => this.toggleInputArea());

		// Next-send token estimate (mono), sits left of the warning + Send.
		this.sendEstimateEl = toolbar.createEl("span", { cls: "p-send-estimate" });

		// Max-tokens warning, sits just left of Send. Hidden unless the effective
		// max-tokens looks too low for a reasoning model; clicking opens settings.
		this.sendHintEl = toolbar.createEl("button", { cls: "p-send-hint" });
		setIcon(this.sendHintEl, "alert-triangle");
		this.sendHintEl.style.display = "none";
		this.registerDomEvent(this.sendHintEl, "click", () => this.onModelBadgeClick());

		// Wrap the send button so the summary menu can open directly above it.
		this.sendMenuWrap = toolbar.createDiv({ cls: "p-send-wrap" });
		this.sendBtn = this.sendMenuWrap.createEl("button", {
			cls: "p-send",
			text: t("sendBtn"),
		});
		this.registerDomEvent(this.sendBtn, "click", () => {
			// A long-press that opened the summary menu also fires a click — swallow it.
			if (this.suppressNextSendClick) {
				this.suppressNextSendClick = false;
				return;
			}
			if (this.isStreaming) {
				this.plugin.llmRouter.abort();
			} else {
				void this.sendMessage();
			}
		});
		this.attachSendLongPress();
	}

	/** Long-press on Send opens a menu to (re)generate the conversation or
	 *  favorites summary. Reuses the 450 ms touch+mouse timer pattern. */
	private attachSendLongPress(): void {
		this.sendLongPressCleanup?.();
		const btn = this.sendBtn;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const cancel = () => {
			if (timer !== null) { clearTimeout(timer); timer = null; }
		};
		const fire = () => {
			timer = null;
			if (this.isStreaming) return;
			this.suppressNextSendClick = true;
			this.openSummaryMenu();
		};
		const onTouchStart = () => {
			timer = setTimeout(fire, 450);
		};
		const onMouseDown = (e: MouseEvent) => {
			if (e.button !== 0) return;
			timer = setTimeout(fire, 450);
		};

		btn.addEventListener("touchstart", onTouchStart, { passive: true });
		btn.addEventListener("touchend", cancel, { passive: true });
		btn.addEventListener("touchcancel", cancel, { passive: true });
		btn.addEventListener("touchmove", cancel, { passive: true });
		btn.addEventListener("mousedown", onMouseDown);
		btn.addEventListener("mouseup", cancel);
		btn.addEventListener("mouseleave", cancel);

		this.sendLongPressCleanup = () => {
			cancel();
			btn.removeEventListener("touchstart", onTouchStart);
			btn.removeEventListener("touchend", cancel);
			btn.removeEventListener("touchcancel", cancel);
			btn.removeEventListener("touchmove", cancel);
			btn.removeEventListener("mousedown", onMouseDown);
			btn.removeEventListener("mouseup", cancel);
			btn.removeEventListener("mouseleave", cancel);
		};
	}

	/** The long-press Send menu — a small popover stacked directly above the Send
	 *  button. The only entry point for generating summaries. */
	private openSummaryMenu(): void {
		const conv = this.activeConversation;
		if (!conv) { new Notice(t("noActiveConvToSend")); return; }
		if (this.sendMenuCleanup) { this.closeSummaryMenu(); return; } // toggle off

		const menu = this.sendMenuWrap.createDiv({ cls: "p-send-menu" });

		const addItem = (label: string, icon: string, disabled: boolean, action: () => void) => {
			const item = menu.createDiv({
				cls: `p-send-menu-item${disabled ? " p-send-menu-item-disabled" : ""}`,
			});
			const ic = item.createSpan({ cls: "p-send-menu-icon" });
			setIcon(ic, icon);
			item.createSpan({ cls: "p-send-menu-label", text: label });
			if (disabled) return;
			// mousedown (not click) so the selection/keyboard focus isn't disturbed.
			item.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.closeSummaryMenu();
				action();
			});
		};

		addItem(t("menuSummarizeConversation"), "align-left", conv.messages.length === 0,
			() => void this.generateConversationSummary());
		addItem(t("menuSummarizeFavorites"), "star", (conv.favorites?.length ?? 0) === 0,
			() => void this.summarizeFavorites());
		// Prompt optimization (moved here from the input toolbar). Disabled when there
		// is nothing typed to optimize or no optimizer template is configured.
		const optimizeDisabled =
			this.inputEl.value.trim().length === 0 || !this.plugin.settings.promptOptimizerTemplateId;
		addItem(t("menuOptimizePrompt"), "sparkles", optimizeDisabled, () => {
			this.ensureInputExpanded();
			void this.optimizationController.start();
		});

		// Outside-click / outside-touch dismissal (deferred so this gesture doesn't self-close).
		const onOutside = (e: Event) => {
			if (!this.sendMenuWrap.contains(e.target as Node)) this.closeSummaryMenu();
		};
		window.setTimeout(() => {
			document.addEventListener("mousedown", onOutside, true);
			document.addEventListener("touchstart", onOutside, true);
		}, 0);
		this.sendMenuCleanup = () => {
			document.removeEventListener("mousedown", onOutside, true);
			document.removeEventListener("touchstart", onOutside, true);
			menu.remove();
		};
	}

	private closeSummaryMenu(): void {
		this.sendMenuCleanup?.();
		this.sendMenuCleanup = null;
	}

	renderEmptyState(): void {
		this.messagesEl.empty();
		const empty = this.messagesEl.createDiv({ cls: "pythia-empty" });
		empty.createEl("p", {
			text: t("noActiveConversationHint"),
		});
		empty.createEl("p", {
			text: t("startFromPaletteHint"),
			cls: "pythia-empty-hint",
		});
	}

	/** Minimal centered welcome for an empty conversation (F6): accent sparkle,
	 *  a heading, and three mono keycap hints. */
	private renderWelcome(container: HTMLElement): void {
		const wrap = container.createDiv({ cls: "p-welcome" });
		const spark = wrap.createDiv({ cls: "p-welcome-spark" });
		setIcon(spark, "sparkles");
		wrap.createDiv({ cls: "p-welcome-title", text: t("emptyHeading") });
		const hints = wrap.createDiv({ cls: "p-welcome-hints" });
		const addHint = (cap: string, label: string) => {
			const row = hints.createDiv({ cls: "p-welcome-hint" });
			row.createEl("span", { cls: "p-keycap", text: cap });
			row.createEl("span", { text: label });
		};
		addHint("#", t("emptyHintAttach"));
		addHint("⌘P", t("emptyHintCommands"));
		addHint("⇧↵", t("emptyHintNewline"));
	}

	/** Short token label like "~4.3k" / "~640". */
	private fmtTok(n: number): string {
		return n >= 1000 ? `~${(n / 1000).toFixed(1)}k` : `~${n}`;
	}

	/** Scroll to the top and expand the context inspector — the click target of
	 *  the budget bar / percent chip (F3). */
	private revealContextInspector(): void {
		this.scrollToTop();
		this.inspectorOpen = true;
		if (this.inspectorEl) {
			this.fillContextInspector();
			this.inspectorEl.querySelector(".p-inspector")?.scrollIntoView({ block: "nearest" });
		}
	}

	/** Build/refresh the context inspector card (F2/F3) inside `inspectorEl`.
	 *  Normal mode lists context notes as wikilinks + a system-prompt estimate;
	 *  when the context window is ≥80% full it switches to a budget breakdown
	 *  with per-source mini-bars and a "Zusammenfassen" action. */
	private fillContextInspector(): void {
		const wrap = this.inspectorEl;
		if (!wrap) return;
		wrap.empty();
		const conv = this.activeConversation;
		if (!conv) { wrap.style.display = "none"; return; }

		const notes = conv.contextNotes ?? [];
		const noteTok = notes.map((p) => {
			const f = this.app.vault.getAbstractFileByPath(p);
			const tokens = f instanceof TFile ? Math.round(f.stat.size / 4) : 0;
			return { path: p, tokens };
		});
		const noteTotal = noteTok.reduce((a, b) => a + b.tokens, 0);
		const sysTokens = estimateTokensFromText(buildSystemPrompt(conv));
		const last = this.lastTokenUsageMsg();
		const windowSize = getContextWindow(conv.model);
		const used = last?.tokenUsage
			? last.tokenUsage.inputTokens + last.tokenUsage.outputTokens
			: noteTotal + sysTokens;
		const frac = windowSize > 0 ? Math.min(1, used / windowSize) : 0;
		const budgetTight = frac >= 0.8;

		// Nothing worth a card: no context notes and plenty of budget.
		if (notes.length === 0 && !budgetTight) { wrap.style.display = "none"; return; }
		wrap.style.display = "";

		const card = wrap.createDiv({ cls: "p-inspector" });
		if (budgetTight) card.addClass("warn");

		// ── Header (toggles the body) ────────────────────────────────
		const header = card.createDiv({ cls: "p-inspector-header" });
		setIcon(header.createSpan({ cls: "p-inspector-icon" }), "file-text");
		const shortK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
		const titleText = budgetTight
			? `${t("ctxLabel")} · ${shortK(used)} / ${shortK(windowSize)}`
			: `${t("ctxLabel")} · ${this.fmtTok(noteTotal + sysTokens)}`;
		header.createSpan({ cls: "p-inspector-title", text: titleText });
		if (budgetTight) {
			header.createSpan({ cls: "p-inspector-pct", text: `${Math.round(frac * 100)}%` });
		}
		const chevron = header.createSpan({ cls: "p-inspector-chevron", text: this.inspectorOpen ? "▾" : "▸" });
		header.addEventListener("click", () => {
			this.inspectorOpen = !this.inspectorOpen;
			card.toggleClass("open", this.inspectorOpen);
			chevron.setText(this.inspectorOpen ? "▾" : "▸");
		});
		card.toggleClass("open", this.inspectorOpen);

		// ── Body ─────────────────────────────────────────────────────
		const body = card.createDiv({ cls: "p-inspector-body" });

		const miniBar = (row: HTMLElement, fraction: number, warn = false) => {
			const bar = row.createDiv({ cls: "p-ins-bar" });
			const fill = bar.createDiv({ cls: "p-ins-bar-fill" });
			fill.style.width = `${Math.min(100, fraction * 100).toFixed(1)}%`;
			if (warn) fill.addClass("warn");
		};
		const wikilinkRow = (parent: HTMLElement, path: string): HTMLElement => {
			const row = parent.createDiv({ cls: "p-inspector-row" });
			const ref = row.createSpan({ cls: "p-wikilink" });
			ref.createEl("span", { cls: "p-wikilink-bracket", text: "[[" });
			const name = ref.createEl("span", {
				cls: "p-wikilink-name",
				text: (path.split("/").pop() ?? path).replace(/\.md$/, ""),
				attr: { title: path },
			});
			name.addEventListener("click", async () => {
				const f = this.app.vault.getAbstractFileByPath(path);
				if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
				else new Notice(t("fileNotFound", { path }));
			});
			ref.createEl("span", { cls: "p-wikilink-bracket", text: "]]" });
			return row;
		};

		if (budgetTight) {
			// Conversation history row
			const histTokens = Math.max(0, used - noteTotal - sysTokens);
			const histRow = body.createDiv({ cls: "p-inspector-row" });
			histRow.createSpan({ cls: "p-inspector-rowlabel", text: t("ctxHistoryRow", { count: String(conv.messages.length) }) });
			miniBar(histRow, windowSize > 0 ? histTokens / windowSize : 0, true);
			histRow.createSpan({ cls: "p-inspector-rowval", text: this.fmtTok(histTokens) });

			for (const n of noteTok) {
				const row = wikilinkRow(body, n.path);
				miniBar(row, windowSize > 0 ? n.tokens / windowSize : 0);
				row.createSpan({ cls: "p-inspector-rowval", text: this.fmtTok(n.tokens) });
			}

			const sysRow = body.createDiv({ cls: "p-inspector-row" });
			sysRow.createSpan({ cls: "p-inspector-rowlabel", text: t("ctxSystemPrompt") });
			miniBar(sysRow, windowSize > 0 ? sysTokens / windowSize : 0);
			sysRow.createSpan({ cls: "p-inspector-rowval", text: this.fmtTok(sysTokens) });

			// Warning + Zusammenfassen
			const warnRow = body.createDiv({ cls: "p-inspector-warn" });
			setIcon(warnRow.createSpan({ cls: "p-inspector-warn-icon" }), "alert-triangle");
			const savings = Math.round(histTokens * 0.85);
			warnRow.createSpan({ cls: "p-inspector-warn-text", text: t("ctxNearFull", { n: this.fmtTok(savings) }) });
			const sumBtn = warnRow.createEl("button", { cls: "p-inspector-summarize", text: t("ctxSummarize") });
			sumBtn.addEventListener("click", (e) => { e.stopPropagation(); void this.generateConversationSummary(); });
		} else {
			for (const n of noteTok) {
				const row = wikilinkRow(body, n.path);
				row.createSpan({ cls: "p-wikilink-tokens", text: this.fmtTok(n.tokens) });
				const x = row.createEl("button", { cls: "p-wikilink-x", text: "×" });
				x.addEventListener("click", async () => {
					conv.contextNotes = conv.contextNotes.filter((p) => p !== n.path);
					await this.plugin.conversationStore.save(conv);
					this.renderReferencePills();
				});
			}
			const footer = body.createDiv({ cls: "p-inspector-footer" });
			const addLink = footer.createSpan({ cls: "p-inspector-add", text: t("ctxAddNote") });
			addLink.addEventListener("click", () => {
				new NoteSuggestModal(this.app, (file) => {
					if (!conv.contextNotes.includes(file.path)) {
						conv.contextNotes.push(file.path);
						void this.plugin.conversationStore.save(conv);
						this.renderReferencePills();
					}
				}).open();
			});
			footer.createSpan({ cls: "p-inspector-sys", text: t("ctxSystemPromptEst", { est: this.fmtTok(sysTokens) }) });
		}
	}

	private renderHeader(): void {
		if (!this.activeConversation) {
			this.convNameEl.setText(t("noConversation"));
			this.templateLabelEl.setText("");
			this.copyLinkBtn.style.display = "none";
			this.renameBtn.style.display = "none";
			return;
		}
		this.copyLinkBtn.style.display = "";
		this.renameBtn.style.display = "";
		this.convNameEl.setText(this.activeConversation.name + " ▾");
		if (this.activeConversation.templateId) {
			const tplName =
				this.activeConversation.templateId
					.split("/")
					.pop()
					?.replace(/\.md$/, "") ?? "";
			this.templateLabelEl.setText(t("templateLabel", { name: tplName }));
			this.templateLabelEl.style.display = "";
		} else {
			this.templateLabelEl.setText("");
			this.templateLabelEl.style.display = "none";
		}
	}

	// ── Summary "Speisekarte" cards (top of the message list) ──────────────────

	/** Rebuild the summary cards for the active conversation. Only renders a card
	 *  for a summary that actually exists; cards are collapsed by default. */
	private renderSummaryCards(): void {
		if (!this.summaryCardsEl) return;
		this.summaryCardsEl.empty();
		this.summaryCardObserver?.disconnect();
		this.summaryCardObserver = null;

		const conv = this.activeConversation;
		const cards: HTMLElement[] = [];
		if (conv?.summaryText?.trim()) {
			cards.push(this.buildSummaryCard("conversation", conv.summaryText.trim(), conv.summaryUpdatedAt));
		}
		if (conv?.favoritesSummary?.text?.trim()) {
			cards.push(this.buildSummaryCard("favorites", conv.favoritesSummary.text.trim(), conv.favoritesSummary.updatedAt));
		}
		this.summaryCardsEl.style.display = cards.length ? "" : "none";

		// Auto-collapse an expanded card once it scrolls out of the message viewport.
		if (cards.length) {
			this.summaryCardObserver = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						const card = entry.target as HTMLElement;
						if (!entry.isIntersecting && card.hasClass("open")) {
							this.setSummaryCardOpen(card, false);
						}
					}
				},
				{ root: this.messagesEl, threshold: 0 }
			);
			for (const card of cards) this.summaryCardObserver.observe(card);
		}
	}

	private buildSummaryCard(
		kind: "conversation" | "favorites",
		text: string,
		updatedAt?: string
	): HTMLElement {
		const card = this.summaryCardsEl!.createDiv({
			cls: "p-summary-card",
			attr: { "data-kind": kind },
		});
		const header = card.createDiv({ cls: "p-summary-card-header" });
		const icon = header.createSpan({ cls: "p-summary-card-icon" });
		setIcon(icon, kind === "favorites" ? "star" : "align-left");
		header.createSpan({
			cls: "p-summary-card-title",
			text: kind === "favorites" ? t("favoritesSummaryTitle") : t("conversationSummaryTitle"),
		});
		// Timestamp lives in the header now (right-aligned, faint).
		if (updatedAt) {
			header.createSpan({ cls: "p-summary-ts", text: formatSummaryTimestamp(updatedAt) });
		}
		// Regenerate icon — re-runs the summary matching this card's kind.
		const regen = header.createEl("button", {
			cls: "p-summary-card-regen",
			attr: { title: kind === "favorites" ? t("menuSummarizeFavorites") : t("menuSummarizeConversation") },
		});
		setIcon(regen, "refresh-cw");
		regen.addEventListener("click", (e) => {
			e.stopPropagation();
			if (kind === "favorites") void this.summarizeFavorites();
			else void this.generateConversationSummary();
		});
		const chevron = header.createSpan({ cls: "p-summary-card-chevron", text: "▸" });
		header.addEventListener("click", () =>
			this.setSummaryCardOpen(card, !card.hasClass("open"))
		);

		const body = card.createDiv({ cls: "p-summary-card-body" });
		const md = body.createDiv({ cls: "p-summary-card-md" });
		void MarkdownRenderer.render(this.app, text, md, "", this)
			.catch((e) => console.error("[Pythia] summary card render:", e));

		const footer = body.createDiv({ cls: "p-summary-card-footer" });
		const copyBtn = footer.createEl("button", { cls: "p-summary-card-action", text: t("copyBtn") });
		copyBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			navigator.clipboard.writeText(text).then(
				() => new Notice(t("copied")),
				() => new Notice(t("copyFailed")),
			);
		});
		const saveBtn = footer.createEl("button", { cls: "p-summary-card-action", text: t("saveToNoteBtn") });
		saveBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.onSaveSummaryToNote(kind, text);
		});

		void chevron; // chevron text is updated via setSummaryCardOpen
		return card;
	}

	private setSummaryCardOpen(card: HTMLElement, open: boolean): void {
		card.toggleClass("open", open);
		const chevron = card.querySelector<HTMLElement>(".p-summary-card-chevron");
		if (chevron) chevron.setText(open ? "▾" : "▸");
	}

	private async onSaveSummaryToNote(kind: "conversation" | "favorites", text: string): Promise<void> {
		const conv = this.activeConversation;
		if (!conv) return;
		try {
			const path = kind === "favorites"
				? await this.plugin.noteWriter.saveFavoritesSummaryNote(conv, text)
				: await this.plugin.noteWriter.saveSummaryNote(conv, text);
			new Notice(t("savedToPath", { path }));
		} catch (e) {
			new Notice(t("saveFailed", { error: e instanceof Error ? e.message : String(e) }));
		}
	}

	/** Expand a summary card and scroll it to the top of the viewport. */
	private revealSummaryCard(kind: "conversation" | "favorites"): void {
		const card = this.summaryCardsEl?.querySelector<HTMLElement>(
			`.p-summary-card[data-kind="${kind}"]`
		);
		if (!card) return;
		this.setSummaryCardOpen(card, true);
		// Instant scroll so the card is in view before the observer evaluates it
		// (a smooth scroll would let the observer collapse it mid-flight).
		const top = card.offsetTop - this.messagesEl.offsetTop;
		this.messagesEl.scrollTo({ top: Math.max(0, top - 8) });
	}

	/** Nav: jump to and expand the favorites summary card. */
	goToFavoritesSummary(): void {
		if (!this.activeConversation?.favoritesSummary?.text?.trim()) return;
		requestAnimationFrame(() => this.revealSummaryCard("favorites"));
	}

	private toggleInputArea(): void {
		this.inputAreaCollapsed = !this.inputAreaCollapsed;
		this.inputAreaEl.toggleClass("collapsed", this.inputAreaCollapsed);
		setIcon(this.inputCollapseBtn, this.inputAreaCollapsed ? "arrow-up" : "arrow-down");
		this.inputCollapseBtn.setAttribute(
			"title",
			this.inputAreaCollapsed ? t("expandInputTooltip") : t("minimizeInputTooltip")
		);
		this.updateReferenceRowVisibility();
	}

	private ensureInputExpanded(): void {
		if (this.inputAreaCollapsed) this.toggleInputArea();
	}

	private updateReferenceRowVisibility(): void {
		this.referenceSectionEl.style.display =
			this.referenceRowHasEntries && !this.inputAreaCollapsed ? "" : "none";
	}

	private renderForkBannerEl(): void {
		const conv = this.activeConversation;
		if (!conv?.forkedFromId) return;
		const source = this.plugin.conversationStore.getById(conv.forkedFromId);

		const banner = this.messagesEl.createDiv({ cls: "pythia-fork-banner" });
		const header = banner.createDiv({ cls: "pythia-fork-header" });
		setIcon(header.createSpan({ cls: "pythia-fork-icon" }), "git-branch");
		const label = header.createEl("span", { cls: "pythia-fork-label", text: `${t("forkedFromLabel")}: ` });
		if (source) {
			// A span (not an <a>) — matches the extension's standard clickable-link
			// pattern (.p-source-web / .p-wikilink-name) and avoids Obsidian core's
			// anchor underline, which out-specifies a plugin text-decoration rule.
			const link = label.createSpan({
				cls: "pythia-fork-source-link",
				text: source.name,
			});
			const forkId = conv.id;
			link.addEventListener("click", async () => {
				await this.setActiveConversation(source);
				// Prefer landing on the fork-origin anchor (scrolls + expands it);
				// fall back to the branch message if the snippet can't be located.
				const mark = this.messagesEl.querySelector(`.p-fork-origin[data-fork-id="${forkId}"]`);
				if (mark) {
					this.revealForkOrigin(forkId);
				} else if (conv.forkedFromMessageId) {
					this.scrollToMessage(conv.forkedFromMessageId);
				}
			});
		} else {
			label.createEl("span", {
				cls: "pythia-fork-source-deleted",
				text: t("deletedConversation"),
			});
		}

		// Show the selected text that triggered the fork, truncated to a readable excerpt.
		const selection = conv.forkedFromSelection?.trim();
		if (selection) {
			const MAX = 220;
			const excerpt = selection.length > MAX
				? selection.slice(0, MAX).trimEnd() + "…"
				: selection;
			banner.createDiv({ cls: "pythia-fork-selection", text: excerpt });
		}
	}

	private renderReferencePills(): void {
		this.referencePillsEl.empty();
		const conv = this.activeConversation;

		if (!conv) {
			this.referenceRowHasEntries = false;
			this.updateReferenceRowVisibility();
			return;
		}

		type RefEntry =
			| { kind: "context"; path: string }
			| { kind: "output"; path: string; clearField: () => void };

		const entries: RefEntry[] = [];

		for (const path of conv.contextNotes ?? []) {
			entries.push({ kind: "context", path });
		}
		if (conv.savedNotePath) {
			entries.push({ kind: "output", path: conv.savedNotePath, clearField: () => { conv.savedNotePath = undefined; } });
		}
		if (conv.summaryNote) {
			entries.push({ kind: "output", path: conv.summaryNote, clearField: () => { conv.summaryNote = undefined; } });
		}

		this.referenceRowHasEntries = entries.length > 0;
		this.updateReferenceRowVisibility();
		// Keep the context inspector in sync with note add/remove.
		if (this.inspectorEl) this.fillContextInspector();
		if (entries.length === 0) return;

		for (const entry of entries) {
			const fileName = entry.path.split("/").pop() ?? entry.path;
			const displayName = fileName.replace(/\.md$/, "");
			const file = this.app.vault.getAbstractFileByPath(entry.path);
			const tokEst = file instanceof TFile ? estimateTokensFromBytes(file.stat.size) : null;

			// Wikilink reference: [[ name ]] ~tokens ×
			const ref = this.referencePillsEl.createEl("span", { cls: "p-wikilink" });
			ref.createEl("span", { cls: "p-wikilink-bracket", text: "[[" });
			const label = ref.createEl("span", { text: displayName, cls: "p-wikilink-name", attr: { title: entry.path } });
			label.addEventListener("click", async () => {
				const f = this.app.vault.getAbstractFileByPath(entry.path);
				if (f instanceof TFile) {
					await this.app.workspace.getLeaf(false).openFile(f);
				} else {
					new Notice(t("fileNotFound", { path: entry.path }));
				}
			});
			ref.createEl("span", { cls: "p-wikilink-bracket", text: "]]" });
			if (tokEst) ref.createEl("span", { cls: "p-wikilink-tokens", text: tokEst });
			const x = ref.createEl("button", { cls: "p-wikilink-x", text: "×" });
			if (entry.kind === "context") {
				x.addEventListener("click", async () => {
					conv.contextNotes = conv.contextNotes.filter(n => n !== entry.path);
					await this.plugin.conversationStore.save(conv);
					this.renderReferencePills();
				});
			} else {
				x.addEventListener("click", () => {
					new DeleteFileModal(this.app, fileName, async () => {
						const f = this.app.vault.getAbstractFileByPath(entry.path);
						if (f instanceof TFile) await this.app.vault.trash(f, true);
						entry.clearField();
						await this.plugin.conversationStore.save(conv);
						this.renderReferencePills();
					}).open();
				});
			}
		}

		const addBtn = this.referencePillsEl.createEl("button", {
			cls: "pythia-pill-add",
			attr: { title: t("addContextNoteTooltip") },
			text: t("addNoteInline"),
		});
		addBtn.addEventListener("click", () => {
			new NoteSuggestModal(this.app, (file) => {
				if (!conv.contextNotes.includes(file.path)) {
					conv.contextNotes.push(file.path);
					void this.plugin.conversationStore.save(conv);
					this.renderReferencePills();
				}
			}).open();
		});
	}


	private async renderMessages(scrollTo: "bottom" | "top" = "bottom"): Promise<void> {
		this.hideDeletePreview();

		if (!this.activeConversation) {
			this.messagesEl.empty();
			this.renderedConvId = null;
			this.lastRenderedMsgId = null;
			this.renderEmptyState();
			return;
		}

		const conv = this.activeConversation;
		const msgs = conv.messages;
		const tailId = msgs.at(-1)?.id ?? null;

		// ── Same conversation, nothing new ───────────────────────────────────────
		// The DOM already reflects the full message list — only handle scroll.
		if (this.renderedConvId === conv.id && this.lastRenderedMsgId === tailId) {
			if (scrollTo === "top") {
				this.scrollToTop();
			} else {
				this.scrollToBottom();
			}
			this.attachLastBubbleLongPress();
			return;
		}

		// ── Same conversation, new messages appended ─────────────────────────────
		// Append only the messages that aren't yet in the DOM.
		if (this.renderedConvId === conv.id && this.lastRenderedMsgId !== null) {
			const anchorIdx = msgs.findIndex(m => m.id === this.lastRenderedMsgId);
			if (anchorIdx !== -1) {
				this.messagesEl.querySelector(".pythia-empty, .p-welcome")?.remove();
				for (let i = anchorIdx + 1; i < msgs.length; i++) {
					await this.appendMessageBubble(msgs[i]);
				}
				this.lastRenderedMsgId = tailId;
				// New turn(s) changed the context size — refresh the inspector so
				// its budget figure / near-full warning stay current without a
				// full rebuild.
				if (this.inspectorEl) this.fillContextInspector();
				if (scrollTo === "top") {
					this.scrollToTop();
				} else {
					this.scrollToBottom();
				}
				this.attachLastBubbleLongPress();
				return;
			}
			// anchor not found (e.g. delete-last-exchange removed the tracked message)
			// → fall through to full rebuild
		}

		// ── Full rebuild ─────────────────────────────────────────────────────────
		this.messagesEl.empty();
		this.openForkAnchor = null; // detached by empty(); drop the stale reference
		this.renderedConvId = conv.id;
		this.lastRenderedMsgId = null;

		// Context inspector is the very first thing in the conversation view.
		this.inspectorEl = this.messagesEl.createDiv({ cls: "p-inspector-wrap" });
		this.fillContextInspector();

		// The fork banner ("branched from…") comes next: on a fork it's the primary
		// orientation cue, so it sits above the summary cards and next to the first
		// message (ADR-084).
		if (conv.forkedFromId) this.renderForkBannerEl();

		// Summary "Speisekarte" cards sit below the fork info.
		this.summaryCardsEl = this.messagesEl.createDiv({ cls: "p-summary-cards" });
		this.renderSummaryCards();

		if (msgs.length === 0) {
			this.renderWelcome(this.messagesEl);
			return;
		}
		for (const msg of msgs) {
			await this.appendMessageBubble(msg);
		}
		this.lastRenderedMsgId = tailId;

		if (scrollTo === "top") {
			this.scrollToTop();
		} else {
			this.scrollToBottom();
		}
		this.attachLastBubbleLongPress();
	}

	/** Turn micro-label above every message: "DU · 14:31" for user turns,
	 *  "PYTHIA · SONNET 4.6 · 14:32" for assistant turns. The model is taken from
	 *  the message (recorded at generation time) and falls back to the
	 *  conversation's current model for legacy messages that predate the field. */
	private renderTurnLabel(row: HTMLElement, msg: Message): void {
		const time = formatClockTime(msg.timestamp);
		const parts: string[] = [];
		if (msg.role === "user") {
			parts.push(t("turnUser"));
			// Anchor the day: the first user turn of each new day (and the very first
			// message of the conversation) carries an absolute date, so time-only
			// labels stay unambiguous across multi-day conversations.
			if (this.isFirstMessageOfDay(msg)) {
				const date = this.formatTurnDate(msg.timestamp);
				if (date) parts.push(date);
			}
			if (time) parts.push(time);
		} else {
			parts.push(t("turnAI"));
			const model = msg.model ?? this.activeConversation?.model;
			if (model) parts.push(abbreviateModel(model).toUpperCase());
			if (time) parts.push(time);
		}
		const label = row.createDiv({ cls: "p-turn-label", text: parts.join(" · ") });
		if (msg.role === "assistant" && msg.tokenUsage) {
			this.appendTokensToTurnLabel(label, msg.tokenUsage);
		}
	}

	/** True when `msg` starts a new calendar day relative to the message before it
	 *  (any role) — or is the first message of the conversation. Computed from the
	 *  message array so it holds in both the full-rebuild and incremental-append
	 *  render paths. */
	private isFirstMessageOfDay(msg: Message): boolean {
		const msgs = this.activeConversation?.messages;
		if (!msgs) return false;
		const idx = msgs.findIndex((m) => m.id === msg.id);
		if (idx <= 0) return true; // first message (or not found) → anchor the date
		const dayKey = (iso: string): string | null => {
			const d = new Date(iso);
			return Number.isNaN(d.getTime())
				? null
				: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
		};
		const cur = dayKey(msg.timestamp);
		const prev = dayKey(msgs[idx - 1].timestamp);
		if (cur === null || prev === null) return false; // no reliable date → no marker
		return cur !== prev;
	}

	/** Absolute date for a turn label (`27 Aug 2026`, localized). Deliberately not
	 *  the relative "Heute/Gestern" of `formatConvDate` — the label must stay
	 *  correct when the conversation is reopened later. */
	private formatTurnDate(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return "";
		return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
	}

	/** Pick the on-accent label color that reads best on the user's accent.
	 *  Obsidian's `--text-on-accent` is static (white in the default theme) and
	 *  never adapts to a customized `--color-accent`, so a pale/mid accent leaves
	 *  accent-filled labels (Send button, active toolbar/effort pills) low-contrast.
	 *
	 *  We resolve the accent (and the theme's two on-accent tokens) to rgb via a
	 *  probe span. The theme token is kept ONLY when it clears WCAG AA on this
	 *  accent — respecting a theme that deliberately tints its on-accent label —
	 *  otherwise `--p-on-accent` is forced to pure black or white (whichever
	 *  contrasts more), which is guaranteed readable on ANY accent. This is the
	 *  case the earlier "better of the two theme tokens" pick missed: when BOTH
	 *  theme tokens read poorly on the accent, the less-bad one is still unreadable.
	 *  Re-run on css-change. */
	private applyAccentContrast(): void {
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		if (!root) return;
		const resolve = (expr: string): Rgb | null => {
			const probe = root.createSpan();
			probe.style.color = expr;
			probe.style.display = "none";
			const rgb = parseRgb(getComputedStyle(probe).color);
			probe.remove();
			return rgb;
		};
		const accent = resolve("var(--color-accent)");
		if (!accent) {
			root.style.removeProperty("--p-on-accent"); // leave the CSS fallback in charge
			return;
		}

		// Offer the theme's own on-accent tokens (when defined and resolvable) as
		// candidates; readableOnAccent uses the best one only if it clears AA, else
		// forces pure black/white. Keeping the CSS var strings (not the resolved rgb)
		// as the values means the label still tracks a later theme edit to that token.
		const tokens: { value: string; rgb: Rgb }[] = [];
		const onAccent = resolve("var(--text-on-accent, #fff)");
		const inverted = resolve("var(--text-on-accent-inverted, #000)");
		if (onAccent) tokens.push({ value: "var(--text-on-accent, #fff)", rgb: onAccent });
		if (inverted) tokens.push({ value: "var(--text-on-accent-inverted, #000)", rgb: inverted });

		root.style.setProperty("--p-on-accent", readableOnAccent(accent, tokens));
	}

	/** Append the input/output token counts inline to a turn label
	 *  ("… · ↑7.028 ↓125"), replacing the old separate footer row. */
	private appendTokensToTurnLabel(label: HTMLElement, usage: TokenUsage): void {
		const fmt = (n: number) => n.toLocaleString();
		label.createSpan({
			cls: "p-turn-tokens",
			text: ` · ${t("tokenCount", { input: fmt(usage.inputTokens), output: fmt(usage.outputTokens) })}`,
			attr: { title: t("tokenCountTitle", { input: fmt(usage.inputTokens), output: fmt(usage.outputTokens) }) },
		});
	}

	/** Replace ⟦cite:…⟧ markers left in the rendered markdown with numbered
	 *  superscript chips. Mirrors the favorites re-paint: walk text nodes and
	 *  swap each marker for a `.p-cite` chip that opens its source on click. */
	private paintCitations(body: HTMLElement, sources: MessageSource[]): void {
		const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
		const targets: Text[] = [];
		let node: Node | null;
		while ((node = walker.nextNode())) {
			if (node.nodeValue && node.nodeValue.indexOf("⟦cite:") !== -1) targets.push(node as Text);
		}
		for (const textNode of targets) {
			const text = textNode.nodeValue ?? "";
			const frag = document.createDocumentFragment();
			eachCitationSegment(
				text,
				sources,
				(t) => { if (t) frag.appendChild(document.createTextNode(t)); },
				(src) => {
					if (!src) return; // drop an unresolved marker entirely
					const chip = document.createElement("sup");
					chip.className = "p-cite";
					chip.textContent = String(src.n);
					chip.title = src.title;
					chip.addEventListener("click", (e) => { e.stopPropagation(); void this.onCitationClick(src); });
					frag.appendChild(chip);
				},
			);
			textNode.parentNode?.replaceChild(frag, textNode);
		}
	}

	private async onCitationClick(src: MessageSource): Promise<void> {
		if (src.kind === "web") {
			const url = /^https?:\/\//i.test(src.ref) ? src.ref : `https://${src.ref}`;
			window.open(url, "_blank");
			return;
		}
		const f = this.app.vault.getAbstractFileByPath(src.ref)
			?? this.app.metadataCache.getFirstLinkpathDest(src.ref, "");
		if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
		else new Notice(t("fileNotFound", { path: src.ref }));
	}

	/** Sources row under an assistant message. A single QUELLEN row when all
	 *  sources are vault notes; split WEB / VAULT rows when any are web. */
	private renderSourcesRow(row: HTMLElement, sources: MessageSource[]): void {
		if (!sources.length) return;
		const web = sources.filter((s) => s.kind === "web");
		const vault = sources.filter((s) => s.kind === "vault");
		const container = row.createDiv({ cls: "p-sources" });

		const makeRow = (label: string, items: MessageSource[]) => {
			const r = container.createDiv({ cls: "p-sources-row" });
			r.createSpan({ cls: "p-sources-label", text: label });
			for (const s of items) {
				const item = r.createSpan({ cls: "p-source" });
				item.createSpan({ cls: "p-source-num", text: String(s.n) });
				if (s.kind === "web") {
					const link = item.createSpan({ cls: "p-source-web", text: `${s.title} ↗` });
					link.addEventListener("click", () => void this.onCitationClick(s));
				} else {
					item.createSpan({ cls: "p-wikilink-bracket", text: " [[" });
					const name = item.createSpan({ cls: "p-wikilink-name", text: s.title });
					name.addEventListener("click", () => void this.onCitationClick(s));
					item.createSpan({ cls: "p-wikilink-bracket", text: "]]" });
				}
			}
		};

		if (web.length) {
			makeRow(t("sourcesWeb"), web);
			if (vault.length) makeRow(t("sourcesVault"), vault);
		} else {
			makeRow(t("sourcesLabel"), vault);
		}
	}

	private async appendMessageBubble(msg: Message): Promise<HTMLElement> {
		// ── User message ────────────────────────────────────────────
		if (msg.role === "user") {
			const row = this.messagesEl.createDiv({
				cls: "p-msg-user",
				attr: { "data-msg-id": msg.id },
			});
			this.renderTurnLabel(row, msg);
			const bubble = row.createDiv({ cls: "p-bubble" });
			const isLong = msg.content.length > 280;
			if (isLong) bubble.addClass("p-bubble-collapsed");
			try {
				await MarkdownRenderer.render(this.app, this.unwrapCodeFence(msg.content), bubble, "", this);
			} catch (e) {
				console.error("[Pythia] render error:", e);
			}
			this.repaintFavorites(bubble, msg.id);
			this.repaintForkOrigins(bubble, msg.id);
			if (isLong) {
				const toggle = row.createEl("button", {
					cls: "p-bubble-toggle",
					attr: { title: t("showMore") },
				});
				setIcon(toggle, "chevron-down");
				toggle.addEventListener("click", () => {
					const collapsed = bubble.hasClass("p-bubble-collapsed");
					bubble.toggleClass("p-bubble-collapsed", !collapsed);
					bubble.toggleClass("p-bubble-expanded", collapsed);
					setIcon(toggle, collapsed ? "chevron-up" : "chevron-down");
					toggle.title = collapsed ? t("showLess") : t("showMore");
				});
			}
			return bubble;
		}

		// ── Assistant message ────────────────────────────────────────
		const row = this.messagesEl.createDiv({
			cls: "p-msg-ai",
			attr: { "data-msg-id": msg.id },
		});
		this.renderTurnLabel(row, msg);
		const aiBody = row.createDiv({ cls: "p-ai-body" });
		try {
			await MarkdownRenderer.render(this.app, this.unwrapCodeFence(stripForeignCitations(msg.content)), aiBody, "", this);
		} catch (e) {
			console.error("[Pythia] render error:", e);
		}
		decorateCodeBlocks(aiBody, this.diagObservers);
		this.repaintFavorites(aiBody, msg.id);
		this.repaintForkOrigins(aiBody, msg.id);
		// Citations: paint markers → chips, then render the sources row. Backfill
		// sources from content for messages saved before the field existed.
		const sources = msg.sources ?? parseCitations(msg.content);
		this.paintCitations(aiBody, sources);
		this.renderSourcesRow(row, sources);
		// Token counts are shown inline in the turn label (renderTurnLabel),
		// not a separate footer.

		return aiBody;
	}

	private createStreamingBubble(): {
		appendToken: (text: string) => void;
		finalize: (fullText: string) => Promise<void>;
		row: HTMLElement;
	} {
		const row = this.messagesEl.createDiv({ cls: "p-msg-ai" });
		this.renderTurnLabel(row, {
			id: "", role: "assistant", content: "",
			timestamp: new Date().toISOString(), model: this.activeConversation?.model,
		});
		const aiBody = row.createDiv({ cls: "p-ai-body pythia-streaming" });
		const textNode = document.createTextNode("");
		aiBody.appendChild(textNode);

		return {
			row,
			appendToken: (text: string) => {
				textNode.textContent = (textNode.textContent ?? "") + text;
				this.scrollToBottom();
			},
			finalize: async (fullText: string) => {
				aiBody.removeClass("pythia-streaming");
				aiBody.empty();
				try {
					await MarkdownRenderer.render(this.app, this.unwrapCodeFence(stripForeignCitations(fullText)), aiBody, "", this);
				} catch (e) {
					console.error("[Pythia] render error:", e);
				}
				decorateCodeBlocks(aiBody, this.diagObservers);
				const sources = appendWebSources(parseCitations(fullText), this.pendingWebSources);
				this.paintCitations(aiBody, sources);
				this.renderSourcesRow(row, sources);
				// rAF ensures scrollToBottom runs after the markdown DOM is laid out.
				this.autoScroll = true;
				requestAnimationFrame(() => this.scrollToBottom(true));
			},
		};
	}

	// ── Code block decoration: drag-to-pan + copy button ────────────────────
	// When the LLM has a syntax reference in context it sometimes wraps the
	// generated code fence in a plain outer fence (no language tag). Strip it so
	// third-party processors (e.g. Vizardry) receive the bare fenced block.
	private unwrapCodeFence(text: string): string {
		return text.replace(
			/```[ \t]*\n(```[a-zA-Z][^\n]*\n[\s\S]*?\n[ \t]*```)[ \t]*\n[ \t]*```/g,
			"$1"
		);
	}


	private autoResizeTextarea(): void {
		requestAnimationFrame(() => {
			if (this.cachedLineHeight === null) {
				this.cachedLineHeight = parseFloat(getComputedStyle(this.inputEl).lineHeight) || 18.6;
			}
			const lineHeight = this.cachedLineHeight;
			const minH = Math.ceil(lineHeight * 2);
			const maxH = Math.ceil(lineHeight * 5);
			this.inputEl.style.height = "auto";
			this.inputEl.style.height = `${Math.min(Math.max(this.inputEl.scrollHeight, minH), maxH)}px`;
		});
	}

	private scrollToTop(): void {
		this.autoScroll = false;
		this.messagesEl.scrollTo({ top: 0, behavior: "instant" });
		requestAnimationFrame(() => {
			this.messagesEl.scrollTo({ top: 0, behavior: "instant" });
		});
	}

	private scrollToBottom(force = false): void {
		if (force || this.autoScroll) {
			this.isScrolling = true;
			this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
			requestAnimationFrame(() => { this.isScrolling = false; });
		}
	}

	// The layout viewport doesn't shrink when the soft keyboard appears, but
	// visualViewport does. Shrink the container to keep the input area visible.
	private adjustForKeyboard(): void {
		const vv = window.visualViewport;
		if (!vv) return;
		const container = this.containerEl.children[1] as HTMLElement;
		// Reset before measuring so repeated calls are idempotent.
		container.style.paddingBottom = '';
		container.style.height = '';
		const rect = container.getBoundingClientRect();
		const visibleBottom = vv.offsetTop + vv.height;
		const overflow = Math.round(rect.bottom - visibleBottom);
		if (overflow > 0) {
			container.style.height = `${container.offsetHeight - overflow}px`;
		}
	}

	/** Derive a short navigator label from the favorited text: first ~6 words, ≤40 chars. */
	private favoriteLabel(text: string): string {
		const clean = text.replace(/\s+/g, " ").trim();
		const words = clean.split(" ").slice(0, 6).join(" ");
		const label = words.length > 40 ? words.slice(0, 40).trimEnd() + "…" : words;
		return label || clean.slice(0, 40);
	}

	/** Re-apply every stored highlight for `messageId` onto its rendered body. */
	private repaintFavorites(body: HTMLElement, messageId: string): void {
		const favs = this.activeConversation?.favorites?.filter(
			(f) => f.messageId === messageId
		);
		if (!favs || favs.length === 0) {
			// No favorites left for this message — strip any stale marks.
			clearHighlights(body);
			return;
		}
		repaintBody(body, favs);
	}

	/** Paint the accent fork-origin marks for any forks that branched from `messageId`. */
	private repaintForkOrigins(body: HTMLElement, messageId: string): void {
		const convId = this.activeConversation?.id;
		if (!convId) return;
		const forks = this.plugin.conversationStore.getAll()
			.filter((c) => c.forkedFromId === convId && c.forkedFromMessageId === messageId && c.forkedFromSelection)
			// Trim the stored selection when searching so forks saved before ADR-096
			// (with an untrimmed selection that findRange can't locate) still paint.
			.map((c) => ({ id: c.id, text: c.forkedFromSelection!.trim(), occurrenceIndex: c.forkedFromOccurrenceIndex }));
		repaintForkOrigins(body, forks);
		// Diagnostic (debugMode only): shows each fork's stored text/index and whether
		// its origin mark actually landed — so a still-broken branch-back is traceable
		// without guessing (ADR-096).
		if (forks.length > 0) {
			debugLog(this.plugin.settings, "repaintForkOrigins", { messageId, forks: forks.map((f) => ({
				id: f.id,
				text: f.text,
				occurrenceIndex: f.occurrenceIndex,
				painted: !!body.querySelector(`.p-fork-origin[data-fork-id="${f.id}"]`),
			})) });
		}
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

		// Fork origin wins over favorites.
		const forkMark = target?.closest(".p-fork-origin");
		const forkId = forkMark?.getAttribute("data-fork-id");
		if (forkId) {
			this.toggleForkAnchor(forkId, forkMark as HTMLElement);
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

	// ── Fork-origin inline anchor ──────────────────────────────────────────────

	/** Toggle the inline fork-summary anchor for a fork-origin snippet. */
	private toggleForkAnchor(forkId: string, markEl: HTMLElement): void {
		// Tapping the already-open anchor's snippet closes it.
		if (this.openForkAnchor?.getAttribute("data-fork-id") === forkId) {
			this.closeForkAnchor();
			return;
		}
		this.closeForkAnchor();

		const fork = this.plugin.conversationStore.getById(forkId);
		if (!fork) return;

		// Insert the anchor immediately after the snippet's last mark fragment.
		const row = markEl.closest("[data-msg-id]");
		const marks = row?.querySelectorAll<HTMLElement>(`.p-fork-origin[data-fork-id="${forkId}"]`);
		const lastMark = marks && marks.length ? marks[marks.length - 1] : markEl;

		const anchor = createDiv({ cls: "p-fork-anchor", attr: { "data-fork-id": forkId } });
		lastMark.after(anchor);
		this.openForkAnchor = anchor;
		this.buildForkAnchor(anchor, fork);
	}

	private closeForkAnchor(): void {
		this.closeForkMenu();
		this.openForkAnchor?.remove();
		this.openForkAnchor = null;
	}

	/** Fill the anchor with the fork's summary and its Open-fork control.
	 *  `preferType` forces which summary shows (the one just generated); otherwise
	 *  favorites are preferred over the conversation summary. Long-pressing the
	 *  Open-fork button opens a menu to (re)generate either summary. */
	private buildForkAnchor(
		anchor: HTMLElement,
		fork: Conversation,
		preferType?: "conversation" | "favorites",
	): void {
		anchor.empty();
		this.closeForkMenu();

		const favText = fork.favoritesSummary?.text?.trim();
		const convText = fork.summaryText?.trim();
		let summary: string | undefined;
		// Track which summary is displayed so the meta line can show its generation
		// date (favorites is preferred unless "conversation" is forced).
		let summaryKind: "conversation" | "favorites" | undefined;
		const pickConv = () => { summary = convText; summaryKind = "conversation"; };
		const pickFav = () => { summary = favText; summaryKind = "favorites"; };
		if (preferType === "conversation") { if (convText) pickConv(); else if (favText) pickFav(); }
		else { if (favText) pickFav(); else if (convText) pickConv(); }

		// Header: branch icon + ABZWEIGUNG micro-label (F1).
		const head = anchor.createDiv({ cls: "p-fork-anchor-head" });
		setIcon(head.createSpan({ cls: "p-fork-anchor-icon" }), "git-branch");
		head.createSpan({ cls: "p-fork-anchor-label", text: t("forkAnchorLabel") });

		// Fork title.
		anchor.createDiv({ cls: "p-fork-anchor-title", text: fork.name });

		// One or more summary paragraphs (multi-paragraph is the norm — no clamp).
		if (summary) {
			const body = anchor.createDiv({ cls: "p-fork-anchor-body" });
			void MarkdownRenderer.render(this.app, summary, body, "", this)
				.catch((e) => console.error("[Pythia] fork summary render:", e));
		}

		// Meta line: "N Nachrichten · Model · <generated date> · Öffnen →". Model and
		// date are shown only when a summary exists; the date reflects whichever
		// summary is displayed. The Öffnen link short-presses to open the fork,
		// long-presses for the summary menu.
		const meta = anchor.createDiv({ cls: "p-fork-anchor-meta" });
		const summaryTs = summaryKind === "favorites"
			? fork.favoritesSummary?.updatedAt
			: summaryKind === "conversation"
				? fork.summaryUpdatedAt
				: undefined;
		const metaParts = [t("msgCount", { n: String(fork.messages.length) })];
		if (summaryTs) {
			metaParts.push(abbreviateModel(fork.model));
			metaParts.push(formatSummaryTimestamp(summaryTs));
		}
		meta.createSpan({
			cls: "p-fork-anchor-metatext",
			text: `${metaParts.join(" · ")} · `,
		});
		const openWrap = meta.createSpan({ cls: "p-fork-open-wrap" });
		const open = openWrap.createEl("button", { cls: "p-fork-anchor-open", text: t("forkOpenShort") });
		open.addEventListener("click", (e) => {
			e.stopPropagation();
			if (this.suppressNextForkOpen) {
				this.suppressNextForkOpen = false;
				return;
			}
			void this.setActiveConversation(fork);
		});
		this.attachForkLongPress(open, openWrap, anchor, fork);
	}

	/** 450 ms touch+mouse long-press on the Open-fork button → summary menu. */
	private attachForkLongPress(
		btn: HTMLElement,
		wrap: HTMLElement,
		anchor: HTMLElement,
		fork: Conversation,
	): void {
		let timer: ReturnType<typeof setTimeout> | null = null;
		const cancel = () => {
			if (timer !== null) { clearTimeout(timer); timer = null; }
		};
		const fire = () => {
			timer = null;
			this.suppressNextForkOpen = true;
			this.openForkMenu(wrap, anchor, fork);
		};
		this.registerDomEvent(btn, "touchstart", () => { timer = setTimeout(fire, 450); }, { passive: true });
		this.registerDomEvent(btn, "touchend", cancel, { passive: true });
		this.registerDomEvent(btn, "touchcancel", cancel, { passive: true });
		this.registerDomEvent(btn, "touchmove", cancel, { passive: true });
		this.registerDomEvent(btn, "mousedown", (e: MouseEvent) => { if (e.button === 0) timer = setTimeout(fire, 450); });
		this.registerDomEvent(btn, "mouseup", cancel);
		this.registerDomEvent(btn, "mouseleave", cancel);
	}

	/** The fork anchor's long-press menu — a popover above the Open-fork button.
	 *  "Summarize favorites" is offered only when the fork carries favorites. */
	private openForkMenu(wrap: HTMLElement, anchor: HTMLElement, fork: Conversation): void {
		if (this.forkMenuCleanup) { this.closeForkMenu(); return; } // toggle off

		const menu = wrap.createDiv({ cls: "p-send-menu p-fork-menu" });
		const hasFavorites = (fork.favorites?.length ?? 0) > 0;

		const addItem = (label: string, icon: string, disabled: boolean, action: () => void) => {
			const item = menu.createDiv({
				cls: `p-send-menu-item${disabled ? " p-send-menu-item-disabled" : ""}`,
			});
			const ic = item.createSpan({ cls: "p-send-menu-icon" });
			setIcon(ic, icon);
			item.createSpan({ cls: "p-send-menu-label", text: label });
			if (disabled) return;
			item.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.closeForkMenu();
				action();
			});
		};

		addItem(t("menuSummarizeConversation"), "align-left", fork.messages.length === 0,
			() => void this.generateForkSummary(anchor, fork, "conversation"));
		if (hasFavorites) {
			addItem(t("menuSummarizeFavorites"), "star", false,
				() => void this.generateForkSummary(anchor, fork, "favorites"));
		}

		const onOutside = (e: Event) => {
			if (!wrap.contains(e.target as Node)) this.closeForkMenu();
		};
		window.setTimeout(() => {
			document.addEventListener("mousedown", onOutside, true);
			document.addEventListener("touchstart", onOutside, true);
		}, 0);
		this.forkMenuCleanup = () => {
			document.removeEventListener("mousedown", onOutside, true);
			document.removeEventListener("touchstart", onOutside, true);
			menu.remove();
		};
	}

	private closeForkMenu(): void {
		this.forkMenuCleanup?.();
		this.forkMenuCleanup = null;
	}

	/** Generate (or regenerate) a fork's conversation or favorites summary, then
	 *  re-render the anchor showing the type just generated. */
	private async generateForkSummary(
		anchor: HTMLElement,
		fork: Conversation,
		type: "conversation" | "favorites",
	): Promise<void> {
		if (type === "favorites") {
			const text = await this.runFavoritesSummary(fork);
			if (text && this.openForkAnchor === anchor) this.buildForkAnchor(anchor, fork, "favorites");
			return;
		}
		if (fork.messages.length === 0) { new Notice(t("noMessagesToSummarize")); return; }
		const notice = new Notice(t("generatingSummary"), 0);
		try {
			// Use generateSummaryWithTitle (not generateSummary) so summarizing a fork
			// from its source-side anchor also RETITLES the fork — matching the in-fork
			// path (generateConversationSummary). Without this, a fork summarized from
			// the origin keeps its generic "Fork of X" name while one summarized from
			// inside gets a real title.
			const { title, summary } = await this.plugin.llmRouter.generateSummaryWithTitle(fork);
			if (summary) {
				fork.summaryText = summary;
				fork.summaryUpdatedAt = new Date().toISOString();
				if (title) {
					fork.name = title;
					void this.plugin.renameConversationFile(fork);
				}
				await this.plugin.conversationStore.save(fork);
				if (this.openForkAnchor === anchor) this.buildForkAnchor(anchor, fork, "conversation");
			}
		} catch (err) {
			new Notice(t("summaryFailed", { error: err instanceof Error ? err.message : String(err) }));
		} finally {
			notice.hide();
		}
	}

	/** From a fork's banner: scroll to its origin snippet in the source and expand its anchor. */
	revealForkOrigin(forkId: string): void {
		const mark = this.messagesEl.querySelector<HTMLElement>(
			`.p-fork-origin[data-fork-id="${forkId}"]`
		);
		if (!mark) return;
		const row = mark.closest("[data-msg-id]") as HTMLElement | null;
		if (row) this.expandBubbleIfCollapsed(row);
		this.toggleForkAnchor(forkId, mark);
		const top = mark.offsetTop - this.messagesEl.offsetTop;
		this.messagesEl.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
	}

	/**
	 * Favorite the current text selection as a highlighted span, or unfavorite the
	 * tapped highlight when `tappedFavId` is set. Selections must stay within a
	 * single message; cross-message selections are rejected.
	 */
	private async onFavoriteSelection(): Promise<void> {
		const conv = this.activeConversation;
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
		await this.plugin.conversationStore.save(conv);

		this.selectionToolbar.style.display = "none";
		window.getSelection()?.removeAllRanges();
		// Repaint the whole message body so the new mark is applied cleanly.
		this.repaintFavorites(body, messageId);
	}

	/** Remove a favorite by its id and strip its highlight from the DOM. */
	private async removeFavorite(favId: string): Promise<void> {
		if (!this.activeConversation) return;
		const conv = this.activeConversation;
		const fav = conv.favorites?.find((f) => f.id === favId);
		conv.favorites = (conv.favorites ?? []).filter((f) => f.id !== favId);
		await this.plugin.conversationStore.save(conv);
		// Surgically unwrap only this favorite's marks so other highlights in the
		// same message are never affected (no clear-all-then-repaint).
		if (fav) {
			const row = this.messagesEl.querySelector(
				`[data-msg-id="${fav.messageId}"]`
			) as HTMLElement | null;
			const body = row?.querySelector<HTMLElement>(".p-ai-body, .p-bubble") ?? row;
			if (body) removeHighlightById(body, favId);
		}
	}

	scrollToMessage(messageId: string): void {
		const row = this.messagesEl.querySelector(
			`[data-msg-id="${messageId}"]`
		) as HTMLElement | null;
		if (!row) return;
		// Scroll messagesEl directly so the row appears at the top of the
		// visible area. scrollIntoView() targets the wrong scroll ancestor on
		// iOS and uses block:"center" which hides the start of long messages.
		const TOP_MARGIN = 8;
		const rowTop = row.offsetTop - this.messagesEl.offsetTop;
		this.messagesEl.scrollTo({ top: rowTop - TOP_MARGIN, behavior: "smooth" });
	}

	/**
	 * Jump to a favorite. Prefers the painted highlight mark (scrolls its start to
	 * the top), re-finds the text if the mark is missing, and falls back to the
	 * message top for legacy favorites or text that can no longer be located.
	 */
	scrollToFavorite(fav: Favorite): void {
		const row = this.messagesEl.querySelector(
			`[data-msg-id="${fav.messageId}"]`
		) as HTMLElement | null;
		if (!row) return;

		// Expand a collapsed long bubble first so the highlight mark is laid out and
		// its offset is measurable. Reading offsetTop below forces synchronous layout,
		// so no requestAnimationFrame is needed — mirrors scrollToMessage (Chapters),
		// which navigates correctly on the first tap.
		this.expandBubbleIfCollapsed(row);

		const TOP_MARGIN = 8;
		const scrollToOffsetTop = (top: number) =>
			this.messagesEl.scrollTo({ top: top - TOP_MARGIN, behavior: "smooth" });

		// 1) Painted mark — the common case.
		const mark = row.querySelector<HTMLElement>(
			`.p-highlight[data-fav-id="${fav.id}"]`
		);
		if (mark) {
			scrollToOffsetTop(mark.offsetTop - this.messagesEl.offsetTop);
			flashHighlight(fav.id, row);
			return;
		}

		// 2) Re-find the text (e.g. legacy favorite, or mark not painted).
		if (fav.text) {
			const body = row.querySelector<HTMLElement>(".p-ai-body, .p-bubble") ?? row;
			const range = findRange(body, fav.text, fav.occurrenceIndex ?? 0);
			if (range) {
				const rect = range.getBoundingClientRect();
				const containerRect = this.messagesEl.getBoundingClientRect();
				const top = this.messagesEl.scrollTop + (rect.top - containerRect.top);
				scrollToOffsetTop(top);
				return;
			}
		}

		// 3) Legacy / not-found — scroll to the message top.
		scrollToOffsetTop(row.offsetTop - this.messagesEl.offsetTop);
	}

	/** Expand a collapsed long user bubble in `row`, syncing its toggle icon. */
	private expandBubbleIfCollapsed(row: HTMLElement): void {
		const bubble = row.querySelector<HTMLElement>(".p-bubble.p-bubble-collapsed");
		if (!bubble) return;
		bubble.removeClass("p-bubble-collapsed");
		bubble.addClass("p-bubble-expanded");
		const toggle = row.querySelector<HTMLElement>(".p-bubble-toggle");
		if (toggle) {
			setIcon(toggle, "chevron-up");
			toggle.title = t("showLess");
		}
	}

	private updateModelBadge(): void {
		if (!this.activeConversation) {
			this.modelBadgeEl.style.display = "none";
			return;
		}
		const model = this.activeConversation.model ?? "";
		this.modelBadgeEl.setText(abbreviateModel(model));
		this.modelBadgeEl.style.display = "";
		this.updateSendHint();
		this.updateContextBar();
	}

	/** Show a warning beside Send when the effective max-tokens is low enough that
	 *  a reasoning model's hidden reasoning budget could truncate the reply — the
	 *  main sharp edge of switching a conversation onto a reasoning model. */
	private updateSendHint(): void {
		if (!this.sendHintEl) return;
		const conv = this.activeConversation;
		const model = conv?.model ?? "";
		const isReasoning = !!model && (isReasoningModel(model) || isMistralReasoningModel(model));
		// undefined ⇒ the model-appropriate default applies, so there is nothing to warn about.
		const effective = conv?.maxTokens ?? this.plugin.settings.maxTokens;
		const warn = isReasoning && effective !== undefined && effective < DEFAULT_MAX_TOKENS_REASONING;
		if (!warn) {
			this.sendHintEl.style.display = "none";
			return;
		}
		this.sendHintEl.setAttribute(
			"title",
			t("sendMaxTokensHint", {
				max: String(effective),
				model: abbreviateModel(model),
				recommended: String(DEFAULT_MAX_TOKENS_REASONING),
			}),
		);
		this.sendHintEl.style.display = "";
	}

	/** Reflect the active conversation's research (web-search) state on the
	 *  toolbar toggle. Called on build and on every conversation switch, since
	 *  the input toolbar is not rebuilt when the active conversation changes. */
	private updateResearchButton(): void {
		if (!this.researchBtnEl) return;
		const on = !!this.activeConversation?.researchMode;
		this.researchBtnEl.toggleClass("is-active", on);
		this.researchBtnEl.setAttr("aria-pressed", String(on));
	}

	/** Toggle web search for the active conversation. Warns (but still toggles)
	 *  when no Tavily key is configured so the intent is remembered for when one
	 *  is added. Persists so the choice survives reloads and device sync. */
	private toggleResearchMode(): void {
		const conv = this.activeConversation;
		if (!conv) return;
		conv.researchMode = !conv.researchMode;
		this.updateResearchButton();
		if (conv.researchMode && !this.plugin.webSearchService.hasApiKey()) {
			new Notice(t("researchNoKeyNotice"));
		} else {
			new Notice(conv.researchMode ? t("researchEnabledNotice") : t("researchDisabledNotice"));
		}
		void this.plugin.conversationStore.save(conv);
	}

	/** Format a context window as "1M" / "200k" / "128k". */
	private fmtWindow(n: number): string {
		if (n >= 1_000_000) {
			const m = n / 1_000_000;
			return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
		}
		return `${Math.round(n / 1000)}k`;
	}

	/** Anchored model popover (F7): provider groups with context-window labels,
	 *  Reasoning tags, an active check, and a footer that opens the full
	 *  conversation-settings modal. Selecting a model applies it immediately. */
	private openModelPopover(): void {
		const conv = this.activeConversation;
		if (!conv) return;
		if (this.modelPopoverCleanup) { this.modelPopoverCleanup(); return; } // toggle

		const container = this.containerEl.children[1] as HTMLElement;
		const pop = container.createDiv({ cls: "p-model-pop" });
		// Absolute within the (position:relative) view root — robust against an
		// Obsidian ancestor that turns position:fixed into a clipped containing
		// block. Height is capped to the space below the chip with internal scroll.
		const cRect = container.getBoundingClientRect();
		const rect = this.modelBadgeEl.getBoundingClientRect();
		const width = 226;
		const top = rect.bottom - cRect.top + 4;
		let left = rect.right - cRect.left - width;
		left = Math.max(4, Math.min(left, cRect.width - width - 4));
		pop.style.position = "absolute";
		pop.style.top = `${top}px`;
		pop.style.left = `${left}px`;
		pop.style.width = `${width}px`;
		pop.style.maxHeight = `${Math.max(120, cRect.height - top - 8)}px`;
		this.modelBadgeEl.addClass("open");

		const onOutside = (e: MouseEvent) => {
			if (!pop.contains(e.target as Node) && e.target !== this.modelBadgeEl) closePop();
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePop(); };
		const closePop = () => {
			pop.remove();
			this.modelBadgeEl.removeClass("open");
			document.removeEventListener("mousedown", onOutside, true);
			document.removeEventListener("keydown", onKey, true);
			this.modelPopoverCleanup = null;
		};

		const providers: { key: typeof conv.provider; label: string }[] = [
			{ key: "anthropic", label: "ANTHROPIC" },
			{ key: "openai", label: "OPENAI" },
			{ key: "mistral", label: "MISTRAL" },
		];
		for (const p of providers) {
			const models = MODEL_CATALOG.filter((m) => m.provider === p.key && !m.hidden);
			if (!models.length) continue;
			pop.createDiv({ cls: "p-model-pop-group", text: p.label });
			for (const m of models) {
				const active = m.id === conv.model && m.provider === conv.provider;
				const row = pop.createDiv({ cls: "p-model-pop-row" });
				if (active) row.addClass("active");
				row.createSpan({ cls: "p-model-pop-name", text: m.abbreviation });
				if (m.isReasoning || m.isMistralReasoning) {
					row.createSpan({ cls: "p-model-pop-rtag", text: t("reasoningTag") });
				}
				row.createSpan({ cls: "p-model-pop-ctx", text: this.fmtWindow(m.contextWindow) });
				if (active) setIcon(row.createSpan({ cls: "p-model-pop-check" }), "check");
				row.addEventListener("mousedown", (e) => {
					e.preventDefault(); e.stopPropagation();
					void this.applyModelChoice(m);
					closePop();
				});
			}
		}

		const footer = pop.createDiv({ cls: "p-model-pop-footer" });
		setIcon(footer.createSpan({ cls: "p-model-pop-footer-icon" }), "sliders");
		footer.createSpan({ text: t("openConvSettings") });
		footer.addEventListener("mousedown", (e) => {
			e.preventDefault(); e.stopPropagation();
			closePop();
			this.onModelBadgeClick();
		});

		setTimeout(() => {
			document.addEventListener("mousedown", onOutside, true);
			document.addEventListener("keydown", onKey, true);
			this.modelPopoverCleanup = closePop;
		}, 0);
	}

	private async applyModelChoice(m: ModelInfo): Promise<void> {
		const conv = this.activeConversation;
		if (!conv) return;
		conv.provider = m.provider;
		conv.model = m.id;
		await this.plugin.conversationStore.save(conv);
		this.updateModelBadge();
		if (this.inspectorEl) this.fillContextInspector();
	}

	private onModelBadgeClick(): void {
		if (!this.activeConversation) return;
		new ConversationSettingsModal(
			this.app,
			this.activeConversation,
			async (conv) => {
				await this.plugin.conversationStore.save(conv);
				this.updateModelBadge();
				if (this.inspectorEl) this.fillContextInspector();
			},
			this.plugin.settings.temperature,
			this.plugin.settings.effort,
			this.plugin.settings.maxTokens
		).open();
	}

	/** Confirm-and-delete a conversation, reselecting a remaining one (or a fresh
	 *  conversation) if the active one was removed. `onDone` fires after deletion. */
	private deleteConversationWithConfirm(conv: Conversation, onDone?: () => void): void {
		if (this.isStreaming) {
			new Notice(t("cannotDeleteWhileStreaming"));
			return;
		}
		new DeleteConversationModal(this.app, conv, async () => {
			await this.plugin.conversationStore.delete(conv.id);
			new Notice(t("conversationDeleted"));
			if (this.activeConversation?.id === conv.id) {
				const remaining = this.plugin.conversations;
				if (remaining.length > 0) {
					await this.setActiveConversation(remaining[remaining.length - 1]);
				} else {
					await this.plugin.cmdNewConversation();
				}
			}
			onDone?.();
		}).open();
	}

	private onConvNameClick(): void {
		this.openQuickSwitcher();
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
	private openQuickSwitcher(): void {
		if (this.plugin.conversations.length === 0) return;
		if (this.quickSwitcherCleanup) { this.quickSwitcherCleanup(); return; } // toggle

		const container = this.containerEl.children[1] as HTMLElement;
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

		const closeSw = () => {
			panel.remove();
			document.removeEventListener("mousedown", onOutside, true);
			this.quickSwitcherCleanup = null;
		};
		const openConv = (conv: Conversation) => { closeSw(); void this.setActiveConversation(conv); };
		const onOutside = (e: MouseEvent) => {
			if (!panel.contains(e.target as Node) && e.target !== this.convNameEl) closeSw();
		};

		const paintSelection = () => {
			rows.forEach((r, i) => r.el.toggleClass("selected", i === selectedIdx));
			rows[selectedIdx]?.el.scrollIntoView({ block: "nearest" });
		};

		const addRow = (conv: Conversation, isFork: boolean, q: string) => {
			if (q && !conv.name.toLowerCase().includes(q)) return;
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
				const forkCount = this.plugin.conversations.filter((c) => c.forkedFromId === conv.id).length;
				if (forkCount) subEl.createSpan({ cls: "p-switcher-fork-count", text: ` ⑂ ${forkCount}` });
				const favCount = conv.favorites?.length ?? 0;
				if (favCount) subEl.createSpan({ cls: "p-switcher-fav-count", text: ` ★ ${favCount}` });
			}

			// Rename affordance (the header pencil is easy to miss): opens an input to
			// rename THIS conversation. Discoverable via the title dropdown users
			// already open, and works for any conversation, not just the active one.
			const rename = row.createSpan({ cls: "p-switcher-rename", text: "✎", attr: { title: t("renameConvTooltip") } });
			rename.addEventListener("mousedown", (e) => {
				e.preventDefault(); e.stopPropagation();
				closeSw(); // rename happens in its own modal; close the popover first
				new InputModal(this.app, t("renameConvTooltip"), t("renameConvPlaceholder"), conv.name, (value) => {
					const newName = value.trim();
					if (!newName || newName === conv.name) return;
					conv.name = newName;
					void this.plugin.conversationStore.save(conv);
					void this.plugin.renameConversationFile(conv);
					if (this.activeConversation?.id === conv.id) this.renderHeader();
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
			const all = this.plugin.conversations;
			const byId = new Map(all.map((c) => [c.id, c]));
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
	private openHistoryView(): void {
		if (this.historyCleanup) { this.historyCleanup(); return; } // toggle
		const container = this.containerEl.children[1] as HTMLElement;
		const overlay = container.createDiv({ cls: "p-history" });

		const close = () => {
			overlay.remove();
			document.removeEventListener("keydown", onKey, true);
			this.historyCleanup = null;
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
		const openConv = (conv: Conversation) => { close(); void this.setActiveConversation(conv); };

		// ── Header ───────────────────────────────────────────────────
		const head = overlay.createDiv({ cls: "p-history-head" });
		const backBtn = head.createEl("button", { cls: "p-hdr-btn", attr: { title: t("backTooltip") } });
		setIcon(backBtn, "arrow-left");
		backBtn.addEventListener("click", () => close());
		head.createDiv({ cls: "p-history-title", text: t("histTitle") });
		const newBtn = head.createEl("button", { cls: "p-hdr-btn", attr: { title: t("newConvTooltip") } });
		setIcon(newBtn, "plus");
		newBtn.addEventListener("click", () => { close(); void this.plugin.cmdNewConversation(); });

		// ── Search ───────────────────────────────────────────────────
		const searchRow = overlay.createDiv({ cls: "p-switcher-search" });
		setIcon(searchRow.createSpan({ cls: "p-switcher-search-icon" }), "search");
		const input = searchRow.createEl("input", {
			cls: "p-switcher-input",
			attr: { type: "text", placeholder: t("switcherSearchPlaceholder") },
		});

		const listEl = overlay.createDiv({ cls: "p-history-list" });

		const rowSub = (conv: Conversation, isFork: boolean): HTMLElement => {
			const sub = createDiv({ cls: "p-history-sub" });
			if (isFork) {
				sub.appendText(`${t("branchLabel")} · ${t("msgCountShort", { n: String(conv.messages.length) })}`);
				return sub;
			}
			sub.appendText(`${abbreviateModel(conv.model)} · ${t("msgCountShort", { n: String(conv.messages.length) })}`);
			const forkCount = this.plugin.conversations.filter((c) => c.forkedFromId === conv.id).length;
			if (forkCount) sub.createSpan({ cls: "p-history-fork-count", text: ` ⑂ ${forkCount}` });
			const favCount = conv.favorites?.length ?? 0;
			if (favCount) sub.createSpan({ cls: "p-history-fav-count", text: ` ★ ${favCount}` });
			return sub;
		};

		const addRow = (conv: Conversation, isFork: boolean, q: string): boolean => {
			if (q && !conv.name.toLowerCase().includes(q)) return false;
			const row = listEl.createDiv({ cls: isFork ? "p-history-row fork" : "p-history-row" });
			if (conv.id === this.activeConversation?.id) row.addClass("active");
			if (isFork) setIcon(row.createSpan({ cls: "p-switcher-fork-icon" }), "git-branch");
			const main = row.createDiv({ cls: "p-history-main" });
			main.createDiv({ cls: "p-history-row-title", text: conv.name });
			main.appendChild(rowSub(conv, isFork));
			if (conv.id === this.activeConversation?.id) {
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

		const buildList = (query: string) => {
			listEl.empty();
			const q = query.toLowerCase().trim();
			const all = this.plugin.conversations;
			const byId = new Map(all.map((c) => [c.id, c]));
			const sources = all
				.filter((c) => !c.forkedFromId || !byId.has(c.forkedFromId))
				.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
			let currentBucket = "";
			for (const src of sources) {
				const forks = all
					.filter((c) => c.forkedFromId === src.id)
					.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
				// Skip the whole group if nothing matches the query.
				if (q && !src.name.toLowerCase().includes(q) && !forks.some((f) => f.name.toLowerCase().includes(q))) {
					continue;
				}
				const bucket = this.historyBucket(src.updatedAt);
				if (bucket !== currentBucket) {
					currentBucket = bucket;
					listEl.createDiv({ cls: "p-history-group", text: bucket });
				}
				addRow(src, false, ""); // source always shown when its group is shown
				for (const f of forks) addRow(f, true, q);
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

	private enterRenameMode(): void {
		const conv = this.activeConversation;
		if (!conv) return;
		this.convNameEl.style.display = "none";
		this.renameBtn.style.display = "none";
		this.renameWrapEl.style.display = "";
		this.renameInputEl.value = conv.name;
		requestAnimationFrame(() => {
			this.renameInputEl.focus();
			this.renameInputEl.select();
		});
	}

	private exitRenameMode(confirm: boolean): void {
		if (this.renameWrapEl.style.display === "none") return;
		this.renameWrapEl.style.display = "none";
		this.convNameEl.style.display = "";
		this.renameBtn.style.display = this.activeConversation ? "" : "none";
		if (confirm && this.activeConversation) {
			const newName = this.renameInputEl.value.trim();
			if (newName && newName !== this.activeConversation.name) {
				this.activeConversation.name = newName;
				void this.plugin.conversationStore.save(this.activeConversation);
				this.convNameEl.setText(newName + " ▾");
			}
		}
	}

	private async onRenameLLM(): Promise<void> {
		const conv = this.activeConversation;
		if (!conv) return;

		this.renameLLMBtn.disabled = true;
		this.renameLLMBtn.addClass("p-rename-refresh-loading");

		try {
			const msgs = conv.messages;
			const userMsg   = msgs.find(m => m.role === "user")?.content     ?? "";
			const assistMsg = msgs.find(m => m.role === "assistant")?.content ?? "";
			const title = await this.plugin.llmRouter.generateConversationTitle(
				userMsg, assistMsg, conv.provider
			);
			// Fill the input with the generated name — user can still edit before confirming
			this.renameInputEl.value = title;
			this.renameInputEl.focus();
			this.renameInputEl.select();
		} catch {
			new Notice(t("renameLLMFailed"));
		} finally {
			this.renameLLMBtn.disabled = false;
			this.renameLLMBtn.removeClass("p-rename-refresh-loading");
		}
	}

	/** Copy an obsidian://pythia deep-link for the current conversation to the clipboard. */
	async onCopyConversationLink(): Promise<void> {
		const conv = this.activeConversation;
		if (!conv) return;
		const link = `obsidian://pythia?cmd=resume&id=${encodeURIComponent(conv.id)}`;
		await navigator.clipboard.writeText(link);
		// Brief visual feedback on the button
		setIcon(this.copyLinkBtn, "check");
		setTimeout(() => setIcon(this.copyLinkBtn, "link"), 1500);
		new Notice(t("convLinkCopied"));
	}

	async handleDeleteConversation(): Promise<void> {
		if (!this.activeConversation) return;
		if (this.isStreaming) {
			new Notice(t("cannotDeleteWhileStreaming"));
			return;
		}
		const toDelete = this.activeConversation;

		new DeleteConversationModal(this.app, toDelete, async () => {
			await this.plugin.conversationStore.delete(toDelete.id);
			new Notice(t("conversationDeleted"));

			const remaining = this.plugin.conversations;
			if (remaining.length > 0) {
				const next = remaining[remaining.length - 1];
				await this.setActiveConversation(next);
			} else {
				await this.plugin.cmdNewConversation();
			}
		}).open();
	}

	private onAttachNote(): void {
		const conv = this.activeConversation;
		if (!conv) return;
		new NoteSuggestModal(this.app, (file) => {
			if (!conv.contextNotes.includes(file.path)) {
				conv.contextNotes.push(file.path);
				void this.plugin.conversationStore.save(conv);
				this.renderReferencePills();
			}
		}).open();
	}

	private async onApplyTemplate(): Promise<void> {
		const conv = this.activeConversation;
		if (!conv) return;

		const templates = await this.plugin.templateLoader.loadTemplates();
		if (templates.length === 0) {
			new Notice(t("noTemplatesFound", { folder: this.plugin.settings.templatesFolder }));
			return;
		}

		new TemplateSuggestModal(this.app, templates, async (tpl) => {
			conv.systemPrompt = tpl.systemPrompt;
			conv.templateId   = tpl.id;
			if (tpl.provider)   conv.provider   = tpl.provider;
			if (tpl.model)      conv.model      = tpl.model;
			if (tpl.maxTokens)  conv.maxTokens  = tpl.maxTokens;
			if (tpl.temperature !== undefined) conv.temperature = tpl.temperature;
			if (tpl.effort !== undefined) conv.effort = tpl.effort;
			if (tpl.resumeMode) conv.resumeMode = tpl.resumeMode;
			if (tpl.writeMode)  conv.writeMode  = tpl.writeMode;

			for (const n of tpl.contextNotes) {
				if (!conv.contextNotes.includes(n)) conv.contextNotes.push(n);
			}

			await this.plugin.conversationStore.save(conv);
			this.updateModelBadge();
			this.renderReferencePills();
			new Notice(t("appliedTemplate", { name: tpl.name }));

			if (tpl.autoPrompt) {
				this.prefillInput(tpl.autoPrompt);
			}
		}).open();
	}

	/** Generate (or regenerate) the conversation summary, then reveal its card. */
	private async generateConversationSummary(): Promise<void> {
		const conv = this.activeConversation;
		if (!conv || conv.messages.length === 0) {
			new Notice(t("noMessagesToSummarize"));
			return;
		}
		const notice = new Notice(t("generatingSummary"), 0);
		try {
			const { title, summary } = await this.plugin.llmRouter.generateSummaryWithTitle(conv);
			if (summary) {
				conv.summaryText = summary;
				conv.summaryUpdatedAt = new Date().toISOString();
				if (title) {
					conv.name = title;
					void this.plugin.renameConversationFile(conv);
				}
				await this.plugin.conversationStore.save(conv);
				// Only touch UI if the user hasn't switched conversations meanwhile.
				if (this.activeConversation?.id === conv.id) {
					if (title) this.renderHeader();
					this.renderSummaryCards();
					this.revealSummaryCard("conversation");
				}
			}
		} catch (e) {
			new Notice(t("summaryFailed", { error: e instanceof Error ? e.message : String(e) }));
		} finally {
			notice.hide();
		}
	}

	/** Generate (or regenerate) the favorites synthesis, then reveal its card. */
	async summarizeFavorites(): Promise<void> {
		const conv = this.activeConversation;
		if (!conv || (conv.favorites?.length ?? 0) === 0) {
			new Notice(t("noFavoritesToSummarize"));
			return;
		}
		const text = await this.runFavoritesSummary(conv);
		if (text && this.activeConversation?.id === conv.id) {
			this.renderSummaryCards();
			this.revealSummaryCard("favorites");
		}
	}

	/** Run the LLM favorites-summary call, persist the result, and return it. */
	private async runFavoritesSummary(conv: Conversation): Promise<string> {
		const notice = new Notice(t("generatingFavoritesSummary"), 0);
		try {
			const text = await this.plugin.llmRouter.generateFavoritesSummary(conv);
			if (text) {
				conv.favoritesSummary = { text, updatedAt: new Date().toISOString() };
				await this.plugin.conversationStore.save(conv);
			}
			return text;
		} catch (e) {
			new Notice(t("favoritesSummaryFailed", { error: e instanceof Error ? e.message : String(e) }));
			return "";
		} finally {
			notice.hide();
		}
	}

	private async onSaveResponse(): Promise<void> {
		const conv = this.activeConversation;
		if (!conv || conv.messages.length === 0) {
			new Notice(t("noMessagesToSave"));
			return;
		}

		// Preliminary check to decide whether to even open the dialog. The slice
		// actually written is recomputed inside the callback below, so messages
		// that stream in while the dialog is open aren't missed (and the save
		// boundary isn't advanced past them).
		if (conv.messages.length <= (conv.lastSavedMessageCount ?? 0)) {
			new Notice(t("nothingNewToSave"));
			return;
		}

		const safeName = conv.name.replace(/[\\/:*?"<>|]/g, "-");

		let defaultFolder = this.plugin.settings.scratchFolder;
		if (conv.templateId) {
			const tplFile = this.app.vault.getAbstractFileByPath(conv.templateId);
			if (tplFile instanceof TFile) {
				const tpl = await this.plugin.templateLoader.loadTemplate(tplFile);
				if (tpl?.outputFolder) defaultFolder = tpl.outputFolder;
			}
		}

		const freshDefault = `${defaultFolder}/${todayISO()}-${safeName}.md`;
		const suggestedPath = conv.savedNotePath ?? freshDefault;

		new InputModal(
			this.app,
			t("saveConvTitle"),
			t("filePathLabel"),
			suggestedPath,
			async (filePath) => {
				const path = filePath.endsWith(".md")
					? filePath
					: filePath + ".md";
				// Recompute the slice and boundary now (not when the dialog opened) so a
				// reply that streamed in while the dialog was open is included, and the
				// saved-count reflects exactly what was written.
				const savedCount = conv.lastSavedMessageCount ?? 0;
				const boundary = conv.messages.length;
				const slice = conv.messages.slice(savedCount);
				if (slice.length === 0) {
					new Notice(t("nothingNewToSave"));
					return;
				}
				try {
					await this.plugin.noteWriter.appendConversationSlice(slice, path, conv.id);
					conv.savedNotePath = path;
					conv.lastSavedMessageCount = boundary;
					await this.plugin.conversationStore.save(conv);
					this.renderReferencePills();
					new Notice(t("savedToPath", { path }));
				} catch (e) {
					new Notice(t("saveFailed", { error: e instanceof Error ? e.message : String(e) }));
				}
			}
		).open();
	}

	// ── /Inline prompt optimizer (extracted to ui/OptimizationController.ts) ───

	async sendMessage(): Promise<void> {
		if (this.isStreaming || this.optimizationController.isActive) return;
		if (!this.activeConversation) {
			new Notice(t("noActiveConvToSend"));
			return;
		}

		// Capture now so callbacks write to the correct conversation if user switches mid-stream.
		const conv = this.activeConversation;

		const cap = this.plugin.settings.maxMessagesPerSession;
		if (cap > 0 && conv.messages.length >= cap) {
			new Notice(t("messageLimitReached", { cap: String(cap) }));
			return;
		}

		const text = this.inputEl.value.trim();
		if (!text) return;

		this.inputEl.value = "";
		this.autoResizeTextarea();
		this.setStreamingState(true);

		const userMsg: Message = {
			id: crypto.randomUUID(),
			role: "user",
			content: text,
			timestamp: new Date().toISOString(),
			attachedNotes: conv.contextNotes.length > 0 ? [...conv.contextNotes] : undefined,
		};
		conv.messages.push(userMsg);
		// Persist the user turn immediately so it survives an errored or empty
		// response — previously nothing saved the conversation until a reply
		// completed, so a failed send silently dropped the user's own message.
		await this.plugin.conversationStore.save(conv);
		this.messagesEl.querySelector(".pythia-empty, .p-welcome")?.remove();
		await this.appendMessageBubble(userMsg);
		this.lastRenderedMsgId = userMsg.id;

		const attachedNotes = [...(conv.contextNotes ?? [])];

		const { appendToken, finalize, row: streamingRow } = this.createStreamingBubble();
		this.pendingWebSources = [];

		const onToolCall = async (call: ToolCall): Promise<string> => {
				// web_search is read-only — run it directly with a live status chip,
				// no write-confirmation prompt (that would make research unusable).
				if (call.name === "web_search") {
					const query =
						typeof call.input["query"] === "string" ? call.input["query"] : "";
					const searchChip = this.messagesEl.createDiv({ cls: "pythia-tool-call" });
					searchChip.createSpan({
						cls: "pythia-tool-call-label",
						text: t("searchingLabel", { query }),
					});
					this.messagesEl.scrollTop = this.messagesEl.scrollHeight;

					const allowedSearch = ToolHandler.allowedToolNames(
						conv.writeMode ?? "all",
						conv.researchMode ?? false
					);
					const searchResult = await this.plugin.toolHandler.execute(call, allowedSearch);

					searchChip.empty();
					if (searchResult.startsWith("Error")) {
						searchChip.addClass("pythia-tool-call--error");
						searchChip.createSpan({ cls: "pythia-tool-call-label", text: t("searchFailedLabel") });
					} else {
						searchChip.addClass("pythia-tool-call--done");
						searchChip.createSpan({
							cls: "pythia-tool-call-label",
							text: t("searchedLabel", { query }),
						});
						// Capture the real Tavily sources for the message's sources row.
						this.pendingWebSources.push(...parseWebSourcesFromResult(searchResult));
					}
					return searchResult;
				}

				const rawPath =
					typeof call.input["path"] === "string"
						? call.input["path"]
						: call.name;
				const noteName =
					rawPath.split("/").pop()?.replace(/\.md$/, "") ?? rawPath;
				const isRewrite = call.name === "rewrite_note";
				const isPrepend = call.name === "prepend_note";

				const chipEl = this.messagesEl.createDiv({ cls: "pythia-tool-call" });
				this.messagesEl.scrollTop = this.messagesEl.scrollHeight;

				// Path guard: rewrite/prepend may only target context notes
				if (isRewrite || isPrepend) {
					const targetPath =
						typeof call.input["path"] === "string" ? call.input["path"] : "";
					if (!conv.contextNotes.includes(targetPath)) {
						chipEl.addClass("pythia-tool-call--error");
						chipEl.createSpan({
							cls: "pythia-tool-call-label",
							text: t("toolPathNotInContext", { path: targetPath }),
						});
						return `Error: path "${targetPath}" is not in context notes. You may only modify notes that were explicitly provided as context.`;
					}
				}

				// Confirm chip — ask before writing
				const questionText = isRewrite
					? t("confirmRewriteNote", { name: noteName })
					: isPrepend
					? t("confirmPrependNote", { name: noteName })
					: t("confirmCreateNote", { name: noteName });

				chipEl.createSpan({ cls: "pythia-tool-call-label", text: questionText });

				const actionsEl = chipEl.createDiv({ cls: "pythia-tool-call-actions" });
				const actionLabel = isRewrite
					? t("confirmRewriteBtn")
					: isPrepend
					? t("confirmPrependBtn")
					: t("confirmCreateBtn");

				const confirmed = await new Promise<boolean>((resolve) => {
					const actionBtn = actionsEl.createEl("button", {
						cls: "pythia-tool-call-btn pythia-tool-call-btn--action",
						text: actionLabel,
					});
					const cancelBtn = actionsEl.createEl("button", {
						cls: "pythia-tool-call-btn",
						text: t("cancelBtn"),
					});
					this.registerDomEvent(actionBtn, "click", () => resolve(true));
					this.registerDomEvent(cancelBtn, "click", () => resolve(false));
				});

				chipEl.empty();

				if (!confirmed) {
					chipEl.addClass("pythia-tool-call--cancelled");
					chipEl.createSpan({
						cls: "pythia-tool-call-label",
						text: t("toolCallCancelled"),
					});
					return "User declined. Please output the content directly in this conversation instead of saving it to a file.";
				}

				const allowed = ToolHandler.allowedToolNames(conv.writeMode ?? "all", conv.researchMode ?? false);
				const result = await this.plugin.toolHandler.execute(call, allowed);

				if (result.startsWith("Error")) {
					chipEl.addClass("pythia-tool-call--error");
					chipEl.createSpan({ cls: "pythia-tool-call-label", text: result });
				} else {
					chipEl.addClass("pythia-tool-call--done");
					const doneText = isRewrite
						? t("rewrittenNote", { name: noteName })
						: isPrepend
						? t("prependedNote", { name: noteName })
						: t("createdNote", { name: noteName });
					const link = chipEl.createEl("a", {
						cls: "pythia-tool-call-link",
						text: doneText,
					});
					link.addEventListener("click", (e) => {
						e.preventDefault();
						void this.app.workspace.openLinkText(noteName, "");
					});
				}

				return result;
		};

		await this.plugin.llmRouter.streamMessage(
			conv,
			text,
			attachedNotes,
			appendToken,
			async (fullText, tokenUsage) => {
				// Defense-in-depth: switching conversations mid-stream is blocked in the
				// UI, but the view can still be torn down (onClose aborts) while this
				// callback is in flight — don't touch messagesEl/autoScroll in that case.
				const stillActive = this.activeConversation?.id === conv.id;
				if (stillActive) {
					await finalize(fullText);
				}
				// Reset after render so the send guard stays active during MarkdownRenderer.render.
				this.setStreamingState(false);

				if (!fullText) {
					streamingRow.remove();
					return;
				}

				const parsedSources = appendWebSources(parseCitations(fullText), this.pendingWebSources);
				const assistantMsg: Message = {
					id: crypto.randomUUID(),
					role: "assistant",
					content: fullText,
					timestamp: new Date().toISOString(),
					model: conv.model,
					tokenUsage,
					...(parsedSources.length ? { sources: parsedSources } : {}),
				};
				conv.messages.push(assistantMsg);
				if (this.activeConversation?.id === conv.id) {
					this.lastRenderedMsgId = assistantMsg.id;
				}
				const rows = this.messagesEl.querySelectorAll(".p-msg-ai");
				const lastRow = rows[rows.length - 1] as HTMLElement | null;
				if (lastRow && !lastRow.getAttribute("data-msg-id")) {
					lastRow.setAttribute("data-msg-id", assistantMsg.id);
					if (tokenUsage) {
						const label = streamingRow.querySelector<HTMLElement>(".p-turn-label");
						if (label) this.appendTokensToTurnLabel(label, tokenUsage);
					}
				}
				await this.plugin.conversationStore.save(conv);
				if (this.activeConversation?.id === conv.id) {
					this.attachLastBubbleLongPress();
				}

				if (conv.messages.length === 2 && /\d{4}-\d{2}-\d{2}$/.test(conv.name)) {
					const convId = conv.id;
					this.plugin.llmRouter
						.generateConversationTitle(userMsg.content, fullText, conv.provider)
						.then(async (title) => {
							const c = this.plugin.conversationStore.getById(convId);
							if (!c) return;
							c.name = title;
							await this.plugin.conversationStore.save(c);
							if (this.activeConversation?.id === convId) {
								this.convNameEl.setText(c.name + " ▾");
							}
						})
						.catch((e) => console.warn("[Pythia] conversation title generation failed:", e));
				}

				if (!userMsg.chapterName) {
					const convId = conv.id;
					const msgId  = userMsg.id;
					this.plugin.llmRouter
						.generateChapterName(userMsg.content, conv.provider)
						.then(async (name) => {
							if (!name) return;
							const c = this.plugin.conversationStore.getById(convId);
							if (!c) return;
							const m = c.messages.find(msg => msg.id === msgId);
							if (!m) return;
							m.chapterName = name;
							await this.plugin.conversationStore.save(c);
						})
						.catch((e) => console.warn("[Pythia] chapter name generation failed:", e));
				}
			},
			(error) => {
				console.error("[Pythia] stream error:", error);

				new Notice(buildStreamErrorMessage(error, conv.model ?? ""));

				// Discard any partial reply and drop the streaming row. The user's
				// message is already persisted (saved above), so they can retry from a
				// clean state; keeping a partial that never became a real turn would
				// desync the visible transcript from the saved history on the next
				// re-render.
				streamingRow.remove();

				this.setStreamingState(false);
			},
			onToolCall
		);
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
		if (!this.messagesEl.contains(range.commonAncestorContainer)) {
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
		const view = this.lastMarkdownView
			?? this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice(t("noActiveNoteToInsert"));
			return;
		}
		let insertion = text;
		if (this.activeConversation) {
			const conv = this.activeConversation;
			const vault = encodeURIComponent(this.app.vault.getName());
			const uri = `obsidian://pythia?vault=${vault}&cmd=resume&id=${encodeURIComponent(conv.id)}`;
			insertion += `\n\n[↗ ${conv.name}](${uri})`;
		}
		view.editor.replaceSelection(insertion);
		this.selectionToolbar.style.display = "none";
		new Notice(t("insertedIntoNote"));
	}

	private onForkConversation(): void {
		const sel  = window.getSelection();
		// Trim like onFavoriteSelection: `sel.toString()` can carry leading/trailing
		// whitespace or a block-boundary newline that the concatenated text-node data
		// (what findRange searches) never contains, so an untrimmed selection makes the
		// source-side fork-origin mark impossible to re-find and paint (ADR-096).
		const text = (sel?.toString() ?? "").trim();
		const conv = this.activeConversation;
		if (!conv) return;

		// Walk from the selection anchor up to the nearest message row so we
		// can record which message was forked from.
		const anchor = sel?.anchorNode;
		const msgEl  = (anchor instanceof Element ? anchor : anchor?.parentElement)
			?.closest("[data-msg-id]");

		// Forking branches from assistant content only. The toolbar hides the fork
		// button over a user bubble; guard here too so it's never possible.
		if (msgEl?.classList.contains("p-msg-user")) {
			this.selectionToolbar.style.display = "none";
			window.getSelection()?.removeAllRanges();
			return;
		}

		const sourceMessageId = msgEl?.getAttribute("data-msg-id") ?? undefined;

		// Record which occurrence of the snippet this is, so the source can re-find
		// and highlight the exact span later (mirrors favorite creation).
		let occurrenceIndex: number | undefined;
		if (msgEl && sel && sel.rangeCount > 0) {
			const body = msgEl.querySelector<HTMLElement>(".p-ai-body, .p-bubble") ?? (msgEl as HTMLElement);
			occurrenceIndex = computeOccurrenceIndex(body, sel.getRangeAt(0));
		}

		this.selectionToolbar.style.display = "none";
		window.getSelection()?.removeAllRanges();
		void this.plugin.cmdForkConversation(conv.id, text, sourceMessageId, occurrenceIndex);
	}

	private async onSaveToInbox(): Promise<void> {
		const text = window.getSelection()?.toString() ?? "";
		if (!text) return;
		const inboxPath = this.plugin.settings.inboxNote || "Pythia/Inbox.md";
		let entry = text;
		if (this.activeConversation) {
			const conv = this.activeConversation;
			const vault = encodeURIComponent(this.app.vault.getName());
			const uri = `obsidian://pythia?vault=${vault}&cmd=resume&id=${encodeURIComponent(conv.id)}`;
			entry += `\n\n[↗ ${conv.name}](${uri})`;
		}
		try {
			await this.plugin.noteWriter.prependToInbox(entry, inboxPath);
			this.selectionToolbar.style.display = "none";
			new Notice(t("savedToInbox"));
		} catch (e) {
			new Notice(t("failedSaveToInbox", { error: e instanceof Error ? e.message : String(e) }));
		}
	}

	// ── Delete-last-exchange ─────────────────────────────────────

	private attachLastBubbleLongPress(): void {
		this.longPressCleanup?.();
		this.longPressCleanup = null;

		if (!this.activeConversation || this.isStreaming) return;

		const userRows = Array.from(
			this.messagesEl.querySelectorAll<HTMLElement>(".p-msg-user")
		);
		const lastUserRow = userRows[userRows.length - 1];
		if (!lastUserRow) return;

		const assistantRow = lastUserRow.nextElementSibling as HTMLElement | null;
		if (!assistantRow?.classList.contains("p-msg-ai")) return;

		const bubble = lastUserRow.querySelector<HTMLElement>(".p-bubble");
		if (!bubble) return;

		let timer: ReturnType<typeof setTimeout> | null = null;

		const cancel = () => {
			if (timer !== null) { clearTimeout(timer); timer = null; }
		};

		const onTouchStart = (e: TouchEvent) => {
			if (this.activeDeletePreview) return;
			e.preventDefault(); // prevent iOS magnifier / text-selection
			timer = setTimeout(() => {
				timer = null;
				this.showDeletePreview(lastUserRow, assistantRow);
			}, 450);
		};

		const onMouseDown = (e: MouseEvent) => {
			if (e.button !== 0 || this.activeDeletePreview) return;
			timer = setTimeout(() => {
				timer = null;
				this.showDeletePreview(lastUserRow, assistantRow);
			}, 450);
		};

		bubble.addEventListener("touchstart", onTouchStart, { passive: false });
		bubble.addEventListener("touchend",   cancel, { passive: true });
		bubble.addEventListener("touchcancel",cancel, { passive: true });
		bubble.addEventListener("touchmove",  cancel, { passive: true });
		bubble.addEventListener("mousedown",  onMouseDown);
		bubble.addEventListener("mouseup",    cancel);
		bubble.addEventListener("mouseleave", cancel);

		this.longPressCleanup = () => {
			cancel();
			bubble.removeEventListener("touchstart",  onTouchStart);
			bubble.removeEventListener("touchend",    cancel);
			bubble.removeEventListener("touchcancel", cancel);
			bubble.removeEventListener("touchmove",   cancel);
			bubble.removeEventListener("mousedown",   onMouseDown);
			bubble.removeEventListener("mouseup",     cancel);
			bubble.removeEventListener("mouseleave",  cancel);
		};
	}

	private showDeletePreview(userRow: HTMLElement, assistantRow: HTMLElement): void {
		this.hideDeletePreview();

		userRow.addClass("p-del-preview");
		assistantRow.addClass("p-del-preview");

		const bar = createDiv({ cls: "p-del-bar" });
		const confirmBtn = bar.createEl("button", { cls: "p-del-confirm", text: t("deleteExchangeBtn") });
		const cancelBtn  = bar.createEl("button", { cls: "p-del-cancel",  text: t("cancelBtn") });

		const doConfirm = (e: Event) => {
			e.preventDefault(); e.stopPropagation();
			void this.confirmDeleteLastExchange(userRow, assistantRow);
		};
		const doCancel = (e: Event) => {
			e.preventDefault(); e.stopPropagation();
			this.hideDeletePreview();
		};

		confirmBtn.addEventListener("mousedown",  doConfirm);
		confirmBtn.addEventListener("touchstart", doConfirm, { passive: false });
		cancelBtn.addEventListener("mousedown",   doCancel);
		cancelBtn.addEventListener("touchstart",  doCancel, { passive: false });

		assistantRow.insertAdjacentElement("beforebegin", bar);

		const outsideHandler: EventListener = (e) => {
			const t = (e as MouseEvent | TouchEvent).target as Node | null;
			if (t && !bar.contains(t) && !userRow.contains(t) && !assistantRow.contains(t)) {
				this.hideDeletePreview();
			}
		};
		document.addEventListener("mousedown",  outsideHandler, { capture: true });
		document.addEventListener("touchstart", outsideHandler, { capture: true });

		this.activeDeletePreview = { userRow, assistantRow, bar, outsideHandler };
	}

	private hideDeletePreview(): void {
		if (!this.activeDeletePreview) return;
		const { userRow, assistantRow, bar, outsideHandler } = this.activeDeletePreview;
		userRow.removeClass("p-del-preview");
		assistantRow.removeClass("p-del-preview");
		bar.remove();
		document.removeEventListener("mousedown",  outsideHandler, { capture: true });
		document.removeEventListener("touchstart", outsideHandler, { capture: true });
		this.activeDeletePreview = null;
	}

	private async confirmDeleteLastExchange(
		userRow: HTMLElement,
		assistantRow: HTMLElement
	): Promise<void> {
		const conv = this.activeConversation;
		if (!conv) return;

		const userId      = userRow.getAttribute("data-msg-id");
		const assistantId = assistantRow.getAttribute("data-msg-id");
		if (!userId) return;

		const userIdx = conv.messages.findIndex((m) => m.id === userId);
		if (userIdx === -1) return;

		const removeCount = assistantId ? 2 : 1;
		conv.messages.splice(userIdx, removeCount);

		// Keep the save-boundary accurate
		if (conv.lastSavedMessageCount !== undefined && conv.lastSavedMessageCount > userIdx) {
			conv.lastSavedMessageCount = Math.max(0, conv.lastSavedMessageCount - removeCount);
		}

		// Remove the starred entry for the deleted assistant message
		if (assistantId && conv.favorites?.length) {
			conv.favorites = conv.favorites.filter((f) => f.messageId !== assistantId);
		}

		this.hideDeletePreview();
		userRow.remove();
		assistantRow.remove();
		this.lastRenderedMsgId = conv.messages.at(-1)?.id ?? null;

		await this.plugin.conversationStore.save(conv);
		new Notice(t("exchangeDeleted"));

		if (conv.messages.length === 0) {
			this.renderWelcome(this.messagesEl);
		}

		this.attachLastBubbleLongPress();
	}

	/** Return the most recent message carrying token usage (the last completed
	 *  assistant turn), or undefined if the conversation has none yet. */
	private lastTokenUsageMsg(): Message | undefined {
		const messages = this.activeConversation?.messages ?? [];
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].tokenUsage) return messages[i];
		}
		return undefined;
	}

	private updateSendBtnLabel(): void {
		// The token estimate now lives in a mono label left of Send (not the
		// button label). The button reads just "Senden" / "Stopp".
		this.sendBtn.setText(t("sendBtn"));
		this.sendBtn.title = "";
		const last = this.lastTokenUsageMsg();
		if (last?.tokenUsage) {
			// Estimate total input tokens for the NEXT send (#28):
			//   previous inputTokens  = full context as of the last call
			//   + last outputTokens   = assistant reply now added to history
			//   + draft chars / 4     = the message currently being typed
			const { inputTokens, outputTokens } = last.tokenUsage;
			const draftTokens = estimateTokensFromText(this.inputEl?.value ?? "");
			const estimate = inputTokens + outputTokens + draftTokens;
			const fmt = estimate >= 1000
				? `~${(estimate / 1000).toFixed(1)}k`
				: `~${estimate}`;
			this.sendEstimateEl.setText(t("nextSendEstimate", { n: fmt }));
			this.sendEstimateEl.style.display = "";
		} else {
			this.sendEstimateEl.setText("");
			this.sendEstimateEl.style.display = "none";
		}
		this.updateContextBar();
	}

	/** Context-budget bar under the header: fill = (last-known context size) /
	 *  (model context window). Turns warning-colored and surfaces a header
	 *  percent chip at >=80%. Hidden until a turn has produced token usage. */
	private updateContextBar(): void {
		if (!this.ctxBarEl) return;
		const conv = this.activeConversation;
		const last = this.lastTokenUsageMsg();
		if (!conv || !last?.tokenUsage) {
			this.ctxBarEl.style.display = "none";
			this.ctxChipEl.style.display = "none";
			return;
		}
		const used = last.tokenUsage.inputTokens + last.tokenUsage.outputTokens;
		const windowSize = getContextWindow(conv.model);
		const frac = windowSize > 0 ? Math.min(1, used / windowSize) : 0;
		const pct = Math.round(frac * 100);
		const warn = frac >= 0.8;
		this.ctxBarEl.style.display = "";
		this.ctxBarFillEl.style.width = `${(frac * 100).toFixed(1)}%`;
		this.ctxBarEl.toggleClass("warn", warn);
		this.ctxBarEl.setAttr("title", t("ctxBarTooltip", {
			used: used.toLocaleString(),
			total: windowSize.toLocaleString(),
			pct: String(pct),
		}));
		if (warn) {
			this.ctxChipEl.setText(`${pct}%`);
			this.ctxChipEl.style.display = "";
		} else {
			this.ctxChipEl.style.display = "none";
		}
	}

	private setStreamingState(streaming: boolean): void {
		this.isStreaming = streaming;
		if (streaming) {
			this.longPressCleanup?.();
			this.longPressCleanup = null;
			this.autoScroll = true;
			this.sendBtn.setText(t("stopBtn"));
			this.sendBtn.addClass("stop");
		} else {
			this.updateSendBtnLabel();
			this.sendBtn.removeClass("stop");
		}
		this.inputEl.disabled = streaming;
	}
}
