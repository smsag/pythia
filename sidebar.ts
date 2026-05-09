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
import type { Conversation, Favorite, Message, ToolCall, TokenUsage } from "./models/types";
import type PythiaPlugin from "./main";
import { ConversationSuggestModal } from "./suggest/ConversationSuggest";
import { NoteSuggestModal } from "./suggest/NoteSuggest";
import { InputModal } from "./suggest/InputModal";
import { ConversationSettingsModal } from "./suggest/ConversationSettingsModal";
import { FolderSuggestModal } from "./suggest/FolderSuggest";
import { classifyApiError } from "./services/apiError";
import { executeToolCall } from "./services/ToolHandler";
import { DeleteConversationModal } from "./suggest/DeleteConversationModal";

export const PYTHIA_VIEW_TYPE = "pythia";

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

	// DOM elements
	private convNameEl!: HTMLElement;
	private templateLabelEl!: HTMLElement;
	private modelBadgeEl!: HTMLButtonElement;
	private contextPillsEl!: HTMLElement;
	private favoritesPillsEl!: HTMLElement;
	private favoritesSectionEl!: HTMLElement;
	private summaryNoteSectionEl!: HTMLElement;
	private summaryNotePathEl!: HTMLElement;
	private attachedPillsEl!: HTMLElement;
	private messagesEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private selectionToolbar!: HTMLElement;
	private onSelectionChange!: () => void;
	private lastMarkdownView: MarkdownView | null = null;

	// Inline note suggest state (# trigger)
	private hashPos: number | null = null;
	private suggestDropdown: HTMLElement | null = null;
	private suggestActiveIdx = 0;
	private suggestItems: TFile[] = [];
	private suggestOutsideHandler: ((e: MouseEvent) => void) | null = null;
	private inputAreaEl!: HTMLElement;
	private tocBtnEl!: HTMLButtonElement;
	private tocPopoverEl: HTMLElement | null = null;

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
		this.dismissSuggest();
	}

	// ──────────────────────────────────────────────
	// Public API used by main.ts commands
	// ──────────────────────────────────────────────

	async setActiveConversation(
		conversation: Conversation,
		focus = true
	): Promise<void> {
		this.activeConversation = conversation;
		this.pendingAttachedNotes = [];
		// Close any open TOC popover when switching conversations
		if (this.tocPopoverEl) {
			this.tocPopoverEl.remove();
			this.tocPopoverEl = null;
		}
		this.renderHeader();
		this.updateModelBadge();
		this.renderContextPills();
		this.renderFavoritesBar();
		this.renderSummaryNoteRow();
		await this.renderMessages();
		if (focus) this.inputEl?.focus();
		// Back-fill chapter names for any user messages that don't have one yet
		this.backfillChapterNames(conversation);
	}

	getActiveConversation(): Conversation | null {
		return this.activeConversation;
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

	// ──────────────────────────────────────────────
	// UI construction
	// ──────────────────────────────────────────────

	private buildUI(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("pythia-view");

		// ── Header ──────────────────────────────
		const header = container.createDiv({ cls: "pythia-header" });

		const titleRow = header.createDiv({ cls: "pythia-title-row" });
		this.convNameEl = titleRow.createEl("button", {
			cls: "pythia-conv-name",
			text: "No conversation",
		});
		this.convNameEl.addEventListener("click", () =>
			this.onConvNameClick()
		);

		this.modelBadgeEl = titleRow.createEl("button", {
			cls: "pythia-model-badge",
			text: "",
			attr: { title: "Change provider / model" },
		});
		this.modelBadgeEl.style.display = "none";
		this.modelBadgeEl.addEventListener("click", () => this.onModelBadgeClick());

		const deleteConvBtn = titleRow.createEl("button", {
			cls: "pythia-btn pythia-btn-icon pythia-delete-conv-btn",
			attr: { title: "Delete conversation" },
		});
		setIcon(deleteConvBtn, "trash");
		deleteConvBtn.addEventListener("click", () =>
			this.handleDeleteConversation()
		);

		const newConvBtn = titleRow.createEl("button", {
			cls: "pythia-btn pythia-btn-icon pythia-new-conv-btn",
			attr: { title: "New conversation" },
		});
		setIcon(newConvBtn, "plus");
		newConvBtn.addEventListener("click", () =>
			this.plugin.cmdNewConversationFromSidebar()
		);

		this.templateLabelEl = header.createDiv({
			cls: "pythia-template-label",
		});

		// ── Context notes ────────────────────────
		const contextSection = container.createDiv({
			cls: "pythia-context-section",
		});
		contextSection.createEl("span", {
			cls: "pythia-section-label",
			text: "Context",
		});
		this.contextPillsEl = contextSection.createDiv({
			cls: "pythia-pills",
		});

		// ── Favorites ─────────────────────────────
		this.favoritesSectionEl = container.createDiv({
			cls: "pythia-favorites-section",
		});
		this.favoritesSectionEl.createEl("span", {
			cls: "pythia-section-label",
			text: "Favorites",
		});
		this.favoritesPillsEl = this.favoritesSectionEl.createDiv({
			cls: "pythia-pills",
		});
		this.favoritesSectionEl.style.display = "none";

		// ── Summary note ──────────────────────────
		this.summaryNoteSectionEl = container.createDiv({
			cls: "pythia-summary-note-section",
		});
		this.summaryNoteSectionEl.createEl("span", {
			cls: "pythia-section-label",
			text: "Summary note:",
		});
		this.summaryNotePathEl = this.summaryNoteSectionEl.createEl("span", {
			cls: "pythia-summary-note-path",
		});
		const moveBtn = this.summaryNoteSectionEl.createEl("button", {
			cls: "pythia-btn pythia-btn-icon pythia-summary-note-move",
			attr: { title: "Move summary note to another folder" },
		});
		setIcon(moveBtn, "folder-open");
		moveBtn.addEventListener("click", () => this.onMoveSummaryNote());
		this.summaryNoteSectionEl.style.display = "none";

		// ── Messages ─────────────────────────────
		this.messagesEl = container.createDiv({ cls: "pythia-messages" });
		this.messagesEl.addEventListener("scroll", () => {
			if (this.isScrolling) return; // programmatic scroll — ignore
			const el = this.messagesEl;
			const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
			if (distFromBottom > 50) this.autoScroll = false;
		});
		// ── Selection toolbar ────────────────────────────
		this.selectionToolbar = container.createDiv({ cls: "pythia-sel-toolbar" });
		this.selectionToolbar.style.display = "none";

		const copyBtn = this.selectionToolbar.createEl("button", {
			cls: "pythia-sel-btn",
			text: "Copy",
			attr: { title: "Copy selection" },
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
			text: "Insert into note",
			attr: { title: "Insert at cursor in active note" },
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
			text: "Save to inbox",
			attr: { title: "Prepend to inbox note with timestamp" },
		});
		inboxBtn.addEventListener("mousedown", (e) => {
			e.preventDefault();
			this.onSaveToInbox();
		});
		inboxBtn.addEventListener("touchstart", (e) => {
			e.preventDefault();
			this.onSaveToInbox();
		}, { passive: false });

		// Wire selection detection
		this.onSelectionChange = () => this.handleSelectionChange();
		document.addEventListener("selectionchange", this.onSelectionChange);
		this.messagesEl.addEventListener("mouseup", () =>
			setTimeout(() => this.handleSelectionChange(), 10)
		);
		this.messagesEl.addEventListener("touchend", () =>
			setTimeout(() => this.handleSelectionChange(), 300)
		);
		// ── TOC bar ──────────────────────────────
		const tocBar = container.createDiv({ cls: "pythia-toc-bar" });
		this.tocBtnEl = tocBar.createEl("button", {
			cls: "pythia-toc-btn",
			text: "↑",
			attr: { title: "Show chapters" },
		});
		this.tocBtnEl.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleTocPopover(container, tocBar);
		});

		// ── Input area ───────────────────────────
		const inputArea = container.createDiv({ cls: "pythia-input-area" });
		this.inputAreaEl = inputArea;

		// Pending attached notes row
		const attachRow = inputArea.createDiv({ cls: "pythia-attach-row" });
		this.attachedPillsEl = attachRow.createDiv({
			cls: "pythia-pills pythia-attached-pills",
		});

		// Textarea + overlaid button row wrapper
		const inputWrapper = inputArea.createDiv({ cls: "pythia-input-wrapper" });

		this.inputEl = inputWrapper.createEl("textarea", {
			cls: "pythia-input",
			attr: { placeholder: "Type a message… (Enter to send, Shift+Enter for new line)" },
		});
		this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			// Intercept navigation keys when the inline suggest dropdown is open
			if (this.suggestDropdown) {
				if (e.key === "ArrowDown") {
					e.preventDefault();
					this.moveSuggestSelection(1);
					return;
				}
				if (e.key === "ArrowUp") {
					e.preventDefault();
					this.moveSuggestSelection(-1);
					return;
				}
				if (e.key === "Enter") {
					e.preventDefault();
					this.commitSuggestSelection();
					return;
				}
				if (e.key === "Escape") {
					e.preventDefault();
					this.dismissSuggest();
					return;
				}
			}
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		});
		this.inputEl.addEventListener("input", () => this.onInputChange());

		// Buttons row — below the textarea in normal document flow
		const btnRow = inputArea.createDiv({ cls: "pythia-btn-row" });

		const attachBtn = btnRow.createEl("button", {
			cls: "pythia-btn pythia-btn-icon",
			attr: { title: "Attach note" },
		});
		setIcon(attachBtn, "paperclip");
		attachBtn.addEventListener("click", () => this.onAttachNote());

		const saveBtn = btnRow.createEl("button", {
			cls: "pythia-btn pythia-btn-icon",
			attr: { title: "Save response" },
		});
		setIcon(saveBtn, "save");
		saveBtn.addEventListener("click", () => this.onSaveResponse());

		btnRow.createEl("span", { cls: "pythia-btn-separator" });

		this.sendBtn = btnRow.createEl("button", {
			cls: "pythia-btn pythia-btn-primary",
			text: "Senden",
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
			text: "No active conversation.",
		});
		empty.createEl("p", {
			text: 'Use the command palette to start one (Ctrl/Cmd+P → "Pythia:").',
			cls: "pythia-empty-hint",
		});
	}

	private renderHeader(): void {
		if (!this.activeConversation) {
			this.convNameEl.setText("No conversation");
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
			this.templateLabelEl.setText(`Template: ${tplName}`);
		} else {
			this.templateLabelEl.setText("");
		}
	}

	private renderSummaryBanner(summary: string): void {
		const banner = this.messagesEl.createDiv({ cls: "pythia-summary-banner" });
		const header = banner.createDiv({ cls: "pythia-summary-header" });
		header.createEl("span", { text: "↩ Summary" });

		const LIMIT = 300;
		const isTruncatable = summary.length > LIMIT;
		const bodyEl = banner.createDiv({ cls: "pythia-summary-body" });
		bodyEl.setText(isTruncatable ? summary.slice(0, LIMIT) + "…" : summary);

		if (isTruncatable) {
			let expanded = false;
			const toggle = banner.createEl("button", {
				cls: "pythia-summary-toggle",
				text: "Show more",
			});
			toggle.addEventListener("click", () => {
				expanded = !expanded;
				bodyEl.setText(expanded ? summary : summary.slice(0, LIMIT) + "…");
				toggle.setText(expanded ? "Show less" : "Show more");
			});
		}

	}

	private renderContextPills(): void {
		this.contextPillsEl.empty();
		if (!this.activeConversation) return;

		for (const notePath of this.activeConversation.contextNotes) {
			this.addPill(
				this.contextPillsEl,
				notePath.split("/").pop() ?? notePath,
				async () => {
					if (!this.activeConversation) return;
					this.activeConversation.contextNotes =
						this.activeConversation.contextNotes.filter(
							(n) => n !== notePath
						);
					await this.plugin.conversationStore.save(
						this.activeConversation
					);
					this.renderContextPills();
				}
			);
		}

		const addBtn = this.contextPillsEl.createEl("button", {
			cls: "pythia-pill-add",
			text: "+",
			attr: { title: "Attach a vault note as context" },
		});
		addBtn.addEventListener("click", () => {
			new NoteSuggestModal(this.app, async (file) => {
				if (!this.activeConversation) return;
				if (
					!this.activeConversation.contextNotes.includes(file.path)
				) {
					this.activeConversation.contextNotes.push(file.path);
					await this.plugin.conversationStore.save(
						this.activeConversation
					);
					this.renderContextPills();
				}
			}).open();
		});
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
			hint.createEl("p", { text: "Start the conversation below." });
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
				attr: { title: isFav ? "Remove from favorites" : "Add to favorites" },
			});
			star.addEventListener("click", () => this.onStarClick(msg, star));
			if (msg.tokenUsage) {
				footer.createSpan({ cls: "pythia-bubble-pipe", text: "|" });
				this.renderTokenCount(footer, msg.tokenUsage);
			}
		}

		return bubble;
	}

	/** Create a streaming bubble. Returns helpers to append tokens and finalize. */
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
				// Re-engage auto-scroll and force-scroll to bottom after the
				// markdown DOM has been laid out (rAF fires after paint).
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

	// ──────────────────────────────────────────────
	// Favorites
	// ──────────────────────────────────────────────

	private renderSummaryNoteRow(): void {
		const path = this.activeConversation?.summaryNote;
		if (!path) {
			this.summaryNoteSectionEl.style.display = "none";
			return;
		}
		this.summaryNoteSectionEl.style.display = "";
		const fileName = path.split("/").pop() ?? path;
		this.summaryNotePathEl.setText(fileName);
		this.summaryNotePathEl.title = path;
	}

	private async onMoveSummaryNote(): Promise<void> {
		const conv = this.activeConversation;
		if (!conv?.summaryNote) return;
		const currentPath = conv.summaryNote;
		const file = this.app.vault.getAbstractFileByPath(currentPath);
		if (!(file instanceof TFile)) {
			new Notice(`File not found: ${currentPath}`);
			return;
		}
		new FolderSuggestModal(this.app, async (folder) => {
			const fileName = currentPath.split("/").pop() ?? currentPath;
			const newPath = folder.isRoot() ? fileName : `${folder.path}/${fileName}`;
			try {
				await this.app.fileManager.renameFile(file, newPath);
				// Update contextNotes references and summaryNote
				conv.summaryNote = newPath;
				conv.contextNotes = conv.contextNotes.map((p) =>
					p === currentPath ? newPath : p
				);
				await this.plugin.conversationStore.save(conv);
				this.renderSummaryNoteRow();
				this.renderContextPills();
				new Notice(`Moved to ${newPath}`);
			} catch (e) {
				new Notice(`Move failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		}).open();
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
				attr: { title: "Remove favorite" },
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
			starEl.title = "Add to favorites";
			return;
		}

		// Add with placeholder name
		if (!conv.favorites) conv.favorites = [];
		const placeholder: Favorite = { messageId: msg.id, name: "…" };
		conv.favorites.push(placeholder);
		await this.plugin.conversationStore.save(conv);
		starEl.setText("★");
		starEl.addClass("pythia-star-active");
		starEl.title = "Remove from favorites";
		this.renderFavoritesBar();

		// Background name generation
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
			star.title = "Add to favorites";
		}
	}

	private renderTokenCount(row: HTMLElement, usage: TokenUsage): void {
		const fmt = (n: number) => n.toLocaleString();
		const el = row.createEl("span", { cls: "pythia-token-count" });
		el.setText(`↑${fmt(usage.inputTokens)} tokens  ↓${fmt(usage.outputTokens)} tokens`);
		el.title = `Input: ${fmt(usage.inputTokens)} tokens · Output: ${fmt(usage.outputTokens)} tokens`;
	}

	scrollToMessage(messageId: string): void {
		const row = this.messagesEl.querySelector(
			`[data-msg-id="${messageId}"]`
		) as HTMLElement | null;
		row?.scrollIntoView({ behavior: "smooth", block: "center" });
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

		// Append to the root view element so it isn't clipped by intermediate
		// overflow:hidden / overflow:auto ancestors (messages container, etc.).
		const popover = viewRoot.createDiv({ cls: "pythia-toc-popover" });
		this.tocPopoverEl = popover;

		// Position the popover above the TOC bar using getBoundingClientRect.
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
				text: "No chapters yet",
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

		// Position after the DOM is laid out
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

	// ──────────────────────────────────────────────
	// Event handlers
	// ──────────────────────────────────────────────

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
			new Notice("Conversation deleted.");

			const remaining = this.plugin.conversations;
			if (remaining.length > 0) {
				const next = remaining[remaining.length - 1];
				await this.setActiveConversation(next);
			} else {
				await this.plugin.cmdNewConversationFromSidebar();
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

	// ──────────────────────────────────────────────
	// # inline note picker
	// ──────────────────────────────────────────────

	private onInputChange(): void {
		const el = this.inputEl;
		const val = el.value;
		const cursor = el.selectionStart ?? val.length;

		// Find the most recent '#' preceded by start-of-string or whitespace
		let triggerPos: number | null = null;
		for (let i = cursor - 1; i >= 0; i--) {
			if (val[i] === "#") {
				if (i === 0 || /\s/.test(val[i - 1])) {
					triggerPos = i;
					break;
				}
			}
			// Stop scanning once we cross whitespace without finding '#'
			if (/\s/.test(val[i])) break;
		}

		if (triggerPos === null) {
			this.dismissSuggest();
			return;
		}

		this.hashPos = triggerPos;
		const query = val.slice(triggerPos + 1, cursor);
		this.showSuggest(query);
	}

	private showSuggest(query: string): void {
		const q = query.toLowerCase();
		const allFiles = this.app.vault.getMarkdownFiles();

		this.suggestItems = allFiles
			.filter((f) => q === "" || f.path.toLowerCase().includes(q))
			.sort((a, b) => {
				// Boost files where the base name matches
				const aName = a.basename.toLowerCase().includes(q);
				const bName = b.basename.toLowerCase().includes(q);
				if (aName && !bName) return -1;
				if (!aName && bName) return 1;
				return 0;
			})
			.slice(0, 8);

		if (this.suggestItems.length === 0) {
			this.dismissSuggest();
			return;
		}

		if (!this.suggestDropdown) {
			this.suggestDropdown = this.inputAreaEl.createDiv({
				cls: "pythia-inline-suggest",
			});
			this.suggestOutsideHandler = (e: MouseEvent) => {
				if (
					!this.suggestDropdown?.contains(e.target as Node) &&
					e.target !== this.inputEl
				) {
					this.dismissSuggest();
				}
			};
			document.addEventListener("mousedown", this.suggestOutsideHandler);
		}

		this.suggestActiveIdx = Math.min(
			this.suggestActiveIdx,
			Math.max(0, this.suggestItems.length - 1)
		);
		this.renderSuggestDropdown();
	}

	private renderSuggestDropdown(): void {
		if (!this.suggestDropdown) return;
		this.suggestDropdown.empty();
		for (let i = 0; i < this.suggestItems.length; i++) {
			const file = this.suggestItems[i];
			const row = this.suggestDropdown.createDiv({
				cls:
					i === this.suggestActiveIdx
						? "pythia-suggest-item pythia-suggest-item--active"
						: "pythia-suggest-item",
			});
			row.createSpan({ cls: "pythia-suggest-name", text: file.basename });
			const folder = file.parent?.path ?? "";
			if (folder && folder !== "/") {
				row.createSpan({ cls: "pythia-suggest-folder", text: folder });
			}
			row.addEventListener("mousedown", (e) => {
				e.preventDefault();
				this.suggestActiveIdx = i;
				this.commitSuggestSelection();
			});
		}
	}

	private moveSuggestSelection(delta: number): void {
		if (!this.suggestDropdown || this.suggestItems.length === 0) return;
		this.suggestActiveIdx =
			(this.suggestActiveIdx + delta + this.suggestItems.length) %
			this.suggestItems.length;
		this.renderSuggestDropdown();
	}

	private commitSuggestSelection(): void {
		const file = this.suggestItems[this.suggestActiveIdx];
		if (!file || this.hashPos === null) {
			this.dismissSuggest();
			return;
		}
		const val = this.inputEl.value;
		const cursor = this.inputEl.selectionStart ?? val.length;
		// Remove the #query fragment from the textarea
		this.inputEl.value = val.slice(0, this.hashPos) + val.slice(cursor);
		this.inputEl.setSelectionRange(this.hashPos, this.hashPos);
		// Attach the note
		if (!this.pendingAttachedNotes.includes(file.path)) {
			this.pendingAttachedNotes.push(file.path);
			this.renderAttachedPills();
		}
		this.dismissSuggest();
	}

	private dismissSuggest(): void {
		this.hashPos = null;
		this.suggestActiveIdx = 0;
		if (this.suggestDropdown) {
			this.suggestDropdown.remove();
			this.suggestDropdown = null;
		}
		if (this.suggestOutsideHandler) {
			document.removeEventListener("mousedown", this.suggestOutsideHandler);
			this.suggestOutsideHandler = null;
		}
	}

	private async onSaveResponse(): Promise<void> {
		const lastResponse = this.getLastAssistantMessage();
		if (!lastResponse) {
			new Notice("No assistant response to save.");
			return;
		}

		const conv = this.activeConversation;
		const date = new Date().toISOString().slice(0, 10);
		const safeName = (conv?.name ?? "response").replace(
			/[\\/:*?"<>|]/g,
			"-"
		);

		// Determine default folder from template output_folder or scratch
		let defaultFolder = this.plugin.settings.scratchFolder;
		if (conv?.templateId) {
			const tplFile = this.app.vault.getAbstractFileByPath(conv.templateId);
			if (tplFile) {
				const tpl = await this.plugin.templateLoader.loadTemplate(
					tplFile as any
				);
				if (tpl?.outputFolder) defaultFolder = tpl.outputFolder;
			}
		}

		const defaultPath = `${defaultFolder}/${date}-${safeName}.md`;

		new InputModal(
			this.app,
			"Save response as note",
			"File path",
			defaultPath,
			async (filePath) => {
				const path = filePath.endsWith(".md")
					? filePath
					: filePath + ".md";
				try {
					await this.plugin.noteWriter.writeNote(lastResponse, path);
					new Notice(`Saved to ${path}`);
				} catch (e) {
					new Notice(
						`Save failed: ${e instanceof Error ? e.message : String(e)}`
					);
				}
			}
		).open();
	}

	private async sendMessage(): Promise<void> {
		if (this.isStreaming) return;
		if (!this.activeConversation) {
			new Notice(
				"No active conversation. Start one from the command palette."
			);
			return;
		}

		// Capture the conversation reference now so callbacks always write to the
		// correct conversation, even if the user switches mid-stream.
		const conv = this.activeConversation;

		const cap = this.plugin.settings.maxMessagesPerSession;
		if (cap > 0 && conv.messages.length >= cap) {
			new Notice(
				`Message limit reached (${cap}). Start a new conversation or raise the limit in Settings → Pythia.`
			);
			return;
		}

		const text = this.inputEl.value.trim();
		if (!text) return;

		this.inputEl.value = "";
		this.setStreamingState(true);

		// Save user message
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
		// Remove the "Start the conversation below." hint if still present
		this.messagesEl.querySelector(".pythia-empty")?.remove();
		await this.appendMessageBubble(userMsg);

		const attachedNotes = [...this.pendingAttachedNotes];
		this.pendingAttachedNotes = [];
		this.renderAttachedPills();

		// Streaming assistant bubble
		const { appendToken, finalize, bubbleCol: streamingBubbleCol } = this.createStreamingBubble();

		// Tool call handler — creates a status chip in the message area
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
						text: `Creating note: ${pathText}`,
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
							text: `✓ Created [[${noteName}]]`,
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
				// Reset the button immediately so the user can type again while
				// the markdown render and persistence happen in the background.
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
					// Wire the star button only when conv is still the displayed conversation
					const rows = this.messagesEl.querySelectorAll(".pythia-message-assistant");
					const lastRow = rows[rows.length - 1] as HTMLElement | null;
					if (lastRow && !lastRow.getAttribute("data-msg-id")) {
						lastRow.setAttribute("data-msg-id", assistantMsg.id);
						if (this.activeConversation?.id === conv.id) {
							const footer = streamingBubbleCol.createDiv({ cls: "pythia-bubble-footer" });
							const star = footer.createEl("button", {
								cls: "pythia-star",
								text: "☆",
								attr: { title: "Add to favorites" },
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

					// Auto-title: after the first exchange, replace the default
					// date-based name with a short LLM-generated title.
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

					// Generate chapter name for the user message (fire-and-forget)
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
				}			},
			(error) => {
				const errClass = classifyApiError(error);
				const model = conv.model ?? "";
				let msg: string;
				switch (errClass) {
					case "model_not_found":
						msg = `Model "${model}" not found. Open settings to change it.`;
						break;
					case "invalid_key":
						msg = "API key rejected. Check Settings → Pythia.";
						break;
					case "rate_limit":
						msg = "Rate limit hit. Try again in a moment.";
						break;
					case "network":
						msg = "Network error. Check your internet connection.";
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

	// ──────────────────────────────────────────────
	// Selection toolbar
	// ──────────────────────────────────────────────

	private handleSelectionChange(): void {
		const sel = window.getSelection();
		const text = sel?.toString().trim() ?? "";

		if (!text || !sel || sel.rangeCount === 0) {
			this.selectionToolbar.style.display = "none";
			return;
		}

		// Only show toolbar when selection is inside the messages area
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
			new Notice("Copied");
			this.selectionToolbar.style.display = "none";
		}).catch(() => {
			new Notice("Copy failed");
		});
	}

	private onInsertIntoNote(): void {
		const text = window.getSelection()?.toString() ?? "";
		if (!text) return;
		const view = this.lastMarkdownView
			?? this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice("No active note to insert into.");
			return;
		}
		let insertion = text;
		if (this.activeConversation) {
			const conv = this.activeConversation;
			const vault = encodeURIComponent(this.app.vault.getName());
			const uri = `obsidian://pythia?vault=${vault}&action=resume&id=${encodeURIComponent(conv.id)}`;
			insertion += `\n\n[↗ ${conv.name}](${uri})`;
		}
		view.editor.replaceSelection(insertion);
		this.selectionToolbar.style.display = "none";
		new Notice("Inserted into note");
	}

	private async onSaveToInbox(): Promise<void> {
		const text = window.getSelection()?.toString() ?? "";
		if (!text) return;
		const inboxPath = this.plugin.settings.inboxNote || "Pythia/Inbox.md";
		let entry = text;
		if (this.activeConversation) {
			const conv = this.activeConversation;
			const vault = encodeURIComponent(this.app.vault.getName());
			const uri = `obsidian://pythia?vault=${vault}&action=resume&id=${encodeURIComponent(conv.id)}`;
			entry += `\n\n[↗ ${conv.name}](${uri})`;
		}
		try {
			await this.plugin.noteWriter.prependToInbox(entry, inboxPath);
			this.selectionToolbar.style.display = "none";
			new Notice("Saved to inbox");
		} catch (e) {
			new Notice(`Failed to save to inbox: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private setStreamingState(streaming: boolean): void {
		this.isStreaming = streaming;
		if (streaming) {
			this.autoScroll = true;
			this.sendBtn.setText("Anfrage abbrechen");
			this.sendBtn.removeClass("pythia-btn-primary");
			this.sendBtn.addClass("pythia-btn-danger");
		} else {
			this.sendBtn.setText("Senden");
			this.sendBtn.removeClass("pythia-btn-danger");
			this.sendBtn.addClass("pythia-btn-primary");
		}
		this.inputEl.disabled = streaming;
	}
}
