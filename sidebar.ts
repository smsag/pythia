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
import { estimateTokensFromBytes, estimateTokensFromText, formatClockTime } from "./services/messageUtils";
import { parseRgb, readableOnAccent, type Rgb } from "./services/color";
import { parseCitations, eachCitationSegment, stripForeignCitations, appendWebSources } from "./services/citations";
import { parseWebSourcesFromResult } from "./services/WebSearchService";
import { shouldGenerateTitle, shouldGenerateChapterName } from "./services/sendPolicy";
import { looksTimeSensitive } from "./services/webSearchHeuristics";
import { t } from "./i18n";
import { InlineSuggest } from "./ui/InlineSuggest";
import { OptimizationController } from "./ui/OptimizationController";
import { NavigatorController } from "./ui/NavigatorController";
import { HistoryController } from "./ui/HistoryController";
import { SummaryController } from "./ui/SummaryController";
import { ContextInspectorController } from "./ui/ContextInspectorController";
import { ForkController } from "./ui/ForkController";
import { SelectionController } from "./ui/SelectionController";
import { HeaderController } from "./ui/HeaderController";
import { decorateCodeBlocks } from "./ui/CodeBlockDecorator";
import type { Conversation, Message, MessageSource, ToolCall, TokenUsage } from "./models/types";
import type PythiaPlugin from "./main";
import { NoteSuggestModal } from "./suggest/NoteSuggest";
import { InputModal } from "./suggest/InputModal";
import { buildStreamErrorMessage } from "./services/apiError";
import { ToolHandler } from "./services/ToolHandler";
import { DeleteFileModal } from "./suggest/DeleteFileModal";
import { TemplateSuggestModal } from "./suggest/TemplateSuggest";
import { abbreviateModel, isReasoningModel, isMistralReasoningModel } from "./models/knownModels";
import { DEFAULT_MAX_TOKENS_REASONING } from "./services/promptConstants";

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

	// Header chrome: title, model badge/popover, inline rename, copy-link, ctx chip (ADR-103).
	private headerController!: HeaderController;
	// Context-budget bar under the header (the >=80% chip lives in HeaderController).
	private ctxBarEl!: HTMLElement;
	private ctxBarFillEl!: HTMLElement;
	// Mono next-send token estimate shown left of the Send button.
	private sendEstimateEl!: HTMLElement;
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

		this.summaryController?.dispose();
		this.sendLongPressCleanup?.();
		this.sendLongPressCleanup = null;
		this.closeSummaryMenu();

		// Discard any pending optimization state.
		this.optimizationController?.cancel();

		// Clean up navigator outside-click listener if view is closed while open (#26).
		this.navigatorController?.close();
		this.headerController?.close();
		this.historyController?.close();

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
		this.headerController?.exitRename(false);     // discard any in-progress rename
		this.optimizationController?.cancel();
		this.activeConversation = conversation;
		// autoScroll is NOT reset here — renderMessages sets it based on scrollTo.
		// Resetting to true here was the root cause of conversations always scrolling
		// to the bottom on open: anything calling scrollToBottom() during rendering
		// would fire because autoScroll was still true.
		this.navigatorController?.close();            // #26 — detach stale outside-click listener
		this.headerController.renderHeader();
		this.headerController.updateModelBadge();
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
		this.headerController?.close();
		this.historyController?.close();
		this.renderedConvId = null;
		this.lastRenderedMsgId = null;
		this.cachedLineHeight = null; // inputEl is about to be recreated below
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("pythia-view");
		this.applyAccentContrast();

		this.headerController = new HeaderController({
			plugin: this.plugin,
			getConversation: () => this.activeConversation,
			getContainer: () => this.containerEl.children[1] as HTMLElement,
			registerDomEvent: (el, type, cb, opts) =>
				this.registerDomEvent(el as HTMLElement, type as keyof HTMLElementEventMap, cb as never, opts),
			openHistoryView: () => this.historyController.openHistoryView(),
			openQuickSwitcher: () => this.historyController.openQuickSwitcher(),
			handleDeleteConversation: () => void this.historyController.handleDeleteConversation(),
			revealContextInspector: () => this.contextInspector.reveal(),
			updateContextBar: () => this.contextInspector.updateContextBar(),
			refreshContextInspector: () => this.contextInspector.refresh(),
			updateSendHint: () => this.updateSendHint(),
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
			goToFavoritesSummary: () => this.summaryController.goToFavoritesSummary(),
		});

		this.historyController = new HistoryController({
			plugin: this.plugin,
			getContainer: () => this.containerEl.children[1] as HTMLElement,
			getConvNameEl: () => this.headerController.getConvNameEl(),
			getConversation: () => this.activeConversation,
			isStreaming: () => this.isStreaming,
			setActiveConversation: (conv) => this.setActiveConversation(conv),
			renderHeader: () => this.headerController.renderHeader(),
		});

		this.summaryController = new SummaryController({
			plugin: this.plugin,
			getConversation: () => this.activeConversation,
			getCardsEl: () => this.summaryCardsEl,
			getMessagesEl: () => this.messagesEl,
			renderMarkdown: (md, el) => {
				void MarkdownRenderer.render(this.app, md, el, "", this)
					.catch((e) => console.error("[Pythia] summary card render:", e));
			},
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
			getLastTokenUsageMsg: () => this.lastTokenUsageMsg(),
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
			renderMarkdown: (md, el) => {
				void MarkdownRenderer.render(this.app, md, el, "", this)
					.catch((e) => console.error("[Pythia] fork summary render:", e));
			},
			runFavoritesSummary: (conv) => this.summaryController.runFavoritesSummary(conv),
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
		this.registerDomEvent(this.sendHintEl, "click", () => this.headerController.onModelBadgeClick());

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
			() => void this.summaryController.generateConversationSummary());
		addItem(t("menuSummarizeFavorites"), "star", (conv.favorites?.length ?? 0) === 0,
			() => void this.summaryController.summarizeFavorites());
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
		this.contextInspector.refresh();
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
				this.contextInspector.refresh();
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
		this.forkController.closeAnchor(); // fork anchor DOM detached by empty(); drop the stale reference + listeners
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

		// Summary "Speisekarte" cards sit below the fork info. Create, then populate —
		// same reason as the inspector above.
		this.summaryCardsEl = this.messagesEl.createDiv({ cls: "p-summary-cards" });
		this.summaryController.renderSummaryCards();

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
	 *  the relative "Heute/Gestern" of `HistoryController.formatConvDate` — the label
	 *  must stay correct when the conversation is reopened later. */
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
			this.selectionController.repaintFavorites(bubble, msg.id);
			this.forkController.repaintForkOrigins(bubble, msg.id);
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
		this.selectionController.repaintFavorites(aiBody, msg.id);
		this.forkController.repaintForkOrigins(aiBody, msg.id);
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
		this.updateResearchButton();
		if (conv.researchMode && !this.plugin.webSearchService.hasApiKey()) {
			new Notice(t("researchNoKeyNotice"));
		} else {
			new Notice(conv.researchMode ? t("researchEnabledNotice") : t("researchDisabledNotice"));
		}
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
			this.headerController.updateModelBadge();
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

		// Auto-arm web search for THIS send when the message reads as time-sensitive
		// and research mode isn't already on (ADR-099). We offer the tool for this
		// turn only — never flipping or persisting conv.researchMode — so search can
		// fire when the user expects it without their having to toggle the globe.
		const autoArmedSearch =
			!conv.researchMode &&
			this.plugin.settings.webSearchAutoArm &&
			this.plugin.webSearchService.hasApiKey() &&
			looksTimeSensitive(text, new Date().getFullYear());
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

				const allowed = ToolHandler.allowedToolNames(conv.writeMode ?? "all", researchActive);
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
			// Pass an armed shallow clone for an auto-armed send so web_search is
			// offered this turn. The clone shares conv.messages (read-only in the
			// provider) and is never persisted — sidebar's own callbacks below save
			// the original `conv`, so the toggle stays off after the turn.
			autoArmedSearch ? { ...conv, researchMode: true } : conv,
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

				if (shouldGenerateTitle(conv)) {
					const convId = conv.id;
					this.plugin.llmRouter
						.generateConversationTitle(userMsg.content, fullText, conv.provider)
						.then(async (title) => {
							const c = this.plugin.conversationStore.getById(convId);
							if (!c) return;
							c.name = title;
							await this.plugin.conversationStore.save(c);
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
		this.contextInspector.updateContextBar();
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
