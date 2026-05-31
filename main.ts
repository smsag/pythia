import { Editor, Menu, Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, PythiaSettings, PythiaSettingTab } from "./settings";
import { t } from "./i18n";
import type { Conversation, Provider } from "./models/types";
import { getFilesInFolder, todayISO } from "./utils";
import { PythiaSidebarView, PYTHIA_VIEW_TYPE } from "./sidebar";
import { ConversationSuggestModal, FavoritesSuggestModal } from "./suggest/ConversationSuggest";
import { TemplateSuggestModal } from "./suggest/TemplateSuggest";
import { ResumeModeModal } from "./suggest/ResumeModeModal";
import { AnthropicService } from "./services/AnthropicService";
import { OpenAIProvider } from "./services/OpenAIProvider";
import { LLMRouter } from "./services/LLMRouter";
import { ConversationStore } from "./services/ConversationStore";
import { TemplateLoader } from "./services/TemplateLoader";
import { NoteWriter } from "./services/NoteWriter";

export default class PythiaPlugin extends Plugin {
	settings!: PythiaSettings;
	conversations!: Conversation[];
	/** Number of conversations successfully loaded from disk at startup.
	 *  Used as a safety guard in persistData() to detect empty-load anomalies. */
	private loadedConversationCount = 0;
	/** Set by watchDataJson() so persistData() can stamp the own-write time. */
	private saveDataRecordTime: (() => void) | null = null;
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

