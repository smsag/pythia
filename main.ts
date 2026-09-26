import { CHART_BLOCK_LANG } from "./services/chartSpec";
import { renderChartCard } from "./ui/chart/card";
import { Menu, Notice, Platform, Plugin, TFile, TFolder } from "obsidian";
import { PythiaSettings, PythiaSettingTab } from "./settings";
import { t } from "./i18n";
import { debugLog } from "./services/messageUtils";
import type { Conversation, Provider, PythiaTemplate } from "./models/types";
import { getFilesInFolder, todayISO } from "./utils";
import { PythiaSidebarView, PYTHIA_VIEW_TYPE } from "./sidebar";
import { PYTHIA_ICON_ID, registerPythiaIcon } from "./ui/pluginIcon";
import { registerEditorSelectionEntries } from "./ui/editorSelectionEntries";
import { CommandHubModal } from "./suggest/CommandHubModal";
import { TemplateSuggestModal } from "./suggest/TemplateSuggest";
import { ConversationStore } from "./services/ConversationStore";
import { AppContainer } from "./appContainer";
import type { LLMRouter } from "./services/LLMRouter";
import type { TemplateLoader } from "./services/TemplateLoader";
import type { NoteWriter } from "./services/NoteWriter";
import type { GlossaryService } from "./services/GlossaryService";
import type { ToolHandler } from "./services/ToolHandler";
import type { WebSearchService } from "./services/WebSearchService";
import type { PromptOptimizerService } from "./services/PromptOptimizerService";
import type { SecretStore } from "./services/SecretStore";
import type { PluginDataStore } from "./services/PluginDataStore";
import type { ConversationService } from "./services/ConversationService";
import type { ViewManager } from "./services/ViewManager";
import { embeddingWorkerUrl } from "./services/embedding/host/workerBundleUrl";
import { VaultIndexStore } from "./services/embedding/vaultIndexStore";
import { scheduleWarm } from "./services/embedding/warmIndex";
import { VaultRagService } from "./services/VaultRagService";
import { EmbeddingHub, type VaultRagLike } from "./services/embedding/EmbeddingHub";
import type { RelatedResult } from "./services/embedding/relatedConversations";
import type { EmbeddingModelId } from "./models/embeddingModels";
import { vaultBuildGuard } from "./services/embedding/buildGuard";
import { installEmbeddingResidency } from "./services/embedding/residency";
import type { VaultIndexStatus } from "./services/embedding/indexStatus";
import { registerVaultWatcher } from "./services/vaultWatcher";
import { CATCH_UP_DELAY_MS } from "./services/embedding/vaultCatchUp";
import { RenameFollower } from "./services/renameFollower";
import { handleDeepLink } from "./services/deepLink";
import { REGENERATE_ICON, SOURCE_ICONS } from "./ui/icons";

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
	/** Vault renames into stored paths, batched and logged (ADR-218 addendum). */
	renameFollower!: RenameFollower;

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
	get glossaryService(): GlossaryService { return this.container?.glossaryService as GlossaryService; }
	get webSearchService(): WebSearchService { return this.container?.webSearchService as WebSearchService; }
	get toolHandler(): ToolHandler { return this.container?.toolHandler as ToolHandler; }
	get promptOptimizerService(): PromptOptimizerService { return this.container?.promptOptimizerService as PromptOptimizerService; }

	/** On-device embeddings: the shared provider, "related conversations" (ADR-109)
	 *  and vault-wide semantic RAG (ADR-116) — see `services/embedding/EmbeddingHub.ts`.
	 *  The methods below are thin facades kept for settings.ts, the sidebar and tests. */
	embedding!: EmbeddingHub;

	/** Vault-wide semantic RAG — index lifecycle + retrieval (ADR-116/118/119). */
	get vaultRag(): VaultRagLike { return this.embedding.vaultRag; }

	/** The model this device embeds with (ADR-199/200). */
	activeEmbeddingModelId(): EmbeddingModelId { return this.embedding.activeModelId(); }

	/** Vault paths auto-retrieved for `conversationId` on its most recent turn. */
	getAutoContext(conversationId: string): string[] { return this.embedding.getAutoContext(conversationId); }

	/** Conversations semantically related to `sourceId`, most-similar first (ADR-109). */
	getRelatedConversations(sourceId: string, signal?: AbortSignal): Promise<RelatedResult[]> {
		return this.embedding.getRelated(sourceId, signal);
	}

	/** Full reindex of vault context (ADR-119) — clear + rebuild in the background. */
	reindexVault(): Promise<void> { return this.embedding.reindexVault(); }

	/** "Build now" in settings: finish or update the index, keeping its rows (ADR-199). */
	buildVaultIndexNow(): void { this.embedding.buildVaultIndexNow(); }

	/** The chat input got focus: load a model the phone released (ADR-202). */
	prewarmEmbedding(): void { this.embedding.prewarm(); }

	onVaultIndexChange(listener: () => void): () => void { return this.embedding.onVaultIndexChange(listener); }

	/** Where the vault index stands, for the settings tab (ADR-199). */
	vaultIndexStatus(): Promise<VaultIndexStatus> { return this.embedding.vaultIndexStatus(); }

	/** Drop the provider + index services so the next use rebuilds with the current
	 *  model. Called by the settings tab on a model change. */
	invalidateRelatedService(): void { this.embedding.invalidate(); }

	async onload(): Promise<void> {
		// ConversationStore owns the conversation list and must exist before
		// AppContainer.create() runs loadPluginData (which writes conversations
		// through the plugin.conversations accessor → the store). The container
		// then loads data and constructs every remaining service in order.
		this.conversationStore = new ConversationStore(this);
		this.container = await AppContainer.create(this);

		// On-device embeddings (ADR-109 related conversations + ADR-116 vault RAG):
		// ONE lazily-built provider shared by both index services, plus the phone's
		// residency rule. The Obsidian-shaped pieces are supplied here; everything
		// with a rule to it lives in `services/embedding/EmbeddingHub.ts`.
		this.embedding = new EmbeddingHub({
			settings: () => this.settings,
			conversations: () => this.conversations,
			isMobile: Platform.isMobile,
			makeStore: (modelId, prefix) => new VaultIndexStore(this, modelId, prefix),
			workerUrl: () => embeddingWorkerUrl(this),
			makeVaultRag: (w) => new VaultRagService(
				this.app,
				() => this.settings,
				w.getProvider,
				w.makeStore,
				{ modelId: w.modelId, guard: vaultBuildGuard(this.app), mobile: Platform.isMobile },
			),
			installResidency: (deps) => installEmbeddingResidency(this, deps),
			notice: (message) => new Notice(message),
			log: (m, d) => debugLog(this.settings, m, d),
			firstRunMessage: t("relatedFirstRun"),
		});
		// Let the router auto-retrieve relevant vault notes per turn (fail-open, and
		// non-blocking — returns [] until the background index is ready).
		this.llmRouter.setVaultRetriever((conv, query, exclude) =>
			this.vaultRag.getRelevantNotes(conv, query, exclude)
		);

		// Before the view is registered: a leaf restored from workspace.json asks
		// for its icon during layout-ready, and the ribbon and commands name it.
		registerPythiaIcon();

		this.registerView(
			PYTHIA_VIEW_TYPE,
			(leaf) => new PythiaSidebarView(leaf, this)
		);

		// A chart draws wherever markdown renders, not only inside the panel
		// (ADR-210): the answer on both its render paths, a conversation saved or
		// archived as a note, and Reading view of any note the block is pasted
		// into — which is what makes "copy the source block" worth offering.
		// Wiring only; what to draw lives in ui/chart/card.ts (ADR-205).
		this.registerMarkdownCodeBlockProcessor(
			CHART_BLOCK_LANG,
			(src, el) => renderChartCard(src, el)
		);

		// One pending flush at a time (the follower batches), cleared on unload.
		let renameTimer: number | null = null;
		this.register(() => { if (renameTimer !== null) window.clearTimeout(renameTimer); });
		this.renameFollower = new RenameFollower({
			conversations: () => this.conversations,
			conversationsChanged: (ids) => this.conversationStore.markChanged(ids),
			settings: () => this.settings,
			settingsChanged: () => {
				void this.saveSettings();
				this.glossaryService?.invalidate();
			},
			exists: (path) => this.app.vault.getAbstractFileByPath(path) !== null,
			renameLog: () => this.pluginDataStore.renameLog,
			defer: (fn) => { renameTimer = window.setTimeout(fn, 0); },
			now: () => new Date().toISOString(),
			debug: (message) => debugLog(this.settings, message),
		});

		this.app.workspace.onLayoutReady(() => {
			this.viewManager.initLeaf();
			// The vault's files are known now, which the replay's guard reads.
			this.renameFollower.replay();
			// After the workspace is up, not during it (ADR-169/170).
			scheduleWarm({ run: () => void this.embedding.warm(), register: (c) => this.register(c) });
			// The vault index catches up with what changed while Pythia was closed (ADR-221).
			scheduleWarm({ run: () => void this.embedding.catchUpVaultIndex(), register: (c) => this.register(c), delayMs: CATCH_UP_DELAY_MS });
		});

		// Watch data.json for external changes (iCloud/Obsidian Sync delivering
		// updates from another device while this instance is running).
		// When detected, reload from disk and refresh the sidebar.
		this.pluginDataStore.watchDataJson();

		this.addRibbonIcon(PYTHIA_ICON_ID, "Pythia", () => this.activateView());
		this.addSettingTab(new PythiaSettingTab(this.app, this));

		this.addCommand({
			id: "new-conversation",
			name: t("cmdNewConversation"),
			icon: PYTHIA_ICON_ID,
			callback: () => this.cmdNewConversation(),
		});

		this.addCommand({
			id: "resume-conversation",
			name: t("cmdResumeConversation"),
			icon: PYTHIA_ICON_ID,
			callback: () => this.conversationService.cmdResumeConversation(),
		});

		this.addCommand({
			id: "hub",
			name: t("cmdHub"),
			icon: PYTHIA_ICON_ID,
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
			icon: "star",
			callback: () => this.conversationService.cmdSummarizeFavorites(),
		});

		this.addCommand({
			id: "toggle-vault-context",
			name: t("cmdToggleVaultContext"),
			icon: SOURCE_ICONS.auto,
			callback: async () => {
				this.settings.vaultContextEnabled = !this.settings.vaultContextEnabled;
				await this.saveSettings();
				new Notice(this.settings.vaultContextEnabled ? t("vaultContextDefaultOn") : t("vaultContextDefaultOff"));
			},
		});

		this.addCommand({
			id: "reindex-vault-context",
			name: t("cmdReindexVault"),
			icon: REGENERATE_ICON,
			callback: () => void this.reindexVault(),
		});

		// Keep the vault index fresh with EVENT-DRIVEN, targeted updates (ADR-121).
		// The batching rules live in `services/vaultWatcher.ts`, where they are tested.
		registerVaultWatcher(this, {
			applyChanges: (changed, deleted) => void this.vaultRag.applyChanges(changed, deleted),
			invalidateGlossary: (path) => {
				if (this.glossaryService?.isGlossaryNote(path)) this.glossaryService.invalidate();
			},
			followRename: (oldPath, newPath) => this.renameFollower.queue(oldPath, newPath),
			// The note being written waits until it is left or quiet (ADR-220).
			activePath: () => this.app.workspace.getActiveFile()?.path ?? null,
		});

		registerEditorSelectionEntries(this);
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file) => {
				if (file instanceof TFile) {
					menu.addItem((item) => {
						item
							.setTitle(t("chatAboutNote"))
							.setSection("open")
							.setIcon(PYTHIA_ICON_ID)
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
							.setIcon(PYTHIA_ICON_ID)
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

		// obsidian://pythia — routing and validation live in `services/deepLink.ts`;
		// this is the Obsidian half. `handleDeepLink` never rejects, which matters
		// because Obsidian does not await an async protocol handler.
		this.registerObsidianProtocolHandler("pythia", (params) => void handleDeepLink(params, {
			open: async () => void (await this.activateView()),
			create: async () => {
				const conv = await this.createConversation({ name: `Conversation ${todayISO()}` });
				await (await this.activateView()).setActiveConversation(conv);
			},
			resume: async (id) => {
				const conv = this.conversationStore.getById(id);
				if (!conv) return false;
				await (await this.activateView()).setActiveConversation(conv, true, "top");
				return true;
			},
			template: async (name) => {
				const tpl = (await this.templateLoader.loadTemplates()).find((x) => x.name === name);
				if (!tpl) return false;
				const conv = await this.createConversationFromTemplate(tpl);
				await (await this.activateView()).setActiveConversation(conv);
				return true;
			},
			inject: async (text) => {
				const templates = await this.templateLoader.loadTemplates();
				if (templates.length === 0) return false;
				await this.activateView();
				new TemplateSuggestModal(this.app, templates, async (tpl) => {
					const conv = await this.createConversationFromTemplate(tpl);
					const view = await this.activateView();
					await view.setActiveConversation(conv);
					view.triggerAutoPrompt(text);
				}).open();
				return true;
			},
			templatesFolder: () => this.settings.templatesFolder,
			notice: (message) => new Notice(message),
		}));
	}

	async onunload(): Promise<void> {
		// Flush any pending debounced save so the last conversation state
		// is written to disk before the plugin unloads.
		await this.conversationStore?.flush();
		this.llmRouter?.abort();
		this.embedding?.dispose();
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
	/** Debounced settings save for typed fields; see PluginDataStore. */
	saveSettingsSoon(): void { this.pluginDataStore.saveSettingsSoon(); }
	/** The settings tab closed: persist the last typed value, and repaint the header,
	 *  which shows the global effort and language defaults resolved (ADR-165). */
	onSettingsTabClosed(): void {
		this.pluginDataStore.flushSettingsSave();
		this.viewManager.getSidebarView()?.refreshInstructions();
	}
	saveConversations(): Promise<void> { return this.pluginDataStore.saveConversations(); }
	/** Archive one conversation; false = not written, so do not delete it (ADR-173). */
	archiveConversation(conv: Conversation): Promise<boolean> { return this.conversationService.archiveConversation(conv); }
	/** How many conversations a lower history limit would delete (ADR-171). */
	pendingEvictionCount(cap: number): number { return this.pluginDataStore.pendingEvictionCount(cap); }

	activateView(): Promise<PythiaSidebarView> { return this.viewManager.activateView(); }

	createConversation(opts: Parameters<ConversationService["createConversation"]>[0]): Promise<Conversation> {
		return this.conversationService.createConversation(opts);
	}
	createConversationFromTemplate(tpl: PythiaTemplate, contextNotes?: string[], outputFolder?: string): Promise<Conversation> {
		return this.conversationService.createConversationFromTemplate(tpl, contextNotes, outputFolder);
	}
	renameConversation(conv: Conversation, newName: string): Promise<void> {
		return this.conversationService.renameConversation(conv, newName);
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
	cmdMergeConversation(convId: string, selectedText: string, messageId: string, occurrenceIndex?: number): Promise<void> {
		return this.conversationService.cmdMergeConversation(convId, selectedText, messageId, occurrenceIndex);
	}
}
