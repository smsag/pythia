import { App, Notice, TFile } from "obsidian";
import type { Conversation } from "../models/types";
import type { PythiaSettings } from "../settings";
import type { EmbeddingProvider } from "./embedding/EmbeddingProvider";
import type { IndexStore } from "./embedding/ConversationIndexService";
import { VaultIndexService, type IndexableNote } from "./embedding/VaultIndexService";
import { selectIndexPaths, isPathInScope } from "./embedding/indexScope";
import { relatedMinScore } from "./embedding/relatedConversations";
import { debugLog } from "./messageUtils";
import { t } from "../i18n";

/**
 * Vault-wide semantic RAG orchestration (ADR-116/118/119), extracted from
 * PythiaPlugin. Owns the vault index lifecycle and keeps it strictly OFF the chat
 * send path:
 *  - `getRelevantNotes` (the LLMRouter hook) only ranks against an already-ready
 *    index — embedding just the query — and returns [] until the index is built,
 *    so a turn never waits on indexing.
 *  - `refresh` builds/refreshes the index in the BACKGROUND (cooperative-yield
 *    throttled in VaultIndexService, or off-thread when the Worker backend is
 *    live), with a live progress notice; failures are logged, never surfaced to a
 *    turn.
 *  - `reindex` wipes and rebuilds (after a scope change / on demand).
 *
 * The embedding provider (worker-with-iframe-fallback) is shared with
 * "related conversations" and injected via `getProvider`; `reset()` drops the
 * per-model index when the model changes.
 */
export class VaultRagService {
	private service: VaultIndexService | null = null;
	/** Paths auto-retrieved on the last turn, per conversation id (for the "auto" pills). */
	private lastAutoContext = new Map<string, string[]>();
	private syncing = false;
	private status = "";
	/** One-time "vault too large, capped" warning per session/model. */
	private capWarned = false;

	constructor(
		private readonly app: App,
		private readonly getSettings: () => PythiaSettings,
		/** Returns the shared embedding provider, initializing it (and the model) if needed. */
		private readonly getProvider: () => EmbeddingProvider,
		/** Builds the vault-index persistence store for the current model. */
		private readonly makeStore: () => IndexStore,
	) {}

	/** Drop the per-model index/service (on a model change). */
	reset(): void {
		this.service = null;
		this.status = "";
		this.capWarned = false;
	}

	private ensure(): VaultIndexService {
		const provider = this.getProvider(); // also fixes the current model id for makeStore()
		if (!this.service) this.service = new VaultIndexService(provider, this.makeStore());
		return this.service;
	}

	/** True once the index has been built at least once (see VaultIndexService.isReady). */
	isReady(): boolean {
		return this.service?.isReady() ?? false;
	}

	/** Human-readable index status for the settings tab. */
	getStatus(): string {
		return this.status || t("vaultIndexStatusIdle");
	}

	/** Vault paths auto-retrieved for `conversationId` on its most recent turn. */
	getAutoContext(conversationId: string): string[] {
		return this.lastAutoContext.get(conversationId) ?? [];
	}

	/**
	 * Notes semantically relevant to `query`, for auto-RAG context. Non-blocking:
	 * kicks a background refresh, and returns [] immediately while the index isn't
	 * ready, so the LLM reply is never delayed by indexing. Gating is
	 * per-conversation (`conversation.vaultContext`) with the global default.
	 */
	async getRelevantNotes(conversation: Conversation, query: string, exclude: string[] = []): Promise<string[]> {
		const settings = this.getSettings();
		const enabled = conversation.vaultContext ?? settings.vaultContextEnabled;
		if (!enabled) {
			this.lastAutoContext.delete(conversation.id);
			return [];
		}
		const q = query.trim();
		if (!q) return [];

		this.refresh(); // background build/refresh — never awaited

		const svc = this.ensure();
		if (!svc.isReady()) {
			this.lastAutoContext.set(conversation.id, []);
			return [];
		}

		const minScore = relatedMinScore(settings.vaultContextSimilarity);
		const limit = settings.vaultContextMaxNotes > 0 ? settings.vaultContextMaxNotes : 5;
		const startedAt = Date.now();
		const results = await svc.query(q, { minScore, limit, exclude });
		debugLog(settings, `vault RAG: query (${Date.now() - startedAt}ms)`, {
			returned: results.length,
			top: results.slice(0, 5).map((r) => ({ id: r.id, score: Math.round(r.score * 1000) / 1000 })),
		});
		const paths = results.map((r) => r.id);
		this.lastAutoContext.set(conversation.id, paths);
		return paths;
	}

