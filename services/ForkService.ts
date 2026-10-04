import { Notice } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { effectiveTheme } from "./glossaryNotes";
import { favoritesSeed, seedSourceId, seedState } from "./favoritesFork";
import type { ConversationService, ForkFields } from "./ConversationService";

/**
 * Forks: a new conversation that branches from an existing one (ADR-097's
 * passage fork, ADR-255's fork from favorites), and the later changes a fork
 * from favorites takes — the source's newer summary on ↻, and the pill's
 * off / on switch — always on the user's tap.
 *
 * Split from `ConversationService` when the second kind of fork pushed it over
 * the file-size budget (ADR-097); a fork is created through that service's
 * `createConversation`, like every other conversation, with everything that
 * makes it a fork in its first write.
 */
export class ForkService {
	constructor(
		private readonly plugin: PythiaPlugin,
		private readonly conversations: Pick<ConversationService, "createConversation">,
	) {}

	async cmdForkConversation(sourceConvId: string, selectedText: string, forkedFromMessageId?: string, forkedFromOccurrenceIndex?: number): Promise<void> {
		const p = this.plugin;
		let source = p.conversationStore.getById(sourceConvId);
		if (!source) return;

		// Resolve the summary before the fork is created so it's part of the
		// new conversation's context from the moment it opens, rather than
		// arriving asynchronously after the fact.
		let summary = source.summaryText;
		if (!summary && source.messages.length > 0) {
			const notice = new Notice(t("generatingSummary"), 0);
			try {
				summary = await p.llmRouter.generateSummary(source);
				// An await is a boundary in time (principle 7): the summary goes onto
				// the conversation the store holds NOW, saved through the store so it
				// is marked changed — never onto the object read before the call.
				const live = p.conversationStore.getById(sourceConvId);
				if (summary && live) {
					live.summaryText = summary;
					live.summaryUpdatedAt = new Date().toISOString();
					await p.conversationStore.save(live);
				}
				if (live) source = live;
				// "" is how a utility call reports both "no text" and "failed" (ADR-158):
				// the fork still opens, but the user is told it lacks the source's topic.
				if (!summary) new Notice(t("forkSummaryEmpty"));
			} catch (e) {
				new Notice(t("forkSummaryFailed", { error: e instanceof Error ? e.message : String(e) }));
			} finally {
				notice.hide();
			}
		}

		const conv = await this.createForkOf(source, {
			...(forkedFromMessageId ? { forkedFromMessageId } : {}),
			...(selectedText ? { forkedFromSelection: selectedText } : {}),
			...(forkedFromOccurrenceIndex !== undefined ? { forkedFromOccurrenceIndex } : {}),
			// Carry the source summary as context only — NOT as the fork's own summary
			// (its own summaryText/favoritesSummary stay empty until the user summarizes
			// the fork, so the source can surface a genuine fork summary at the origin).
			...(summary ? { forkedFromSummary: summary } : {}),
			// A branch of a fork from favorites keeps the ground every answer it
			// branched from was built on (ADR-255 review 2) — the snapshot as it is,
			// its source and its on/off state included. It is still a passage fork.
			...(source.forkedFromFavorites ? { forkedFromFavorites: { ...source.forkedFromFavorites } } : {}),
		});
		// Opened where the source is shown — with two Pythia leaves, not the first one.
		const view = await p.viewShowing(sourceConvId);
		await view.setActiveConversation(conv);
	}

