import { Editor, Menu, Notice, Plugin, TFile, TFolder } from "obsidian";
import { PythiaSettings, PythiaSettingTab } from "./settings";
import { t } from "./i18n";
import type { Conversation, Provider, PythiaTemplate } from "./models/types";
import { getFilesInFolder, todayISO } from "./utils";
import { PythiaSidebarView, PYTHIA_VIEW_TYPE } from "./sidebar";
import { CommandHubModal } from "./suggest/CommandHubModal";
import { TemplateSuggestModal } from "./suggest/TemplateSuggest";
import { ConversationStore } from "./services/ConversationStore";
import { AppContainer } from "./appContainer";
import type { LLMRouter } from "./services/LLMRouter";
import type { TemplateLoader } from "./services/TemplateLoader";
import type { NoteWriter } from "./services/NoteWriter";
import type { ToolHandler } from "./services/ToolHandler";
import type { WebSearchService } from "./services/WebSearchService";
import type { PromptOptimizerService } from "./services/PromptOptimizerService";
import type { SecretStore } from "./services/SecretStore";
import type { PluginDataStore } from "./services/PluginDataStore";
import type { ConversationService } from "./services/ConversationService";
import type { ViewManager } from "./services/ViewManager";
import { IframeEmbeddingProvider } from "./services/embedding/host/iframeEmbeddingProvider";
import { ConversationIndexService } from "./services/embedding/ConversationIndexService";
import { VaultIndexStore } from "./services/embedding/vaultIndexStore";
import { DEFAULT_MIN_SCORE, type RelatedResult } from "./services/embedding/relatedConversations";
import type { EmbeddingModelId } from "./models/embeddingModels";

export default class PythiaPlugin extends Plugin {
	settings!: PythiaSettings;
	/** Decrypted API keys held only in memory — never written to disk as plaintext. */
	plaintextApiKey = "";
	plaintextOpenAIKey = "";
	plaintextMistralKey = "";
	plaintextSearchKey = "";

	// The composition root (ADR-103 / #122) owns the services; the plugin exposes
	// each as a getter so `plugin.llmRouter` etc. keep working with no call-site changes.
	container!: AppContainer;
	// ConversationStore is a direct field: it OWNS the conversation list and must
	// exist before AppContainer.create() runs loadPluginData (which writes to it).
	conversationStore!: ConversationStore;

	/** The ConversationStore owns the list; this is a read/write accessor (ADR-103 / #122). */
	get conversations(): Conversation[] { return this.conversationStore.getAll(); }
	set conversations(v: Conversation[]) { this.conversationStore.setAll(v); }

	get pluginDataStore(): PluginDataStore { return this.container?.pluginDataStore as PluginDataStore; }
	get secretStore(): SecretStore { return this.container?.secretStore as SecretStore; }
	get conversationService(): ConversationService { return this.container?.conversationService as ConversationService; }
	get viewManager(): ViewManager { return this.container?.viewManager as ViewManager; }
	get llmRouter(): LLMRouter { return this.container?.llmRouter as LLMRouter; }
	get templateLoader(): TemplateLoader { return this.container?.templateLoader as TemplateLoader; }
	get noteWriter(): NoteWriter { return this.container?.noteWriter as NoteWriter; }
	get webSearchService(): WebSearchService { return this.container?.webSearchService as WebSearchService; }
	get toolHandler(): ToolHandler { return this.container?.toolHandler as ToolHandler; }
	get promptOptimizerService(): PromptOptimizerService { return this.container?.promptOptimizerService as PromptOptimizerService; }

	// Related conversations (ADR-109): the embedding index service is built lazily on
	// first use, so the heavy model/iframe only loads when the feature is actually used.
	private relatedService: ConversationIndexService | null = null;
	private relatedProvider: IframeEmbeddingProvider | null = null;
	private relatedModelId: EmbeddingModelId | null = null;

	/** Conversations semantically related to `sourceId`, most-similar first (ADR-109). */
	async getRelatedConversations(sourceId: string): Promise<RelatedResult[]> {
		return this.ensureRelatedService().getRelated(sourceId, this.conversations, {
			minScore: DEFAULT_MIN_SCORE,
		});
	}

	private ensureRelatedService(): ConversationIndexService {
		const modelId = this.settings.embeddingModelId;
		if (this.relatedService && this.relatedModelId === modelId) return this.relatedService;
		// First use, or the model setting changed → tear down any prior provider/index.
		this.relatedProvider?.unload();
		new Notice(t("relatedFirstRun"));
		this.relatedProvider = new IframeEmbeddingProvider(modelId);
		this.relatedModelId = modelId;
		this.relatedService = new ConversationIndexService(
			this.relatedProvider,
			new VaultIndexStore(this, modelId)
		);
		return this.relatedService;
	}

