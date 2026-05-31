import {
	App,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Modal,
	Notice,
	Platform,
	setIcon,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import { todayISO } from "./utils";
import { estimateTokensFromBytes, estimateTokensFromText } from "./services/messageUtils";
import { t } from "./i18n";
import { InlineSuggest } from "./ui/InlineSuggest";
import type { Conversation, Message, ToolCall, TokenUsage } from "./models/types";
import type PythiaPlugin from "./main";
import { ConversationSuggestModal } from "./suggest/ConversationSuggest";
import { NoteSuggestModal } from "./suggest/NoteSuggest";
import { InputModal } from "./suggest/InputModal";
import { ConversationSettingsModal } from "./suggest/ConversationSettingsModal";
import { classifyApiError } from "./services/apiError";
import { executeToolCall } from "./services/ToolHandler";
import { DeleteConversationModal } from "./suggest/DeleteConversationModal";

export const PYTHIA_VIEW_TYPE = "pythia";

function formatSummaryTimestamp(iso: string): string {
	const d = new Date(iso);
	const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
	const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	return `${date} · ${time}`;
}


class DeleteFileModal extends Modal {
	private fileName: string;
	private onConfirm: () => void;

	constructor(app: App, fileName: string, onConfirm: () => void) {
		super(app);
		this.fileName = fileName;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		this.modalEl.addClass("pythia-modal");
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t("deleteFileTitle") });
		contentEl.createEl("p", {
			text: t("deleteFileConfirm", { name: this.fileName }),
			cls: "pythia-modal-desc",
		});
		const buttons = contentEl.createDiv({ cls: "pythia-modal-buttons" });
		const deleteBtn = buttons.createEl("button", { text: t("deleteBtn"), cls: "mod-warning" });
		deleteBtn.addEventListener("click", () => { this.onConfirm(); this.close(); });
		const cancelBtn = buttons.createEl("button", { text: t("cancelBtn") });
		cancelBtn.addEventListener("click", () => this.close());
	}

	onClose(): void { this.contentEl.empty(); }
}

