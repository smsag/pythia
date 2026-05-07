import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, PythiaSettings, PythiaSettingTab } from "./settings";
import type { Conversation, Provider } from "./models/types";
import { PythiaSidebarView, PYTHIA_VIEW_TYPE } from "./sidebar";
import { ConversationSuggestModal } from "./suggest/ConversationSuggest";
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

	// Services — initialised in onload()
	llmRouter!: LLMRouter;
	conversationStore!: ConversationStore;
	templateLoader!: TemplateLoader;
	noteWriter!: NoteWriter;

	// ──────────────────────────────────────────────
	// Lifecycle
	// ──────────────────────────────────────────────

	async onload(): Promise<void> {
		await this.loadPluginData();

		const anthropicSvc = new AnthropicService(this.app, this.settings, this.plaintextApiKey);
		const openaiSvc = new OpenAIProvider(this.app, this.settings, this.plaintextOpenAIKey);
		this.llmRouter = new LLMRouter(anthropicSvc, openaiSvc);
		this.conversationStore = new ConversationStore(this);
		this.templateLoader = new TemplateLoader(this.app, this.settings);
		this.noteWriter = new NoteWriter(this.app, this.settings);

		// Register sidebar view
		this.registerView(
			PYTHIA_VIEW_TYPE,
			(leaf) => new PythiaSidebarView(leaf, this)
		);

		// Ribbon icon
		this.addRibbonIcon("bot", "Pythia", () =>
			this.activateView()
		);

		// Settings tab
		this.addSettingTab(new PythiaSettingTab(this.app, this));

		// Commands
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
			id: "save-response-as-note",
			name: "Save response as note",
			callback: () => this.cmdSaveResponseAsNote(),
		});
	}

	async onunload(): Promise<void> {
		this.llmRouter.abort();
	}

	// ──────────────────────────────────────────────
	// Data persistence
	// ──────────────────────────────────────────────

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
			}
			delete saved.encryptedOpenAIKey;
			needsMigrationSave = true;
		}

		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		this.conversations = (data.conversations ?? []) as Conversation[];

		// Read keys from Obsidian SecretStorage (synchronous, vault-scoped)
		this.plaintextApiKey =
			this.app.secretStorage.getSecret(this.settings.anthropicSecretName) ?? "";
		this.plaintextOpenAIKey =
			this.app.secretStorage.getSecret(this.settings.openaiSecretName) ?? "";

		// Persist any migrations
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
		// Propagate updated settings to individual providers via router is handled
		// by re-reading settings from the shared settings reference (injected via constructor).
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

	// ──────────────────────────────────────────────
	// View management
	// ──────────────────────────────────────────────

	async activateView(): Promise<PythiaSidebarView> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(PYTHIA_VIEW_TYPE)[0] as
			| WorkspaceLeaf
			| undefined;
		if (!leaf) {
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

	// ──────────────────────────────────────────────
	// Conversation factory
	// ──────────────────────────────────────────────

	async createConversation(
		name: string,
		systemPrompt = "",
		contextNotes: string[] = [],
		templateId?: string,
		provider?: Provider,
		model?: string
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
			messages: [],
		};
		this.conversations.push(conv);
		await this.saveConversations();
		return conv;
	}

	// ──────────────────────────────────────────────
	// Commands
	// ──────────────────────────────────────────────

	private async cmdNewConversation(): Promise<void> {
		const date = new Date().toISOString().slice(0, 10);
		const conv = await this.createConversation(`Conversation ${date}`);
		const view = await this.activateView();
		await view.setActiveConversation(conv);
	}

	private async cmdNewConversationFromTemplate(): Promise<void> {
		const templates = await this.templateLoader.loadTemplates();
		if (templates.length === 0) {
			new Notice(
				`No templates found in "${this.settings.templatesFolder}". Create a note with \`pythia_template: true\` in its frontmatter.`
			);
			return;
		}

		new TemplateSuggestModal(this.app, templates, async (tpl) => {
			const date = new Date().toISOString().slice(0, 10);
			const conv = await this.createConversation(
				`${tpl.name} ${date}`,
				tpl.systemPrompt,
				[...tpl.contextNotes],
				tpl.id,
				tpl.provider,
				tpl.model
			);
			if (tpl.resumeMode) conv.resumeMode = tpl.resumeMode;
			await this.conversationStore.save(conv);

			const view = await this.activateView();
			await view.setActiveConversation(conv);

			if (tpl.contextNotes.length > 0) {
				new Notice(
					`Loaded template "${tpl.name}" with ${tpl.contextNotes.length} context note(s).`
				);
			}
		}).open();
	}

	private async cmdNewConversationWithCurrentNote(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("No active note. Open a note first.");
			return;
		}

		const date = new Date().toISOString().slice(0, 10);
		const conv = await this.createConversation(
			`${activeFile.basename} ${date}`,
			"",
			[activeFile.path]
		);
		const view = await this.activateView();
		await view.setActiveConversation(conv);
		new Notice(`Attached "${activeFile.name}" as context.`);
	}

	private async cmdResumeConversation(): Promise<void> {
		if (this.conversations.length === 0) {
			new Notice("No past conversations found.");
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
							if (!this.plaintextApiKey) {
								new Notice(
									"Set your API key in settings before generating a summary."
								);
								return;
							}
							const notice = new Notice(
								"Generating conversation summary…",
								0
							);
							try {
								conv.summaryText =
									await this.llmRouter.generateSummary(conv);
								// Clear history — it is now represented by the summary
								conv.messages = [];
								await this.conversationStore.save(conv);
								notice.hide();
							} catch (e) {
								notice.hide();
								new Notice(
									`Summary generation failed: ${e instanceof Error ? e.message : String(e)}`
								);
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
		const response = view?.getLastAssistantMessage();
		if (!response) {
			new Notice("No assistant response to save. Open the sidebar first.");
			return;
		}

		const conv = view!.getActiveConversation();
		const date = new Date().toISOString().slice(0, 10);
		const safeName = (conv?.name ?? "response").replace(
			/[\\/:*?"<>|]/g,
			"-"
		);

		let defaultFolder = this.settings.scratchFolder;
		if (conv?.templateId) {
			const tplFile = this.app.vault.getAbstractFileByPath(
				conv.templateId
			);
			if (tplFile) {
				const tpl = await this.templateLoader.loadTemplate(
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
					await this.noteWriter.writeNote(response, path);
					new Notice(`Saved to ${path}`);

					// Optionally auto-save summary note alongside the output
					if (this.settings.autoSaveSummary && conv) {
						const summary = conv.summaryText
							? conv.summaryText
							: `Conversation: ${conv.name}`;
						await this.noteWriter.saveSummaryNote(
							conv,
							summary,
							path
						);
					}
				} catch (e) {
					new Notice(
						`Save failed: ${e instanceof Error ? e.message : String(e)}`
					);
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
