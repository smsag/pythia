import { Notice } from "obsidian";
import type { Conversation } from "../models/types";
import type { GlossaryEntry } from "../services/glossary";
import { t } from "../i18n";

/**
 * Writing a forked discussion back into its term's note (ADR-208).
 *
 * Extracted from `HeaderController` rather than written there: the header owns
 * a menu row, not a vault write, and the header is the one file in the UI layer
 * where a rule of this kind cannot be tested — it needs a mounted view. The seam
 * is structural (`TermDiscussionHost`), not the plugin, so a test satisfies it
 * with a plain object; the same shape ADR-205 used for the embedding hub.
 */
export interface TermDiscussionHost {
	/** Every known entry, frontmatter only — `GlossaryService.all`. */
	all(): Promise<GlossaryEntry[]>;
	/** Resolve a term or one of its surface forms to its entry. */
	find(entries: GlossaryEntry[], term: string): GlossaryEntry | null | undefined;
	/** Read the entry's definition off disk — `all()` leaves it empty. */
	hydrate(entry: GlossaryEntry): Promise<GlossaryEntry>;
	/** Distil the conversation. "" when it settled nothing. */
	summarize(term: string, definition: string, conversation: Conversation): Promise<string>;
	/** Write the section. Null when nothing was written, having said why. */
	save(term: string, text: string): Promise<GlossaryEntry | null>;
	/** A long-lived "working" notice; returns its dismisser. */
	progress(message: string): () => void;
	notify(message: string): void;
}

/**
 * Distil `conversation` into the term it was opened from.
 *
 * The request is the confirmation — there is no proposal card, unlike a rewrite
 * (ADR-178), because the write lands in a section that holds nothing but earlier
 * runs of this same command. The definition, the contexts and every property are
 * untouched.
 *
 * Every outcome speaks (principle 2). The entry can be gone — the note is the
 * user's and they may have deleted it since the fork — and the discussion can
 * have settled nothing, which `save` refuses and reports rather than writing an
 * empty section.
 */
export async function saveTermDiscussion(
	host: TermDiscussionHost,
	conversation: Conversation,
): Promise<GlossaryEntry | null> {
	const term = conversation.glossaryTerm?.trim();
	if (!term) return null;
	const found = host.find(await host.all(), term);
	if (!found) {
		host.notify(t("termDiscussionNoEntry", { term }));
		return null;
	}
	const entry = await host.hydrate(found);
	const done = host.progress(t("termDiscussionSaving", { term }));
	try {
		const text = await host.summarize(term, entry.definition, conversation);
		const saved = await host.save(term, text);
		if (saved) host.notify(t("termDiscussionSaved", { term }));
		return saved;
	} catch (e) {
		host.notify(t("termDiscussionFailed", { error: e instanceof Error ? e.message : String(e) }));
		return null;
	} finally {
		done();
	}
}

/** The host backed by the running plugin. Kept here so the header names one thing. */
export function vaultTermDiscussionHost(plugin: {
	glossaryService: {
		all(): Promise<GlossaryEntry[]>;
		find(entries: GlossaryEntry[], term: string): GlossaryEntry | undefined;
		hydrate(entry: GlossaryEntry): Promise<GlossaryEntry>;
		saveDiscussion(term: string, text: string): Promise<GlossaryEntry | null>;
	};
	llmRouter: {
		summarizeTermDiscussion(term: string, definition: string, conversation: Conversation): Promise<string>;
	};
}): TermDiscussionHost {
	const g = plugin.glossaryService;
	return {
		all: () => g.all(),
		find: (entries, term) => g.find(entries, term),
		hydrate: (entry) => g.hydrate(entry),
		summarize: (term, definition, conv) => plugin.llmRouter.summarizeTermDiscussion(term, definition, conv),
		save: (term, text) => g.saveDiscussion(term, text),
		progress: (message) => {
			const notice = new Notice(message, 0);
			return () => notice.hide();
		},
		notify: (message) => { new Notice(message); },
	};
}
