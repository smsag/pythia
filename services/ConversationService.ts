import { Notice, TFile } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation, Provider, PythiaTemplate } from "../models/types";
import { resolveDefaultModelForProvider } from "../models/knownModels";
import { todayISO } from "../utils";
import { t } from "../i18n";
import { TemplateSuggestModal } from "../suggest/TemplateSuggest";
import { ConversationSuggestModal, FavoritesSuggestModal } from "../suggest/ConversationSuggest";
import { ResumeModeModal } from "../suggest/ResumeModeModal";

/**
 * Conversation creation + the conversation-oriented commands extracted from
 * `PythiaPlugin` (ADR-103, engineering-review #121): create (plain, from
 * template, forked), rename the saved note, and the new/browse/resume/summarize
 * command flows. Behaviour is identical to the inline plugin methods it
 * replaced; cross-service calls go through the plugin's facades.
 */
export class ConversationService {
	constructor(private readonly plugin: PythiaPlugin) {}

	async renameConversationFile(conv: Conversation): Promise<void> {
		const p = this.plugin;
		if (!conv.savedNotePath) return;
		const oldFile = p.app.vault.getAbstractFileByPath(conv.savedNotePath);
		if (!(oldFile instanceof TFile)) return;
		const safeName = conv.name.replace(/[\\/:*?"<>|]/g, "-");
		const dir = oldFile.parent?.path ?? "";
		// Preserve date prefix (YYYY-MM-DD-) if the current filename has one
		const datePrefix = oldFile.basename.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1];
		const newBasename = datePrefix ? `${datePrefix}-${safeName}` : safeName;
		const newPath = dir ? `${dir}/${newBasename}.md` : `${newBasename}.md`;
		if (newPath === conv.savedNotePath) return;
		try {
			await p.app.fileManager.renameFile(oldFile, newPath);
			conv.savedNotePath = newPath;
			await p.conversationStore.save(conv);
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
		const p = this.plugin;
		const resolvedProvider = opts.provider ?? p.settings.defaultProvider;
		const resolvedModel = opts.model ?? resolveDefaultModelForProvider(resolvedProvider, p.settings);

		const conv: Conversation = {
			id: crypto.randomUUID(),
			name: opts.name,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			templateId: opts.templateId,
			systemPrompt: opts.systemPrompt ?? "",
			contextNotes: opts.contextNotes ?? [],
			resumeMode: opts.resumeMode ?? p.settings.defaultResumeMode,
			provider: resolvedProvider,
			model: resolvedModel,
			maxTokens: opts.maxTokens,
			outputFolder: opts.outputFolder,
			writeMode: opts.writeMode,
			researchMode: p.settings.webSearchDefault,
			upvotyMode: p.settings.upvotyDefault,
			messages: [],
		};
		p.conversations.push(conv);
		p.conversationStore.markDirty(conv.id);
		await p.saveConversations();
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
		if (tpl.upvotyMode !== undefined) conv.upvotyMode = tpl.upvotyMode;
		if (tpl.temperature !== undefined) conv.temperature = tpl.temperature;
		if (tpl.effort !== undefined) conv.effort = tpl.effort;
		await this.plugin.conversationStore.save(conv);
		return conv;
	}

	resolveTemplateContext(
		tpl: PythiaTemplate,
		activeFile: TFile | null
	): { contextNotes: string[]; outputFolder: string | undefined } {
		const contextNotes = [...tpl.contextNotes];
		if (this.plugin.settings.injectActiveNoteOnTemplate && activeFile) {
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
		const view = await this.plugin.activateView();
		await view.setActiveConversation(conv);
	}

	async cmdNewConversationFromTemplate(): Promise<void> {
		const p = this.plugin;
		const templates = await p.templateLoader.loadTemplates();
		if (templates.length === 0) {
			new Notice(t("noTemplatesFound", { folder: p.settings.templatesFolder }));
			return;
		}

		// Capture the active note BEFORE the modal opens (it may lose focus)
		const activeFile = p.app.workspace.getActiveFile();

		new TemplateSuggestModal(p.app, templates, async (tpl) => {
			const { contextNotes, outputFolder } = this.resolveTemplateContext(tpl, activeFile);
			const conv = await this.createConversationFromTemplate(tpl, contextNotes, outputFolder);

			const view = await p.activateView();
			await view.setActiveConversation(conv);

			if (contextNotes.length > 0) {
				new Notice(t("loadedTemplate", { name: tpl.name, count: String(contextNotes.length) }));
			}

			if (tpl.autoPrompt) {
				view.triggerAutoPrompt(tpl.autoPrompt);
			}
		}).open();
	}

	async cmdNewConversationWithCurrentNote(): Promise<void> {
		const p = this.plugin;
		const activeFile = p.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice(t("noActiveNoteForCommand"));
			return;
		}

		const conv = await this.createConversation({
			name: `${activeFile.basename} ${todayISO()}`,
			contextNotes: [activeFile.path],
		});
		const view = await p.activateView();
		await view.setActiveConversation(conv);
		new Notice(t("attachedAsContext", { name: activeFile.name }));
	}

	async cmdNewConversationFromClipboard(): Promise<void> {
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
		const view = await this.plugin.activateView();
		await view.setActiveConversation(conv);
		view.prefillInput(text);
	}

	async cmdForkConversation(sourceConvId: string, selectedText: string, forkedFromMessageId?: string, forkedFromOccurrenceIndex?: number): Promise<void> {
		const p = this.plugin;
		const source = p.conversationStore.getById(sourceConvId);
		if (!source) return;

		// Resolve the summary before the fork is created so it's part of the
		// new conversation's context from the moment it opens, rather than
		// arriving asynchronously after the fact.
		let summary = source.summaryText;
		let summaryUpdatedAt = source.summaryUpdatedAt;
		if (!summary && source.messages.length > 0) {
			const notice = new Notice(t("generatingSummary"), 0);
			try {
				summary = await p.llmRouter.generateSummary(source);
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
		await p.saveConversations();

		const view = await p.activateView();
		await view.setActiveConversation(conv);
	}

	async cmdBrowseConversations(): Promise<void> {
		const p = this.plugin;
		if (p.conversations.length === 0) {
			new Notice(t("noConversations"));
			return;
		}

		new ConversationSuggestModal(
			p.app,
			p.conversations,
			async (conv) => {
				const view = await p.activateView();
				await view.setActiveConversation(conv);
			}
		).open();
	}

	async cmdBrowseFavorites(): Promise<void> {
		const p = this.plugin;
		const hasFavorites = p.conversations.some(
			(c) => (c.favorites?.length ?? 0) > 0
		);
		if (!hasFavorites) {
			new Notice(t("noFavorites"));
			return;
		}

		new FavoritesSuggestModal(
			p.app,
			p.conversations,
			async (conv, messageId) => {
				const view = await p.activateView();
				await view.setActiveConversation(conv);
				view.scrollToMessage(messageId);
			}
		).open();
	}

	async cmdSummarizeFavorites(): Promise<void> {
		const view = await this.plugin.activateView();
		await view.summarizeFavorites();
	}

	async cmdResumeConversation(): Promise<void> {
		const p = this.plugin;
		if (p.conversations.length === 0) {
			new Notice(t("noPastConversations"));
			return;
		}

		new ConversationSuggestModal(
			p.app,
			p.conversations,
			(conv) => {
				new ResumeModeModal(p.app, conv, async (mode) => {
					conv.resumeMode = mode;

					if (mode === "summary") {
						if (!conv.summaryText) {
							if (!p.hasApiKeyFor(conv.provider)) {
								new Notice(t("setApiKeyFirst"));
								return;
							}
							const notice = new Notice(t("generatingConvSummary"), 0);
							try {
								conv.summaryText =
									await p.llmRouter.generateSummary(conv);
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
					if (!p.conversationStore.getById(conv.id)) {
						new Notice(t("convDeletedWhileResuming"));
						return;
					}

					await p.conversationStore.save(conv);
					const view = await p.activateView();
					await view.setActiveConversation(conv);
				}).open();
			}
		).open();
	}
}
