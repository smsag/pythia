import {
	App,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Modal,
	Notice,
	setIcon,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import { todayISO } from "./utils";
import { t } from "./i18n";
import { InlineSuggest } from "./ui/InlineSuggest";
import type { Conversation, Favorite, Message, ToolCall, TokenUsage } from "./models/types";
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

function estimateTokens(sizeBytes: number): string {
	const n = Math.round(sizeBytes / 4);
	return n >= 1000 ? `~${(n / 1000).toFixed(1)}k` : `~${n}`;
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
	return MODEL_ABBREVIATIONS[model] ?? model;
}

export class PythiaSidebarView extends ItemView {
	private plugin: PythiaPlugin;
	private activeConversation: Conversation | null = null;
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

	private convNameEl!: HTMLElement;
	private templateLabelEl!: HTMLElement;
	private modelBadgeEl!: HTMLButtonElement;
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
		this.pendingAttachedNotes = [];
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
		Promise.all(
			missing.map(async (msg) => {
				try {
					const name = await this.plugin.llmRouter.generateChapterName(
						msg.content,
						conversation.provider
					);
					if (name) msg.chapterName = name;
				} catch {
					// Silently ignore — chapter name is non-critical
				}
			})
		).then(async () => {
			if (missing.some((m) => m.chapterName)) {
				await this.plugin.conversationStore.save(conversation);
			}
		}).catch(() => { /* ignore persistence errors */ });
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
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		});
		this.inputEl.addEventListener("input", () => {
			this.autoResizeTextarea();
			this.inlineSuggest.handleInput();
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
			return;
		}
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
		void MarkdownRenderer.render(this.app, summary, this.summaryPanelBodyEl, "", this);
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

		const summaryText = source?.summaryText?.trim();
		if (summaryText) {
			const bodyEl = banner.createDiv({ cls: "pythia-summary-body pythia-summary-body--collapsed pythia-fork-body" });
			MarkdownRenderer.render(this.app, summaryText, bodyEl, "", this);
			let expanded = false;
			const toggle = banner.createEl("button", { cls: "pythia-summary-toggle", text: t("showMore") });
			toggle.addEventListener("click", () => {
				expanded = !expanded;
				bodyEl.toggleClass("pythia-summary-body--collapsed", !expanded);
				toggle.setText(expanded ? t("showLess") : t("showMore"));
			});
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
			const tokEst = file instanceof TFile ? estimateTokens(file.stat.size) : null;

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
			const tokEst = file instanceof TFile ? estimateTokens(file.stat.size) : undefined;
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
			await MarkdownRenderer.render(this.app, msg.content, bubble, "", this);
			return bubble;
		}

		// ── Assistant message ────────────────────────────────────────
		const row = this.messagesEl.createDiv({
			cls: "p-msg-ai",
			attr: { "data-msg-id": msg.id },
		});
		const aiBody = row.createDiv({ cls: "p-ai-body" });
		await MarkdownRenderer.render(this.app, msg.content, aiBody, "", this);
		this.addCopyButtons(aiBody);

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
				await MarkdownRenderer.render(this.app, fullText, aiBody, "", this);
				this.addCopyButtons(aiBody);
				// rAF ensures scrollToBottom runs after the markdown DOM is laid out.
				this.autoScroll = true;
				requestAnimationFrame(() => this.scrollToBottom(true));
			},
		};
	}

	private addCopyButtons(container: HTMLElement): void {
		container.querySelectorAll<HTMLElement>("pre:not([data-copy-btn])").forEach((pre) => {
			pre.dataset.copyBtn = "1";
			const btn = pre.createEl("button", { cls: "p-code-copy", attr: { title: "Copy" } });
			setIcon(btn, "copy");
			btn.addEventListener("click", async (e) => {
				e.stopPropagation();
				const text = (pre.querySelector("code") ?? pre).innerText;
				await navigator.clipboard.writeText(text);
				setIcon(btn, "check");
				btn.addClass("copied");
				setTimeout(() => { setIcon(btn, "copy"); btn.removeClass("copied"); }, 1500);
			});
		});
	}

	private autoResizeTextarea(): void {
		this.inputEl.style.height = "auto";
		this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 72)}px`;
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
		const placeholder: Favorite = { messageId: msg.id, name: "…" };
		conv.favorites.push(placeholder);
		await this.plugin.conversationStore.save(conv);
		starEl.setText("★");
		starEl.addClass("on");
		starEl.title = t("removeFromFavorites");
		this.renderFavoritesBar();

		try {
			const name = await this.plugin.llmRouter.generateFavoriteName(
				msg.content,
				conv.provider ?? "anthropic"
			);
			const fav = conv.favorites?.find((f) => f.messageId === msg.id);
			if (fav) {
				fav.name = name;
				await this.plugin.conversationStore.save(conv);
				this.renderFavoritesBar();
			}
		} catch {
			const fav = conv.favorites?.find((f) => f.messageId === msg.id);
			if (fav) {
				fav.name = msg.content.slice(0, 40).replace(/\s+/g, " ").trim();
				await this.plugin.conversationStore.save(conv);
				this.renderFavoritesBar();
			}
		}
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

		// Close on mousedown outside (capture phase so it fires before any Obsidian handlers)
		const onOutside = (e: MouseEvent) => {
			if (!this.navigatorEl.contains(e.target as Node) && e.target !== this.indexTriggerEl) {
				this.navigatorEl.removeClass("open");
				document.removeEventListener("mousedown", onOutside, true);
			}
		};
		// Defer so the trigger's own mousedown doesn't immediately close it
		setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
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
						this.plugin.llmRouter
							.generateConversationTitle(userMsg.content, fullText, conv.provider)
							.then(async (title) => {
								conv.name = title;
								await this.plugin.conversationStore.save(conv);
								if (this.activeConversation?.id === conv.id) {
									this.convNameEl.setText(conv.name + " ▾");
								}
							})
							.catch(() => { /* keep date name on failure */ });
					}

					if (!userMsg.chapterName) {
						this.plugin.llmRouter
							.generateChapterName(userMsg.content, conv.provider)
							.then(async (name) => {
								if (name) {
									userMsg.chapterName = name;
									await this.plugin.conversationStore.save(conv);
								}
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
			const n = last.tokenUsage.inputTokens;
			const fmt = n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
			this.sendBtn.setText(`${t("sendBtn")} · ${fmt}`);
		} else {
			this.sendBtn.setText(t("sendBtn"));
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