const MODEL_ABBREVIATIONS: Record<string, string> = {
	"claude-opus-4":     "Opus 4",
	"claude-sonnet-4-6": "Sonnet 4.6",
	"claude-haiku-3-5":  "Haiku 3.5",
	"gpt-4o":            "GPT-4o",
	"gpt-4o-mini":       "GPT-4o mini",
	"o3":                "o3",
	"o3-mini":           "o3 mini",
	"o4-mini":           "o4 mini",
};

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
	private longPressCleanup: (() => void) | null = null;
	private activeDeletePreview: {
		userRow: HTMLElement;
		assistantRow: HTMLElement;
		bar: HTMLElement;
		outsideHandler: EventListener;
	} | null = null;
	private isScrolling = false;
	private pendingAttachedNotes: string[] = [];
	private navigatorOutsideCleanup: (() => void) | null = null;
	/** Tracks active MutationObservers per diagram element so stale ones are
	 *  disconnected before a new one is armed on DOM rebuild (#20). */
	private readonly diagObservers = new WeakMap<HTMLElement, MutationObserver>();

	private convNameEl!: HTMLElement;
	private templateLabelEl!: HTMLElement;
	private modelBadgeEl!: HTMLButtonElement;
	private copyLinkBtn!: HTMLButtonElement;
	private referencePillsEl!: HTMLElement;
	private referenceSectionEl!: HTMLElement;
	private favoritesPillsEl!: HTMLElement;
	private favoritesSectionEl!: HTMLElement;
	private attachedPillsEl!: HTMLElement;
	private messagesEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private selectionToolbar!: HTMLElement;
	private onSelectionChange!: () => void;
	private lastMarkdownView: MarkdownView | null = null;

	private summaryPanelEl!: HTMLElement;
	private summaryPanelBodyEl!: HTMLElement;
	private headerSparkleEl!: HTMLButtonElement;
	private toolbarSparkleBtn!: HTMLButtonElement;
	private summaryPanelOpen = false;

	private inlineSuggest!: InlineSuggest;
	private indexTriggerEl!: HTMLButtonElement;
	private navigatorEl!: HTMLElement;
	private onViewportResize: (() => void) | null = null;

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

		// Auto-save summary on close (#23 — the setting was declared but never wired).
		const conv = this.activeConversation;
		if (conv && this.plugin.settings.autoSaveSummary && conv.messages.length > 0) {
			void this.plugin.llmRouter
				.generateSummaryWithTitle(conv)
				.then(async ({ title, summary }) => {
					conv.summaryText      = summary;
					conv.summaryUpdatedAt = new Date().toISOString();
					// Also refresh a date-based name now that we have a real title.
					if (/\d{4}-\d{2}-\d{2}$/.test(conv.name)) conv.name = title;
					await this.plugin.conversationStore.save(conv);
				})
				.catch(() => { /* non-critical — leave existing summary intact */ });
		}

		// Clean up navigator outside-click listener if view is closed while open (#26).
		this.navigatorOutsideCleanup?.();
		this.navigatorOutsideCleanup = null;

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
		focus = true
	): Promise<void> {
		this.activeConversation = conversation;
		this.autoScroll = true;                       // #25 — reset so new conv starts at bottom
		this.pendingAttachedNotes = [];
		this.navigatorOutsideCleanup?.();             // #26 — detach stale outside-click listener
		this.navigatorOutsideCleanup = null;
		this.navigatorEl.removeClass("open");
		this.renderHeader();
		this.updateModelBadge();
		this.renderReferencePills();
		this.renderFavoritesBar();
		this.updateSummaryBar();
		this.updateSendBtnLabel();
		await this.renderMessages();
		if (focus) this.inputEl?.focus();
		this.backfillChapterNames(conversation);
	}

	getActiveConversation(): Conversation | null {
		return this.activeConversation;
	}

	getActiveConversationId(): string | undefined {
		return this.activeConversation?.id;
	}

	attachNoteToInput(path: string): void {
		if (!this.pendingAttachedNotes.includes(path)) {
			this.pendingAttachedNotes.push(path);
			this.renderAttachedPills();
		}
	}

	private backfillChapterNames(conversation: Conversation): void {
		const missing = conversation.messages.filter(
			(m) => m.role === "user" && !m.chapterName
		);
		if (missing.length === 0) return;
		// Serial loop to avoid firing 40+ simultaneous API requests for
		// imported conversations (#2 — was Promise.all fan-out).
		void (async () => {
			for (const msg of missing) {
				try {
					const name = await this.plugin.llmRouter.generateChapterName(
						msg.content,
						conversation.provider
					);
					if (name) msg.chapterName = name;
				} catch {
					// Non-critical — silently skip failed chapter names
				}
			}
			if (missing.some((m) => m.chapterName)) {
				await this.plugin.conversationStore.save(conversation);
			}
		})();
	}

	getLastAssistantMessage(): string | null {
		if (!this.activeConversation) return null;
		const messages = this.activeConversation.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "assistant") return messages[i].content;
		}
		return null;
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
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("pythia-view");

		const header = container.createDiv({ cls: "p-header" });

		this.convNameEl = header.createEl("button", {
			cls: "p-title",
			text: t("noConversation"),
		});
		this.convNameEl.addEventListener("click", () => this.onConvNameClick());

		this.headerSparkleEl = header.createEl("button", {
			cls: "p-hdr-btn p-hdr-sparkle",
			attr: { title: t("summarizeTooltip") },
		});
		setIcon(this.headerSparkleEl, "sparkles");
		this.headerSparkleEl.style.display = "none";
		this.headerSparkleEl.addEventListener("click", () => this.toggleSummaryPanel());

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

		// ── Summary panel (below header, above messages) ────────────
		this.summaryPanelEl = container.createDiv({ cls: "p-summary-panel" });
		this.summaryPanelBodyEl = this.summaryPanelEl.createDiv({ cls: "p-summary-panel-body" });
		this.summaryPanelEl.style.display = "none";

		this.referenceSectionEl = container.createDiv({ cls: "p-ref-row" });
		this.referenceSectionEl.createEl("span", {
			cls: "p-row-label",
			text: t("referenceSection"),
		});
		this.referencePillsEl = this.referenceSectionEl.createDiv({ cls: "p-pills" });
		this.referenceSectionEl.style.display = "none";

		this.favoritesSectionEl = container.createDiv({
			cls: "pythia-favorites-section",
		});
		this.favoritesSectionEl.createEl("span", {
			cls: "pythia-section-label",
			text: t("favoritesSection"),
		});
		this.favoritesPillsEl = this.favoritesSectionEl.createDiv({
			cls: "pythia-pills",
		});
		this.favoritesSectionEl.style.display = "none";

		const messagesWrapper = container.createDiv({ cls: "pythia-messages-wrapper" });

		this.messagesEl = messagesWrapper.createDiv({ cls: "p-chat" });
		this.messagesEl.addEventListener("scroll", () => {
			if (this.isScrolling) return; // programmatic scroll — ignore
			const el = this.messagesEl;
			const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
			if (distFromBottom > 50) this.autoScroll = false;
		});
		this.selectionToolbar = container.createDiv({ cls: "pythia-sel-toolbar" });
		this.selectionToolbar.style.display = "none";

		// Passive touchstart on the container: save the selection and swipe origin
		// before iOS dismisses the selection. Passive = does NOT block scroll gestures.
		let savedSelRange: Range | null = null;
		let selTouchStartX = 0;
		this.selectionToolbar.addEventListener("touchstart", (e: TouchEvent) => {
			const sel = window.getSelection();
			savedSelRange = (sel && sel.rangeCount > 0)
				? sel.getRangeAt(0).cloneRange()
				: null;
			selTouchStartX = e.touches[0].clientX;
		}, { passive: true });

		// Helper: returns a touchend handler that fires the action only on taps
		// (not swipes), restoring the saved selection first.
		const makeSelTouch = (action: () => void) => (e: TouchEvent) => {
			if (Math.abs(e.changedTouches[0].clientX - selTouchStartX) > 12) return;
			e.preventDefault(); // suppress the synthetic click that follows touchend
			if (savedSelRange) {
				const sel = window.getSelection();
				if (sel) { sel.removeAllRanges(); sel.addRange(savedSelRange); }
				savedSelRange = null;
			}
			action();
		};

		const copyBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: t("copyBtn"),
			attr: { title: t("copyBtn") },
		});
		copyBtn.addEventListener("mousedown", (e) => { e.preventDefault(); this.onCopySelection(); });
		copyBtn.addEventListener("touchend", makeSelTouch(() => this.onCopySelection()));

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
		inboxBtn.addEventListener("mousedown", (e) => { e.preventDefault(); this.onSaveToInbox(); });
		inboxBtn.addEventListener("touchend", makeSelTouch(() => this.onSaveToInbox()));

		const forkBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: t("forkBtn"),
			attr: { title: t("forkBtn") },
		});
		forkBtn.addEventListener("mousedown", (e) => { e.preventDefault(); this.onForkConversation(); });
		forkBtn.addEventListener("touchend", makeSelTouch(() => this.onForkConversation()));

		this.onSelectionChange = () => this.handleSelectionChange();
		document.addEventListener("selectionchange", this.onSelectionChange);
		this.messagesEl.addEventListener("mouseup", () =>
			setTimeout(() => this.handleSelectionChange(), 10)
		);
		this.messagesEl.addEventListener("touchend", () =>
			setTimeout(() => this.handleSelectionChange(), 300)
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
			this.toggleNavigator();
		});

		const inputArea = container.createDiv({ cls: "p-input-area" });

		const attachRow = inputArea.createDiv({ cls: "pythia-attach-row" });
		attachRow.style.display = "none";
		this.attachedPillsEl = attachRow.createDiv({
			cls: "pythia-pills pythia-attached-pills",
		});

		this.inputEl = inputArea.createEl("textarea", {
			cls: "p-textarea",
			attr: { placeholder: t("inputPlaceholder"), rows: "1" },
		});
		this.inlineSuggest = new InlineSuggest(
			this.app,
			this.inputEl,
			inputArea,
			(paths) => {
				for (const p of paths) {
					if (!this.pendingAttachedNotes.includes(p)) this.pendingAttachedNotes.push(p);
				}
				this.renderAttachedPills();
			}
		);
		this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (this.inlineSuggest.handleKeydown(e)) return;
			// e.isComposing is true while an IME (CJK) composition is in progress.
			// Without this guard, pressing Enter to confirm a candidate sends the message. (#24)
			if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				this.sendMessage();
			}
		});
		this.inputEl.addEventListener("input", () => {
			this.autoResizeTextarea();
			this.inlineSuggest.handleInput();
			this.updateSendBtnLabel(); // live-update estimate as user types
		});

		// visualViewport resize is unreliable in some WKWebView versions;
		// focus/blur fire unconditionally. 300 ms lets the keyboard slide in.
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
		attachBtn.addEventListener("click", () => this.onAttachNote());

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
		saveBtn.addEventListener("click", () => this.onSaveResponse());

		this.toolbarSparkleBtn = toolbarLeft.createEl("button", {
			cls: "p-tool-btn",
			attr: { title: t("summarizeTooltip") },
		});
		setIcon(this.toolbarSparkleBtn, "sparkles");
		this.toolbarSparkleBtn.addEventListener("click", () => void this.onGenerateSummary());

		this.sendBtn = toolbar.createEl("button", {
			cls: "p-send",
			text: t("sendBtn"),
		});
		this.sendBtn.addEventListener("click", () => {
			if (this.isStreaming) {
				this.plugin.llmRouter.abort();
			} else {
				this.sendMessage();
			}
		});
	}

	private renderEmptyState(): void {
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
			return;
		}
		this.copyLinkBtn.style.display = "";
		this.convNameEl.setText(this.activeConversation.name + " ▾");
		if (this.activeConversation.templateId) {
			const tplName =
				this.activeConversation.templateId
					.split("/")
					.pop()
					?.replace(/\.md$/, "") ?? "";
			this.templateLabelEl.setText(t("templateLabel", { name: tplName }));
		} else {
			this.templateLabelEl.setText("");
		}
	}

	/** Called from main.ts after an async summary injection so the bar can
	 *  update without triggering a full conversation switch (which would wipe
	 *  pendingAttachedNotes and re-render messages unnecessarily). */
	refreshSummaryBar(): void {
		this.updateSummaryBar();
		if (!this.summaryPanelOpen) this.toggleSummaryPanel();
	}

	private updateSummaryBar(): void {
		const summary = this.activeConversation?.summaryText?.trim();
		if (!summary) {
			this.summaryPanelEl.style.display = "none";
			this.headerSparkleEl.style.display = "none";
			return;
		}
		this.summaryPanelEl.style.display = "";
		this.headerSparkleEl.style.display = "";
		this.summaryPanelBodyEl.empty();
		void MarkdownRenderer.render(this.app, summary, this.summaryPanelBodyEl, "", this)
			.catch((e) => console.error("[Pythia] summary render:", e));
		const ts = this.activeConversation?.summaryUpdatedAt;
		if (ts) {
			this.summaryPanelBodyEl.createEl("span", {
				cls: "p-summary-ts",
				text: formatSummaryTimestamp(ts),
			});
		}
		// Collapse when switching conversations or after a refresh
		this.summaryPanelOpen = false;
		this.summaryPanelBodyEl.removeClass("open");
	}

	private toggleSummaryPanel(): void {
		if (this.summaryPanelEl.style.display === "none") return;
		this.summaryPanelOpen = !this.summaryPanelOpen;
		this.summaryPanelBodyEl.toggleClass("open", this.summaryPanelOpen);
	}

	private renderForkBannerEl(): void {
		const conv = this.activeConversation;
		if (!conv?.forkedFromId) return;
		const source = this.plugin.conversationStore.getById(conv.forkedFromId);

		const banner = this.messagesEl.createDiv({ cls: "pythia-fork-banner" });
		const header = banner.createDiv({ cls: "pythia-fork-header" });
		setIcon(header.createSpan({ cls: "pythia-fork-icon" }), "git-branch");
		const label = header.createEl("span", { cls: "pythia-fork-label", text: `${t("forkedFromLabel")}: ` });
		const link = label.createEl("a", {
			cls: "pythia-fork-source-link",
			text: source?.name ?? conv.forkedFromId,
		});
		link.addEventListener("click", async () => {
			if (!source) return;
			await this.setActiveConversation(source);
			// Deep-link: silently scroll to the exact message that was forked from.
			// Falls back to top-of-conversation if the message ID was not recorded
			// or the element is no longer present.
			if (conv.forkedFromMessageId) {
				this.scrollToMessage(conv.forkedFromMessageId);
			}
		});

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

	async renderForkBanner(): Promise<void> {
		const existing = this.messagesEl.querySelector(".pythia-fork-banner");
		if (existing) existing.remove();
		this.renderForkBannerEl();
		const firstChild = this.messagesEl.firstChild;
		const fork = this.messagesEl.querySelector(".pythia-fork-banner");
		if (fork && firstChild && fork !== firstChild) {
			this.messagesEl.insertBefore(fork, firstChild);
		}
	}

	private renderReferencePills(): void {
		this.referencePillsEl.empty();
		const conv = this.activeConversation;

		if (!conv) {
			this.referenceSectionEl.style.display = "none";
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

		this.referenceSectionEl.style.display = entries.length > 0 ? "" : "none";
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

	private renderAttachedPills(): void {
		this.attachedPillsEl.empty();
		const attachRow = this.attachedPillsEl.parentElement as HTMLElement | null;
		if (attachRow) {
			attachRow.style.display = this.pendingAttachedNotes.length > 0 ? "" : "none";
		}
		for (const notePath of this.pendingAttachedNotes) {
			const file = this.app.vault.getAbstractFileByPath(notePath);
			const tokEst = file instanceof TFile ? estimateTokensFromBytes(file.stat.size) : undefined;
			this.addPill(
				this.attachedPillsEl,
				notePath.split("/").pop() ?? notePath,
				() => {
					this.pendingAttachedNotes =
						this.pendingAttachedNotes.filter((n) => n !== notePath);
					this.renderAttachedPills();
				},
				"pythia-pill-attached",
				tokEst
			);
		}
	}

	private addPill(
		container: HTMLElement,
		label: string,
		onRemove: () => void,
		extraClass = "",
		tokenEst?: string
	): void {
		const pill = container.createEl("span", {
			cls: `pythia-pill ${extraClass}`.trim(),
		});
		pill.createEl("span", { text: label, cls: "pythia-pill-label" });
		if (tokenEst) pill.createEl("span", { text: tokenEst, cls: "p-pill-tokens" });
		const x = pill.createEl("button", {
			cls: "pythia-pill-remove",
			text: "×",
		});
		x.addEventListener("click", onRemove);
	}

	private async renderMessages(): Promise<void> {
		this.hideDeletePreview();
		this.messagesEl.empty();
		if (!this.activeConversation) {
			this.renderEmptyState();
			return;
		}
		if (this.activeConversation.forkedFromId) this.renderForkBannerEl();
		if (this.activeConversation.messages.length === 0) {
			const hint = this.messagesEl.createDiv({ cls: "pythia-empty" });
			hint.createEl("p", { text: t("startConversationBelow") });
			return;
		}
		for (const msg of this.activeConversation.messages) {
			await this.appendMessageBubble(msg);
		}
		this.scrollToBottom();
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
			try {
				await MarkdownRenderer.render(this.app, msg.content, bubble, "", this);
			} catch (e) {
				console.error("[Pythia] render error:", e);
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
			await MarkdownRenderer.render(this.app, msg.content, aiBody, "", this);
		} catch (e) {
			console.error("[Pythia] render error:", e);
		}
		this.decorateCodeBlocks(aiBody);

		const isFav = this.activeConversation?.favorites?.some(
			(f) => f.messageId === msg.id
		) ?? false;
		const footer = row.createDiv({ cls: "p-tokens" });
		const star = footer.createEl("button", {
			cls: `p-star${isFav ? " on" : ""}`,
			text: isFav ? "★" : "☆",
			attr: { title: isFav ? t("removeFromFavorites") : t("addToFavorites") },
		});
		star.addEventListener("click", () => this.onStarClick(msg, star));
		if (msg.tokenUsage) {
			footer.createSpan({ cls: "p-tok-sep", text: "|" });
			this.renderTokenCount(footer, msg.tokenUsage);
		}

		return aiBody;
	}

	private createStreamingBubble(): {
		appendToken: (text: string) => void;
		finalize: (fullText: string) => Promise<void>;
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
			finalize: async (fullText: string) => {
				aiBody.removeClass("pythia-streaming");
				aiBody.empty();
				try {
					await MarkdownRenderer.render(this.app, fullText, aiBody, "", this);
				} catch (e) {
					console.error("[Pythia] render error:", e);
				}
				this.decorateCodeBlocks(aiBody);
				// rAF ensures scrollToBottom runs after the markdown DOM is laid out.
				this.autoScroll = true;
				requestAnimationFrame(() => this.scrollToBottom(true));
			},
		};
	}

	// ── Code block decoration: drag-to-pan + copy button ────────────────────
	private decorateCodeBlocks(container: HTMLElement): void {
		// Fenced code blocks — skip the source-listing pre inside diagram blocks;
		// those are handled (and eventually replaced) by Mermaid/PlantUML renderers.
		container.querySelectorAll<HTMLElement>("pre:not([data-decorated])").forEach((pre) => {
			if (pre.closest(".block-language-mermaid, .block-language-plantuml")) return;
			pre.dataset.decorated = "1";
			const frame = this.wrapInScrollFrame(pre);

			// Extract language identifier for the fenced-block wrapper.
			const codeEl = pre.querySelector("code");
			const lang = codeEl?.className.match(/(?:^|\s)language-(\S+)/)?.[1] ?? "";
			const makeFenced = (): string => {
				const raw = (codeEl ?? pre).innerText.replace(/\n$/, "");
				return `\`\`\`${lang}\n${raw}\n\`\`\``;
			};

			// Copy button lives on the frame so it stays fixed while the pre scrolls.
			const actions = frame.createEl("div", { cls: "p-code-actions" });
			const copyBtn = actions.createEl("button", { cls: "p-code-btn p-code-copy", attr: { title: "Copy" } });
			setIcon(copyBtn, "copy");
			copyBtn.addEventListener("click", async (e) => {
				e.stopPropagation();
				await navigator.clipboard.writeText(makeFenced());
				setIcon(copyBtn, "check");
				copyBtn.addClass("copied");
				setTimeout(() => { setIcon(copyBtn, "copy"); copyBtn.removeClass("copied"); }, 1500);
			});

			this.attachDragToPan(pre);
		});

		// Diagram blocks (Mermaid, PlantUML …) — do NOT move the element in the
		// DOM; Mermaid's async renderer expects to find and replace the element's
		// content in its original position.  Scroll behaviour comes from CSS;
		// JS only stamps the explicit SVG pixel size and enables drag-to-pan.
		// A sibling toolbar sits ABOVE the scrolling container so its buttons
		// are never hidden by horizontal overflow on wide diagrams (e.g. Gantt).
		const DIAG = [
			".block-language-mermaid:not([data-decorated])",
			".block-language-plantuml:not([data-decorated])",
		].join(",");
		container.querySelectorAll<HTMLElement>(DIAG).forEach((el) => {
			el.dataset.decorated = "1";

			// Capture the source before Mermaid's async renderer replaces the
			// code element with the SVG.
			const codeEl = el.querySelector("code");
			const lang = el.className.match(/\bblock-language-(\S+)\b/)?.[1] ?? "mermaid";
			const source = codeEl?.innerText.replace(/\n$/, "") ?? "";

			// Toolbar sits as a sibling ABOVE the diagram so the copy button is
			// never clipped by the horizontal-scroll overflow context.
			// Always visible — hover-to-reveal proved unreliable in practice.
			if (source) {
				const makeFenced = (): string => `\`\`\`${lang}\n${source}\n\`\`\``;

				const toolbar = createEl("div", { cls: "p-diag-toolbar" });
				el.parentNode!.insertBefore(toolbar, el);

				const copyBtn = toolbar.createEl("button", { cls: "p-code-btn p-code-copy", attr: { title: "Copy" } });
				setIcon(copyBtn, "copy");
				copyBtn.addEventListener("click", async (e) => {
					e.stopPropagation();
					await navigator.clipboard.writeText(makeFenced());
					setIcon(copyBtn, "check");
					copyBtn.addClass("copied");
					setTimeout(() => { setIcon(copyBtn, "copy"); copyBtn.removeClass("copied"); }, 1500);
				});
			}

			this.fixDiagramSvgSize(el);
			this.attachDragToPan(el);
		});

		// Wide tables — wrap in a scroll frame (overflow scroll pattern).
		container.querySelectorAll<HTMLElement>("table:not([data-decorated])").forEach((table) => {
			table.dataset.decorated = "1";
			const frame = createEl("div", { cls: "p-scroll-frame" });
			table.parentNode!.insertBefore(frame, table);
			frame.appendChild(table);
			this.attachDragToPan(frame);
		});
	}

	/**
	 * Mermaid and PlantUML renderers set `width="100%"` on the SVG, which
	 * causes the browser to scale it down to fit its container.  Read the
	 * `viewBox` intrinsic size and stamp explicit pixel dimensions instead so
	 * the diagram keeps its natural size and the container scrolls.
	 *
	 * Uses a MutationObserver so the stamp fires exactly when the SVG element
	 * is inserted by Mermaid's async renderer — more reliable than ResizeObserver.
	 */
	private fixDiagramSvgSize(el: HTMLElement): void {
		/**
		 * Attempt to stamp explicit pixel dimensions on the SVG.
		 * Returns true when dimensions were applied so the observer knows to stop.
		 *
		 * Priority:
		 *   1. viewBox  — most reliable; set by Mermaid for flowcharts, sequence, class …
		 *   2. explicit numeric width/height attributes — Gantt and some other types use these
		 *   3. Neither available yet → return false (keep observing)
		 */
		const stamp = (svg: SVGElement): boolean => {
			// 1. viewBox
			const vb = svg.getAttribute("viewBox");
			if (vb) {
				const parts = vb.trim().split(/[\s,]+/).map(Number);
				if (parts.length >= 4 && parts[2] > 0) {
					const [, , w, h] = parts;
					svg.style.setProperty("width",     `${w}px`, "important");
					svg.style.setProperty("height",    `${h}px`, "important");
					svg.style.setProperty("max-width", "none",   "important");
					svg.style.display = "block";
					return true;
				}
			}
			// 2. Explicit numeric width/height attributes (not percentages)
			const rawW = svg.getAttribute("width") ?? "";
			const rawH = svg.getAttribute("height") ?? "";
			const attrW = rawW.includes("%") ? NaN : parseFloat(rawW);
			const attrH = rawH.includes("%") ? NaN : parseFloat(rawH);
			if (attrW > 0) {
				svg.style.setProperty("width",     `${attrW}px`, "important");
				svg.style.setProperty("max-width", "none",       "important");
				svg.style.display = "block";
				if (attrH > 0) svg.style.setProperty("height", `${attrH}px`, "important");
				return true;
			}
			return false; // not ready yet — keep observing
		};

		// Disconnect any observer that was armed during a previous DOM rebuild for
		// this same element — prevents observer accumulation across re-renders (#20).
		this.diagObservers.get(el)?.disconnect();

		// If already rendered (conversation reload), stamp immediately and return.
		const existing = el.querySelector<SVGElement>("svg");
		if (existing) { stamp(existing); return; }

		// Watch for SVG insertion AND subsequent attribute mutations.
		// Mermaid often inserts a bare <svg> first and sets viewBox/width in a
		// follow-up attribute update — we must NOT disconnect on the first fire.
		const mo = new MutationObserver(() => {
			const svg = el.querySelector<SVGElement>("svg");
			if (!svg) return;        // content appeared but no SVG yet
			if (stamp(svg)) {
				mo.disconnect();
				this.diagObservers.delete(el);
			}
			// else: SVG present but dimensions not set yet — keep watching
		});
		mo.observe(el, {
			childList:       true,
			subtree:         true,
			attributes:      true,
			attributeFilter: ["viewBox", "width", "height"],
		});
		this.diagObservers.set(el, mo);

		// Safety: disconnect after 10 s.  Covers the case where Mermaid renders
		// a parse-error div instead of an SVG (observer would otherwise leak).
		setTimeout(() => {
			mo.disconnect();
			this.diagObservers.delete(el);
		}, 10_000);
	}

	/** Wraps `scrollEl` in a `.p-code-frame` positioning shell and returns the frame. */
	private wrapInScrollFrame(scrollEl: HTMLElement): HTMLElement {
		const frame = createEl("div", { cls: "p-code-frame" });
		scrollEl.parentNode!.insertBefore(frame, scrollEl);
		frame.appendChild(scrollEl);
		return frame;
	}

	/**
	 * Attach mouse-drag-to-pan to `el` (must be overflow-x: auto).
	 * A 5 px threshold keeps small clicks from fighting text selection.
	 * Touch devices (iOS) rely on native overflow scroll — not intercepted here.
	 */
	private attachDragToPan(el: HTMLElement): void {
		const THRESHOLD = 5;
		let startX         = 0;
		let startScrollLeft = 0;
		let panning        = false;

		const onMove = (e: PointerEvent) => {
			const dx = e.clientX - startX;
			if (!panning) {
				if (Math.abs(dx) < THRESHOLD) return;
				panning = true;
				el.classList.add("p-panning");
			}
			el.scrollLeft = startScrollLeft - dx;
		};

		const cleanup = () => {
			if (panning) el.classList.remove("p-panning");
			panning = false;
			document.removeEventListener("pointermove",  onMove);
			document.removeEventListener("pointerup",    cleanup);
			document.removeEventListener("pointercancel", cleanup);
		};

		el.addEventListener("pointerdown", (e) => {
			// Only mouse left-button; let native touch scroll handle other pointer types.
			if (e.pointerType !== "mouse" || e.button !== 0) return;
			if (el.scrollWidth <= el.clientWidth) return; // nothing to pan
			startX          = e.clientX;
			startScrollLeft = el.scrollLeft;
			panning         = false;
			document.addEventListener("pointermove",  onMove);
			document.addEventListener("pointerup",    cleanup);
			document.addEventListener("pointercancel", cleanup);
		});
	}

	private autoResizeTextarea(): void {
		const maxH = Platform.isDesktop ? 150 : 72;
		this.inputEl.style.height = "auto";
		this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, maxH)}px`;
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

	private renderFavoritesBar(): void {
		this.favoritesPillsEl.empty();
		const favs = this.activeConversation?.favorites;
		if (!favs || favs.length === 0) {
			this.favoritesSectionEl.style.display = "none";
			return;
		}
		this.favoritesSectionEl.style.display = "none";
		for (const fav of favs) {
			const pill = this.favoritesPillsEl.createEl("span", {
				cls: "pythia-pill pythia-favorite-pill",
			});
			const label = pill.createEl("span", {
				cls: "pythia-pill-label",
				text: `★ ${fav.name}`,
				attr: { title: fav.name },
			});
			label.addEventListener("click", () =>
				this.scrollToMessage(fav.messageId)
			);
			const x = pill.createEl("button", {
				cls: "pythia-pill-remove",
				text: "×",
				attr: { title: t("removeFromFavorites") },
			});
			x.addEventListener("click", () =>
				this.removeFavorite(fav.messageId)
			);
		}
	}

	private async onStarClick(msg: Message, starEl: HTMLButtonElement): Promise<void> {
		if (!this.activeConversation) return;
		const conv = this.activeConversation;
		const existing = conv.favorites?.findIndex((f) => f.messageId === msg.id) ?? -1;

		if (existing >= 0) {
			// Already favorited — remove
			await this.removeFavorite(msg.id);
			starEl.setText("☆");
			starEl.removeClass("on");
			starEl.title = t("addToFavorites");
			return;
		}

		if (!conv.favorites) conv.favorites = [];

		// Reuse the chapter name of the preceding user turn — it was already
		// generated when the conversation was loaded, so no extra API call needed.
		// Fall back to the first 40 chars of the answer only if there is no
		// chapter name available (e.g. very first message or backfill still pending).
		const msgIndex = conv.messages.findIndex((m) => m.id === msg.id);
		const precedingUser = conv.messages
			.slice(0, msgIndex)
			.reverse()
			.find((m) => m.role === "user");
		const name =
			precedingUser?.chapterName ??
			msg.content.slice(0, 40).replace(/\s+/g, " ").trim();

		conv.favorites.push({ messageId: msg.id, name });
		await this.plugin.conversationStore.save(conv);
		starEl.setText("★");
		starEl.addClass("on");
		starEl.title = t("removeFromFavorites");
		this.renderFavoritesBar();
	}

	private async removeFavorite(messageId: string): Promise<void> {
		if (!this.activeConversation) return;
		const conv = this.activeConversation;
		conv.favorites = (conv.favorites ?? []).filter(
			(f) => f.messageId !== messageId
		);
		await this.plugin.conversationStore.save(conv);
		this.renderFavoritesBar();
		// Update the star button in the DOM
		const row = this.messagesEl.querySelector(
			`[data-msg-id="${messageId}"]`
		) as HTMLElement | null;
		const star = row?.querySelector(".p-star") as HTMLButtonElement | null;
		if (star) {
			star.setText("☆");
			star.removeClass("on");
			star.title = t("addToFavorites");
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

	private toggleNavigator(): void {
		if (this.navigatorEl.hasClass("open")) {
			this.navigatorEl.removeClass("open");
			return;
		}

		// Populate fresh content on each open
		this.navigatorEl.empty();
		const conv = this.activeConversation;

		// ── Forks ────────────────────────────────────────────────────
		const forks = conv
			? this.plugin.conversationStore.getAll().filter(c => c.forkedFromId === conv.id)
			: [];
		if (forks.length > 0) {
			this.navigatorEl.createDiv({ cls: "p-nav-group-label", text: t("forksSection") });
			for (const fork of forks) {
				const item = this.navigatorEl.createDiv({ cls: "p-nav-item" });
				item.createEl("span", { cls: "p-nav-fork-icon", text: "⎇" });
				item.createEl("span", { text: fork.name });
				item.addEventListener("mousedown", (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.navigatorEl.removeClass("open");
					document.removeEventListener("mousedown", onOutside, true);
					void this.setActiveConversation(fork);
				});
			}
			this.navigatorEl.createDiv({ cls: "p-nav-divider" });
		}

		// ── Starred ─────────────────────────────────────────────────
		this.navigatorEl.createDiv({ cls: "p-nav-group-label", text: "Starred" });
		const favs = conv?.favorites ?? [];
		if (favs.length === 0) {
			const placeholder = this.navigatorEl.createDiv({ cls: "p-nav-item" });
			placeholder.createEl("span", { text: "—" });
			placeholder.style.color = "var(--text-faint)";
			placeholder.style.cursor = "default";
			placeholder.style.pointerEvents = "none";
		} else {
			for (const fav of favs) {
				const item = this.navigatorEl.createDiv({ cls: "p-nav-item" });
				item.createEl("span", { cls: "p-nav-star", text: "★" });
				item.createEl("span", { text: fav.name });
				item.addEventListener("mousedown", (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.scrollToMessage(fav.messageId);
					this.navigatorEl.removeClass("open");
					document.removeEventListener("mousedown", onOutside, true);
				});
			}
		}

		// ── Divider ─────────────────────────────────────────────────
		this.navigatorEl.createDiv({ cls: "p-nav-divider" });

		// ── Chapters ─────────────────────────────────────────────────
		this.navigatorEl.createDiv({ cls: "p-nav-group-label", text: "Chapters" });
		const userMsgs = conv?.messages.filter((m) => m.role === "user") ?? [];
		if (userMsgs.length === 0) {
			const placeholder = this.navigatorEl.createDiv({ cls: "p-nav-item" });
			placeholder.createEl("span", { text: "—" });
			placeholder.style.color = "var(--text-faint)";
			placeholder.style.cursor = "default";
			placeholder.style.pointerEvents = "none";
		} else {
			for (const msg of userMsgs) {
				const label = msg.chapterName ?? msg.content.slice(0, 60).replace(/\s+/g, " ").trim();
				const item = this.navigatorEl.createDiv({ cls: "p-nav-item" });
				item.createEl("span", { text: label });
				item.addEventListener("mousedown", (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.scrollToMessage(msg.id);
					this.navigatorEl.removeClass("open");
					document.removeEventListener("mousedown", onOutside, true);
				});
			}
		}

		this.navigatorEl.addClass("open");

		// Close on mousedown outside (capture phase so it fires before any Obsidian handlers).
		// Track as an instance field so the listener can be removed if the view closes or the
		// conversation switches before the user clicks outside (#26).
		this.navigatorOutsideCleanup?.();
		const onOutside = (e: MouseEvent) => {
			if (!this.navigatorEl.contains(e.target as Node) && e.target !== this.indexTriggerEl) {
				this.navigatorEl.removeClass("open");
				this.navigatorOutsideCleanup?.();
				this.navigatorOutsideCleanup = null;
			}
		};
		// Defer so the trigger's own mousedown doesn't immediately close it.
		setTimeout(() => {
			document.addEventListener("mousedown", onOutside, true);
			this.navigatorOutsideCleanup = () =>
				document.removeEventListener("mousedown", onOutside, true);
		}, 0);
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

	private onModelBadgeClick(): void {
		if (!this.activeConversation) return;
		new ConversationSettingsModal(
			this.app,
			this.activeConversation,
			async (conv) => {
				await this.plugin.conversationStore.save(conv);
				this.updateModelBadge();
			}
		).open();
	}

	private onConvNameClick(): void {
		const convs = this.plugin.conversations;
		if (convs.length === 0) return;

		new ConversationSuggestModal(this.app, convs, async (conv) => {
			await this.setActiveConversation(conv);
		}).open();
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
		new NoteSuggestModal(this.app, (file) => {
			if (!this.pendingAttachedNotes.includes(file.path)) {
				this.pendingAttachedNotes.push(file.path);
				this.renderAttachedPills();
			}
		}).open();
	}

	private async onGenerateSummary(): Promise<void> {
		const conv = this.activeConversation;
		if (!conv || conv.messages.length === 0) {
			new Notice(t("noMessagesToSummarize"));
			return;
		}
		const notice = new Notice(t("generatingSummary"), 0);
		this.toolbarSparkleBtn.addClass("p-sparkle-loading");
		this.toolbarSparkleBtn.disabled = true;
		try {
			const { title, summary } = await this.plugin.llmRouter.generateSummaryWithTitle(conv);
			if (summary) {
				conv.summaryText = summary;
				conv.summaryUpdatedAt = new Date().toISOString();
				if (title) {
					conv.name = title;
					void this.plugin.renameConversationFile(conv);
					this.renderHeader();
				}
				await this.plugin.conversationStore.save(conv);
				this.updateSummaryBar();
				// Auto-open the panel to reveal the freshly generated summary
				if (!this.summaryPanelOpen) this.toggleSummaryPanel();
			}
		} catch (e) {
			new Notice(t("summaryFailed", { error: e instanceof Error ? e.message : String(e) }));
		} finally {
			notice.hide();
			this.toolbarSparkleBtn.removeClass("p-sparkle-loading");
			this.toolbarSparkleBtn.disabled = false;
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

	async sendMessage(): Promise<void> {
		if (this.isStreaming) return;
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
			attachedNotes:
				this.pendingAttachedNotes.length > 0
					? [...this.pendingAttachedNotes]
					: undefined,
		};
		conv.messages.push(userMsg);
		this.messagesEl.querySelector(".pythia-empty")?.remove();
		await this.appendMessageBubble(userMsg);

		const attachedNotes = [...this.pendingAttachedNotes];
		this.pendingAttachedNotes = [];
		this.renderAttachedPills();

		const { appendToken, finalize, row: streamingRow } = this.createStreamingBubble();

		const onToolCall = this.plugin.settings.enableNoteCreation
			? async (call: ToolCall): Promise<string> => {
					const pathText =
						typeof call.input["path"] === "string"
							? call.input["path"]
							: call.name;
					const chipEl = this.messagesEl.createDiv({
						cls: "pythia-tool-call pythia-tool-call--pending",
					});
					chipEl.createSpan({ cls: "pythia-tool-call-spinner" });
					chipEl.createSpan({
						cls: "pythia-tool-call-label",
						text: t("creatingNote", { path: pathText }),
					});
					this.messagesEl.scrollTop = this.messagesEl.scrollHeight;

					const result = await executeToolCall(
						this.plugin.app,
						this.plugin.settings,
						call
					);

					chipEl.empty();
					chipEl.removeClass("pythia-tool-call--pending");
					if (result.startsWith("Error")) {
						chipEl.addClass("pythia-tool-call--error");
						chipEl.createSpan({ text: result });
					} else {
						chipEl.addClass("pythia-tool-call--done");
						const notePath =
							typeof call.input["path"] === "string"
								? call.input["path"]
								: "";
						const noteName =
							notePath.split("/").pop()?.replace(/\.md$/, "") ??
							notePath;
						const link = chipEl.createEl("a", {
							cls: "pythia-tool-call-link",
							text: t("createdNote", { name: noteName }),
						});
						link.addEventListener("click", (e) => {
							e.preventDefault();
							this.app.workspace.openLinkText(noteName, "");
						});
					}

					return result;
			  }
			: undefined;

		await this.plugin.llmRouter.streamMessage(
			conv,
			text,
			attachedNotes,
			appendToken,
			async (fullText, tokenUsage) => {
				// Reset immediately so the user can type while render/persist run.
				this.setStreamingState(false);
				await finalize(fullText);

				if (fullText) {
					const assistantMsg: Message = {
						id: crypto.randomUUID(),
						role: "assistant",
						content: fullText,
						timestamp: new Date().toISOString(),
						tokenUsage,
					};
					conv.messages.push(assistantMsg);
					// Only wire the star when conv is still the displayed conversation.
					const rows = this.messagesEl.querySelectorAll(".p-msg-ai");
					const lastRow = rows[rows.length - 1] as HTMLElement | null;
					if (lastRow && !lastRow.getAttribute("data-msg-id")) {
						lastRow.setAttribute("data-msg-id", assistantMsg.id);
						if (this.activeConversation?.id === conv.id) {
							const footer = streamingRow.createDiv({ cls: "p-tokens" });
							const star = footer.createEl("button", {
								cls: "p-star",
								text: "☆",
								attr: { title: t("addToFavorites") },
							});
							star.addEventListener("click", () =>
								this.onStarClick(assistantMsg, star)
							);
							if (tokenUsage) {
								footer.createSpan({ cls: "p-tok-sep", text: "|" });
								this.renderTokenCount(footer, tokenUsage);
							}
						}
					}
					await this.plugin.conversationStore.save(conv);
					if (this.activeConversation?.id === conv.id) {
						this.attachLastBubbleLongPress();
					}

					if (conv.messages.length === 2 && /\d{4}-\d{2}-\d{2}$/.test(conv.name)) {
						// Capture IDs so the callback doesn't write to a deleted conversation (#27).
						const convId = conv.id;
						this.plugin.llmRouter
							.generateConversationTitle(userMsg.content, fullText, conv.provider)
							.then(async (title) => {
								const c = this.plugin.conversationStore.getById(convId);
								if (!c) return; // conversation deleted in the interim
								c.name = title;
								await this.plugin.conversationStore.save(c);
								if (this.activeConversation?.id === convId) {
									this.convNameEl.setText(c.name + " ▾");
								}
							})
							.catch(() => { /* keep date name on failure */ });
					}

					if (!userMsg.chapterName) {
						const convId = conv.id;
						const msgId  = userMsg.id;
						this.plugin.llmRouter
							.generateChapterName(userMsg.content, conv.provider)
							.then(async (name) => {
								if (!name) return;
								const c = this.plugin.conversationStore.getById(convId);
								if (!c) return; // conversation deleted in the interim
								const m = c.messages.find(msg => msg.id === msgId);
								if (!m) return; // message deleted in the interim
								m.chapterName = name;
								await this.plugin.conversationStore.save(c);
							})
							.catch(() => { /* chapter name is non-critical */ });
					}
				}
			},
			(error) => {
				const errClass = classifyApiError(error);
				const model = conv.model ?? "";
				let msg: string;
				switch (errClass) {
					case "model_not_found":
						msg = t("modelNotFound", { model });
						break;
					case "invalid_key":
						msg = t("apiKeyRejected");
						break;
					case "rate_limit":
						msg = t("rateLimitHit");
						break;
					case "network":
						msg = t("networkError");
						break;
					default:
						msg = error.message;
				}
				new Notice(msg);
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
			return;
		}

		const range = sel.getRangeAt(0);
		if (!this.messagesEl.contains(range.commonAncestorContainer)) {
			this.selectionToolbar.style.display = "none";
			return;
		}

		this.selectionToolbar.style.display = "flex";
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
		this.plugin.cmdForkConversation(conv.id, text, sourceMessageId);
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
		const last = [...messages].reverse().find(m => m.tokenUsage);
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
