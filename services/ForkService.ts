import { Notice } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { effectiveTheme } from "./glossaryNotes";
import { favoritesSeed, seedState } from "./favoritesFork";
import type { ConversationService } from "./ConversationService";

/**
 * Forks: a new conversation that branches from an existing one (ADR-097's
 * passage fork, ADR-255's fork from favorites), and the one later change a
 * fork from favorites takes — the source's newer summary, on the user's tap.
 *
 * Split from `ConversationService` when the second kind of fork pushed it over
 * the file-size budget (ADR-097); a fork is created through that service's
 * `createConversation`, like every other conversation.
 */
export class ForkService {
	constructor(
		private readonly plugin: PythiaPlugin,
		private readonly conversations: Pick<ConversationService, "createConversation">,
	) {}

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

		const conv = await this.createForkOf(source);
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

	/**
	 * A new conversation that is a fork of `source`: its settings, its link
	 * back, its theme. What the fork carries as context is the caller's —
	 * a passage and the source's summary, or the favorites summary (ADR-255).
	 */
	private async createForkOf(source: Conversation): Promise<Conversation> {
		const conv = await this.conversations.createConversation({
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
		conv.forkedFromId = source.id;
		// Resolve the source's theme rather than copying `theme` verbatim: a source
		// that is following its own name would otherwise hand the fork "undefined",
		// and the fork would then follow its OWN name instead of inheriting
		// anything. Pinning it also means renaming the fork leaves the theme alone,
		// which is what "inherited, but changeable" has to mean (ADR-150).
		conv.theme = effectiveTheme(source);
		return conv;
	}

	/**
	 * Fork from a conversation's favorites (ADR-255). The fork starts empty and
	 * carries a snapshot of the source's favorites summary in every system
	 * prompt — and nothing else from the source: not its conversation summary
	 * (the favorites are the user's own filter of it, and the full summary
	 * would bring back what they left out), not a passage.
	 *
	 * The caller has made sure the summary is current; this re-reads the source
	 * by id, because that took an await (principle 7).
	 */
	async cmdForkFromFavorites(sourceConvId: string): Promise<Conversation | null> {
		const p = this.plugin;
		const source = p.conversationStore.getById(sourceConvId);
		const seed = source ? favoritesSeed(source) : null;
		if (!source || !seed) {
			new Notice(t("noFavoritesToSummarize"));
			return null;
		}
		const conv = await this.createForkOf(source);
		conv.forkedFromFavorites = seed;
		await p.saveConversations();

		const view = await p.activateView();
		await view.setActiveConversation(conv);
		return conv;
	}

	/**
	 * Take the source's newer favorites summary into a fork (ADR-255, the
	 * reference pill's ↻). Explicit by design: the snapshot changes only when
	 * the user asks. Both conversations are read by id at the moment of the
	 * tap; a source that is gone, or holds nothing newer, changes nothing.
	 */
	async updateForkedFavorites(forkId: string): Promise<boolean> {
		const p = this.plugin;
		const fork = p.conversationStore.getById(forkId);
		const source = fork?.forkedFromId ? p.conversationStore.getById(fork.forkedFromId) : undefined;
		if (!fork?.forkedFromFavorites || seedState(fork.forkedFromFavorites, source) !== "outdated") return false;
		const seed = source ? favoritesSeed(source) : null;
		if (!source || !seed) return false;
		fork.forkedFromFavorites = seed;
		await p.conversationStore.save(fork);
		new Notice(t("favoritesSeedUpdated", { name: source.name }));
		return true;
	}
}
