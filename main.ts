import { Editor, Menu, Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, PythiaSettings, PythiaSettingTab } from "./settings";
import { t } from "./i18n";
import type { Conversation, Provider, PythiaTemplate } from "./models/types";
import { getFilesInFolder, todayISO } from "./utils";
import { PythiaSidebarView, PYTHIA_VIEW_TYPE } from "./sidebar";
import { ConversationSuggestModal, FavoritesSuggestModal } from "./suggest/ConversationSuggest";
import { CommandHubModal } from "./suggest/CommandHubModal";
import { TemplateSuggestModal } from "./suggest/TemplateSuggest";
import { ResumeModeModal } from "./suggest/ResumeModeModal";
import { AnthropicService } from "./services/AnthropicService";
import { OpenAIProvider } from "./services/OpenAIProvider";
import { MistralService } from "./services/MistralService";
import { LLMRouter } from "./services/LLMRouter";
import { resolveDefaultModelForProvider } from "./models/knownModels";
import { ConversationStore } from "./services/ConversationStore";
import { TemplateLoader } from "./services/TemplateLoader";
import { NoteWriter } from "./services/NoteWriter";
import { ToolHandler } from "./services/ToolHandler";
import { WebSearchService } from "./services/WebSearchService";
import { PromptOptimizerService } from "./services/PromptOptimizerService";
import {
	applySettingsMigrations,
	mergeSettings,
	parseConversations,
	shouldRefuseLoad,
	evictConversations,
} from "./services/persistence";

export default class PythiaPlugin extends Plugin {
	settings!: PythiaSettings;
	conversations!: Conversation[];
	/** Set by watchDataJson() so persistData() can stamp the own-write time. */
	private saveDataRecordTime: (() => void) | null = null;
	/** Decrypted API keys held only in memory — never written to disk as plaintext. */
	plaintextApiKey = "";
	plaintextOpenAIKey = "";
	plaintextMistralKey = "";
	plaintextSearchKey = "";

	llmRouter!: LLMRouter;
	conversationStore!: ConversationStore;
	templateLoader!: TemplateLoader;
	noteWriter!: NoteWriter;
	webSearchService!: WebSearchService;
	toolHandler!: ToolHandler;
	promptOptimizerService!: PromptOptimizerService;