	/** Build/refresh the index in the background. Coalesced; failures logged only. */
	refresh(): void {
		if (this.syncing) return;
		this.syncing = true;
		void (async () => {
			const startedAt = Date.now();
			const notice = new Notice(t("vaultIndexBuilding"), 0);
			try {
				const { notes, total, capped } = this.collectIndexableNotes();
				// Warn ONCE per session when the vault is too large and got capped, so
				// the user knows to scope to folders rather than silently missing notes.
				if (capped && !this.capWarned) {
					this.capWarned = true;
					new Notice(t("vaultIndexCapped", { indexed: String(notes.length), total: String(total) }), 10000);
				}
				this.status = t("vaultIndexStatusIndexing", { done: "0", total: String(notes.length) });
				await this.ensure().sync(notes, (done, tot) => {
					notice.setMessage(t("vaultIndexProgress", { done: String(done), total: String(tot) }));
					this.status = t("vaultIndexStatusIndexing", { done: String(done), total: String(tot) });
				});
				this.status = t("vaultIndexStatusReady", { count: String(notes.length) });
				debugLog(this.getSettings(), `vault RAG: index synced (${Date.now() - startedAt}ms)`, { indexed: notes.length, inScope: total, capped });
			} catch (e) {
				this.status = t("vaultIndexStatusFailed");
				console.warn("[Pythia] vault RAG: index sync failed", e);
			} finally {
				notice.hide();
				this.syncing = false;
			}
		})();
	}

	/**
	 * Apply targeted, event-driven index updates for the notes that changed (ADR-121)
	 * — one embed per edited note instead of rescanning the whole vault. No-op unless
	 * the index is already built (an unbuilt index is handled by a full `refresh` on
	 * the next turn). Notes edited out of scope are dropped; the note cap still bounds
	 * new additions.
	 */
	async applyChanges(changed: TFile[], deleted: string[]): Promise<void> {
		if (!this.isReady()) return;
		const svc = this.ensure();
		const settings = this.getSettings();
		const norm = (f: string) => (f ?? "").replace(/\/+$/, "");
		const include = settings.vaultContextFolders.map(norm).filter(Boolean);
		const skip = [settings.conversationsFolder, settings.scratchFolder].map(norm).filter(Boolean);

		const removes = [...deleted];
		const updates: IndexableNote[] = [];
		for (const file of changed) {
			if (isPathInScope(file.path, include, skip)) {
				updates.push({ path: file.path, load: () => this.app.vault.cachedRead(file) });
			} else {
				removes.push(file.path); // edited into an out-of-scope / skip folder
			}
		}
		// One persist for the whole batch (ADR-122), not one per note.
		await svc.applyBatch({ updates, removes }, { cap: settings.vaultContextMaxIndexedNotes });
		this.status = t("vaultIndexStatusReady", { count: String(svc.size()) });
	}

	/** Full reindex: clear the index, then rebuild in the background. */
	async reindex(): Promise<void> {
		if (this.syncing) { new Notice(t("vaultIndexBusy")); return; }
		try {
			await this.ensure().clear();
		} catch (e) {
			console.warn("[Pythia] vault RAG: clear failed", e);
		}
		this.refresh();
	}

	/** Notes to index as LAZY refs (path + content loader): the configured folders
	 *  (empty = whole vault) minus Pythia's own folders, trimmed to the note cap.
	 *  Only paths are materialized here — content is read one note at a time during
	 *  the streamed sync, so peak memory stays bounded on huge vaults (ADR-120). */
	private collectIndexableNotes(): { notes: IndexableNote[]; total: number; capped: boolean } {
		const settings = this.getSettings();
		const norm = (f: string) => (f ?? "").replace(/\/+$/, "");
		const include = settings.vaultContextFolders.map(norm).filter(Boolean);
		const skip = [settings.conversationsFolder, settings.scratchFolder].map(norm).filter(Boolean);

		const files = this.app.vault.getMarkdownFiles();
		const byPath = new Map(files.map((f) => [f.path, f]));
		const { paths, total, capped } = selectIndexPaths([...byPath.keys()], {
			include,
			skip,
			cap: settings.vaultContextMaxIndexedNotes,
		});
		const notes: IndexableNote[] = paths.map((path) => ({
			path,
			load: () => this.app.vault.cachedRead(byPath.get(path)!),
		}));
		return { notes, total, capped };
	}
}
