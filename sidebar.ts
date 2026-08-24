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
import { estimateTokensFromBytes, estimateTokensFromText } from "./services/messageUtils";
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
} from "./ui/HighlightPainter";
import type { Conversation, Favorite, Message, ToolCall, TokenUsage } from "./models/types";
import type PythiaPlugin from "./main";
import { ConversationSuggestModal } from "./suggest/ConversationSuggest";
import { NoteSuggestModal } from "./suggest/NoteSuggest";
import { InputModal } from "./suggest/InputModal";
import { ConversationSettingsModal } from "./suggest/ConversationSettingsModal";
import { buildStreamErrorMessage } from "./services/apiError";
import { ToolHandler } from "./services/ToolHandler";
import { DeleteConversationModal } from "./suggest/DeleteConversationModal";
import { DeleteFileModal } from "./suggest/DeleteFileModal";
import { TemplateSuggestModal } from "./suggest/TemplateSuggest";
import { MODEL_ABBREVIATIONS } from "./models/knownModels";

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
	private referencePillsEl!: HTMLElement;
	private referenceSectionEl!: HTMLElement;
	private referenceRowHasEntries = false;

	// attachedPillsEl removed — notes shown in reference row only
	private messagesEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private selectionToolbar!: HTMLElement;
	private favBtn!: HTMLButtonElement;
	/** When set, the current selection came from tapping this favorite's highlight,
	 *  so the toolbar's favorite button acts as "Unfavorite" targeting this id. */
	private tappedFavId: string | null = null;
	private onSelectionChange!: () => void;
	private lastMarkdownView: MarkdownView | null = null;

	// Summary "Speisekarte" cards at the top of the message list.
	private summaryCardsEl: HTMLElement | null = null;
	private summaryCardObserver: IntersectionObserver | null = null;
	private sendLongPressCleanup: (() => void) | null = null;
	private suppressNextSendClick = false;
	private sendMenuWrap!: HTMLElement;
	private sendMenuCleanup: (() => void) | null = null;

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

	private optimizeBtnEl!: HTMLButtonElement;
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

		if (this.onSelectionChange) {
			document.removeEventListener("selectionchange", this.onSelectionChange);
		}
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
		this.renderedConvId = null;
		this.lastRenderedMsgId = null;
		this.cachedLineHeight = null; // inputEl is about to be recreated below
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("pythia-view");

		this.buildHeader(container);

		this.buildChatArea(container);

		this.referenceSectionEl = container.createDiv({ cls: "p-ref-row" });
		this.referencePillsEl = this.referenceSectionEl.createDiv({ cls: "p-pills" });
		this.referenceSectionEl.style.display = "none";

		this.buildInputArea(container);

		this.optimizationController = new OptimizationController({
			app: this.app,
			component: this,
			plugin: this.plugin,
			messagesEl: this.messagesEl,
			inputEl: this.inputEl,
			sendBtn: this.sendBtn,
			optimizeBtnEl: this.optimizeBtnEl,
			getConversation: () => this.activeConversation,
			isStreaming: () => this.isStreaming,
			scrollToBottom: () => this.scrollToBottom(),
			autoResizeTextarea: () => this.autoResizeTextarea(),
			sendMessage: () => this.sendMessage(),
			registerDomEvent: (el, event, cb) => this.registerDomEvent(el, event, cb),
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
		this.convNameEl.addEventListener("click", () => this.onConvNameClick());

		this.renameWrapEl = titleGroup.createDiv({ cls: "p-rename-wrap" });
		this.renameWrapEl.style.display = "none";

		this.renameLLMBtn = this.renameWrapEl.createEl("button", {
			cls: "p-hdr-btn p-rename-refresh",
			attr: { title: t("renameLLMTooltip") },
		});
		setIcon(this.renameLLMBtn, "refresh-cw");
		this.renameLLMBtn.addEventListener("mousedown", (e) => {
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
		this.renameBtn.addEventListener("click", () => this.enterRenameMode());

		this.modelBadgeEl = header.createEl("button", {
			cls: "p-model",
			text: "",
			attr: { title: t("changeModelTooltip") },
		});
		this.modelBadgeEl.style.display = "none";
		this.modelBadgeEl.addEventListener("click", () => this.onModelBadgeClick());

		this.copyLinkBtn = header.createEl("button", {
			cls: "p-hdr-btn",
			attr: { title: t("copyConvLinkTooltip") },
		});
		setIcon(this.copyLinkBtn, "link");
		this.copyLinkBtn.style.display = "none";
		this.copyLinkBtn.addEventListener("click", () => this.onCopyConversationLink());

		const deleteConvBtn = header.createEl("button", {
			cls: "p-hdr-btn",
			attr: { title: t("deleteConvTooltip") },
		});
		setIcon(deleteConvBtn, "trash");
		deleteConvBtn.addEventListener("click", () => this.handleDeleteConversation());

		const newConvBtn = header.createEl("button", {
			cls: "p-hdr-btn",
			attr: { title: t("newConvTooltip") },
		});
		setIcon(newConvBtn, "plus");
		newConvBtn.addEventListener("click", () => this.plugin.cmdNewConversation());

		this.templateLabelEl = header.createDiv({ cls: "pythia-template-label" });
		this.templateLabelEl.style.display = "none";
	}

	private buildChatArea(container: HTMLElement): void {
		const messagesWrapper = container.createDiv({ cls: "pythia-messages-wrapper" });

		this.messagesEl = messagesWrapper.createDiv({ cls: "p-chat" });
		this.messagesEl.addEventListener("scroll", () => {
			if (this.isScrolling) return;
			const el = this.messagesEl;
			const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
			if (distFromBottom > 50) this.autoScroll = false;
		});
		this.selectionToolbar = container.createDiv({ cls: "pythia-sel-toolbar" });
		this.selectionToolbar.style.display = "none";

		let savedSelRange: Range | null = null;
		let selTouchStartX = 0;
		this.selectionToolbar.addEventListener("touchstart", (e: TouchEvent) => {
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
		copyBtn.addEventListener("mousedown", (e) => { e.preventDefault(); this.onCopySelection(); });
		copyBtn.addEventListener("touchend", makeSelTouch(() => this.onCopySelection()));

		this.favBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: t("favoriteBtn"),
			attr: { title: t("favoriteBtn") },
		});
		this.favBtn.addEventListener("mousedown", (e) => { e.preventDefault(); void this.onFavoriteSelection(); });
		this.favBtn.addEventListener("touchend", makeSelTouch(() => void this.onFavoriteSelection()));

		const forkBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: t("forkBtn"),
			attr: { title: t("forkBtn") },
		});
		forkBtn.addEventListener("mousedown", (e) => { e.preventDefault(); this.onForkConversation(); });
		forkBtn.addEventListener("touchend", makeSelTouch(() => this.onForkConversation()));

		const insertBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: t("insertBtn"),
			attr: { title: t("insertBtn") },
		});
		insertBtn.addEventListener("mousedown", (e) => { e.preventDefault(); this.onInsertIntoNote(); });
		insertBtn.addEventListener("touchend", makeSelTouch(() => this.onInsertIntoNote()));

		const inboxBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: t("inboxBtn"),
			attr: { title: t("inboxBtn") },
		});
		inboxBtn.addEventListener("mousedown", (e) => { e.preventDefault(); void this.onSaveToInbox(); });
		inboxBtn.addEventListener("touchend", makeSelTouch(() => this.onSaveToInbox()));

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
		document.addEventListener("selectionchange", this.onSelectionChange);
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
		this.indexTriggerEl.addEventListener("click", (e) => {
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
		this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (this.inlineSuggest.handleKeydown(e)) return;
			if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				void this.sendMessage();
			}
		});
		{
			let tokenDebounce: ReturnType<typeof setTimeout> | null = null;
			this.inputEl.addEventListener("input", () => {
				this.autoResizeTextarea();
				this.inlineSuggest.handleInput();
				if (tokenDebounce !== null) clearTimeout(tokenDebounce);
				tokenDebounce = setTimeout(() => {
					tokenDebounce = null;
					this.updateSendBtnLabel();
				}, 250);
			});
		}

		this.inputEl.addEventListener("focus", () => {
			setTimeout(() => this.adjustForKeyboard(), 300);
		});
		this.inputEl.addEventListener("blur", () => {
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

		this.optimizeBtnEl = toolbarLeft.createEl("button", {
			cls: "p-tool-btn p-optimize-btn",
			attr: { title: t("optimizeBtnTooltip") },
		});
		const optimizeSvg = this.optimizeBtnEl.createSvg("svg", {
			attr: { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.6" },
		});
		optimizeSvg.createSvg("path", {
			attr: { d: "m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.21 1.21 0 0 0 0-1.72z" },
		});
		optimizeSvg.createSvg("path", { attr: { d: "M14 7l3 3" } });
		optimizeSvg.createSvg("path", { attr: { d: "M5 6v4" } });
		optimizeSvg.createSvg("path", { attr: { d: "M19 14v4" } });
		optimizeSvg.createSvg("path", { attr: { d: "M10 2v2" } });
		optimizeSvg.createSvg("path", { attr: { d: "M7 8H3" } });
		optimizeSvg.createSvg("path", { attr: { d: "M21 16h-4" } });
		this.registerDomEvent(this.optimizeBtnEl, "click", () => {
			this.ensureInputExpanded();
			void this.optimizationController.start();
		});

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

		// Wrap the send button so the summary menu can open directly above it.
		this.sendMenuWrap = toolbar.createDiv({ cls: "p-send-wrap" });
		this.sendBtn = this.sendMenuWrap.createEl("button", {
			cls: "p-send",
			text: t("sendBtn"),
		});
		this.sendBtn.addEventListener("click", () => {
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
		const chevron = header.createSpan({ cls: "p-summary-card-chevron", text: "▸" });
		header.addEventListener("click", () =>
			this.setSummaryCardOpen(card, !card.hasClass("open"))
		);

		const body = card.createDiv({ cls: "p-summary-card-body" });
		const md = body.createDiv({ cls: "p-summary-card-md" });
		void MarkdownRenderer.render(this.app, text, md, "", this)
			.catch((e) => console.error("[Pythia] summary card render:", e));

		const footer = body.createDiv({ cls: "p-summary-card-footer" });
		if (updatedAt) {
			footer.createSpan({ cls: "p-summary-ts", text: formatSummaryTimestamp(updatedAt) });
		}
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
			const link = label.createEl("a", {
				cls: "pythia-fork-source-link",
				text: source.name,
			});
			link.addEventListener("click", async () => {
				await this.setActiveConversation(source);
				if (conv.forkedFromMessageId) {
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
		if (entries.length === 0) return;

		for (const entry of entries) {
			const fileName = entry.path.split("/").pop() ?? entry.path;
			const file = this.app.vault.getAbstractFileByPath(entry.path);
			const tokEst = file instanceof TFile ? estimateTokensFromBytes(file.stat.size) : null;

			const pill = this.referencePillsEl.createEl("span", { cls: "p-pill" });
			const label = pill.createEl("span", { text: fileName, cls: "p-pill-label", attr: { title: entry.path } });
			label.style.cursor = "pointer";
			label.addEventListener("click", async () => {
				const f = this.app.vault.getAbstractFileByPath(entry.path);
				if (f instanceof TFile) {
					await this.app.workspace.getLeaf(false).openFile(f);
				} else {
					new Notice(t("fileNotFound", { path: entry.path }));
				}
			});
			if (tokEst) pill.createEl("span", { cls: "p-pill-tokens", text: tokEst });
			const x = pill.createEl("button", { cls: "p-pill-x", text: "✕" });
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
			text: "+",
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
				this.messagesEl.querySelector(".pythia-empty")?.remove();
				for (let i = anchorIdx + 1; i < msgs.length; i++) {
					await this.appendMessageBubble(msgs[i]);
				}
				this.lastRenderedMsgId = tailId;
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
		this.renderedConvId = conv.id;
		this.lastRenderedMsgId = null;

		// Summary "Speisekarte" cards sit at the very top and scroll with content.
		this.summaryCardsEl = this.messagesEl.createDiv({ cls: "p-summary-cards" });
		this.renderSummaryCards();

		if (conv.forkedFromId) this.renderForkBannerEl();

		if (msgs.length === 0) {
			const hint = this.messagesEl.createDiv({ cls: "pythia-empty" });
			hint.createEl("p", { text: t("startConversationBelow") });
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

	private async appendMessageBubble(msg: Message): Promise<HTMLElement> {
		// ── User message ────────────────────────────────────────────
		if (msg.role === "user") {
			const row = this.messagesEl.createDiv({
				cls: "p-msg-user",
				attr: { "data-msg-id": msg.id },
			});
			const bubble = row.createDiv({ cls: "p-bubble" });
			const isLong = msg.content.length > 280;
			if (isLong) bubble.addClass("p-bubble-collapsed");
			try {
				await MarkdownRenderer.render(this.app, this.unwrapCodeFence(msg.content), bubble, "", this);
			} catch (e) {
				console.error("[Pythia] render error:", e);
			}
			this.repaintFavorites(bubble, msg.id);
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
		const aiBody = row.createDiv({ cls: "p-ai-body" });
		try {
			await MarkdownRenderer.render(this.app, this.unwrapCodeFence(msg.content), aiBody, "", this);
		} catch (e) {
			console.error("[Pythia] render error:", e);
		}
		decorateCodeBlocks(aiBody, this.diagObservers);
		this.repaintFavorites(aiBody, msg.id);

		if (msg.tokenUsage) {
			const footer = row.createDiv({ cls: "p-tokens" });
			this.renderTokenCount(footer, msg.tokenUsage);
		}

		return aiBody;
	}

	private createStreamingBubble(): {
		appendToken: (text: string) => void;
		finalize: (fullText: string) => Promise<void>;
		getPartial: () => string;
		row: HTMLElement;
	} {
		const row = this.messagesEl.createDiv({ cls: "p-msg-ai" });
		const aiBody = row.createDiv({ cls: "p-ai-body pythia-streaming" });
		const textNode = document.createTextNode("");
		aiBody.appendChild(textNode);

		return {
			row,
			appendToken: (text: string) => {
				textNode.textContent = (textNode.textContent ?? "") + text;
				this.scrollToBottom();
			},
			getPartial: () => textNode.textContent ?? "",
			finalize: async (fullText: string) => {
				aiBody.removeClass("pythia-streaming");
				aiBody.empty();
				try {
					await MarkdownRenderer.render(this.app, this.unwrapCodeFence(fullText), aiBody, "", this);
				} catch (e) {
					console.error("[Pythia] render error:", e);
				}
				decorateCodeBlocks(aiBody, this.diagObservers);
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

	/**
	 * Tap (no drag) inside a highlight → select its whole span and open the toolbar
	 * with the favorite button acting as "Unfavorite". A dragged selection is left
	 * alone here so it flows through the normal add path.
	 */
	private onMessageClick(e: MouseEvent): void {
		this.tappedFavId = null;
		const sel = window.getSelection();
		// Only react to a plain tap — a drag leaves a non-collapsed selection.
		if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return;
		const target = e.target instanceof Element ? e.target : null;
		const mark = target?.closest("mark.p-highlight");
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

	private renderTokenCount(row: HTMLElement, usage: TokenUsage): void {
		const fmt = (n: number) => n.toLocaleString();
		const el = row.createEl("span");
		el.setText(t("tokenCount", { input: fmt(usage.inputTokens), output: fmt(usage.outputTokens) }));
		el.title = t("tokenCountTitle", { input: fmt(usage.inputTokens), output: fmt(usage.outputTokens) });
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
			`mark.p-highlight[data-fav-id="${fav.id}"]`
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

	private onModelBadgeClick(): void {
		if (!this.activeConversation) return;
		new ConversationSettingsModal(
			this.app,
			this.activeConversation,
			async (conv) => {
				await this.plugin.conversationStore.save(conv);
				this.updateModelBadge();
			},
			this.plugin.settings.temperature,
			this.plugin.settings.effort,
			this.plugin.settings.maxTokens
		).open();
	}

	private onConvNameClick(): void {
		const convs = this.plugin.conversations;
		if (convs.length === 0) return;

		new ConversationSuggestModal(
			this.app,
			convs,
			async (conv) => {
				await this.setActiveConversation(conv);
			},
			(conv) => {
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
				}).open();
			}
		).open();
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

		const savedCount = conv.lastSavedMessageCount ?? 0;
		const slice = conv.messages.slice(savedCount);
		if (slice.length === 0) {
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
				try {
					await this.plugin.noteWriter.appendConversationSlice(slice, path, conv.id);
					conv.savedNotePath = path;
					conv.lastSavedMessageCount = conv.messages.length;
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
		this.messagesEl.querySelector(".pythia-empty")?.remove();
		await this.appendMessageBubble(userMsg);
		this.lastRenderedMsgId = userMsg.id;

		const attachedNotes = [...(conv.contextNotes ?? [])];

		const { appendToken, finalize, getPartial, row: streamingRow } = this.createStreamingBubble();

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

				const assistantMsg: Message = {
					id: crypto.randomUUID(),
					role: "assistant",
					content: fullText,
					timestamp: new Date().toISOString(),
					tokenUsage,
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
						const footer = streamingRow.createDiv({ cls: "p-tokens" });
						this.renderTokenCount(footer, tokenUsage);
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

				// Never leave the streaming bubble stuck mid-render — finalize whatever
				// partial text arrived, or drop the empty row.
				const partial = getPartial();
				if (partial && this.activeConversation?.id === conv.id) {
					void finalize(partial);
				} else {
					streamingRow.remove();
				}

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
		const text = sel?.toString() ?? "";
		const conv = this.activeConversation;
		if (!conv) return;

		// Walk from the selection anchor up to the nearest message row so we
		// can record which message was forked from.
		const anchor = sel?.anchorNode;
		const msgEl  = (anchor instanceof Element ? anchor : anchor?.parentElement)
			?.closest("[data-msg-id]");
		const sourceMessageId = msgEl?.getAttribute("data-msg-id") ?? undefined;

		this.selectionToolbar.style.display = "none";
		window.getSelection()?.removeAllRanges();
		void this.plugin.cmdForkConversation(conv.id, text, sourceMessageId);
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
			const hint = this.messagesEl.createDiv({ cls: "pythia-empty" });
			hint.createEl("p", { text: t("startConversationBelow") });
		}

		this.attachLastBubbleLongPress();
	}

	private updateSendBtnLabel(): void {
		const messages = this.activeConversation?.messages ?? [];
		let last: Message | undefined;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].tokenUsage) { last = messages[i]; break; }
		}
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
			this.sendBtn.setText(`${t("sendBtn")} · ↑${fmt}`);
			this.sendBtn.title = t("sendBtnEstTitle", { n: fmt });
		} else {
			this.sendBtn.setText(t("sendBtn"));
			this.sendBtn.title = "";
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