	async onload(): Promise<void> {
		await this.loadPluginData();

		const anthropicSvc = new AnthropicService(this.app, this.settings, this.plaintextApiKey);
		const openaiSvc = new OpenAIProvider(this.app, this.settings, this.plaintextOpenAIKey);
		const mistralSvc = new MistralService(this.app, this.settings, this.plaintextMistralKey);
		this.llmRouter = new LLMRouter(anthropicSvc, openaiSvc, mistralSvc);
		this.conversationStore = new ConversationStore(this);
		this.templateLoader = new TemplateLoader(this.app, this.settings);
		this.noteWriter = new NoteWriter(this.app, this.settings);
		this.webSearchService = new WebSearchService(this.settings, this.plaintextSearchKey);
		this.toolHandler = new ToolHandler(this.noteWriter, this.webSearchService);
		this.promptOptimizerService = new PromptOptimizerService(this.app, this, this.settings, this.llmRouter);

		this.registerView(
			PYTHIA_VIEW_TYPE,
			(leaf) => new PythiaSidebarView(leaf, this)
		);

		this.app.workspace.onLayoutReady(() => this.initLeaf());

		// Watch data.json for external changes (iCloud/Obsidian Sync delivering
		// updates from another device while this instance is running).
		// When detected, reload from disk and refresh the sidebar.
		this.watchDataJson();

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
			callback: () => this.cmdResumeConversation(),
		});

		this.addCommand({
			id: "hub",
			name: t("cmdHub"),
			icon: "bot",
			callback: () => new CommandHubModal(this.app, [
				{
					label: t("cmdNewConversationFromTemplate"),
					desc:   t("cmdNewConversationFromTemplateDesc"),
					action: () => this.cmdNewConversationFromTemplate(),
				},
				{
					label: t("cmdNewConversationWithCurrentNote"),
					desc:   t("cmdNewConversationWithCurrentNoteDesc"),
					action: () => this.cmdNewConversationWithCurrentNote(),
				},
				{
					label: t("cmdNewConversationFromClipboard"),
					desc:   t("cmdNewConversationFromClipboardDesc"),
					action: () => this.cmdNewConversationFromClipboard(),
				},
				{
					label: t("cmdNewConversationFromPrompt"),
					desc:   t("cmdNewConversationFromPromptDesc"),
					action: () => this.promptOptimizerService.run(),
				},
				{
					label: t("cmdBrowseConversations"),
					desc:   t("cmdBrowseConversationsDesc"),
					action: () => this.cmdBrowseConversations(),
				},
				{
					label: t("cmdBrowseFavorites"),
					desc:   t("cmdBrowseFavoritesDesc"),
					action: () => this.cmdBrowseFavorites(),
				},
				{
					label: t("cmdSummarizeFavorites"),
					desc:   t("cmdSummarizeFavoritesDesc"),
					action: () => this.cmdSummarizeFavorites(),
				},
				{
					label: t("cmdReloadConversations"),
					desc:   t("cmdReloadConversationsDesc"),
					action: () => this.reloadFromDisk(),
				},
			]).open(),
		});

		this.addCommand({
			id: "summarize-favorites",
			name: t("cmdSummarizeFavorites"),
			icon: "bot",
			callback: () => this.cmdSummarizeFavorites(),
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
					const { contextNotes, outputFolder } = this.resolveTemplateContext(tpl, activeFile);
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
	}

	async reloadFromDisk(): Promise<void> {
		this.conversationStore?.cancelPendingPersist();
		await this.loadPluginData();
		this.llmRouter?.updateSettings(this.settings);
		this.llmRouter?.updateApiKey("anthropic", this.plaintextApiKey);
		this.llmRouter?.updateApiKey("openai", this.plaintextOpenAIKey);
		this.llmRouter?.updateApiKey("mistral", this.plaintextMistralKey);
		this.templateLoader?.updateSettings(this.settings);
		this.noteWriter?.updateSettings(this.settings);
		this.webSearchService?.updateSettings(this.settings);
		this.webSearchService?.updateApiKey(this.plaintextSearchKey);
		this.promptOptimizerService?.updateSettings(this.settings);
		const leaves = this.app.workspace.getLeavesOfType(PYTHIA_VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view as PythiaSidebarView;
			const still = this.conversations.find(c => c.id === view.activeConversationId);
			const next  = still ?? this.conversations[0] ?? null;
			if (next) {
				await view.setActiveConversation(next, false);
			} else {
				view.renderEmptyState();
			}
		}
		new Notice(t("reloadComplete"));
	}

	private async loadPluginData(): Promise<void> {
		const data = (await this.loadData()) ?? {};
		const saved = (data.settings ?? {}) as Record<string, unknown>;

		const { needsSave, legacyAnthropicCiphertext, legacyOpenAICiphertext } =
			applySettingsMigrations(saved);

		if (legacyAnthropicCiphertext) {
			const plaintext = legacyDecrypt(legacyAnthropicCiphertext);
			if (plaintext) {
				this.app.secretStorage.setSecret(DEFAULT_SETTINGS.anthropicSecretName, plaintext);
			} else {
				new Notice(t("migrateAnthropicFailed"), 8000);
			}
		}
		if (legacyOpenAICiphertext) {
			const plaintext = legacyDecrypt(legacyOpenAICiphertext);
			if (plaintext) {
				this.app.secretStorage.setSecret(DEFAULT_SETTINGS.openaiSecretName, plaintext);
			} else {
				new Notice(t("migrateOpenAIFailed"), 8000);
			}
		}

		this.settings = mergeSettings(saved);

		const rawConversations = (data.conversations ?? []) as unknown[];
		const { conversations: loaded, dropped } = parseConversations(rawConversations);
		if (dropped > 0) {
			console.warn(`[Pythia] Dropped ${dropped} malformed conversation(s) from data.json`);
		}

		// iCloud eviction guard — checked BEFORE overwriting this.conversations.
		// If the file came back empty while we have conversations in memory,
		// refuse the load and keep the existing state.
		// (Cause: iCloud evicts data.json to cloud-only; loadData() returns {}.)
		//
		// Deliberately in loadPluginData, NOT in persistData, so that
		// user-initiated "delete all conversations" works normally: conversations
		// decrement one by one through normal deletes; persistData() is never
		// blocked and always saves whatever is in this.conversations.
		const existingCount = Array.isArray(this.conversations) ? this.conversations.length : 0;
		if (shouldRefuseLoad(loaded, existingCount)) {
			new Notice(
				"[Pythia] Loaded 0 conversations from disk while having conversations in memory. " +
				"Keeping existing state. Check iCloud sync.",
				8000
			);
			return;
		}

		this.conversations = loaded;

		// getSecret() is async in Obsidian's current typings (truly async on iOS WebKit). (#18)
		this.plaintextApiKey =
			(await this.app.secretStorage.getSecret(this.settings.anthropicSecretName)) ?? "";
		this.plaintextOpenAIKey =
			(await this.app.secretStorage.getSecret(this.settings.openaiSecretName)) ?? "";
		this.plaintextMistralKey =
			(await this.app.secretStorage.getSecret(this.settings.mistralSecretName)) ?? "";
		this.plaintextSearchKey =
			(await this.app.secretStorage.getSecret(this.settings.searchSecretName)) ?? "";

		if (needsSave) {
			await this.saveData({ settings: this.settings, conversations: this.conversations });
		}
	}

	/** Update the Anthropic API key reference and refresh the in-memory key from SecretStorage. */
	async setApiKey(secretName: string): Promise<void> {
		this.settings.anthropicSecretName = secretName;
		await this.persistData();
		this.plaintextApiKey = (await this.app.secretStorage.getSecret(secretName)) ?? "";
		this.llmRouter?.updateApiKey("anthropic", this.plaintextApiKey);
	}

	/** Update the OpenAI API key reference and refresh the in-memory key from SecretStorage. */
	async setOpenAIKey(secretName: string): Promise<void> {
		this.settings.openaiSecretName = secretName;
		await this.persistData();
		this.plaintextOpenAIKey = (await this.app.secretStorage.getSecret(secretName)) ?? "";
		this.llmRouter?.updateApiKey("openai", this.plaintextOpenAIKey);
	}

	/** Update the Mistral API key reference and refresh the in-memory key from SecretStorage. */
	async setMistralKey(secretName: string): Promise<void> {
		this.settings.mistralSecretName = secretName;
		await this.persistData();
		this.plaintextMistralKey = (await this.app.secretStorage.getSecret(secretName)) ?? "";
		this.llmRouter?.updateApiKey("mistral", this.plaintextMistralKey);
	}

	/** Update the Tavily web-search API key reference and refresh the in-memory key from SecretStorage. */
	async setSearchKey(secretName: string): Promise<void> {
		this.settings.searchSecretName = secretName;
		await this.persistData();
		this.plaintextSearchKey = (await this.app.secretStorage.getSecret(secretName)) ?? "";
		this.webSearchService?.updateApiKey(this.plaintextSearchKey);
	}

	/** Exhaustive switch (not a two-way ternary) so a fourth provider fails to
	 *  compile here instead of silently checking the wrong provider's key. */
	hasApiKeyFor(provider: Provider): boolean {
		switch (provider) {
			case "anthropic":
				return !!this.plaintextApiKey;
			case "openai":
				return !!this.plaintextOpenAIKey;
			case "mistral":
				return !!this.plaintextMistralKey;
			default: {
				const exhaustiveCheck: never = provider;
				throw new Error(`Unknown provider: ${String(exhaustiveCheck)}`);
			}
		}
	}

	async saveSettings(): Promise<void> {
		await this.persistData();
		this.llmRouter?.updateSettings(this.settings);
		this.templateLoader?.updateSettings(this.settings);
		this.noteWriter?.updateSettings(this.settings);
		this.webSearchService?.updateSettings(this.settings);
		this.promptOptimizerService?.updateSettings(this.settings);
	}

	async saveConversations(): Promise<void> {
		await this.persistData();
	}

	private async persistData(): Promise<void> {
		try {
			// Evict oldest non-starred conversations beyond the cap (#3).
			// Always protect every currently-open conversation, even if it has no
			// starred messages — evicting an active conversation would silently
			// lose new turns (#17). Pythia's view can be opened in more than one
			// leaf, so every leaf's active conversation is protected, not just one.
			const activeIds = this.app.workspace
				.getLeavesOfType(PYTHIA_VIEW_TYPE)
				.map((leaf) => (leaf.view as PythiaSidebarView).activeConversationId)
				.filter((id): id is string => id !== null);
			this.conversations = evictConversations(
				this.conversations,
				this.settings.maxConversations,
				activeIds,
			);

			const snapshot = this.conversationStore?.snapshotDirty();
			this.saveDataRecordTime?.();   // stamp own-write time before the watcher can fire
			await this.saveData({
				settings: this.settings,
				conversations: this.conversations,
			});
			if (snapshot) this.conversationStore?.clearDirtySnapshot(snapshot);
		} catch (err) {
			new Notice(
				`[Pythia] Failed to save data: ${err instanceof Error ? err.message : String(err)}`,
				8000
			);
		}
	}

	/**
	 * Poll data.json for external modifications every 5 seconds.
	 * vault.on("modify") does not fire for .obsidian/ system files, so
	 * polling adapter.stat() is the reliable cross-platform approach.
	 *
	 * When another device (via iCloud / Obsidian Sync) writes a newer
	 * data.json while this instance is running, we reload from disk and
	 * refresh the sidebar so conversations stay in sync.
	 */
	private watchDataJson(): void {
		const DATA_JSON_PATH = `.obsidian/plugins/${this.manifest.id}/data.json`;
		let lastKnownMtime = Date.now();
		let lastOwnWrite   = Date.now();

		// Record whenever WE write so we can ignore our own saves.
		this.saveDataRecordTime = () => { lastOwnWrite = Date.now(); };

		const handle = window.setInterval(async () => {
			try {
				const stat = await this.app.vault.adapter.stat(DATA_JSON_PATH);
				if (!stat) return;
				// External write: mtime is newer than what we last saw AND
				// we didn't write it ourselves within the last 3 seconds.
				if (stat.mtime > lastKnownMtime && Date.now() - lastOwnWrite > 3000) {
					lastKnownMtime = stat.mtime;
					await this.reloadFromDisk();
				} else {
					// Keep mtime in sync even if we wrote it ourselves.
					lastKnownMtime = Math.max(lastKnownMtime, stat.mtime);
				}
			} catch { /* adapter unavailable on some platforms */ }
		}, 5000);

		this.register(() => window.clearInterval(handle));
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
		void workspace.getRightLeaf(false)?.setViewState({ type: PYTHIA_VIEW_TYPE });
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
		void workspace.revealLeaf(leaf);
		return leaf.view as PythiaSidebarView;
	}

	private getSidebarView(): PythiaSidebarView | null {
		const leaf = this.app.workspace.getLeavesOfType(PYTHIA_VIEW_TYPE)[0];
		return leaf ? (leaf.view as PythiaSidebarView) : null;
	}

	async renameConversationFile(conv: Conversation): Promise<void> {
		if (!conv.savedNotePath) return;
		const oldFile = this.app.vault.getAbstractFileByPath(conv.savedNotePath);
		if (!(oldFile instanceof TFile)) return;
		const safeName = conv.name.replace(/[\\/:*?"<>|]/g, "-");
		const dir = oldFile.parent?.path ?? "";
		// Preserve date prefix (YYYY-MM-DD-) if the current filename has one
		const datePrefix = oldFile.basename.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1];
		const newBasename = datePrefix ? `${datePrefix}-${safeName}` : safeName;
		const newPath = dir ? `${dir}/${newBasename}.md` : `${newBasename}.md`;
		if (newPath === conv.savedNotePath) return;
		try {
			await this.app.fileManager.renameFile(oldFile, newPath);
			conv.savedNotePath = newPath;
			await this.conversationStore.save(conv);
		} catch (e) {
			new Notice(`Could not rename file: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	async createConversation(opts: {
		name: string;
		systemPrompt?: string;
		contextNotes?: string[];
		templateId?: string;
		provider?: Provider;
		model?: string;
		maxTokens?: number;
		outputFolder?: string;
		resumeMode?: "full" | "summary" | "hybrid";
		writeMode?: "update" | "create" | "none" | "rewrite" | "all";
	}): Promise<Conversation> {
		const resolvedProvider = opts.provider ?? this.settings.defaultProvider;
		const resolvedModel = opts.model ?? resolveDefaultModelForProvider(resolvedProvider, this.settings);

		const conv: Conversation = {
			id: crypto.randomUUID(),
			name: opts.name,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			templateId: opts.templateId,
			systemPrompt: opts.systemPrompt ?? "",
			contextNotes: opts.contextNotes ?? [],
			resumeMode: opts.resumeMode ?? this.settings.defaultResumeMode,
			provider: resolvedProvider,
			model: resolvedModel,
			maxTokens: opts.maxTokens,
			outputFolder: opts.outputFolder,
			writeMode: opts.writeMode,
			researchMode: this.settings.webSearchDefault,
			messages: [],
		};
		this.conversations.push(conv);
		this.conversationStore.markDirty(conv.id);
		await this.saveConversations();
		return conv;
	}

	async createConversationFromTemplate(
		tpl: PythiaTemplate,
		contextNotes?: string[],
		outputFolder?: string
	): Promise<Conversation> {
		const conv = await this.createConversation({
			name: `${tpl.name} ${todayISO()}`,
			systemPrompt: tpl.systemPrompt,
			contextNotes: contextNotes ?? [...tpl.contextNotes],
			templateId: tpl.id,
			provider: tpl.provider,
			model: tpl.model,
			maxTokens: tpl.maxTokens,
			outputFolder: outputFolder ?? tpl.outputFolder,
		});
		if (tpl.resumeMode) conv.resumeMode = tpl.resumeMode;
		if (tpl.writeMode) conv.writeMode = tpl.writeMode;
		if (tpl.researchMode !== undefined) conv.researchMode = tpl.researchMode;
		if (tpl.temperature !== undefined) conv.temperature = tpl.temperature;
		if (tpl.effort !== undefined) conv.effort = tpl.effort;
		await this.conversationStore.save(conv);
		return conv;
	}

	private resolveTemplateContext(
		tpl: PythiaTemplate,
		activeFile: TFile | null
	): { contextNotes: string[]; outputFolder: string | undefined } {
		const contextNotes = [...tpl.contextNotes];
		if (this.settings.injectActiveNoteOnTemplate && activeFile) {
			if (!contextNotes.includes(activeFile.path)) {
				contextNotes.push(activeFile.path);
			}
		}
		let outputFolder = tpl.outputFolder;
		if (outputFolder === "." && activeFile) {
			const parentPath = activeFile.parent?.path ?? "";
			outputFolder = parentPath === "/" ? "" : parentPath;
		}
		return { contextNotes, outputFolder };
	}

	async cmdNewConversation(): Promise<void> {
		const conv = await this.createConversation({ name: `Conversation ${todayISO()}` });
		const view = await this.activateView();
		await view.setActiveConversation(conv);
	}

	private async cmdNewConversationFromTemplate(): Promise<void> {
		const templates = await this.templateLoader.loadTemplates();
		if (templates.length === 0) {
			new Notice(t("noTemplatesFound", { folder: this.settings.templatesFolder }));
			return;
		}

		// Capture the active note BEFORE the modal opens (it may lose focus)
		const activeFile = this.app.workspace.getActiveFile();

		new TemplateSuggestModal(this.app, templates, async (tpl) => {
			const { contextNotes, outputFolder } = this.resolveTemplateContext(tpl, activeFile);
			const conv = await this.createConversationFromTemplate(tpl, contextNotes, outputFolder);

			const view = await this.activateView();
			await view.setActiveConversation(conv);

			if (contextNotes.length > 0) {
				new Notice(t("loadedTemplate", { name: tpl.name, count: String(contextNotes.length) }));
			}

			if (tpl.autoPrompt) {
				view.triggerAutoPrompt(tpl.autoPrompt);
			}
		}).open();
	}

	private async cmdNewConversationWithCurrentNote(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice(t("noActiveNoteForCommand"));
			return;
		}

		const conv = await this.createConversation({
			name: `${activeFile.basename} ${todayISO()}`,
			contextNotes: [activeFile.path],
		});
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
		const conv = await this.createConversation({ name: `Conversation ${todayISO()}` });
		const view = await this.activateView();
		await view.setActiveConversation(conv);
		view.prefillInput(text);
	}

	async cmdForkConversation(sourceConvId: string, selectedText: string, forkedFromMessageId?: string, forkedFromOccurrenceIndex?: number): Promise<void> {
		const source = this.conversationStore.getById(sourceConvId);
		if (!source) return;

		// Resolve the summary before the fork is created so it's part of the
		// new conversation's context from the moment it opens, rather than
		// arriving asynchronously after the fact.
		let summary = source.summaryText;
		let summaryUpdatedAt = source.summaryUpdatedAt;
		if (!summary && source.messages.length > 0) {
			const notice = new Notice(t("generatingSummary"), 0);
			try {
				summary = await this.llmRouter.generateSummary(source);
				if (summary) {
					summaryUpdatedAt = new Date().toISOString();
					source.summaryText = summary;
					source.summaryUpdatedAt = summaryUpdatedAt;
				}
			} catch (e) {
				new Notice(t("forkSummaryFailed", { error: e instanceof Error ? e.message : String(e) }));
			} finally {
				notice.hide();
			}
		}

		const conv = await this.createConversation({
			name: `Fork of ${source.name}`,
			systemPrompt: source.systemPrompt,
			templateId: source.templateId,
			provider: source.provider,
			model: source.model,
			maxTokens: source.maxTokens,
			contextNotes: source.contextNotes ? [...source.contextNotes] : undefined,
			resumeMode: source.resumeMode,
			outputFolder: source.outputFolder,
			writeMode: source.writeMode,
		});
		conv.temperature = source.temperature;
		conv.effort = source.effort;
		conv.forkedFromId = sourceConvId;
		if (forkedFromMessageId) conv.forkedFromMessageId = forkedFromMessageId;
		if (selectedText) conv.forkedFromSelection = selectedText;
		if (forkedFromOccurrenceIndex !== undefined) conv.forkedFromOccurrenceIndex = forkedFromOccurrenceIndex;
		// Carry the source summary as context only — NOT as the fork's own summary
		// (its own summaryText/favoritesSummary stay empty until the user summarizes
		// the fork, so the source can surface a genuine fork summary at the origin).
		if (summary) conv.forkedFromSummary = summary;
		await this.saveConversations();

		const view = await this.activateView();
		await view.setActiveConversation(conv);
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

	private async cmdSummarizeFavorites(): Promise<void> {
		const view = await this.activateView();
		await view.summarizeFavorites();
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
							if (!this.hasApiKeyFor(conv.provider)) {
								new Notice(t("setApiKeyFirst"));
								return;
							}
							const notice = new Notice(t("generatingConvSummary"), 0);
							try {
								conv.summaryText =
									await this.llmRouter.generateSummary(conv);
								conv.summaryUpdatedAt = new Date().toISOString();
								notice.hide();
							} catch (e) {
								notice.hide();
								new Notice(t("summaryGenerationFailed", { error: e instanceof Error ? e.message : String(e) }));
								return;
							}
						}
						// History is preserved for UI/scrollback and for switching back
						// to "full" mode later. The API-level gate (selectHistoryForSend
						// in services/messageUtils.ts, applied in both providers) is what
						// actually excludes prior messages from the request in "summary"
						// mode — no data is deleted here.
					}

					// The summary generation above can take several seconds — the
					// conversation may have been deleted in the meantime. Don't
					// resurrect/reactivate a conversation that no longer exists.
					if (!this.conversationStore.getById(conv.id)) {
						new Notice(t("convDeletedWhileResuming"));
						return;
					}

					await this.conversationStore.save(conv);
					const view = await this.activateView();
					await view.setActiveConversation(conv);
				}).open();
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
			// Buffer is a Node.js/Electron API — unavailable on iOS/Android.
			// Guard before calling to avoid ReferenceError on mobile.
			if (typeof Buffer === "undefined") return "";
			const electron = (window as any).require?.("electron"); // any: Electron API not in TS types
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