	/**
	 * A new conversation that is a fork of `source`: its settings, its link
	 * back, its theme, and what the caller says it carries — all in the first
	 * write (ADR-255 review: assigned after it, a reload could swap the object
	 * and the fork would be saved without them).
	 */
	private createForkOf(source: Conversation, carries: ForkFields): Promise<Conversation> {
		return this.conversations.createConversation({
			name: `Fork of ${source.name}`,
			systemPrompt: source.systemPrompt,
			templateId: source.templateId,
			provider: source.provider,
			model: source.model,
			maxTokens: source.maxTokens,
			temperature: source.temperature,
			effort: source.effort,
			contextNotes: source.contextNotes ? [...source.contextNotes] : undefined,
			resumeMode: source.resumeMode,
			outputFolder: source.outputFolder,
			writeMode: source.writeMode,
			fork: {
				forkedFromId: source.id,
				// Resolve the source's theme rather than copying `theme` verbatim: a
				// source that is following its own name would otherwise hand the fork
				// "undefined", and the fork would then follow its OWN name instead of
				// inheriting anything. Pinning it also means renaming the fork leaves
				// the theme alone — "inherited, but changeable" (ADR-150).
				theme: effectiveTheme(source),
				// The source's pinned answer language, so a fork answers as it did
				// (undefined stays undefined: inherited stays inherited, principle 6).
				...(source.outputLanguage ? { outputLanguage: source.outputLanguage } : {}),
				...carries,
			},
		});
	}

	/**
	 * Fork from a conversation's favorites (ADR-255). The fork starts empty and
	 * carries a snapshot of the source's favorites summary in every system
	 * prompt — and nothing else from the source: not its conversation summary
	 * (the favorites are the user's own filter of it, and the full summary
	 * would bring back what they left out), not a passage.
	 *
	 * The caller has made sure the summary is current; this re-reads the source
	 * by id, because that took an await (principle 7), and says which of the two
	 * things went missing meanwhile.
	 */
	async cmdForkFromFavorites(sourceConvId: string): Promise<Conversation | null> {
		const p = this.plugin;
		const source = p.conversationStore.getById(sourceConvId);
		if (!source) {
			new Notice(t("forkSourceGone"));
			return null;
		}
		const seed = favoritesSeed(source);
		if (!seed) {
			new Notice(t("favoritesSummaryMissing"));
			return null;
		}
		const conv = await this.createForkOf(source, { forkedFromFavorites: seed });
		const view = await p.viewShowing(sourceConvId);
		await view.setActiveConversation(conv);
		return conv;
	}

	/**
	 * Take the source's newer favorites summary into a fork (ADR-255, the
	 * pill's ↻). Explicit by design: the snapshot changes only when the user
	 * asks. Both conversations are read by id at the moment of the tap, and a
	 * tap that changes nothing says why — the button was drawn when it could.
	 */
	async updateForkedFavorites(forkId: string): Promise<boolean> {
		const p = this.plugin;
		const fork = p.conversationStore.getById(forkId);
		if (!fork?.forkedFromFavorites) return false; // the pill is gone with it: nothing was offered
		const fromId = seedSourceId(fork);
		const source = fromId ? p.conversationStore.getById(fromId) : undefined;
		const seed = source ? favoritesSeed(source) : null;
		if (!source) {
			new Notice(t("forkSourceGone"));
			return false;
		}
		if (!seed) {
			new Notice(t("favoritesSummaryMissing"));
			return false;
		}
		if (seedState(fork.forkedFromFavorites, source) !== "outdated") {
			new Notice(t("favoritesSeedAlreadyCurrent"));
			return false;
		}
		// Taking the newer summary does not switch a muted snapshot back on.
		fork.forkedFromFavorites = { ...seed, ...(fork.forkedFromFavorites.off ? { off: true as const } : {}) };
		await p.conversationStore.save(fork);
		new Notice(t("favoritesSeedUpdated", { name: source.name }));
		return true;
	}

	/**
	 * The pill's × and its "send again" (ADR-255 review). The snapshot is never
	 * deleted: once the source is gone it is the only copy, and it is what marks
	 * the conversation as a fork from favorites.
	 */
	async setForkedFavoritesSent(forkId: string, sent: boolean): Promise<void> {
		const p = this.plugin;
		const fork = p.conversationStore.getById(forkId);
		const seed = fork?.forkedFromFavorites;
		if (!fork || !seed) return;
		const { off: _off, ...rest } = seed;
		fork.forkedFromFavorites = sent ? rest : { ...rest, off: true };
		await p.conversationStore.save(fork);
	}
}
