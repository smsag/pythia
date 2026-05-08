import {
	App,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	WorkspaceLeaf,
} from "obsidian";
import type { Conversation, Favorite, Message, TokenUsage } from "./models/types";
import type PythiaPlugin from "./main";
import { ConversationSuggestModal } from "./suggest/ConversationSuggest";
import { NoteSuggestModal } from "./suggest/NoteSuggest";
import { InputModal } from "./suggest/InputModal";
import { ConversationSettingsModal } from "./suggest/ConversationSettingsModal";
import { classifyApiError } from "./services/apiError";

export const PYTHIA_VIEW_TYPE = "pythia";

export class PythiaSidebarView extends ItemView {
	private plugin: PythiaPlugin;
	private activeConversation: Conversation | null = null;
	private isStreaming = false;
	private pendingAttachedNotes: string[] = [];

	// DOM elements
	private convNameEl!: HTMLElement;
	private templateLabelEl!: HTMLElement;
	private modelBadgeEl!: HTMLButtonElement;
	private contextPillsEl!: HTMLElement;
	private favoritesPillsEl!: HTMLElement;
	private favoritesSectionEl!: HTMLElement;
	private attachedPillsEl!: HTMLElement;
	private messagesEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private stopBtn!: HTMLButtonElement;
	private selectionToolbar!: HTMLElement;
	private onSelectionChange!: () => void;
	private lastMarkdownView: MarkdownView | null = null;

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
		this.renderHeader();
		this.updateModelBadge();
		this.renderContextPills();
		this.renderFavoritesBar();
		await this.renderMessages();
		if (focus) this.inputEl?.focus();
	}

	getActiveConversation(): Conversation | null {
		return this.activeConversation;
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

		// ── Messages ─────────────────────────────
		this.messagesEl = container.createDiv({ cls: "pythia-messages" });
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

		// Wire selection detection
		this.onSelectionChange = () => this.handleSelectionChange();
		document.addEventListener("selectionchange", this.onSelectionChange);
		this.messagesEl.addEventListener("mouseup", () =>
			setTimeout(() => this.handleSelectionChange(), 10)
		);
		this.messagesEl.addEventListener("touchend", () =>
			setTimeout(() => this.handleSelectionChange(), 300)
		);
		// ── Input area ───────────────────────────
		const inputArea = container.createDiv({ cls: "pythia-input-area" });

		// Pending attached notes row
		const attachRow = inputArea.createDiv({ cls: "pythia-attach-row" });
		this.attachedPillsEl = attachRow.createDiv({
			cls: "pythia-pills pythia-attached-pills",
		});

		// Textarea
		this.inputEl = inputArea.createEl("textarea", {
			cls: "pythia-input",
			attr: { placeholder: "Type a message… (Enter to send, Shift+Enter for new line)" },
		});
		this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		});

		// Buttons row
		const btnRow = inputArea.createDiv({ cls: "pythia-btn-row" });

		const attachBtn = btnRow.createEl("button", {
			cls: "pythia-btn",
			text: "Attach note",
		});
		attachBtn.addEventListener("click", () => this.onAttachNote());

		this.sendBtn = btnRow.createEl("button", {
			cls: "pythia-btn pythia-btn-primary",
			text: "Send",
		});
		this.sendBtn.addEventListener("click", () => this.sendMessage());

		this.stopBtn = btnRow.createEl("button", {
			cls: "pythia-btn pythia-btn-danger",
			text: "Stop",
		});
		this.stopBtn.style.display = "none";
		this.stopBtn.addEventListener("click", () => {
			this.plugin.llmRouter.abort();
		});

		const saveBtn = btnRow.createEl("button", {
			cls: "pythia-btn",
			text: "Save response",
		});
		saveBtn.addEventListener("click", () => this.onSaveResponse());
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
			const star = bubble.createEl("button", {
				cls: `pythia-star${isFav ? " pythia-star-active" : ""}`,
				text: isFav ? "★" : "☆",
				attr: { title: isFav ? "Remove from favorites" : "Add to favorites" },
			});
			star.addEventListener("click", () => this.onStarClick(msg, star));
			if (msg.tokenUsage) this.renderTokenCount(bubbleCol, msg.tokenUsage);
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
				this.scrollToBottom();
			},
		};
	}

	private scrollToBottom(): void {
		this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
	}

	// ──────────────────────────────────────────────
	// Favorites
	// ──────────────────────────────────────────────

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
		el.setText(`↑${fmt(usage.inputTokens)} ↓${fmt(usage.outputTokens)}`);
		el.title = `Input: ${fmt(usage.inputTokens)} tokens · Output: ${fmt(usage.outputTokens)} tokens`;
	}

	private scrollToMessage(messageId: string): void {
		const row = this.messagesEl.querySelector(
			`[data-msg-id="${messageId}"]`
		) as HTMLElement | null;
		row?.scrollIntoView({ behavior: "smooth", block: "center" });
	}

	// ──────────────────────────────────────────────
	// Event handlers
	// ──────────────────────────────────────────────

	private updateModelBadge(): void {
		if (!this.activeConversation) {
			this.modelBadgeEl.style.display = "none";
			return;
		}
		const provider = this.activeConversation.provider ?? "anthropic";
		const model = this.activeConversation.model ?? "";
		const providerLabel = provider === "openai" ? "OpenAI" : "Anthropic";
		this.modelBadgeEl.setText(`${model} · ${providerLabel}`);
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

	private onAttachNote(): void {
		new NoteSuggestModal(this.app, (file) => {
			if (!this.pendingAttachedNotes.includes(file.path)) {
				this.pendingAttachedNotes.push(file.path);
				this.renderAttachedPills();
			}
		}).open();
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
		await this.appendMessageBubble(userMsg);

		const attachedNotes = [...this.pendingAttachedNotes];
		this.pendingAttachedNotes = [];
		this.renderAttachedPills();

		// Streaming assistant bubble
		const { appendToken, finalize, bubbleCol: streamingBubbleCol } = this.createStreamingBubble();

		await this.plugin.llmRouter.streamMessage(
			conv,
			text,
			attachedNotes,
			appendToken,
			async (fullText, tokenUsage) => {
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
							const bubbleEl = streamingBubbleCol.querySelector(".pythia-bubble") as HTMLElement | null;
							const star = (bubbleEl ?? streamingBubbleCol).createEl("button", {
								cls: "pythia-star",
								text: "☆",
								attr: { title: "Add to favorites" },
							});
							star.addEventListener("click", () =>
								this.onStarClick(assistantMsg, star)
							);
							if (tokenUsage) this.renderTokenCount(streamingBubbleCol, tokenUsage);
						}
					}
					await this.plugin.conversationStore.save(conv);
				}

				this.setStreamingState(false);
			},
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
			}
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

		// Position the toolbar above the selection
		const rect = range.getBoundingClientRect();
		const containerRect = this.containerEl.getBoundingClientRect();

		const top = rect.top - containerRect.top - 40;
		const left = Math.min(
			rect.left - containerRect.left + rect.width / 2 - 60,
			containerRect.width - 128
		);

		this.selectionToolbar.style.display = "flex";
		this.selectionToolbar.style.top = `${Math.max(4, top)}px`;
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
		view.editor.replaceSelection(text);
		this.selectionToolbar.style.display = "none";
		new Notice("Inserted into note");
	}

	private setStreamingState(streaming: boolean): void {
		this.isStreaming = streaming;
		this.sendBtn.style.display = streaming ? "none" : "";
		this.stopBtn.style.display = streaming ? "" : "none";
		this.inputEl.disabled = streaming;
	}
}
