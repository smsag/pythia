import { Editor, Menu, Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, PythiaSettings, PythiaSettingTab } from "./settings";
import { t } from "./i18n";
import type { Conversation, Provider } from "./models/types";
import { getFilesInFolder, todayISO } from "./utils";
import { PythiaSidebarView, PYTHIA_VIEW_TYPE } from "./sidebar";
import { ConversationSuggestModal, FavoritesSuggestModal } from "./suggest/ConversationSuggest";
import { TemplateSuggestModal } from "./suggest/TemplateSuggest";
import { ResumeModeModal } from "./suggest/ResumeModeModal";
import { InputModal } from "./suggest/InputModal";
import { AnthropicService } from "./services/AnthropicService";
import { OpenAIProvider } from "./services/OpenAIProvider";
import { LLMRouter } from "./services/LLMRouter";
import { ConversationStore } from "./services/ConversationStore";
import { TemplateLoader } from "./services/TemplateLoader";
import { NoteWriter } from "./services/NoteWriter";

export default class PythiaPlugin extends Plugin {
	settings!: PythiaSettings;
	conversations!: Conversation[];
	/** Decrypted API keys held only in memory — never written to disk as plaintext. */
	plaintextApiKey = "";
	plaintextOpenAIKey = "";

	llmRouter!: LLMRouter;
	conversationStore!: ConversationStore;
	templateLoader!: TemplateLoader;
	noteWriter!: NoteWriter;