		// Watch data.json for external changes (iCloud/Obsidian Sync delivering
		// updates from another device while this instance is running).
		// When detected, reload from disk and refresh the sidebar.
		this.watchDataJson();

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
			id: "copy-conversation-link",
			name: "Copy link to current conversation",
			callback: () => this.cmdCopyConversationLink(),
		});

		this.addCommand({
			id: "new-conversation-from-clipboard",
			name: "New conversation from clipboard",
			callback: () => this.cmdNewConversationFromClipboard(),
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
		// Flush any pending debounced save so the last conversation state
		// is written to disk before the plugin unloads.
		await this.conversationStore?.flush();
		this.llmRouter?.abort();
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

		// ── Migration: outputLanguage stored as human-readable string → locale code ──
		if (saved.outputLanguage === "English") { saved.outputLanguage = "en"; needsMigrationSave = true; }
		if (saved.outputLanguage === "German")  { saved.outputLanguage = "de"; needsMigrationSave = true; }

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
		// Record how many conversations we loaded so persistData() can detect
		// an accidental empty-load (e.g. iCloud evicted the file to cloud-only
		// before we read it) and refuse to overwrite real data with [].
		this.loadedConversationCount = this.conversations.length;

		// getSecret() is async in Obsidian's current typings (truly async on iOS WebKit). (#18)
		this.plaintextApiKey =
			(await this.app.secretStorage.getSecret(this.settings.anthropicSecretName)) ?? "";
		this.plaintextOpenAIKey =
			(await this.app.secretStorage.getSecret(this.settings.openaiSecretName)) ?? "";

		if (needsMigrationSave) {
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

	async saveSettings(): Promise<void> {
		await this.persistData();
		this.templateLoader?.updateSettings(this.settings);
		this.noteWriter?.updateSettings(this.settings);
	}

	async saveConversations(): Promise<void> {
		await this.persistData();
	}

	private async persistData(): Promise<void> {
		// Safety guard: if we loaded N conversations at startup but are about to
		// persist 0, something went wrong (iCloud eviction, partial initialisation,
		// failed loadData). Refuse to overwrite real data with an empty array.
		// The user explicitly deleting all conversations is handled by checking
		// whether the in-memory array was intentionally emptied vs never loaded.
		if (this.conversations.length === 0 && this.loadedConversationCount > 0) {
			new Notice(
				"[Pythia] Safety: refusing to save an empty conversation list — " +
				"loaded count was " + this.loadedConversationCount + ". " +
				"Restart Obsidian if this persists.",
				10_000
			);
			console.error(
				"[Pythia] persistData() aborted: conversations is empty but " +
				this.loadedConversationCount + " were loaded at startup."
			);
			return;
		}

		// Evict oldest non-starred conversations beyond the cap (#3).
		// Always protect the currently open conversation even if it has no starred
		// messages — evicting the active conversation would silently lose new turns (#17).
		const cap = this.settings.maxConversations;
		if (cap > 0 && this.conversations.length > cap) {
			const sidebarLeaf = this.app.workspace.getLeavesOfType(PYTHIA_VIEW_TYPE)[0];
			const activeId = sidebarLeaf
				? (sidebarLeaf.view as PythiaSidebarView).activeConversationId
				: null;

			const protected_ = this.conversations.filter(
				c => (c.favorites?.length ?? 0) > 0 || c.id === activeId
			);
			const plain = this.conversations
				.filter(c => (c.favorites?.length ?? 0) === 0 && c.id !== activeId)
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
			const slots = Math.max(0, cap - protected_.length);
			this.conversations = [
				...protected_,
				...plain.slice(0, slots),
			].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
		}

		try {
			this.saveDataRecordTime?.();   // stamp own-write time before the watcher can fire
			await this.saveData({
				settings: this.settings,
				conversations: this.conversations,
			});
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
					await this.loadPluginData();
					// Refresh the sidebar with the updated conversation list.
					const leaves = this.app.workspace.getLeavesOfType(PYTHIA_VIEW_TYPE);
					for (const leaf of leaves) {
						const view = leaf.view as PythiaSidebarView;
						const still = this.conversations.find(c => c.id === view.activeConversationId);
						const next  = still ?? this.conversations[0] ?? null;
						if (next) await view.setActiveConversation(next, false);
					}
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

	private async generateAndInjectSummary(conv: Conversation, content: string): Promise<void> {
		try {
			const summary = await this.llmRouter.summarizeNotes(content, conv.provider);
			if (summary) {
				conv.summaryText = summary;
				conv.summaryUpdatedAt = new Date().toISOString();
				await this.conversationStore.save(conv);
				const view = this.getSidebarView();
				if (view?.getActiveConversation()?.id === conv.id) {
					view.refreshSummaryBar();
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
		maxTokens?: number,
		outputFolder?: string
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
			outputFolder,
			messages: [],
		};
		this.conversations.push(conv);
		await this.saveConversations();
		return conv;
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

		// Capture the active note BEFORE the modal opens (it may lose focus)
		const activeFile = this.app.workspace.getActiveFile();

		new TemplateSuggestModal(this.app, templates, async (tpl) => {
			// Resolve context notes: template's own notes + active note (if setting is on)
			const contextNotes = [...tpl.contextNotes];
			if (this.settings.injectActiveNoteOnTemplate && activeFile) {
				if (!contextNotes.includes(activeFile.path)) {
					contextNotes.push(activeFile.path);
				}
			}

			// Resolve output folder: "." means same folder as the active note
			let outputFolder = tpl.outputFolder;
			if (outputFolder === "." && activeFile) {
				const parentPath = activeFile.parent?.path ?? "";
				outputFolder = parentPath === "/" ? "" : parentPath;
			}

			const conv = await this.createConversation(
				`${tpl.name} ${todayISO()}`,
				tpl.systemPrompt,
				contextNotes,
				tpl.id,
				tpl.provider,
				tpl.model,
				tpl.maxTokens,
				outputFolder
			);
			if (tpl.resumeMode) conv.resumeMode = tpl.resumeMode;
			await this.conversationStore.save(conv);

			const view = await this.activateView();
			await view.setActiveConversation(conv);

			const totalContext = contextNotes.length;
			if (totalContext > 0) {
				new Notice(t("loadedTemplate", { name: tpl.name, count: String(totalContext) }));
			}

			// Fire auto_prompt immediately after the conversation is ready
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

	async cmdForkConversation(sourceConvId: string, selectedText: string, forkedFromMessageId?: string): Promise<void> {
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
		if (forkedFromMessageId) conv.forkedFromMessageId = forkedFromMessageId;
		if (selectedText) conv.forkedFromSelection = selectedText;
		await this.saveConversations();

		if (!source.summaryText && source.messages.length > 0) {
			this.llmRouter.generateSummary(source).then(async (summary) => {
				if (summary) {
					source.summaryText = summary;
					source.summaryUpdatedAt = new Date().toISOString();
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

	private async cmdCopyConversationLink(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(PYTHIA_VIEW_TYPE);
		const view = leaves[0]?.view as PythiaSidebarView | undefined;
		const convId = view?.activeConversationId;
		if (!convId) {
			new Notice(t("noActiveConvToSend"));
			return;
		}
		const link = `obsidian://pythia?cmd=resume&id=${encodeURIComponent(convId)}`;
		await navigator.clipboard.writeText(link);
		new Notice(t("convLinkCopied"));
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
								conv.summaryUpdatedAt = new Date().toISOString();
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
