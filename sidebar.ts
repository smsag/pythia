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

	private inlineSuggest!: InlineSuggest;
	private tocBtnEl!: HTMLButtonElement;
	private tocPopoverEl: HTMLElement | null = null;
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
		if (this.tocPopoverEl) {
			this.tocPopoverEl.remove();
			this.tocPopoverEl = null;
		}
		this.renderHeader();
		this.updateModelBadge();
		this.renderReferencePills();
		this.renderFavoritesBar();
		await this.renderMessages();
		if (focus) this.inputEl?.focus();
		this.backfillChapterNames(conversation);
	}

	getActiveConversation(): Conversation | null {
		return this.activeConversation;
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
		this.inputEl.focus();
	}

	private buildUI(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("pythia-view");

		const header = container.createDiv({ cls: "pythia-header" });

		const titleRow = header.createDiv({ cls: "pythia-title-row" });
		this.convNameEl = titleRow.createEl("button", {
			cls: "pythia-conv-name",
			text: t("noConversation"),
		});
		this.convNameEl.addEventListener("click", () =>
			this.onConvNameClick()
		);

		this.modelBadgeEl = titleRow.createEl("button", {
			cls: "pythia-model-badge",
			text: "",
			attr: { title: t("changeModelTooltip") },
		});
		this.modelBadgeEl.style.display = "none";
		this.modelBadgeEl.addEventListener("click", () => this.onModelBadgeClick());

		const deleteConvBtn = titleRow.createEl("button", {
			cls: "pythia-btn pythia-btn-icon pythia-delete-conv-btn",
			attr: { title: t("deleteConvTooltip") },
		});
		setIcon(deleteConvBtn, "trash");
		deleteConvBtn.addEventListener("click", () =>
			this.handleDeleteConversation()
		);

		const newConvBtn = titleRow.createEl("button", {
			cls: "pythia-btn pythia-btn-icon pythia-new-conv-btn",
			attr: { title: t("newConvTooltip") },
		});
		setIcon(newConvBtn, "plus");
		newConvBtn.addEventListener("click", () =>
			this.plugin.cmdNewConversation()
		);

		this.templateLabelEl = header.createDiv({
			cls: "pythia-template-label",
		});

		this.referenceSectionEl = container.createDiv({
			cls: "pythia-context-section",
		});
		this.referenceSectionEl.createEl("span", {
			cls: "pythia-section-label",
			text: t("referenceSection"),
		});
		this.referencePillsEl = this.referenceSectionEl.createDiv({
			cls: "pythia-pills",
		});
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
		this.messagesEl = messagesWrapper.createDiv({ cls: "pythia-messages" });
		this.messagesEl.addEventListener("scroll", () => {
			if (this.isScrolling) return; // programmatic scroll — ignore
			const el = this.messagesEl;
			const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
			if (distFromBottom > 50) this.autoScroll = false;
		});
		this.selectionToolbar = container.createDiv({ cls: "pythia-sel-toolbar" });
		this.selectionToolbar.style.display = "none";

		const copyBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: t("copyBtn"),
			attr: { title: t("copyBtn") },
		});
		copyBtn.addEventListener("mousedown", (e) => {
			e.preventDefault(); // keep selection alive
			this.onCopySelection();
		});
		copyBtn.addEventListener("touchstart", (e) => {
			e.preventDefault();
			this.onCopySelection();
		}, { passive: false });

		const insertBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: t("insertBtn"),
			attr: { title: t("insertBtn") },
		});
		insertBtn.addEventListener("mousedown", (e) => {
			e.preventDefault();
			this.onInsertIntoNote();
		});
		insertBtn.addEventListener("touchstart", (e) => {
			e.preventDefault();
			this.onInsertIntoNote();
		}, { passive: false });

		const inboxBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: t("inboxBtn"),
			attr: { title: t("inboxBtn") },
		});
		inboxBtn.addEventListener("mousedown", (e) => {
			e.preventDefault();
			this.onSaveToInbox();
		});
		inboxBtn.addEventListener("touchstart", (e) => {
			e.preventDefault();
			this.onSaveToInbox();
		}, { passive: false });

		this.onSelectionChange = () => this.handleSelectionChange();
		document.addEventListener("selectionchange", this.onSelectionChange);
		this.messagesEl.addEventListener("mouseup", () =>
			setTimeout(() => this.handleSelectionChange(), 10)
		);
		this.messagesEl.addEventListener("touchend", () =>
			setTimeout(() => this.handleSelectionChange(), 300)
		);

		const tocBar = messagesWrapper.createDiv({ cls: "pythia-toc-bar" });
		this.tocBtnEl = tocBar.createEl("button", {
			cls: "pythia-toc-btn",
			text: "↑",
			attr: { title: t("showChaptersTooltip") },
		});
		this.tocBtnEl.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleTocPopover(container, tocBar);
		});

		const inputArea = container.createDiv({ cls: "pythia-input-area" });

		const attachRow = inputArea.createDiv({ cls: "pythia-attach-row" });
		this.attachedPillsEl = attachRow.createDiv({
			cls: "pythia-pills pythia-attached-pills",
		});

		const inputWrapper = inputArea.createDiv({ cls: "pythia-input-wrapper" });

		this.inputEl = inputWrapper.createEl("textarea", {
			cls: "pythia-input",
			attr: { placeholder: t("inputPlaceholder") },
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
		this.inputEl.addEventListener("input", () => this.inlineSuggest.handleInput());

		// visualViewport resize is unreliable in some WKWebView versions;
		// focus/blur fire unconditionally. 300 ms lets the keyboard slide in.
		this.inputEl.addEventListener("focus", () => {
			setTimeout(() => this.adjustForKeyboard(), 300);
		});
		this.inputEl.addEventListener("blur", () => {
			setTimeout(() => this.adjustForKeyboard(), 300);
		});

		const btnRow = inputArea.createDiv({ cls: "pythia-btn-row" });

		const attachBtn = btnRow.createEl("button", {
			cls: "pythia-btn pythia-btn-icon",
			attr: { title: t("attachNoteTooltip") },
		});
		setIcon(attachBtn, "paperclip");
		attachBtn.addEventListener("click", () => this.onAttachNote());

		const saveBtn = btnRow.createEl("button", {
			cls: "pythia-btn pythia-btn-icon",
			attr: { title: t("saveResponseTooltip") },
		});
		setIcon(saveBtn, "save");
		saveBtn.addEventListener("click", () => this.onSaveResponse());

		const summarizeBtn = btnRow.createEl("button", {
			cls: "pythia-btn pythia-btn-icon",
			attr: { title: t("summarizeTooltip") },
		});
		setIcon(summarizeBtn, "sparkles");
		summarizeBtn.addEventListener("click", () => this.onGenerateSummary());

		btnRow.createEl("span", { cls: "pythia-btn-separator" });

		this.sendBtn = btnRow.createEl("button", {
			cls: "pythia-btn pythia-btn-primary",
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

	private renderSummaryBanner(summary: string): void {
		const banner = this.messagesEl.createDiv({ cls: "pythia-summary-banner" });
		const header = banner.createDiv({ cls: "pythia-summary-header" });
		header.createEl("span", { text: t("summaryLabel") });
		const refreshBtn = header.createEl("button", {
			cls: "pythia-summary-refresh",
			attr: { title: t("regenerateSummaryTooltip") },
		});
		setIcon(refreshBtn, "refresh-cw");
		refreshBtn.addEventListener("click", () => this.onGenerateSummary());

		const bodyEl = banner.createDiv({ cls: "pythia-summary-body pythia-summary-body--collapsed" });
		MarkdownRenderer.render(this.app, summary, bodyEl, "", this);

		let expanded = false;
		const toggle = banner.createEl("button", {
			cls: "pythia-summary-toggle",
			text: t("showMore"),
		});
		toggle.addEventListener("click", () => {
			expanded = !expanded;
			bodyEl.toggleClass("pythia-summary-body--collapsed", !expanded);
			toggle.setText(expanded ? t("showLess") : t("showMore"));
		});
	}

	private renderReferencePills(): void {
		this.referencePillsEl.empty();
		const conv = this.activeConversation;
		const refs: { path: string; clearField: () => void }[] = [];
		if (conv?.savedNotePath) {
			refs.push({ path: conv.savedNotePath, clearField: () => { conv.savedNotePath = undefined; } });
		}
		if (conv?.summaryNote) {
			refs.push({ path: conv.summaryNote, clearField: () => { conv.summaryNote = undefined; } });
		}

		this.referenceSectionEl.style.display = refs.length > 0 ? "" : "none";
		if (refs.length === 0) return;

		for (const ref of refs) {
			const fileName = ref.path.split("/").pop() ?? ref.path;
			const pill = this.referencePillsEl.createEl("span", { cls: "pythia-pill" });
			const label = pill.createEl("span", { text: fileName, cls: "pythia-pill-label", attr: { title: ref.path } });
			label.style.cursor = "pointer";
			label.addEventListener("click", async () => {
				const file = this.app.vault.getAbstractFileByPath(ref.path);
				if (file instanceof TFile) {
					await this.app.workspace.getLeaf(false).openFile(file);
				} else {
					new Notice(t("fileNotFound", { path: ref.path }));
				}
			});
			const x = pill.createEl("button", { cls: "pythia-pill-remove", text: "×" });
			x.addEventListener("click", () => {
				new DeleteFileModal(this.app, fileName, async () => {
					const file = this.app.vault.getAbstractFileByPath(ref.path);
					if (file instanceof TFile) await this.app.vault.trash(file, true);
					ref.clearField();
					if (conv) await this.plugin.conversationStore.save(conv);
					this.renderReferencePills();
				}).open();
			});
		}
	}

	private renderAttachedPills(): void {
		this.attachedPillsEl.empty();
		for (const notePath of this.pendingAttachedNotes) {
			this.addPill(
				this.attachedPillsEl,
				notePath.split("/").pop() ?? notePath,
				() => {
					this.pendingAttachedNotes =
						this.pendingAttachedNotes.filter((n) => n !== notePath);
					this.renderAttachedPills();
				},
				"pythia-pill-attached"
			);
		}
	}

	private addPill(
		container: HTMLElement,
		label: string,
		onRemove: () => void,
		extraClass = ""
	): void {
		const pill = container.createEl("span", {
			cls: `pythia-pill ${extraClass}`.trim(),
		});
		pill.createEl("span", { text: label, cls: "pythia-pill-label" });
		const x = pill.createEl("button", {
			cls: "pythia-pill-remove",
			text: "×",
		});
		x.addEventListener("click", onRemove);
	}

	private async renderMessages(): Promise<void> {
		this.messagesEl.empty();
		if (!this.activeConversation) {
			this.renderEmptyState();
			return;
		}
		const summary = this.activeConversation.summaryText?.trim();
		if (summary) this.renderSummaryBanner(summary);
		if (this.activeConversation.messages.length === 0) {
			const hint = this.messagesEl.createDiv({ cls: "pythia-empty" });
			hint.createEl("p", { text: t("startConversationBelow") });
			return;
		}
		for (const msg of this.activeConversation.messages) {
			await this.appendMessageBubble(msg);
		}
		this.scrollToBottom();
	}

	private async appendMessageBubble(msg: Message): Promise<HTMLElement> {
		const row = this.messagesEl.createDiv({
			cls: `pythia-message pythia-message-${msg.role}`,
			attr: { "data-msg-id": msg.id },
		});

		const bubbleCol = row.createDiv({ cls: "pythia-bubble-col" });
		const bubble = bubbleCol.createDiv({ cls: "pythia-bubble" });
		await MarkdownRenderer.render(this.app, msg.content, bubble, "", this);

		if (msg.role === "assistant") {
			const isFav = this.activeConversation?.favorites?.some(
				(f) => f.messageId === msg.id
			) ?? false;
			const footer = bubbleCol.createDiv({ cls: "pythia-bubble-footer" });
			const star = footer.createEl("button", {
				cls: `pythia-star${isFav ? " pythia-star-active" : ""}`,
				text: isFav ? "★" : "☆",
				attr: { title: isFav ? t("removeFromFavorites") : t("addToFavorites") },
			});
			star.addEventListener("click", () => this.onStarClick(msg, star));
			if (msg.tokenUsage) {
				footer.createSpan({ cls: "pythia-bubble-pipe", text: "|" });
				this.renderTokenCount(footer, msg.tokenUsage);
			}
		}

		return bubble;
	}

	private createStreamingBubble(): {
		appendToken: (text: string) => void;
		finalize: (fullText: string) => Promise<void>;
		bubbleCol: HTMLElement;
	} {
		const row = this.messagesEl.createDiv({
			cls: "pythia-message pythia-message-assistant",
		});
		const bubbleCol = row.createDiv({ cls: "pythia-bubble-col" });
		const bubble = bubbleCol.createDiv({ cls: "pythia-bubble pythia-streaming" });
		const textNode = document.createTextNode("");
		bubble.appendChild(textNode);

		return {
			bubbleCol,
			appendToken: (text: string) => {
				textNode.textContent = (textNode.textContent ?? "") + text;
				this.scrollToBottom();
			},
			finalize: async (fullText: string) => {
				bubble.removeClass("pythia-streaming");
				bubble.empty();
				await MarkdownRenderer.render(
					this.app,
					fullText,
					bubble,
					"",
					this
				);
				// rAF ensures scrollToBottom runs after the markdown DOM is laid out.
				this.autoScroll = true;
				requestAnimationFrame(() => this.scrollToBottom(true));
			},
		};
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
		this.favoritesSectionEl.style.display = "";
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
			starEl.removeClass("pythia-star-active");
			starEl.title = t("addToFavorites");
			return;
		}

		if (!conv.favorites) conv.favorites = [];
		const placeholder: Favorite = { messageId: msg.id, name: "…" };
		conv.favorites.push(placeholder);
		await this.plugin.conversationStore.save(conv);
		starEl.setText("★");
		starEl.addClass("pythia-star-active");
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
		const star = row?.querySelector(".pythia-star") as HTMLButtonElement | null;
		if (star) {
			star.setText("☆");
			star.removeClass("pythia-star-active");
			star.title = t("addToFavorites");
		}
	}

	private renderTokenCount(row: HTMLElement, usage: TokenUsage): void {
		const fmt = (n: number) => n.toLocaleString();
		const el = row.createEl("span", { cls: "pythia-token-count" });
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

	private toggleTocPopover(viewRoot: HTMLElement, tocBar: HTMLElement): void {
		if (this.tocPopoverEl) {
			this.tocPopoverEl.remove();
			this.tocPopoverEl = null;
			return;
		}

		const conv = this.activeConversation;
		const userMessages = conv
			? conv.messages.filter((m) => m.role === "user")
			: [];

		// Append to the root so the popover isn't clipped by overflow:hidden ancestors.
		const popover = viewRoot.createDiv({ cls: "pythia-toc-popover" });
		this.tocPopoverEl = popover;

		const positionPopover = () => {
			const barRect = tocBar.getBoundingClientRect();
			const rootRect = viewRoot.getBoundingClientRect();
			const popoverHeight = Math.min(popover.scrollHeight, 240);
			const bottom = rootRect.bottom - barRect.top + 4;
			popover.style.position = "absolute";
			popover.style.bottom = `${bottom}px`;
			popover.style.right = "8px";
		};

		if (userMessages.length === 0) {
			popover.createDiv({
				cls: "pythia-toc-item pythia-toc-placeholder",
				text: t("chaptersEmpty"),
			});
		} else {
			for (const msg of userMessages) {
				const item = popover.createDiv({
					cls: "pythia-toc-item",
					text: msg.chapterName ?? "…",
				});
				// Use mousedown so Obsidian's global click interceptors can't block it
				item.addEventListener("mousedown", (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.scrollToMessage(msg.id);
					popover.remove();
					this.tocPopoverEl = null;
					document.removeEventListener("mousedown", onOutside, true);
				});
			}
		}

		requestAnimationFrame(positionPopover);

		// Close on mousedown outside (capture so it fires before any Obsidian handlers)
		const onOutside = (e: MouseEvent) => {
			if (!popover.contains(e.target as Node) && e.target !== this.tocBtnEl) {
				popover.remove();
				this.tocPopoverEl = null;
				document.removeEventListener("mousedown", onOutside, true);
			}
		};
		// Defer so the button's own mousedown doesn't immediately close it
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
		try {
			const summary = await this.plugin.llmRouter.generateSummary(conv);
			if (summary) {
				conv.summaryText = summary;
				await this.plugin.conversationStore.save(conv);
				await this.renderMessages();
			}
		} catch (e) {
			new Notice(t("summaryFailed", { error: e instanceof Error ? e.message : String(e) }));
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
					await this.plugin.noteWriter.appendConversationSlice(slice, path);
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

	private async sendMessage(): Promise<void> {
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

		const { appendToken, finalize, bubbleCol: streamingBubbleCol } = this.createStreamingBubble();

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
					const rows = this.messagesEl.querySelectorAll(".pythia-message-assistant");
					const lastRow = rows[rows.length - 1] as HTMLElement | null;
					if (lastRow && !lastRow.getAttribute("data-msg-id")) {
						lastRow.setAttribute("data-msg-id", assistantMsg.id);
						if (this.activeConversation?.id === conv.id) {
							const footer = streamingBubbleCol.createDiv({ cls: "pythia-bubble-footer" });
							const star = footer.createEl("button", {
								cls: "pythia-star",
								text: "☆",
								attr: { title: t("addToFavorites") },
							});
							star.addEventListener("click", () =>
								this.onStarClick(assistantMsg, star)
							);
							if (tokenUsage) {
								footer.createSpan({ cls: "pythia-bubble-pipe", text: "|" });
								this.renderTokenCount(footer, tokenUsage);
							}
						}
					}
					await this.plugin.conversationStore.save(conv);

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

		// Position the toolbar below the selection so it doesn't compete with
		// the iOS native copy/paste popover, which always appears above.
		const rect = range.getBoundingClientRect();
		const containerRect = this.containerEl.getBoundingClientRect();

		const toolbarH = 36; // approximate toolbar height
		const top = rect.bottom - containerRect.top + 8;
		const left = Math.min(
			rect.left - containerRect.left + rect.width / 2 - 60,
			containerRect.width - 128
		);

		this.selectionToolbar.style.display = "flex";
		// Clamp so the toolbar doesn't overflow below the container.
		const maxTop = containerRect.height - toolbarH - 4;
		this.selectionToolbar.style.top = `${Math.min(Math.max(4, top), maxTop)}px`;
		this.selectionToolbar.style.left = `${Math.max(4, left)}px`;
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

	private setStreamingState(streaming: boolean): void {
		this.isStreaming = streaming;
		if (streaming) {
			this.autoScroll = true;
			this.sendBtn.setText(t("stopBtn"));
			this.sendBtn.removeClass("pythia-btn-primary");
			this.sendBtn.addClass("pythia-btn-danger");
		} else {
			this.sendBtn.setText(t("sendBtn"));
			this.sendBtn.removeClass("pythia-btn-danger");
			this.sendBtn.addClass("pythia-btn-primary");
		}
		this.inputEl.disabled = streaming;
	}
}