	async onload(): Promise<void> {
		await this.loadPluginData();

		const anthropicSvc = new AnthropicService(this.app, this.settings, this.plaintextApiKey);
		const openaiSvc = new OpenAIProvider(this.app, this.settings, this.plaintextOpenAIKey);
		this.llmRouter = new LLMRouter(anthropicSvc, openaiSvc);
		this.conversationStore = new ConversationStore(this);
		this.templateLoader = new TemplateLoader(this.app, this.settings);
		this.noteWriter = new NoteWriter(this.app, this.settings);

		this.registerView(
			PYTHIA_VIEW_TYPE,
			(leaf) => new PythiaSidebarView(leaf, this)
		);

		this.app.workspace.onLayoutReady(() => this.initLeaf());

		this.addRibbonIcon("bot", "Pythia", () => this.activateView());
		this.addSettingTab(new PythiaSettingTab(this.app, this));

		this.addCommand({
			id: "open-sidebar",
			name: "Open sidebar",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "new-conversation",
			name: "New conversation",
			callback: () => this.cmdNewConversation(),
		});

		this.addCommand({
			id: "new-conversation-from-template",
			name: "New conversation from template",
			callback: () => this.cmdNewConversationFromTemplate(),
		});

		this.addCommand({
			id: "new-conversation-with-current-note",
			name: "New conversation with current note",
			callback: () => this.cmdNewConversationWithCurrentNote(),
		});

		this.addCommand({
			id: "resume-conversation",
			name: "Resume conversation",
			callback: () => this.cmdResumeConversation(),
		});

		this.addCommand({
			id: "browse-conversations",
			name: "Browse conversations",
			callback: () => this.cmdBrowseConversations(),
		});

		this.addCommand({
			id: "browse-favorites",
			name: "Browse favorites",
			callback: () => this.cmdBrowseFavorites(),
		});

		this.addCommand({
			id: "save-response-as-note",
			name: "Save response as note",
			callback: () => this.cmdSaveResponseAsNote(),
		});

		this.addCommand({
			id: "open-in-left-sidebar",
			name: "Open in left sidebar",
			callback: () => this.activateInLeftSidebar(),
		});

		this.addCommand({
			id: "new-conversation-from-clipboard",
			name: "New conversation from clipboard",
			callback: () => this.cmdNewConversationFromClipboard(),
		});

		this.addCommand({
			id: "delete-conversation",
			name: "Delete current conversation",
			callback: () => this.cmdDeleteConversation(),
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
				const selection = editor.getSelection();
				if (!selection) return;
				menu.addItem((item) => {
					item
						.setTitle(t("sendToPythia"))
						.setIcon("bot")
						.onClick(async () => {
							const conv = await this.createConversation(
								`Conversation ${todayISO()}`
							);
							const view = await this.activateView();
							await view.setActiveConversation(conv);
							view.prefillInput(selection);
						});
				});
			})
		);

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file) => {
				if (file instanceof TFile) {
					menu.addItem((item) => {
						item
							.setTitle(t("chatAboutNote"))
							.setSection("open")
							.setIcon("bot")
							.onClick(async () => {
								const conv = await this.createConversation(
									`${file.basename} ${todayISO()}`,
									"",
									[]
								);
								const view = await this.activateView();
								await view.setActiveConversation(conv);
								view.attachNoteToInput(file.path);
								void this.app.vault.read(file).then((content) =>
									this.generateAndInjectSummary(conv, content.slice(0, 20000))
								);
							});
					});
				} else if (file instanceof TFolder) {
					menu.addItem((item) => {
						item
							.setTitle(t("chatAboutFolder"))
							.setSection("open")
							.setIcon("bot")
							.onClick(async () => {
								const files = getFilesInFolder(file);
								if (files.length === 0) {
									new Notice(t("noMarkdownInFolder"));
									return;
								}
								const conv = await this.createConversation(
									`${file.name} ${todayISO()}`,
									"",
									[]
								);
								const view = await this.activateView();
								await view.setActiveConversation(conv);
								for (const f of files) view.attachNoteToInput(f.path);
								;(async () => {
									const CAP = 20000;
									let combined = "";
									for (const f of files) {
										if (combined.length >= CAP) break;
										combined += `# [[${f.basename}]]\n${await this.app.vault.read(f)}\n\n`;
									}
									void this.generateAndInjectSummary(conv, combined.slice(0, CAP));
								})();
							});
					});
				}
			})
		);

		// obsidian://pythia deep-link handler — Obsidian does not await async
		// protocol handlers, so errors would be silently swallowed without try/catch.
		this.registerObsidianProtocolHandler("pythia", async (params) => {
			try {
			const action = params.cmd ?? "open";

				if (action === "open") {
					await this.activateView();
					return;
				}

					if (action === "new") {
					const conv = await this.createConversation(`Conversation ${todayISO()}`);
					const view = await this.activateView();
					await view.setActiveConversation(conv);
					return;
				}

				if (action === "resume") {
					if (!params.id) {
						new Notice(t("uriMissingId"));
						return;
					}
					const conv = this.conversationStore.getById(params.id);
					if (!conv) {
						new Notice(t("convNotFound", { id: params.id }));
						return;
					}
					const view = await this.activateView();
					await view.setActiveConversation(conv);
					return;
				}

				if (action === "template") {
					if (!params.name) {
						new Notice(t("uriMissingName"));
						return;
					}
					const templates = await this.templateLoader.loadTemplates();
					const tpl = templates.find((tpl) => tpl.name === params.name);
					if (!tpl) {
						new Notice(t("templateNotFound", { name: params.name }));
						return;
					}
					const conv = await this.createConversation(
						`${tpl.name} ${todayISO()}`,
						tpl.systemPrompt,
						[...tpl.contextNotes],
						tpl.id,
						tpl.provider,
						tpl.model,
						tpl.maxTokens
					);
					if (tpl.resumeMode) conv.resumeMode = tpl.resumeMode;
					await this.conversationStore.save(conv);
					const view = await this.activateView();
					await view.setActiveConversation(conv);
					return;
				}

					new Notice(t("unknownAction", { action }));
			} catch (err) {
				new Notice(t("deepLinkError", { error: err instanceof Error ? err.message : String(err) }));
				console.error("[Pythia] protocol handler error", err);
			}
		});
	}

	async onunload(): Promise<void> {
		await this.conversationStore.flush();
		this.llmRouter.abort();
	}

	private async loadPluginData(): Promise<void> {
		const data = (await this.loadData()) ?? {};
		const saved = data.settings ?? {};
		let needsMigrationSave = false;

		// ── Migration: old plaintext apiKey field ─────────────────────────────
		if (saved.apiKey) {
			delete saved.apiKey;
			needsMigrationSave = true;
		}

		// ── Migration: defaultModel → defaultAnthropicModel ──────────────────
		if (saved.defaultModel && !saved.defaultAnthropicModel) {
			saved.defaultAnthropicModel = saved.defaultModel;
			delete saved.defaultModel;
			needsMigrationSave = true;
		}

		// ── Migration: encryptedApiKey → Obsidian SecretStorage ───────────────
		if (saved.encryptedApiKey) {
			const plaintext = legacyDecrypt(saved.encryptedApiKey as string);
			if (plaintext) {
				this.app.secretStorage.setSecret(
					DEFAULT_SETTINGS.anthropicSecretName,
					plaintext
				);
			} else {
				new Notice(t("migrateAnthropicFailed"), 8000);
			}
			delete saved.encryptedApiKey;
			needsMigrationSave = true;
		}

		// ── Migration: encryptedOpenAIKey → Obsidian SecretStorage ────────────
		if (saved.encryptedOpenAIKey) {
			const plaintext = legacyDecrypt(saved.encryptedOpenAIKey as string);
			if (plaintext) {
				this.app.secretStorage.setSecret(
					DEFAULT_SETTINGS.openaiSecretName,
					plaintext
				);
			} else {
				new Notice(t("migrateOpenAIFailed"), 8000);
			}
			delete saved.encryptedOpenAIKey;
			needsMigrationSave = true;
		}

		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		const rawConversations = (data.conversations ?? []) as unknown[];
		this.conversations = rawConversations.filter(
			(c): c is Conversation =>
				c !== null &&
				typeof c === "object" &&
				typeof (c as Record<string, unknown>).id === "string" &&
				Array.isArray((c as Record<string, unknown>).messages)
		);
		if (this.conversations.length < rawConversations.length) {
			console.warn(
				`[Pythia] Dropped ${
					rawConversations.length - this.conversations.length
				} malformed conversation(s) from data.json`
			);
		}

		this.plaintextApiKey =
			this.app.secretStorage.getSecret(this.settings.anthropicSecretName) ?? "";
		this.plaintextOpenAIKey =
			this.app.secretStorage.getSecret(this.settings.openaiSecretName) ?? "";

		if (needsMigrationSave) {
			await this.saveData({ settings: this.settings, conversations: this.conversations });
		}
	}

	/** Update the Anthropic API key reference and refresh the in-memory key from SecretStorage. */
	async setApiKey(secretName: string): Promise<void> {
		this.settings.anthropicSecretName = secretName;
		await this.persistData();
		this.plaintextApiKey = this.app.secretStorage.getSecret(secretName) ?? "";
		this.llmRouter?.updateApiKey("anthropic", this.plaintextApiKey);
	}

	/** Update the OpenAI API key reference and refresh the in-memory key from SecretStorage. */
	async setOpenAIKey(secretName: string): Promise<void> {
		this.settings.openaiSecretName = secretName;
		await this.persistData();
		this.plaintextOpenAIKey = this.app.secretStorage.getSecret(secretName) ?? "";
		this.llmRouter?.updateApiKey("openai", this.plaintextOpenAIKey);
	}

	async saveSettings(): Promise<void> {
		await this.persistData();
		this.templateLoader?.updateSettings(this.settings);
		this.noteWriter?.updateSettings(this.settings);
	}

	async saveConversations(): Promise<void> {
		await this.persistData();
	}

	private async persistData(): Promise<void> {
		await this.saveData({
			settings: this.settings,
			conversations: this.conversations,
		});
	}

	/** Called once on layout-ready. Creates the sidebar leaf on first install
	 *  (or after the user manually closed the tab). Obsidian then persists the
	 *  leaf in its workspace layout, so subsequent launches restore it without
	 *  hitting this branch.
	 *
	 *  We use iterateAllLeaves instead of getLeavesOfType because during a
	 *  hot-reload (BRAT update) the existing leaf's view hasn't been
	 *  re-instantiated yet, so getLeavesOfType returns 0 and a second leaf
	 *  would be created. iterateAllLeaves inspects the raw view-state type,
	 *  which is always present. Any extras accumulated from previous
	 *  hot-reloads are detached here to keep the sidebar clean. */
	private initLeaf(): void {
		const { workspace } = this.app;
		const existing: WorkspaceLeaf[] = [];
		workspace.iterateAllLeaves((leaf) => {
			if (leaf.getViewState().type === PYTHIA_VIEW_TYPE) {
				existing.push(leaf);
			}
		});
		// Deduplicate: keep the first, detach any extras from hot-reloads.
		for (let i = 1; i < existing.length; i++) {
			existing[i].detach();
		}
		if (existing.length >= 1) return;
		workspace.getRightLeaf(false)?.setViewState({ type: PYTHIA_VIEW_TYPE });
	}

	async activateView(): Promise<PythiaSidebarView> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(PYTHIA_VIEW_TYPE)[0] as
			| WorkspaceLeaf
			| undefined;
		if (!leaf || !(leaf.view instanceof PythiaSidebarView)) {
			// false = reuse the existing right-sidebar split rather than
			// creating a new horizontal split (which would produce a second icon).
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: PYTHIA_VIEW_TYPE, active: true });
		}
		workspace.revealLeaf(leaf);
		return leaf.view as PythiaSidebarView;
	}

	private async activateInLeftSidebar(): Promise<PythiaSidebarView> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(PYTHIA_VIEW_TYPE)[0] as
			| WorkspaceLeaf
			| undefined;
		if (!leaf) {
			leaf = workspace.getLeftLeaf(false) ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: PYTHIA_VIEW_TYPE, active: true });
		}
		workspace.revealLeaf(leaf);
		return leaf.view as PythiaSidebarView;
	}

	private getSidebarView(): PythiaSidebarView | null {
		const leaf = this.app.workspace.getLeavesOfType(PYTHIA_VIEW_TYPE)[0];
		return leaf ? (leaf.view as PythiaSidebarView) : null;
	}

	private async generateAndInjectSummary(conv: Conversation, content: string): Promise<void> {
		try {
			const summary = await this.llmRouter.summarizeNotes(content, conv.provider);
			if (summary) {
				conv.summaryText = summary;
				await this.conversationStore.save(conv);
				const view = this.getSidebarView();
				if (view?.getActiveConversation()?.id === conv.id) {
					await view.setActiveConversation(conv, false);
				}
			}
		} catch (e) {
			new Notice(t("summaryGenerationFailed", { error: e instanceof Error ? e.message : String(e) }));
		}
	}

	async createConversation(
		name: string,
		systemPrompt = "",
		contextNotes: string[] = [],
		templateId?: string,
		provider?: Provider,
		model?: string,
		maxTokens?: number
	): Promise<Conversation> {
		const resolvedProvider = provider ?? this.settings.defaultProvider;
		const resolvedModel = model ?? (
			resolvedProvider === "openai"
				? this.settings.defaultOpenAIModel
				: this.settings.defaultAnthropicModel
		);

		const conv: Conversation = {
			id: crypto.randomUUID(),
			name,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			templateId,
			systemPrompt,
			contextNotes,
			resumeMode: this.settings.defaultResumeMode,
			provider: resolvedProvider,
			model: resolvedModel,
			maxTokens,
			messages: [],
		};
		this.conversations.push(conv);
		await this.saveConversations();
		return conv;
	}

	async cmdDeleteConversation(): Promise<void> {
		const view = this.getSidebarView();
		if (!view) return;
		await view.handleDeleteConversation();
	}

	async cmdNewConversation(): Promise<void> {
		const conv = await this.createConversation(`Conversation ${todayISO()}`);
		const view = await this.activateView();
		await view.setActiveConversation(conv);
	}

	private async cmdNewConversationFromTemplate(): Promise<void> {
		const templates = await this.templateLoader.loadTemplates();
		if (templates.length === 0) {
			new Notice(t("noTemplatesFound", { folder: this.settings.templatesFolder }));
			return;
		}

		new TemplateSuggestModal(this.app, templates, async (tpl) => {
			const conv = await this.createConversation(
				`${tpl.name} ${todayISO()}`,
				tpl.systemPrompt,
				[...tpl.contextNotes],
				tpl.id,
				tpl.provider,
				tpl.model,
				tpl.maxTokens
			);
			if (tpl.resumeMode) conv.resumeMode = tpl.resumeMode;
			await this.conversationStore.save(conv);

			const view = await this.activateView();
			await view.setActiveConversation(conv);

			if (tpl.contextNotes.length > 0) {
				new Notice(t("loadedTemplate", { name: tpl.name, count: String(tpl.contextNotes.length) }));
			}
		}).open();
	}

	private async cmdNewConversationWithCurrentNote(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice(t("noActiveNoteForCommand"));
			return;
		}

		const conv = await this.createConversation(
			`${activeFile.basename} ${todayISO()}`,
			"",
			[activeFile.path]
		);
		const view = await this.activateView();
		await view.setActiveConversation(conv);
		new Notice(t("attachedAsContext", { name: activeFile.name }));
	}

	private async cmdNewConversationFromClipboard(): Promise<void> {
		let text: string;
		try {
			text = await navigator.clipboard.readText();
		} catch {
			new Notice(t("clipboardReadFailed"));
			return;
		}
		text = text.trim();
		if (!text) {
			new Notice(t("clipboardEmpty"));
			return;
		}
		const conv = await this.createConversation(`Conversation ${todayISO()}`);
		const view = await this.activateView();
		await view.setActiveConversation(conv);
		view.prefillInput(text);
	}

	async cmdForkConversation(sourceConvId: string, selectedText: string): Promise<void> {
		const source = this.conversationStore.getById(sourceConvId);
		if (!source) return;

		const conv = await this.createConversation(
			`Fork of ${source.name}`,
			source.systemPrompt,
			[],
			source.templateId,
			source.provider,
			source.model,
			source.maxTokens,
		);
		conv.forkedFromId = sourceConvId;
		await this.saveConversations();

		if (!source.summaryText && source.messages.length > 0) {
			this.llmRouter.generateSummary(source).then(async (summary) => {
				if (summary) {
					source.summaryText = summary;
					await this.saveConversations();
					const view = this.getSidebarView();
					if (view?.getActiveConversationId() === conv.id) {
						await view.renderForkBanner();
					}
				}
			}).catch((e) => {
				new Notice(t("forkSummaryFailed", { error: e instanceof Error ? e.message : String(e) }));
			});
		}

		const view = await this.activateView();
		await view.setActiveConversation(conv);
		view.prefillInput(selectedText);
	}

	private async cmdBrowseConversations(): Promise<void> {
		if (this.conversations.length === 0) {
			new Notice(t("noConversations"));
			return;
		}

		new ConversationSuggestModal(
			this.app,
			this.conversations,
			async (conv) => {
				const view = await this.activateView();
				await view.setActiveConversation(conv);
			}
		).open();
	}

	private async cmdBrowseFavorites(): Promise<void> {
		const hasFavorites = this.conversations.some(
			(c) => (c.favorites?.length ?? 0) > 0
		);
		if (!hasFavorites) {
			new Notice(t("noFavorites"));
			return;
		}

		new FavoritesSuggestModal(
			this.app,
			this.conversations,
			async (conv, messageId) => {
				const view = await this.activateView();
				await view.setActiveConversation(conv);
				view.scrollToMessage(messageId);
			}
		).open();
	}

	private async cmdResumeConversation(): Promise<void> {
		if (this.conversations.length === 0) {
			new Notice(t("noPastConversations"));
			return;
		}

		new ConversationSuggestModal(
			this.app,
			this.conversations,
			(conv) => {
				new ResumeModeModal(this.app, conv, async (mode) => {
					conv.resumeMode = mode;

					if (mode === "summary") {
						if (!conv.summaryText) {
							const hasKey =
								conv.provider === "openai"
									? !!this.plaintextOpenAIKey
									: !!this.plaintextApiKey;
							if (!hasKey) {
								new Notice(t("setApiKeyFirst"));
								return;
							}
							const notice = new Notice(t("generatingConvSummary"), 0);
							try {
								conv.summaryText =
									await this.llmRouter.generateSummary(conv);
								conv.messages = [];
								await this.conversationStore.save(conv);
								notice.hide();
							} catch (e) {
								notice.hide();
								new Notice(t("summaryGenerationFailed", { error: e instanceof Error ? e.message : String(e) }));
								return;
							}
						}
					}

					await this.conversationStore.save(conv);
					const view = await this.activateView();
					await view.setActiveConversation(conv);
				}).open();
			}
		).open();
	}

	private async cmdSaveResponseAsNote(): Promise<void> {
		const view = this.getSidebarView();
		const conv = view?.getActiveConversation();
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

		let defaultFolder = this.settings.scratchFolder;
		if (conv.templateId) {
			const tplFile = this.app.vault.getAbstractFileByPath(conv.templateId);
			if (tplFile instanceof TFile) {
				const tpl = await this.templateLoader.loadTemplate(tplFile);
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
					await this.noteWriter.appendConversationSlice(slice, path, conv.id);
					conv.savedNotePath = path;
					conv.lastSavedMessageCount = conv.messages.length;
					await this.conversationStore.save(conv);
					new Notice(t("savedToPath", { path }));

					if (this.settings.autoSaveSummary) {
						const summary = conv.summaryText
							? conv.summaryText
							: `Conversation: ${conv.name}`;
						const summaryPath = await this.noteWriter.saveSummaryNote(
							conv,
							summary,
							path
						);
						conv.summaryNote = summaryPath;
						await this.conversationStore.save(conv);
					}
				} catch (e) {
					new Notice(t("saveFailed", { error: e instanceof Error ? e.message : String(e) }));
				}
			}
		).open();
	}
}

/**
 * One-time migration helper: decrypts a value that was previously stored by
 * the old SecureStorage implementation (Electron safeStorage or plain: prefix).
 * Used only during the migration path in loadPluginData() — not for any
 * ongoing encryption/decryption.
 */
function legacyDecrypt(stored: string): string {
	if (!stored) return "";

	if (stored.startsWith("enc:")) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const electron = (window as any).require?.("electron");
			const ss = electron?.safeStorage;
			if (ss?.isEncryptionAvailable()) {
				const buf = Buffer.from(stored.slice(4), "base64");
				return ss.decryptString(buf) as string;
			}
		} catch {
			// safeStorage unavailable or decryption failed
		}
		return "";
	}

	if (stored.startsWith("plain:")) return stored.slice(6);

	// Legacy: raw plaintext with no prefix
	return stored;
}
