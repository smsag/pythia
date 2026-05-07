import {
	App,
	ItemView,
	MarkdownRenderer,
	Notice,
	WorkspaceLeaf,
} from "obsidian";
import type { Conversation, Message } from "./models/types";
import type PythiaPlugin from "./main";
import { ConversationSuggestModal } from "./suggest/ConversationSuggest";
import { NoteSuggestModal } from "./suggest/NoteSuggest";
import { InputModal } from "./suggest/InputModal";
import { ConversationSettingsModal } from "./suggest/ConversationSettingsModal";

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
	private attachedPillsEl!: HTMLElement;
	private messagesEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private stopBtn!: HTMLButtonElement;

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
		titleRow.createEl("span", {
			cls: "pythia-icon",
			text: "🤖",
		});
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

		// ── Messages ─────────────────────────────
		this.messagesEl = container.createDiv({ cls: "pythia-messages" });

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
			attr: { placeholder: "Type a message… (Ctrl+Enter to send)" },
		});
		this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
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
			await this.appendMessageBubble(msg.role, msg.content);
		}
		this.scrollToBottom();
	}

	private async appendMessageBubble(
		role: "user" | "assistant",
		content: string
	): Promise<HTMLElement> {
		const row = this.messagesEl.createDiv({
			cls: `pythia-message pythia-message-${role}`,
		});
		const bubble = row.createDiv({ cls: "pythia-bubble" });
		await MarkdownRenderer.render(
			this.app,
			content,
			bubble,
			"",
			this
		);
		return bubble;
	}

	/** Create a streaming bubble. Returns helpers to append tokens and finalize. */
	private createStreamingBubble(): {
		appendToken: (text: string) => void;
		finalize: (fullText: string) => Promise<void>;
	} {
		const row = this.messagesEl.createDiv({
			cls: "pythia-message pythia-message-assistant",
		});
		const bubble = row.createDiv({ cls: "pythia-bubble pythia-streaming" });
		const textNode = document.createTextNode("");
		bubble.appendChild(textNode);

		return {
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
			const tpl = await this.plugin.templateLoader.loadTemplate(
				this.app.vault.getAbstractFileByPath(conv.templateId) as any
			);
			if (tpl?.outputFolder) defaultFolder = tpl.outputFolder;
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

		const cap = this.plugin.settings.maxMessagesPerSession;
		if (cap > 0 && this.activeConversation.messages.length >= cap) {
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
		this.activeConversation.messages.push(userMsg);
		await this.appendMessageBubble("user", text);

		const attachedNotes = [...this.pendingAttachedNotes];
		this.pendingAttachedNotes = [];
		this.renderAttachedPills();

		// Streaming assistant bubble
		const { appendToken, finalize } = this.createStreamingBubble();

		await this.plugin.llmRouter.streamMessage(
			this.activeConversation,
			text,
			attachedNotes,
			appendToken,
			async (fullText) => {
				await finalize(fullText);

				if (fullText) {
					const assistantMsg: Message = {
						id: crypto.randomUUID(),
						role: "assistant",
						content: fullText,
						timestamp: new Date().toISOString(),
					};
					this.activeConversation!.messages.push(assistantMsg);
					await this.plugin.conversationStore.save(
						this.activeConversation!
					);
				}

				this.setStreamingState(false);
			},
			(error) => {
				new Notice(`Pythia error: ${error.message}`);
				this.setStreamingState(false);
			}
		);
	}

	private setStreamingState(streaming: boolean): void {
		this.isStreaming = streaming;
		this.sendBtn.style.display = streaming ? "none" : "";
		this.stopBtn.style.display = streaming ? "" : "none";
		this.inputEl.disabled = streaming;
	}
}