	/** Drop the embedding service so the next use rebuilds with the current model. */
	invalidateRelatedService(): void {
		this.relatedProvider?.unload();
		this.relatedProvider = null;
		this.relatedService = null;
		this.relatedModelId = null;
	}

	async onload(): Promise<void> {
		// ConversationStore owns the conversation list and must exist before
		// AppContainer.create() runs loadPluginData (which writes conversations
		// through the plugin.conversations accessor → the store). The container
		// then loads data and constructs every remaining service in order.
		this.conversationStore = new ConversationStore(this);
		this.container = await AppContainer.create(this);

		this.registerView(
			PYTHIA_VIEW_TYPE,
			(leaf) => new PythiaSidebarView(leaf, this)
		);

		this.app.workspace.onLayoutReady(() => this.viewManager.initLeaf());

		// Watch data.json for external changes (iCloud/Obsidian Sync delivering
		// updates from another device while this instance is running).
		// When detected, reload from disk and refresh the sidebar.
		this.pluginDataStore.watchDataJson();

		this.addRibbonIcon("bot", "Pythia", () => this.activateView());
		this.addSettingTab(new PythiaSettingTab(this.app, this));

		this.addCommand({
			id: "new-conversation",
			name: t("cmdNewConversation"),
			icon: "bot",
			callback: () => this.cmdNewConversation(),
		});

		this.addCommand({
			id: "resume-conversation",
			name: t("cmdResumeConversation"),
			icon: "bot",
			callback: () => this.conversationService.cmdResumeConversation(),
		});

		this.addCommand({
			id: "hub",
			name: t("cmdHub"),
			icon: "bot",
			callback: () => new CommandHubModal(this.app, [
				{
					label: t("cmdNewConversationFromTemplate"),
					desc:   t("cmdNewConversationFromTemplateDesc"),
					action: () => this.conversationService.cmdNewConversationFromTemplate(),
				},
				{
					label: t("cmdNewConversationWithCurrentNote"),
					desc:   t("cmdNewConversationWithCurrentNoteDesc"),
					action: () => this.conversationService.cmdNewConversationWithCurrentNote(),
				},
				{
					label: t("cmdNewConversationFromClipboard"),
					desc:   t("cmdNewConversationFromClipboardDesc"),
					action: () => this.conversationService.cmdNewConversationFromClipboard(),
				},
				{
					label: t("cmdNewConversationFromPrompt"),
					desc:   t("cmdNewConversationFromPromptDesc"),
					action: () => this.promptOptimizerService.run(),
				},
				{
					label: t("cmdBrowseConversations"),
					desc:   t("cmdBrowseConversationsDesc"),
					action: () => this.conversationService.cmdBrowseConversations(),
				},
				{
					label: t("cmdBrowseFavorites"),
					desc:   t("cmdBrowseFavoritesDesc"),
					action: () => this.conversationService.cmdBrowseFavorites(),
				},
				{
					label: t("cmdSummarizeFavorites"),
					desc:   t("cmdSummarizeFavoritesDesc"),
					action: () => this.conversationService.cmdSummarizeFavorites(),
				},
				{
					label: t("cmdReloadConversations"),
					desc:   t("cmdReloadConversationsDesc"),
					action: () => this.pluginDataStore.reloadFromDisk(),
				},
			]).open(),
		});

		this.addCommand({
			id: "summarize-favorites",
			name: t("cmdSummarizeFavorites"),
			icon: "bot",
			callback: () => this.conversationService.cmdSummarizeFavorites(),
		});

		this.addCommand({
			id: "send-selection-to-pythia",
			name: t("sendSelectionToPythia"),
			icon: "bot",
			editorCallback: async (editor: Editor) => {
				const selection = editor.getSelection();
				if (!selection) return;
				const conv = await this.createConversation({ name: `Conversation ${todayISO()}` });
				const view = await this.activateView();
				await view.setActiveConversation(conv);
				view.triggerAutoPrompt(selection);
			},
		});

		this.addCommand({
			id: "send-selection-to-pythia-with-template",
			name: t("sendSelectionToPythiaWithTemplate"),
			icon: "bot",
			editorCallback: async (editor: Editor) => {
				const selection = editor.getSelection();
				if (!selection) return;
				const templates = await this.templateLoader.loadTemplates();
				if (templates.length === 0) {
					new Notice(t("noTemplatesFound", { folder: this.settings.templatesFolder }));
					return;
				}
				const activeFile = this.app.workspace.getActiveFile();
				new TemplateSuggestModal(this.app, templates, async (tpl) => {
					const { contextNotes, outputFolder } = this.conversationService.resolveTemplateContext(tpl, activeFile);
					const conv = await this.createConversationFromTemplate(tpl, contextNotes, outputFolder);
					const view = await this.activateView();
					await view.setActiveConversation(conv);
					view.triggerAutoPrompt(selection);
				}).open();
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file) => {
				if (file instanceof TFile) {
					menu.addItem((item) => {
						item
							.setTitle(t("chatAboutNote"))
							.setSection("open")
							.setIcon("bot")
							.onClick(async () => {
								const conv = await this.createConversation({
									name: `${file.basename} ${todayISO()}`,
								});
								const view = await this.activateView();
								await view.setActiveConversation(conv);
								view.attachNoteToInput(file.path);
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
								const conv = await this.createConversation({
									name: `${file.name} ${todayISO()}`,
								});
								const view = await this.activateView();
								await view.setActiveConversation(conv);
								for (const f of files) view.attachNoteToInput(f.path);
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
					const conv = await this.createConversation({ name: `Conversation ${todayISO()}` });
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
					await view.setActiveConversation(conv, true, "top");
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
					const conv = await this.createConversationFromTemplate(tpl);
					const view = await this.activateView();
					await view.setActiveConversation(conv);
					return;
				}

				if (action === "inject") {
					// Obsidian already decodes protocol-handler params — decoding again
					// throws on any text containing a bare "%" (e.g. "50% off").
					const rawText = params.text ?? "";
					if (!rawText) {
						new Notice(t("uriMissingText"));
						return;
					}
					const templates = await this.templateLoader.loadTemplates();
					if (templates.length === 0) {
						new Notice(t("noTemplatesFound", { folder: this.settings.templatesFolder }));
						return;
					}
					await this.activateView();
					new TemplateSuggestModal(this.app, templates, async (tpl) => {
						const conv = await this.createConversationFromTemplate(tpl);
						const view = await this.activateView();
						await view.setActiveConversation(conv);
						view.triggerAutoPrompt(rawText);
					}).open();
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
		// Flush any pending debounced save so the last conversation state
		// is written to disk before the plugin unloads.
		await this.conversationStore?.flush();
		this.llmRouter?.abort();
		this.relatedProvider?.unload();
	}

	// ── Facades delegating to the extracted services (ADR-103 / #121) ──────────
	// Public API kept stable for settings.ts, the sidebar controllers,
	// ConversationStore, PromptOptimizerService, and tests.

	setApiKey(secretName: string): Promise<void> { return this.secretStore.setApiKey(secretName); }
	setOpenAIKey(secretName: string): Promise<void> { return this.secretStore.setOpenAIKey(secretName); }
	setMistralKey(secretName: string): Promise<void> { return this.secretStore.setMistralKey(secretName); }
	setSearchKey(secretName: string): Promise<void> { return this.secretStore.setSearchKey(secretName); }
	hasApiKeyFor(provider: Provider): boolean { return this.secretStore.hasApiKeyFor(provider); }

	saveSettings(): Promise<void> { return this.pluginDataStore.saveSettings(); }
	saveConversations(): Promise<void> { return this.pluginDataStore.saveConversations(); }

	activateView(): Promise<PythiaSidebarView> { return this.viewManager.activateView(); }

	createConversation(opts: Parameters<ConversationService["createConversation"]>[0]): Promise<Conversation> {
		return this.conversationService.createConversation(opts);
	}
	createConversationFromTemplate(tpl: PythiaTemplate, contextNotes?: string[], outputFolder?: string): Promise<Conversation> {
		return this.conversationService.createConversationFromTemplate(tpl, contextNotes, outputFolder);
	}
	renameConversationFile(conv: Conversation): Promise<void> {
		return this.conversationService.renameConversationFile(conv);
	}
	cmdNewConversation(): Promise<void> {
		return this.conversationService.cmdNewConversation();
	}
	cmdForkConversation(sourceConvId: string, selectedText: string, forkedFromMessageId?: string, forkedFromOccurrenceIndex?: number): Promise<void> {
		return this.conversationService.cmdForkConversation(sourceConvId, selectedText, forkedFromMessageId, forkedFromOccurrenceIndex);
	}
}
