import { TFile, type App } from "obsidian";
import type { Conversation } from "../models/types";
import type { PythiaSettings } from "../models/settings";
import { debugLog } from "./messageUtils";
import type { SchreibstubeLink } from "./schreibstubeLink";
import { contextScope, isIndexingOptedOut, isPathInScope, retrievalQuery } from "./vaultContext";

/** Notes asked for per turn beyond the limit, so the ones the scope drops can be
 *  replaced from further down the list rather than leaving the turn short. */
const OVERFETCH = 3;

/**
 * Vault context for a turn (ADR-116, ADR-224): the notes that answer it,
 * found by Schreibstube's search by meaning and filtered by what Pythia may
 * send. Without Schreibstube there are none — Pythia has no model of its own
 * any more — and the turn goes out with the notes attached by hand, as it
 * always could.
 */
export class VaultContextService {
	/** The notes each conversation's last turn drew in, for the reference row. */
	private readonly lastAutoContext = new Map<string, string[]>();

	constructor(
		private readonly app: App,
		private readonly getSettings: () => PythiaSettings,
		private readonly schreibstube: SchreibstubeLink
	) {}

	/** Whether a turn with vault context on could draw notes here and now. */
	available(): boolean {
		return this.schreibstube.available();
	}

	getAutoContext(conversationId: string): string[] {
		return this.lastAutoContext.get(conversationId) ?? [];
	}

	/** Paths of the notes that answer `query`, best first; `exclude` are the notes
	 *  already attached by hand. */
	async getRelevantNotes(conversation: Conversation, query: string, exclude: string[] = []): Promise<string[]> {
		const settings = this.getSettings();
		const enabled = conversation.vaultContext ?? settings.vaultContextEnabled;
		if (!enabled) {
			this.lastAutoContext.delete(conversation.id);
			return [];
		}
		const lastAnswer = [...(conversation.messages ?? [])]
			.reverse()
			.find((m) => m?.role === "assistant" && typeof m.content === "string");
		const text = retrievalQuery(query, lastAnswer?.content ?? "");
		if (!text) return [];

		const limit = settings.vaultContextMaxNotes > 0 ? settings.vaultContextMaxNotes : 5;
		const found = await this.schreibstube.searchNotes(text, limit * OVERFETCH, exclude);
		const { include, skip } = contextScope(settings);
		const paths = found
			.filter((path) => isPathInScope(path, include, skip) && !this.optedOut(path))
			.slice(0, limit);
		debugLog(settings, "vault context", { asked: text.length, found: found.length, kept: paths });
		this.lastAutoContext.set(conversation.id, paths);
		return paths;
	}

	/** `pythia: false` in the note's frontmatter. Fail open: a cache that cannot
	 *  be read has not said the note opted out (ADR-183). */
	private optedOut(path: string): boolean {
		try {
			const file = this.app.vault.getAbstractFileByPath(path);
			return file instanceof TFile && isIndexingOptedOut(this.app.metadataCache?.getFileCache(file)?.frontmatter);
		} catch {
			return false;
		}
	}
}
