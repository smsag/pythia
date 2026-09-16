import { Notice, TFile } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation, EffortLevel, Provider, PythiaTemplate } from "../models/types";
import { resolveDefaultModelForProvider } from "../models/knownModels";
import { todayISO } from "../utils";
import { safeNoteName } from "./pathUtils";
import { t } from "../i18n";
import { effectiveTheme } from "./glossaryNotes";
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

	/**
	 * Rename a conversation, keeping everything that follows its name in step
	 * (ADR-150).
	 *
	 * One place, because the name is renamed from four: the header's rename box,
	 * the two summarize-with-title flows, and the automatic title after the first
	 * exchange. A theme that follows the conversation name has to follow it from
	 * all four, and the old name is only available *before* the assignment — which
	 * is exactly why this cannot live inside `renameConversationFile`.
	 */
	async renameConversation(conv: Conversation, newName: string): Promise<void> {
		const name = newName.trim();
		if (!name || name === conv.name) return;
		const previous = conv.name;
		conv.name = name;
		await this.plugin.conversationStore.save(conv);
		// Only when the theme is following the name. A pinned theme is the user's
		// own label and must not be renamed out from under them.
		if (conv.theme === undefined) {
			await this.plugin.glossaryService?.renameTheme(previous, name);
		}
		await this.renameConversationFile(conv);
	}

	async renameConversationFile(conv: Conversation): Promise<void> {
		const p = this.plugin;
		if (!conv.savedNotePath) return;
		const oldFile = p.app.vault.getAbstractFileByPath(conv.savedNotePath);
		if (!(oldFile instanceof TFile)) return;
		const safeName = safeNoteName(conv.name);
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
		temperature?: number;
		effort?: EffortLevel;
		researchMode?: boolean;
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
			researchMode: opts.researchMode ?? p.settings.webSearchDefault,
			...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
			...(opts.effort !== undefined ? { effort: opts.effort } : {}),
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
		// Everything the template sets goes in at creation — one write to disk,
		// and never a moment where the conversation exists without its settings.
		return this.createConversation({
			name: `${tpl.name} ${todayISO()}`,
			systemPrompt: tpl.systemPrompt,
			contextNotes: contextNotes ?? [...tpl.contextNotes],
			templateId: tpl.id,
			provider: tpl.provider,
			model: tpl.model,
			maxTokens: tpl.maxTokens,
			outputFolder: outputFolder ?? tpl.outputFolder,
			resumeMode: tpl.resumeMode,
			writeMode: tpl.writeMode,
			researchMode: tpl.researchMode,
			temperature: tpl.temperature,
			effort: tpl.effort,
		});
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
		// Resolve the source's theme rather than copying `theme` verbatim: a source
		// that is following its own name would otherwise hand the fork "undefined",
		// and the fork would then follow its OWN name instead of inheriting
		// anything. Pinning it also means renaming the fork leaves the theme alone,
		// which is what "inherited, but changeable" has to mean (ADR-150).
		conv.theme = effectiveTheme(source);
		await p.saveConversations();

		const view = await p.activateView();
		await view.setActiveConversation(conv);
	}

	/**
	 * Merge — the inverse of fork (ADR-130). A passage selected in an assistant
	 * answer is pointed at an existing conversation: the user searches all other
	 * conversations, picks one, and that conversation's summary is surfaced
	 * inline at the passage (generated first if it has none).
	 *
	 * Display-only by design: the link is recorded on the conversation holding
	 * the passage and never enters the system prompt.
	 */
	async cmdMergeConversation(
		convId: string,
		selectedText: string,
		messageId: string,
		occurrenceIndex?: number,
	): Promise<void> {
		const p = this.plugin;
		const conv = p.conversationStore.getById(convId);
		const text = selectedText.trim();
		if (!conv || !text) return;

		const candidates = p.conversations.filter((c) => c.id !== convId);
		if (candidates.length === 0) {
			new Notice(t("mergeNoOtherConversations"));
			return;
		}

		// The link target is chosen in the conversation panel the header loupe opens,
		// not in a modal of its own (ADR-143). ADR-107 made that panel the single
		// in-view conversation search, and picking a conversation is still searching
		// for one — a second surface would mean two different-looking searches over
		// the same list, reachable from the same screen.
		const view = await p.activateView();
		view.pickConversation({
			excludeId: convId,
			placeholder: t("mergeSearchPlaceholder"),
			onPick: (target) => void this.linkToConversation(p, conv, target, messageId, text, occurrenceIndex ?? 0),
		});
	}

	/** Record the link once the user has chosen its target. Split out of
	 *  `cmdMergeConversation` so the picker callback stays a single line. */
	private async linkToConversation(
		p: PythiaPlugin,
		conv: Conversation,
		target: Conversation,
		messageId: string,
		text: string,
		occurrenceIndex: number,
	): Promise<void> {
		// Same passage, same target → don't stack a duplicate link; just reveal
		// the one that already exists.
		const existing = (conv.merges ?? []).find(
			(m) =>
				m.messageId === messageId &&
				m.text.trim() === text &&
				m.occurrenceIndex === occurrenceIndex,
		);
		if (existing) {
			const linkedTo = p.conversationStore.getById(existing.conversationId);
			new Notice(t("mergeAlreadyLinked", { name: linkedTo?.name ?? target.name }));
			const view = await p.activateView();
			view.revealMergeLink(existing.id);
			return;
		}

		// Resolve the target's summary BEFORE the anchor opens, so confirming a
		// merge always lands on a populated preview rather than an empty one that
		// fills in later. Mirrors the fork path's await-then-open ordering (ADR-042).
		if (!target.summaryText?.trim() && target.messages.length > 0) {
			const notice = new Notice(t("generatingSummary"), 0);
			try {
				// generateSummary, not generateSummaryWithTitle: merging must never
				// rename a conversation the user already named (see MergeController).
				const summary = await p.llmRouter.generateSummary(target);
				if (summary) {
					target.summaryText = summary;
					target.summaryUpdatedAt = new Date().toISOString();
					await p.conversationStore.save(target);
				}
			} catch (e) {
				new Notice(t("summaryFailed", { error: e instanceof Error ? e.message : String(e) }));
			} finally {
				notice.hide();
			}
		}

		const link = {
			id: crypto.randomUUID(),
			conversationId: target.id,
			messageId,
			text,
			occurrenceIndex,
			createdAt: new Date().toISOString(),
		};
		conv.merges = [...(conv.merges ?? []), link];
		await p.conversationStore.save(conv);

		const view = await p.activateView();
		view.repaintMergeMessage(messageId);
		view.revealMergeLink(link.id);
		new Notice(t("mergeLinked", { name: target.name }));
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
								const summary = await p.llmRouter.generateSummary(conv);
								notice.hide();
								// "" is not a summary (ADR-158): resuming in summary mode on an
								// empty one would send the model no context at all, silently.
								if (!summary) {
									new Notice(t("summaryEmpty"), 8000);
									return;
								}
								conv.summaryText = summary;
								conv.summaryUpdatedAt = new Date().toISOString();
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
