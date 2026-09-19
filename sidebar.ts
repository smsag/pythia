import { ItemView, MarkdownRenderer, MarkdownView, Notice, Platform, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import { ActionSheet, type ActionSheetItem } from "./ui/ActionSheet";
import { todayISO } from "./utils";
import { estimateTokensFromBytes, lastTokenUsageMessage, unwrapCodeFence } from "./services/messageUtils";
import { applyAccentContrast } from "./ui/accentContrast";
import { PYTHIA_ICON_ID } from "./ui/pluginIcon";
import { noteBasename, safeNoteName } from "./services/pathUtils";
import { renderTurnLabel, appendTokensToTurnLabel, turnTemplateCaption } from "./ui/turnLabel";
import { parseCitations, stripForeignCitations, appendWebSources } from "./services/citations";
import { renderSourcesRow } from "./ui/sourcesRow";
import { parseWebSourcesFromResult } from "./services/WebSearchService";
import { shouldGenerateTitle, shouldGenerateChapterName, shouldAutoArmSearch } from "./services/sendPolicy";
import { looksTimeSensitive } from "./services/webSearchHeuristics";
import { t } from "./i18n";
import { InlineSuggest } from "./ui/InlineSuggest";
import { composerKeyAction, composerPlaceholder } from "./ui/composerKeys";
import { applyPendingTemplate, armPendingTemplate } from "./services/pendingTemplate";
import { RewriteController } from "./ui/RewriteController";
import { referenceEntries } from "./ui/referenceEntries";
import { OptimizationController } from "./ui/OptimizationController";
import { NavigatorController } from "./ui/NavigatorController";
import { HistoryController, type HistoryPick } from "./ui/HistoryController";
import { SummaryController } from "./ui/SummaryController";
import { ContextInspectorController } from "./ui/ContextInspectorController";
import { ForkController } from "./ui/ForkController";
import { MergeController } from "./ui/MergeController";
import { GlossaryController } from "./ui/GlossaryController";
import { paintCitations } from "./ui/citationPainter";
import { attachLongPress } from "./ui/longPress";
import { attachOutsideDismiss } from "./ui/outsideDismiss";
import { SelectionController } from "./ui/SelectionController";
import { HeaderController } from "./ui/HeaderController";
import { decorateCodeBlocks } from "./ui/CodeBlockDecorator";
import { renderRichMarkdown } from "./ui/renderMarkdown";
import { renderNoConversation, renderWelcome } from "./ui/emptyState";
import { ExchangeActionsController } from "./ui/ExchangeActionsController";
import { ComparisonController } from "./ui/ComparisonController";
import { SendHintController } from "./ui/SendHintController";
import { drawAttachIcon, drawSaveIcon, paintToggle } from "./ui/toolbarIcons";
import { ModelSuggestionController } from "./ui/ModelSuggestionController";
import { costSnapshot } from "./models/modelPricing";
import { TruncationController } from "./ui/TruncationController";
import { updateViewportInsets, watchViewport } from "./ui/keyboardInset";
import type { Conversation, Message, ToolCall } from "./models/types";
import type PythiaPlugin from "./main";
import { NoteSuggestModal } from "./suggest/NoteSuggest";
import { InputModal } from "./suggest/InputModal";
import { buildStreamErrorMessage } from "./services/apiError";
import { describeErrorForLog } from "./services/redact";
import { ToolHandler } from "./services/ToolHandler";
import { DeleteFileModal } from "./suggest/DeleteFileModal";
import { TemplateSuggestModal } from "./suggest/TemplateSuggest";

export const PYTHIA_VIEW_TYPE = "pythia";



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
	// Long-press on the last bubble → delete / compare (ADR-160), and the comparison card.
	private exchangeActions!: ExchangeActionsController;
	private comparisonController!: ComparisonController;
	private isScrolling = false;
	// pendingAttachedNotes removed — all note attachments go to conv.contextNotes
	private navigatorController!: NavigatorController;
	/** Tracks active observers per diagram element so stale ones are
	 *  disconnected before new ones are armed on DOM rebuild (#20). */
	private readonly diagObservers = new WeakMap<HTMLElement, { mo: MutationObserver; ro: ResizeObserver }>();

	// Header chrome: title, model badge/popover, inline rename, copy-link, ctx chip (ADR-103).
	private headerController!: HeaderController;
	// Context-budget bar under the header (the >=80% chip lives in HeaderController).
	private ctxBarEl!: HTMLElement;
	private ctxBarFillEl!: HTMLElement;
	// Mono next-send token estimate shown left of the Send button.
	// Quick switcher (F9), history overlay (F10), and delete-with-confirm (ADR-103).
	private historyController!: HistoryController;
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
	// Selection toolbar (Copy/Favorite/Branch/Insert/Inbox) + span-favorites (ADR-103).
	private selectionController!: SelectionController;
	private lastMarkdownView: MarkdownView | null = null;

	// Fork-origin banner, painted marks, and the inline anchor/menu (ADR-103).
	private forkController!: ForkController;
	private mergeController!: MergeController;
	private glossaryController!: GlossaryController;
	// Summary "Speisekarte" cards at the top of the message list. The container is
	// created here (for DOM position); the SummaryController (ADR-103) owns the
	// cards, their auto-collapse observer, and the generate/reveal/save flows.
	private summaryCardsEl: HTMLElement | null = null;
	private summaryController!: SummaryController;
	// Context inspector card (F2/F3) — lives just under the summary cards. The
	// container is created here (for DOM position); the ContextInspectorController
	// (ADR-103) owns the card, the budget bar/chip logic, and the open state.
	private inspectorEl: HTMLElement | null = null;
	private contextInspector!: ContextInspectorController;
	private sendLongPressCleanup: (() => void) | null = null;
	private suppressNextSendClick = false;
	private sendMenuWrap!: HTMLElement;
	private sendMenuCleanup: (() => void) | null = null;
	/** Bottom action sheet used on mobile in place of the desktop `.p-send-menu`
	 *  popover (created lazily on first long-press). */
	private actionSheet: ActionSheet | null = null;
	private sendHint!: SendHintController;
	private modelSuggestion!: ModelSuggestionController;
	private truncation!: TruncationController;
	/** Public: the editor entry point arms a target through it (ADR-178). */
	rewrite!: RewriteController;

	private inputAreaEl!: HTMLElement;
	private inputCollapseBtn!: HTMLButtonElement;
	private inputAreaCollapsed = false;

	private inlineSuggest!: InlineSuggest;
	private indexTriggerEl!: HTMLButtonElement;
	private navigatorEl!: HTMLElement;
	private disposeViewport: (() => void) | null = null;

	private researchBtnEl!: HTMLButtonElement;
	private templateBtnEl!: HTMLButtonElement;
	private vaultBtnEl!: HTMLButtonElement;
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
		return PYTHIA_ICON_ID;
	}

	async onOpen(): Promise<void> {
		this.buildUI();

		// Viewport-driven insets (ADR-132/134): lift above the keyboard, and drop the
		// home-indicator padding when another leaf sits below us.
		this.disposeViewport = watchViewport(() => this.adjustForKeyboard());
		// Opening, closing or resizing a leaf moves this panel's bottom edge and
		// fires no visualViewport event, so the inset would otherwise go stale.
		this.registerEvent(this.app.workspace.on("resize", () => this.adjustForKeyboard()));
		this.registerEvent(this.app.workspace.on("layout-change", () => this.adjustForKeyboard()));

		// Recompute the on-accent label color when the user changes their accent
		// or theme in Appearance settings (Obsidian fires css-change) — no reopen.
		this.registerEvent(
			this.app.workspace.on("css-change", () => this.refreshAccentContrast())
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

		this.summaryController?.dispose();
		this.sendLongPressCleanup?.();
		this.sendLongPressCleanup = null;
		this.closeSummaryMenu();
		this.actionSheet?.close();

		// Discard any pending optimization state and its model offer (ADR-181).
		this.optimizationController?.cancel();
		this.modelSuggestion?.clear();

		// Clean up navigator outside-click listener if view is closed while open (#26).
		this.navigatorController?.close();
		this.headerController?.close();
		this.historyController?.close();

		// The selectionchange listener is registered via registerDomEvent and is
		// cleaned up automatically on view unload — no manual removal needed.
		this.disposeViewport?.();
		this.disposeViewport = null;
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
		this.headerController?.exitRename(false);     // discard any in-progress rename
		this.optimizationController?.cancel();
		this.modelSuggestion?.clear();
		this.activeConversation = conversation;
		// autoScroll is NOT reset here — renderMessages sets it based on scrollTo.
		// Resetting to true here was the root cause of conversations always scrolling
		// to the bottom on open: anything calling scrollToBottom() during rendering
		// would fire because autoScroll was still true.
		this.navigatorController?.close();            // #26 — detach stale outside-click listener
		this.headerController.renderHeader();
		this.headerController.updateInstructions();
		this.updateToolbarToggles();
		this.renderReferencePills();
		this.updateSendBtnLabel();
		await this.renderMessages(scrollTo);
		if (focus) this.inputEl?.focus();
		this.backfillChapterNames(conversation);
	}

	getActiveConversation(): Conversation | null { return this.activeConversation; }

	/** Repaint the header's model | effort | language after a global default changed (ADR-165). */
	refreshInstructions(): void { this.headerController?.updateInstructions(); }

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
		// No key for this provider → every call below would throw the same
		// "key not configured" error, once per message, on every open.
		if (!this.plugin.hasApiKeyFor(conversation.provider)) return;
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
							conversation.provider,
							conversation
						);
						if (name) msg.chapterName = name;
					} catch (e) {
						// One failure (auth, network, quota) means the rest will fail the
						// same way: stop here rather than log it N more times. The
						// remaining messages are picked up on the next open.
						console.warn("[Pythia] chapter name backfill stopped:", describeErrorForLog(e));
						break;
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
		this.headerController?.close();
		this.historyController?.close();
		this.renderedConvId = null;
		this.lastRenderedMsgId = null;
		this.cachedLineHeight = null; // inputEl is about to be recreated below
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("pythia-view");
		this.refreshAccentContrast();

		this.headerController = new HeaderController({
			plugin: this.plugin,
			getConversation: () => this.activeConversation,
			getContainer: () => this.containerEl.children[1] as HTMLElement,
			registerDomEvent: (el, type, cb, opts) =>
				this.registerDomEvent(el as HTMLElement, type as keyof HTMLElementEventMap, cb as never, opts),
			openHistoryView: () => this.historyController.openHistoryView(),
			handleDeleteConversation: () => void this.historyController.handleDeleteConversation(),
			revealContextInspector: () => this.contextInspector.reveal(),
			updateContextBar: () => this.contextInspector.updateContextBar(),
			refreshContextInspector: () => this.contextInspector.refresh(),
			updateSendHint: () => this.sendHint.update(),
		});
		this.headerController.mount(container);

		// Context-budget bar: a 3px track directly under the header row. Fill
		// width = context usage / model window; turns warning-colored at >=80%.
		this.ctxBarEl = container.createDiv({ cls: "p-ctx-bar" });
		this.ctxBarFillEl = this.ctxBarEl.createDiv({ cls: "p-ctx-bar-fill" });
		this.registerDomEvent(this.ctxBarEl, "click", () => this.contextInspector.reveal());
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
			onRated: (difficulty) => this.modelSuggestion.consider(difficulty),
		});

		this.navigatorController = new NavigatorController({
			plugin: this.plugin,
			navigatorEl: this.navigatorEl,
			indexTriggerEl: this.indexTriggerEl,
			getConversation: () => this.activeConversation,
			setActiveConversation: (conv) => this.setActiveConversation(conv),
			scrollToMessage: (id) => this.scrollToMessage(id),
			scrollToFavorite: (fav) => this.selectionController.scrollToFavorite(fav),
			removeFavorite: (favId) => this.selectionController.removeFavorite(favId),
			revealMergeLink: (mergeId) => this.mergeController.revealMergeLink(mergeId),
			removeMergeLink: (mergeId) => this.mergeController.removeMergeLink(mergeId),
			goToFavoritesSummary: () => this.summaryController.goToFavoritesSummary(),
		});

		this.historyController = new HistoryController({
			plugin: this.plugin,
			getContainer: () => this.containerEl.children[1] as HTMLElement,
			getConversation: () => this.activeConversation,
			isStreaming: () => this.isStreaming,
			setActiveConversation: (conv) => this.setActiveConversation(conv),
			renderHeader: () => this.headerController.renderHeader(),
			getRelated: (id, signal) => this.plugin.getRelatedConversations(id, signal),
		});

		this.summaryController = new SummaryController({
			plugin: this.plugin,
			getConversation: () => this.activeConversation,
			getCardsEl: () => this.summaryCardsEl,
			getMessagesEl: () => this.messagesEl,
			renderMarkdown: (md, el) => renderRichMarkdown(this.app, md, el, this),
			renderHeader: () => this.headerController.renderHeader(),
		});

		// Construct-once so `inspectorOpen` survives a buildUI rebuild; DOM handles
		// are read through getters, so a long-lived controller sees current elements.
		// (Both controllers are populated in renderMessages, once their containers exist.)
		this.contextInspector ??= new ContextInspectorController({
			plugin: this.plugin,
			getConversation: () => this.activeConversation,
			getWrapEl: () => this.inspectorEl,
			getBarEl: () => this.ctxBarEl,
			getBarFillEl: () => this.ctxBarFillEl,
			getChipEl: () => this.headerController.getChipEl(),
			getLastTokenUsageMsg: () => lastTokenUsageMessage(this.activeConversation?.messages ?? []),
			scrollToTop: () => this.scrollToTop(),
			refreshReferencePills: () => this.renderReferencePills(),
			onSummarize: () => void this.summaryController.generateConversationSummary(),
		});

		this.forkController = new ForkController({
			plugin: this.plugin,
			getConversation: () => this.activeConversation,
			getMessagesEl: () => this.messagesEl,
			setActiveConversation: (conv) => this.setActiveConversation(conv),
			scrollToMessage: (id) => this.scrollToMessage(id),
			expandBubbleIfCollapsed: (row) => this.expandBubbleIfCollapsed(row),
			renderMarkdown: (md, el) => renderRichMarkdown(this.app, md, el, this),
			runFavoritesSummary: (conv) => this.summaryController.runFavoritesSummary(conv),
		});

		this.glossaryController = new GlossaryController({
			plugin: this.plugin,
			getConversation: () => this.activeConversation,
			getMessagesEl: () => this.messagesEl,
			renderMarkdown: (md, el) => renderRichMarkdown(this.app, md, el, this),
		});

		this.exchangeActions = new ExchangeActionsController({
			plugin: this.plugin,
			getConversation: () => this.activeConversation,
			getMessagesEl: () => this.messagesEl,
			isStreaming: () => this.isStreaming,
			onExchangeDeleted: () => {
				const conv = this.activeConversation;
				this.lastRenderedMsgId = conv?.messages.at(-1)?.id ?? null;
				if (conv && conv.messages.length === 0) renderWelcome(this.messagesEl);
				this.exchangeActions.attach();
			},
			startComparison: (userId, assistantId) => this.comparisonController.start(userId, assistantId),
		});

		this.rewrite = new RewriteController({
			plugin: this.plugin,
			getConversation: () => this.activeConversation,
			focusInput: () => this.inputEl?.focus(),
			refreshPills: () => this.renderReferencePills(),
		});
		this.truncation = new TruncationController({
			plugin: this.plugin,
			getConversation: () => this.activeConversation,
			isStreaming: () => this.isStreaming,
			sendText: (text) => this.sendText(text),
			rerender: () => { this.renderedConvId = null; return this.renderMessages(); },
			startComparison: (userId, assistantId) => this.comparisonController.start(userId, assistantId),
		});

		this.comparisonController = new ComparisonController({
			plugin: this.plugin,
			getConversation: () => this.activeConversation,
			getMessagesEl: () => this.messagesEl,
			isStreaming: () => this.isStreaming,
			setStreamingState: (on) => this.setStreamingState(on),
			renderMarkdown: (md, el) => renderRichMarkdown(this.app, md, el, this),
			onStarted: (userId) => { this.lastRenderedMsgId = userId; },
			rerender: () => { this.renderedConvId = null; void this.renderMessages(); },
			scrollToBottom: () => this.scrollToBottom(),
		});

		this.mergeController = new MergeController({
			plugin: this.plugin,
			getConversation: () => this.activeConversation,
			getMessagesEl: () => this.messagesEl,
			setActiveConversation: (conv) => this.setActiveConversation(conv),
			scrollToMessage: (id) => this.scrollToMessage(id),
			expandBubbleIfCollapsed: (row) => this.expandBubbleIfCollapsed(row),
			renderMarkdown: (md, el) => renderRichMarkdown(this.app, md, el, this),
			registerDomEvent: (el, type, cb, opts) =>
				this.registerDomEvent(el, type as keyof HTMLElementEventMap, cb as never, opts),
		});
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
		this.selectionController = new SelectionController({
			plugin: this.plugin,
			getConversation: () => this.activeConversation,
			getMessagesEl: () => this.messagesEl,
			getLastMarkdownView: () => this.lastMarkdownView,
			expandBubbleIfCollapsed: (row) => this.expandBubbleIfCollapsed(row),
			toggleForkAnchor: (forkId, markEl) => this.forkController.toggleForkAnchor(forkId, markEl),
			toggleMergeAnchor: (mergeId, markEl) => this.mergeController.toggleMergeAnchor(mergeId, markEl),
			toggleTermAnchor: (term, markEl) => void this.glossaryController.toggleAnchor(term, markEl),
			defineTerm: (term, passage) => void this.glossaryController.defineSelection(term, passage),
			describePerson: (name, passage) => void this.glossaryController.describePerson(name, passage),
			registerDomEvent: (el, type, cb, opts) =>
				this.registerDomEvent(el as HTMLElement, type as keyof HTMLElementEventMap, cb as never, opts),
		});
		this.selectionController.mount(container);

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
			attr: { placeholder: composerPlaceholder(Platform.isMobile), rows: "2" },
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
			if (composerKeyAction(e) !== "send") return;   // Enter is a line break (ADR-175)
			e.preventDefault();
			void this.sendMessage();
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
		drawAttachIcon(attachBtn);
		this.registerDomEvent(attachBtn, "click", () => {
			this.ensureInputExpanded();
			this.onAttachNote();
		});

		const saveBtn = toolbarLeft.createEl("button", {
			cls: "p-tool-btn",
			attr: { title: t("saveResponseTooltip") },
		});
		drawSaveIcon(saveBtn);
		this.registerDomEvent(saveBtn, "click", () => {
			this.ensureInputExpanded();
			void this.onSaveResponse();
		});

		const applyTemplateBtn = this.templateBtnEl = toolbarLeft.createEl("button", {
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

		this.vaultBtnEl = toolbarLeft.createEl("button", {
			cls: "p-tool-btn",
			attr: { title: t("vaultContextTooltip") },
		});
		setIcon(this.vaultBtnEl, "library");
		this.registerDomEvent(this.vaultBtnEl, "click", () => this.toggleVaultContext());
		this.updateToolbarToggles();

		this.inputCollapseBtn = toolbarLeft.createEl("button", {
			cls: "p-tool-btn",
			attr: { title: t("minimizeInputTooltip") },
		});
		setIcon(this.inputCollapseBtn, "arrow-down");
		this.registerDomEvent(this.inputCollapseBtn, "click", () => this.toggleInputArea());

		// Max-tokens warning, sits just left of Send (ADR-162: SendHintController).
		this.sendHint = new SendHintController({
			getConversation: () => this.activeConversation,
			getGlobalMaxTokens: () => this.plugin.settings.maxTokens,
			registerDomEvent: (el, type, cb) => this.registerDomEvent(el, type, cb),
			openSettings: () => this.headerController.openConversationSettings(),
		});
		this.sendHint.mount(toolbar);
		this.modelSuggestion = new ModelSuggestionController({
			getSettings: () => this.plugin.settings,
			getConversation: () => this.activeConversation,
			hasApiKeyFor: (provider) => this.plugin.hasApiKeyFor(provider),
			registerDomEvent: (el, type, cb) => this.registerDomEvent(el, type, cb),
		});
		this.modelSuggestion.mount(toolbar);

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
		this.sendLongPressCleanup = attachLongPress(this.sendBtn, () => {
			if (this.isStreaming) return;
			// The press already "used up" this interaction; swallow the click that
			// follows it so releasing doesn't also send the message.
			this.suppressNextSendClick = true;
			this.openSummaryMenu();
		});
	}

	/** Actions offered by the Send long-press menu — shared by the mobile bottom
	 *  sheet and the desktop popover so both stay in lockstep. */
	private buildSummaryMenuItems(): ActionSheetItem[] {
		const conv = this.activeConversation;
		if (!conv) return [];
		// Prompt optimization (moved here from the input toolbar). Disabled when there
		// is nothing typed to optimize or no optimizer template is configured.
		const optimizeDisabled =
			this.inputEl.value.trim().length === 0 || !this.plugin.settings.promptOptimizerTemplateId;
		return [
			{
				label: t("menuSummarizeConversation"), icon: "align-left",
				disabled: conv.messages.length === 0,
				onSelect: () => void this.summaryController.generateConversationSummary(),
			},
			{
				label: t("menuSummarizeFavorites"), icon: "star",
				disabled: (conv.favorites?.length ?? 0) === 0,
				onSelect: () => void this.summaryController.summarizeFavorites(),
			},
			{
				label: t("menuOptimizePrompt"), icon: "sparkles", disabled: optimizeDisabled,
				onSelect: () => { this.ensureInputExpanded(); void this.optimizationController.start(); },
			},
		];
	}

	/** The Send long-press menu. On mobile it opens a bottom action sheet (a
	 *  stacked popover is the wrong UX on touch); on desktop it keeps the small
	 *  popover above the Send button. The only entry point for generating summaries. */
	private openSummaryMenu(): void {
		const conv = this.activeConversation;
		if (!conv) { new Notice(t("noActiveConvToSend")); return; }

		const items = this.buildSummaryMenuItems();

		if (Platform.isMobile) {
			this.actionSheet ??= new ActionSheet(this.containerEl.children[1] as HTMLElement);
			if (this.actionSheet.isOpen) { this.actionSheet.close(); return; } // toggle off
			this.actionSheet.open(items, { title: t("menuSummaryTitle") });
			return;
		}

		if (this.sendMenuCleanup) { this.closeSummaryMenu(); return; } // toggle off

		const menu = this.sendMenuWrap.createDiv({ cls: "p-send-menu" });
		for (const item of items) {
			const el = menu.createDiv({
				cls: `p-send-menu-item${item.disabled ? " p-send-menu-item-disabled" : ""}`,
			});
			const ic = el.createSpan({ cls: "p-send-menu-icon" });
			setIcon(ic, item.icon);
			el.createSpan({ cls: "p-send-menu-label", text: item.label });
			if (item.disabled) continue;
			// mousedown (not click) so the selection/keyboard focus isn't disturbed.
			el.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.closeSummaryMenu();
				item.onSelect();
			});
		}

		// Outside-click / outside-touch dismissal (deferred so this gesture doesn't self-close).
		const detachOutside = attachOutsideDismiss(
			(target) => this.sendMenuWrap.contains(target),
			() => this.closeSummaryMenu(),
			{ touch: true },
		);
		this.sendMenuCleanup = () => {
			detachOutside();
			menu.remove();
		};
	}

	private closeSummaryMenu(): void {
		this.sendMenuCleanup?.();
		this.sendMenuCleanup = null;
	}

	renderEmptyState(): void {
		this.messagesEl.empty();
		renderNoConversation(this.messagesEl);
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

	private renderReferencePills(): void {
		this.updateToolbarToggles(); // every template arm/clear repaints this row
		this.referencePillsEl.empty();
		const conv = this.activeConversation;

		if (!conv) {
			this.referenceRowHasEntries = false;
			this.updateReferenceRowVisibility();
			return;
		}

		const entries = referenceEntries(conv, this.plugin.getAutoContext(conv.id));

		this.referenceRowHasEntries = entries.length > 0;
		this.updateReferenceRowVisibility();
		// Keep the context inspector in sync with note add/remove.
		this.contextInspector.refresh();
		if (entries.length === 0) return;

		for (const entry of entries) {
			const fileName = entry.path.split("/").pop() ?? entry.path; // with extension, for the delete prompt
			const displayName = "label" in entry ? entry.label : noteBasename(entry.path);
			const file = this.app.vault.getAbstractFileByPath(entry.path);
			const tokEst = file instanceof TFile ? estimateTokensFromBytes(file.stat.size) : null;

			// Wikilink reference: [[ name ]] ~tokens ×
			const ref = this.referencePillsEl.createEl("span", { cls: "p-wikilink" });
			// Auto-retrieved pills are read-only and visually distinct (no × — they
			// are ephemeral per-turn context, not persistent conversation context).
			if (entry.kind === "auto") ref.addClass("p-wikilink--auto");
			if (entry.kind === "template" || entry.kind === "rewrite") ref.addClass("p-wikilink--template");
			ref.createEl("span", { cls: "p-wikilink-bracket", text: "[[" });
			const labelTitle = entry.kind === "auto" ? `${entry.path} — ${t("vaultContextAutoPill")}` : entry.path;
			const label = ref.createEl("span", { text: displayName, cls: "p-wikilink-name", attr: { title: labelTitle } });
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
			if (entry.kind === "auto") continue; // read-only: no remove/delete affordance
			const x = ref.createEl("button", { cls: "p-wikilink-x", text: "×" });
			if (entry.kind !== "output") {
				x.addEventListener("click", async () => {
					if (entry.kind === "template") conv.pendingTemplate = undefined;
					else if (entry.kind === "rewrite") conv.pendingRewrite = undefined;
					else conv.contextNotes = conv.contextNotes.filter(n => n !== entry.path);
					await this.plugin.conversationStore.save(conv);
					this.renderReferencePills();
				});
			} else {
				x.addEventListener("click", () => {
					new DeleteFileModal(this.app, fileName, async () => {
						const f = this.app.vault.getAbstractFileByPath(entry.path);
						if (f instanceof TFile) await this.app.vault.trash(f, true);
						conv[entry.field] = undefined;
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
		this.exchangeActions.hidePreview();

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
			this.exchangeActions.attach();
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
				this.contextInspector.refresh();
				if (scrollTo === "top") {
					this.scrollToTop();
				} else {
					this.scrollToBottom();
				}
				this.exchangeActions.attach();
				return;
			}
			// anchor not found (e.g. delete-last-exchange removed the tracked message)
			// → fall through to full rebuild
		}

		// ── Full rebuild ─────────────────────────────────────────────────────────
		this.messagesEl.empty();
		this.forkController.closeAnchor(); // fork anchor DOM detached by empty(); drop the stale reference + listeners
		this.mergeController.closeAnchor(); // same for the merge anchor
		this.glossaryController.closeAnchor();
		this.renderedConvId = conv.id;
		this.lastRenderedMsgId = null;

		// Context inspector is the very first thing in the conversation view. Create
		// it, then populate it — the container only exists after this rebuild, so the
		// controller must be refreshed here (not in buildUI, which runs earlier).
		this.inspectorEl = this.messagesEl.createDiv({ cls: "p-inspector-wrap" });
		this.contextInspector.refresh();

		// The fork banner ("branched from…") comes next: on a fork it's the primary
		// orientation cue, so it sits above the summary cards and next to the first
		// message (ADR-084).
		if (conv.forkedFromId) this.forkController.renderForkBanner();
		this.mergeController.renderIncomingBanner(); // far half of a merge link (ADR-130)

		// Summary "Speisekarte" cards sit below the fork info. Create, then populate —
		// same reason as the inspector above.
		this.summaryCardsEl = this.messagesEl.createDiv({ cls: "p-summary-cards" });
		this.summaryController.renderSummaryCards();

		if (msgs.length === 0) {
			renderWelcome(this.messagesEl);
			return;
		}
		for (const msg of msgs) {
			await this.appendMessageBubble(msg);
		}
		this.lastRenderedMsgId = tailId;
		// A pending comparison sits after the prompt it answers (ADR-160).
		if (conv.comparison) this.comparisonController.render();

		if (scrollTo === "top") {
			this.scrollToTop();
		} else {
			this.scrollToBottom();
		}
		this.exchangeActions.attach();
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
	/** Republish `--p-on-accent` for the current theme accent (ADR-130 session:
	 *  logic lives in `ui/accentContrast.ts`; the view only supplies the root). */
	private refreshAccentContrast(): void {
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		if (root) applyAccentContrast(root);
	}

	/** Replace ⟦cite:…⟧ markers left in the rendered markdown with numbered
	 *  superscript chips. Mirrors the favorites re-paint: walk text nodes and
	 *  swap each marker for a `.p-cite` chip that opens its source on click. */

	private async appendMessageBubble(msg: Message): Promise<HTMLElement> {
		// ── User message ────────────────────────────────────────────
		if (msg.role === "user") {
			const row = this.messagesEl.createDiv({
				cls: "p-msg-user",
				attr: { "data-msg-id": msg.id },
			});
			renderTurnLabel(row, msg, this.activeConversation);
			const bubble = row.createDiv({ cls: "p-bubble" });
			const isLong = msg.content.length > 280;
			if (isLong) bubble.addClass("p-bubble-collapsed");
			try {
				await MarkdownRenderer.render(this.app, unwrapCodeFence(msg.content), bubble, "", this);
			} catch (e) {
				console.error("[Pythia] render error:", e);
			}
			this.selectionController.repaintFavorites(bubble, msg.id);
			this.forkController.repaintForkOrigins(bubble, msg.id);
			this.mergeController.repaintMergeLinks(bubble, msg.id);
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
		renderTurnLabel(row, msg, this.activeConversation, { showCost: this.plugin.settings.showCost });
		const aiBody = row.createDiv({ cls: "p-ai-body" });
		try {
			await MarkdownRenderer.render(this.app, unwrapCodeFence(stripForeignCitations(msg.content)), aiBody, "", this);
		} catch (e) {
			console.error("[Pythia] render error:", e);
		}
		decorateCodeBlocks(aiBody, this.diagObservers);
		this.selectionController.repaintFavorites(aiBody, msg.id);
		this.forkController.repaintForkOrigins(aiBody, msg.id);
		this.mergeController.repaintMergeLinks(aiBody, msg.id);
		void this.glossaryController.repaint(aiBody);
		// Citations: paint markers → chips, then render the sources row. Backfill
		// sources from content for messages saved before the field existed.
		const sources = msg.sources ?? parseCitations(msg.content);
		paintCitations(this.app, aiBody, sources);
		// The template rides the sources row, not the turn label (ADR-140), and on
		// the same turns the label used to caption: where a template starts
		// applying, never repeated down the transcript.
		renderSourcesRow(this.app, row, sources, turnTemplateCaption(msg, this.activeConversation));
		this.truncation.paint(row, msg);
		this.rewrite.paint(row, msg);

		return aiBody;
	}

	private createStreamingBubble(): {
		appendToken: (text: string) => void;
		finalize: (fullText: string) => Promise<void>;
		row: HTMLElement;
	} {
		const row = this.messagesEl.createDiv({ cls: "p-msg-ai" });
		const streamMsg: Message = {
			id: "", role: "assistant", content: "",
			timestamp: new Date().toISOString(), model: this.activeConversation?.model,
			templateId: this.activeConversation?.templateId,
		};
		// Resolved before the answer exists, so the finished row shows the template
		// under the same rule as a re-rendered one.
		const streamTemplate = turnTemplateCaption(streamMsg, this.activeConversation);
		renderTurnLabel(row, streamMsg, this.activeConversation);
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
					await MarkdownRenderer.render(this.app, unwrapCodeFence(stripForeignCitations(fullText)), aiBody, "", this);
				} catch (e) {
					console.error("[Pythia] render error:", e);
				}
				decorateCodeBlocks(aiBody, this.diagObservers);
				const sources = appendWebSources(parseCitations(fullText), this.pendingWebSources);
				paintCitations(this.app, aiBody, sources);
				renderSourcesRow(this.app, row, sources, streamTemplate);
				// rAF ensures scrollToBottom runs after the markdown DOM is laid out.
				this.autoScroll = true;
				requestAnimationFrame(() => this.scrollToBottom(true));
			},
		};
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

	// Viewport-derived insets: lift content above an open soft keyboard (ADR-132),
	// and drop the home-indicator padding when the panel does not actually reach
	// the screen edge (ADR-134). Both live in ui/keyboardInset.ts.
	private adjustForKeyboard(): void {
		updateViewportInsets(this.containerEl.children[1] as HTMLElement);
	}

	/** Repaint one message's merge marks after a link was added or removed (ADR-130). */
	repaintMergeMessage(messageId: string): void {
		this.mergeController.repaintMessage(messageId);
	}

	/** Choose a conversation in the history panel (ADR-143). The view owns the
	 *  controller, so plugin-level commands reach the picker through here. */
	pickConversation(pick: HistoryPick): void {
		this.historyController.openHistoryView(pick);
	}

	/** Scroll to a merge link's passage and open its inline summary anchor (ADR-130). */
	revealMergeLink(mergeId: string): void { this.mergeController.revealMergeLink(mergeId); }

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



	/** Paint the input toolbar's per-conversation toggles — web search, vault
	 *  context, and an armed template (ADR-177) — with one shared active state.
	 *  Called on build and on every switch: the toolbar is not rebuilt. */
	private updateToolbarToggles(): void {
		const conv = this.activeConversation;
		paintToggle(this.researchBtnEl, !!conv?.researchMode);
		paintToggle(this.vaultBtnEl, !!(conv?.vaultContext ?? this.plugin.settings.vaultContextEnabled));
		paintToggle(this.templateBtnEl, !!conv?.pendingTemplate);
	}

	/** Briefly pulse the research globe to show web search was auto-armed for this
	 *  send (ADR-099) without flipping the persistent per-conversation toggle. */
	private flashResearchAutoArm(): void {
		if (!this.researchBtnEl) return;
		this.researchBtnEl.addClass("is-auto-armed");
		window.setTimeout(() => this.researchBtnEl?.removeClass("is-auto-armed"), 1600);
	}

	/** Toggle web search for the active conversation. Warns (but still toggles)
	 *  when no Tavily key is configured so the intent is remembered for when one
	 *  is added. Persists so the choice survives reloads and device sync. */
	private toggleResearchMode(): void {
		const conv = this.activeConversation;
		if (!conv) return;
		conv.researchMode = !conv.researchMode;
		this.updateToolbarToggles();
		if (conv.researchMode && !this.plugin.webSearchService.hasApiKey()) {
			new Notice(t("researchNoKeyNotice"));
		} else {
			new Notice(conv.researchMode ? t("researchEnabledNotice") : t("researchDisabledNotice"));
		}
		void this.plugin.conversationStore.save(conv);
	}


	/** Toggle vault-context (semantic RAG) for the active conversation; persists.
	 *  The first send after enabling lazily builds the embedding index. */
	private toggleVaultContext(): void {
		const conv = this.activeConversation;
		if (!conv) return;
		conv.vaultContext = !(conv.vaultContext ?? this.plugin.settings.vaultContextEnabled);
		this.updateToolbarToggles();
		new Notice(conv.vaultContext ? t("vaultContextOn") : t("vaultContextOff"));
		void this.plugin.conversationStore.save(conv);
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
			// Armed for the next answer only, never written onto the conversation (ADR-177).
			conv.pendingTemplate = armPendingTemplate(tpl);
			await this.plugin.conversationStore.save(conv);
			this.headerController.updateInstructions();
			this.renderReferencePills();
			new Notice(t("appliedTemplate", { name: tpl.name }));

			if (tpl.autoPrompt) {
				this.prefillInput(tpl.autoPrompt);
			}
		}).open();
	}

	/** Facade for the `Pythia: Summarize favorites` command (main.ts). */
	summarizeFavorites(): Promise<void> {
		return this.summaryController.summarizeFavorites();
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

		const safeName = safeNoteName(conv.name);

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

	/** Send `text` as the next user turn, keeping whatever the user had typed
	 *  as their draft (the Continue / Retry actions under a cut-off answer). */
	sendText(text: string): Promise<void> {
		const draft = this.inputEl.value;
		this.inputEl.value = text;
		const sent = this.sendMessage(); // reads and clears the field synchronously
		this.inputEl.value = draft;
		return sent;
	}

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

		// A pending comparison must be resolved first: history never holds two
		// answers to one prompt, and a new turn would have to choose one (ADR-160).
		if (conv.comparison) {
			new Notice(t("comparePending"));
			return;
		}

		const text = this.inputEl.value.trim();
		if (!text) return;

		this.inputEl.value = "";
		this.autoResizeTextarea();
		this.setStreamingState(true);

		// This turn: accepted model suggestion, armed template over it (ADR-177/181).
		const turnConv = applyPendingTemplate(this.modelSuggestion.layer(conv));
		this.modelSuggestion.sent();
		const userMsg: Message = {
			id: crypto.randomUUID(),
			role: "user",
			content: text,
			timestamp: new Date().toISOString(),
			attachedNotes: turnConv.contextNotes.length > 0 ? [...turnConv.contextNotes] : undefined,
		};
		conv.messages.push(userMsg);
		// Persist the user turn immediately so it survives an errored or empty
		// response — previously nothing saved the conversation until a reply
		// completed, so a failed send silently dropped the user's own message.
		await this.plugin.conversationStore.save(conv);
		this.messagesEl.querySelector(".pythia-empty, .p-welcome")?.remove();
		await this.appendMessageBubble(userMsg);
		this.lastRenderedMsgId = userMsg.id;

		const attachedNotes = [...(turnConv.contextNotes ?? [])];

		const { appendToken, finalize, row: streamingRow } = this.createStreamingBubble();
		this.pendingWebSources = [];

		// Offered for THIS send only — never persisted (ADR-099); the rule is in sendPolicy.
		const autoArmedSearch = shouldAutoArmSearch({
			researchMode: conv.researchMode,
			autoArmEnabled: this.plugin.settings.webSearchAutoArm,
			hasApiKey: this.plugin.webSearchService.hasApiKey(),
			timeSensitive: looksTimeSensitive(text, new Date().getFullYear()),
		});
		const researchActive = (conv.researchMode ?? false) || autoArmedSearch;
		if (autoArmedSearch) this.flashResearchAutoArm();

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
						researchActive
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
				const noteName = noteBasename(rawPath);
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

				const allowed = ToolHandler.allowedToolNames(conv.writeMode ?? "all", researchActive);
				const result = await this.plugin.toolHandler.execute(call, allowed, conv.contextNotes);

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

		try {
		await this.plugin.llmRouter.streamMessage(
			// Pass an armed shallow clone for an auto-armed send so web_search is
			// offered this turn. The clone shares conv.messages (read-only in the
			// provider) and is never persisted — sidebar's own callbacks below save
			// the original `conv`, so the toggle stays off after the turn.
			autoArmedSearch ? { ...turnConv, researchMode: true } : turnConv,
			this.rewrite.decorate(text, conv),
			attachedNotes,
			appendToken,
			async (fullText, tokenUsage, finish) => {
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
					this.truncation.noticeEmptyReply(finish);
					return;
				}

				const parsedSources = appendWebSources(parseCitations(fullText), this.pendingWebSources);
				// Priced now (ADR-163), on the model that answered: turnConv, which a
				// template or model suggestion can move off conv.model (ADR-181).
				const cost = costSnapshot(turnConv.model, tokenUsage);
				const assistantMsg: Message = {
					id: crypto.randomUUID(),
					role: "assistant",
					content: fullText,
					timestamp: new Date().toISOString(),
					model: turnConv.model,
					tokenUsage,
					...(turnConv.templateId ? { templateId: turnConv.templateId } : {}),
					...(parsedSources.length ? { sources: parsedSources } : {}),
					...(finish?.truncated ? { truncated: true as const } : {}),
					...(cost ? { cost } : {}),
				};
				this.rewrite.attach(conv, assistantMsg);
				conv.messages.push(assistantMsg);
				// Spent. Cleared on a committed answer, not at send start, so an
				// errored or empty reply leaves it armed for the retry (ADR-177).
				conv.pendingTemplate = undefined;
				this.modelSuggestion.spent(conv.id);
				if (this.activeConversation?.id === conv.id) {
					this.lastRenderedMsgId = assistantMsg.id;
					// Surface any vault-RAG notes pulled in this turn as auto pills (ADR-116).
					this.renderReferencePills();
				}
				const rows = this.messagesEl.querySelectorAll(".p-msg-ai");
				const lastRow = rows[rows.length - 1] as HTMLElement | null;
				if (lastRow && !lastRow.getAttribute("data-msg-id")) {
					lastRow.setAttribute("data-msg-id", assistantMsg.id);
					if (tokenUsage) {
						const label = streamingRow.querySelector<HTMLElement>(".p-turn-label");
						if (label && this.plugin.settings.showCost) appendTokensToTurnLabel(label, tokenUsage, { msg: assistantMsg });
						else if (label) appendTokensToTurnLabel(label, tokenUsage);
					}
					this.truncation.paint(lastRow, assistantMsg);
					this.rewrite.paint(lastRow, assistantMsg);
				}
				await this.plugin.conversationStore.save(conv);
				if (this.activeConversation?.id === conv.id) {
					this.exchangeActions.attach();
				}

				if (shouldGenerateTitle(conv)) {
					const convId = conv.id;
					this.plugin.llmRouter
						.generateConversationTitle(userMsg.content, fullText, conv.provider, conv)
						.then(async (title) => {
							const c = this.plugin.conversationStore.getById(convId);
							if (!c) return;
							await this.plugin.renameConversation(c, title);
							if (this.activeConversation?.id === convId) {
								this.headerController.setConvName(c.name);
							}
						})
						.catch((e) => console.warn("[Pythia] conversation title generation failed:", e));
				}

				if (shouldGenerateChapterName(userMsg)) {
					const convId = conv.id;
					const msgId  = userMsg.id;
					this.plugin.llmRouter
						.generateChapterName(userMsg.content, conv.provider, conv)
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
				// Log a compact, secret-scrubbed description rather than the raw SDK
				// error object (avoids ever surfacing request metadata in the console).
				console.error("[Pythia] stream error:", describeErrorForLog(error));

				new Notice(buildStreamErrorMessage(error, turnConv.model ?? ""));

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
		} catch (error) {
			// The provider catches its own failures; this is for anything thrown
			// before it runs (a retriever bug, a callback throwing). Without it the
			// rejection was unhandled and `isStreaming` stayed true — the input
			// disabled and Send reading "Stop" until the view was reopened.
			console.error("[Pythia] send failed:", describeErrorForLog(error));
			new Notice(t("sendFailed", { error: error instanceof Error ? error.message : String(error) }));
			streamingRow.remove();
			this.setStreamingState(false);
		}
	}

	private updateSendBtnLabel(): void {
		// The token estimate now lives in a mono label left of Send (not the
		// button label). The button reads just "Senden" / "Stopp".
		this.sendBtn.setText(t("sendBtn"));
		this.sendBtn.title = "";
		this.contextInspector.updateContextBar();
	}

	private setStreamingState(streaming: boolean): void {
		this.isStreaming = streaming;
		// Drives `.p-input-area.streaming`, which hides the next-send estimate: it
		// describes a send that cannot happen mid-stream, and it costs the toolbar
		// row ~60px exactly when the button label is at its widest.
		this.inputAreaEl.toggleClass("streaming", streaming);
		if (streaming) {
			this.exchangeActions.detach();
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
