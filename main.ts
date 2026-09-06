import { debounce, Editor, Menu, Notice, normalizePath, Plugin, TFile, TFolder } from "obsidian";
import { PythiaSettings, PythiaSettingTab } from "./settings";
import { t } from "./i18n";
import { debugLog } from "./services/messageUtils";
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
import { createEmbeddingProvider } from "./services/embedding/host/embeddingProviderFactory";
import { getEmbeddingBundle } from "./services/embedding/host/embeddingBundle";
import type { EmbeddingProvider } from "./services/embedding/EmbeddingProvider";
import { ConversationIndexService } from "./services/embedding/ConversationIndexService";
import { VaultIndexStore } from "./services/embedding/vaultIndexStore";
import { VaultRagService } from "./services/VaultRagService";
import { relatedMinScore, type RelatedResult } from "./services/embedding/relatedConversations";
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

	// On-device embeddings: "related conversations" (ADR-109) and vault-wide semantic
	// RAG (ADR-116) share ONE lazily-built provider (the model/iframe is heavy), so
	// the model loads once and both index services reuse it. Switching the embedding
	// model tears everything down so the next use rebuilds against the new model.
	private embeddingProvider: EmbeddingProvider | null = null;
	private embeddingModelId: EmbeddingModelId | null = null;
	private relatedService: ConversationIndexService | null = null;
	/** Memoized resource-path URL for the embedding worker script (written once per
	 *  plugin version). Lets the Worker start where `blob:` Workers are blocked (ADR-126). */
	private embeddingWorkerUrlPromise: Promise<string> | null = null;
	/** Vault-wide semantic RAG (ADR-116/118/119) — index lifecycle + retrieval,
	 *  extracted to its own service; uses the shared embedding provider below. */
	vaultRag!: VaultRagService;

	/** Vault paths auto-retrieved for `conversationId` on its most recent turn. */
	getAutoContext(conversationId: string): string[] {
		return this.vaultRag.getAutoContext(conversationId);
	}

	/** Conversations semantically related to `sourceId`, most-similar first (ADR-109).
	 *
	 *  In-app diagnostic (enable "Debug mode" in settings): traces the embedding
	 *  path so a "shows nothing" report can be triaged from the developer console
	 *  without a rebuild. Three outcomes are distinguishable in the log:
	 *   • a "query failed" warning (always logged) → the model/iframe never produced
	 *     vectors — inspect the attached error (offline, download failed, timeout);
	 *   • "returned 0" with no error → the index built and ranking ran, but nothing
	 *     cleared the minScore floor (raise the floor or the vault is too sparse);
	 *   • "returned N" with per-id scores → the path works end to end. */
	async getRelatedConversations(sourceId: string): Promise<RelatedResult[]> {
		const startedAt = Date.now();
		const minScore = relatedMinScore(this.settings.relatedSimilarity);
		debugLog(this.settings, "related: query start", {
			sourceId,
			model: this.settings.embeddingModelId,
			conversations: this.conversations.length,
			similarity: this.settings.relatedSimilarity,
			minScore,
		});
		try {
			const results = await this.ensureRelatedService().getRelated(sourceId, this.conversations, {
				minScore,
			});
			debugLog(this.settings, `related: query ok (${Date.now() - startedAt}ms)`, {
				returned: results.length,
				top: results.slice(0, 5).map((r) => ({ id: r.id, score: Math.round(r.score * 1000) / 1000 })),
			});
			return results;
		} catch (e) {
			// Genuine failure — surface it unconditionally (not gated on debugMode) so a
			// model-load/inference error is always in the console behind the UI Notice.
			console.warn("[Pythia] related: query failed", e);
			throw e;
		}
	}

	/** Build (or reuse) the shared embedding provider for the current model. On a
	 *  model change, the old provider AND both index services are torn down so the
	 *  next use rebuilds against the new model. The onProgress callback traces the
	 *  model download/load (debug mode only) — the single hardest part to diagnose
	 *  blind, since it happens inside the hidden iframe. */
	private ensureEmbeddingProvider(): EmbeddingProvider {
		const modelId = this.settings.embeddingModelId;
		if (this.embeddingProvider && this.embeddingModelId === modelId) return this.embeddingProvider;
		this.embeddingProvider?.unload();
		this.relatedService = null;
		this.vaultRag?.reset();
		new Notice(t("relatedFirstRun"));
		debugLog(this.settings, "embedding: initializing model", { modelId, priorModel: this.embeddingModelId });
		// Worker (off the UI thread) with a blob→resource-path→iframe fallback chain
		// (ADR-119/126). The resource-path URL lets the Worker start where blob: is blocked.
		this.embeddingProvider = createEmbeddingProvider(
			modelId,
			(p) =>
				debugLog(this.settings, "embedding: model load", {
					file: p.file,
					percent: Math.round(p.progress),
					loaded: p.loaded,
					total: p.total,
				}),
			() => this.embeddingWorkerUrl(),
		);
		this.embeddingModelId = modelId;
		return this.embeddingProvider;
	}

	/** Write the embedding worker bundle to the plugin folder (once per version) and
	 *  return a same-origin resource-path URL for it — the blob-free way to start a
	 *  Worker where `blob:` URLs are blocked (Obsidian mobile, capacitor:// desktop
	 *  builds). Memoized; best-effort cleanup of stale older-version worker files.
	 *  The bundle is the same one inlined in main.js (getEmbeddingBundle). */
	private embeddingWorkerUrl(): Promise<string> {
		if (this.embeddingWorkerUrlPromise) return this.embeddingWorkerUrlPromise;
		this.embeddingWorkerUrlPromise = (async () => {
			const adapter = this.app.vault.adapter;
			const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
			const path = normalizePath(`${dir}/embedding-worker-${this.manifest.version}.mjs`);
			if (!(await adapter.exists(path))) {
				await adapter.write(path, getEmbeddingBundle());
				// Best-effort: drop stale worker bundles from older plugin versions.
				try {
					const listing = await adapter.list(dir);
					for (const f of listing.files) {
						if (/\/embedding-worker-.*\.mjs$/.test(f) && f !== path) await adapter.remove(f);
					}
				} catch { /* cleanup is best-effort */ }
			}
			return adapter.getResourcePath(path);
		})();
		return this.embeddingWorkerUrlPromise;
	}

	private ensureRelatedService(): ConversationIndexService {
		const provider = this.ensureEmbeddingProvider();
		if (!this.relatedService) {
			this.relatedService = new ConversationIndexService(
				provider,
				new VaultIndexStore(this, this.embeddingModelId!)
			);
		}
		return this.relatedService;
	}

	/** Full reindex of vault context (ADR-119) — clear + rebuild in the background.
	 *  Exposed for the settings "Rebuild index" button and the command. */
	reindexVault(): Promise<void> {
		return this.vaultRag.reindex();
	}

	/** Human-readable vault-index status for the settings tab. */
	getVaultIndexStatus(): string {
		return this.vaultRag.getStatus();
	}

	/** Drop the embedding provider + index services so the next use rebuilds with
	 *  the current model. Called by the settings tab on a model change. */
	invalidateRelatedService(): void {
		this.embeddingProvider?.unload();
		this.embeddingProvider = null;
		this.embeddingModelId = null;
		this.relatedService = null;
		this.vaultRag?.reset();
	}

	async onload(): Promise<void> {
		// ConversationStore owns the conversation list and must exist before
		// AppContainer.create() runs loadPluginData (which writes conversations
		// through the plugin.conversations accessor → the store). The container
		// then loads data and constructs every remaining service in order.
		this.conversationStore = new ConversationStore(this);
		this.container = await AppContainer.create(this);

		// Vault-wide semantic RAG (ADR-116/118/119): the service owns the index
		// lifecycle + retrieval and shares the embedding provider (worker/iframe).
		this.vaultRag = new VaultRagService(
			this.app,
			() => this.settings,
			() => this.ensureEmbeddingProvider(),
			() => new VaultIndexStore(this, this.embeddingModelId!, "vault-embeddings"),
		);
		// Let the router auto-retrieve relevant vault notes per turn (fail-open, and
		// non-blocking — returns [] until the background index is ready).
		this.llmRouter.setVaultRetriever((conv, query, exclude) =>
			this.vaultRag.getRelevantNotes(conv, query, exclude)
		);

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
			id: "toggle-vault-context",
			name: t("cmdToggleVaultContext"),
			icon: "bot",
			callback: async () => {
				this.settings.vaultContextEnabled = !this.settings.vaultContextEnabled;
				await this.saveSettings();
				new Notice(this.settings.vaultContextEnabled ? t("vaultContextDefaultOn") : t("vaultContextDefaultOff"));
			},
		});

		this.addCommand({
			id: "reindex-vault-context",
			name: t("cmdReindexVault"),
			icon: "bot",
			callback: () => void this.reindexVault(),
		});

		// Watcher (ADR-121): keep the vault index fresh with EVENT-DRIVEN, targeted
		// updates — an edit re-embeds just that one note instead of rescanning the
		// whole corpus. Changed/deleted paths are batched and flushed on a debounce
		// so a burst of edits coalesces; `applyChanges` no-ops until the index is
		// built (a full build happens on a turn), so this never eagerly loads the model.
		const changedFiles = new Map<string, TFile>();
		const deletedPaths = new Set<string>();
		const flushChanges = debounce(() => {
			const changed = [...changedFiles.values()];
			const deleted = [...deletedPaths];
			changedFiles.clear();
			deletedPaths.clear();
			if (changed.length || deleted.length) void this.vaultRag.applyChanges(changed, deleted);
		}, 2000);
		const markChanged = (file: TFile) => {
			if (file.extension !== "md") return;
			changedFiles.set(file.path, file);
			deletedPaths.delete(file.path);
			flushChanges();
		};
		this.registerEvent(this.app.vault.on("modify", (f) => { if (f instanceof TFile) markChanged(f); }));
		this.registerEvent(this.app.vault.on("create", (f) => { if (f instanceof TFile) markChanged(f); }));
		this.registerEvent(this.app.vault.on("delete", (f) => {
			if (!(f instanceof TFile)) return;
			deletedPaths.add(f.path);
			changedFiles.delete(f.path);
			flushChanges();
		}));
		this.registerEvent(this.app.vault.on("rename", (f, oldPath) => {
			deletedPaths.add(oldPath);
			if (f instanceof TFile) markChanged(f);
			else flushChanges();
		}));

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
		this.embeddingProvider?.unload();
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
