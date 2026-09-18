import { App, Notice, TFile } from "obsidian";
import type { Conversation } from "../models/types";
import type { PythiaSettings } from "../settings";
import type { EmbeddingProvider } from "./embedding/EmbeddingProvider";
import type { IndexStore } from "./embedding/ConversationIndexService";
import { VaultIndexService, type IndexableNote } from "./embedding/VaultIndexService";
import { retrievalQuery, isIndexingOptedOut } from "./embedding/vaultRetrieval";
import { selectIndexPaths, isPathInScope } from "./embedding/indexScope";
import { vaultRetrievalMinScore } from "./embedding/relatedConversations";
import { embedChunkChars } from "../models/embeddingModels";
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
	/** One-time "indexing is throttled on this device" notice per session. */
	private throttleNoticeShown = false;
	/** Which embedding backend actually started, once known (ADR-179). */
	private backend: string | null = null;
	/** Edits that arrived while the index was still building (ADR-181). The
	 *  watcher clears its own batch when it flushes, so without this they were
	 *  dropped for the rest of the session — `applyChanges` no-ops until the index
	 *  is ready, and the first build is exactly when it is not. */
	private deferredChanges: { changed: Map<string, TFile>; deleted: Set<string> } | null = null;

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
		this.backend = null;
		this.deferredChanges = null;
	}

	/**
	 * What this index is an index OF (ADR-181): the folders, the skip folders, the
	 * note cap and the model. Persisted with the rows, so a session that starts
	 * with different settings can tell the file no longer matches them.
	 *
	 * Narrowing `vaultContextFolders` is the case that matters: until the index is
	 * rebuilt it still holds notes that are now out of scope, and retrieval would
	 * keep inlining them into prompts. That is a privacy decision the user made
	 * and the index has to honour.
	 */
	private scopeSignature(): string {
		const s = this.getSettings();
		const folders = [...s.vaultContextFolders].map((f) => (f ?? "").replace(/\/+$/, "")).filter(Boolean).sort();
		const skip = [s.conversationsFolder, s.scratchFolder].map((f) => (f ?? "").replace(/\/+$/, "")).filter(Boolean).sort();
		return JSON.stringify([folders, skip, s.vaultContextMaxIndexedNotes, s.embeddingModelId]);
	}

	private ensure(): VaultIndexService {
		const provider = this.getProvider(); // also fixes the current model id for makeStore()
		if (!this.service) {
			// Chunks sized to the MODEL's token window rather than a shared 500 chars
			// (ADR-179) — the window is a property of the model, so the chunk is too.
			// The conversation index keeps 500 on purpose: ADR-169's floors were
			// measured there.
			this.service = new VaultIndexService(provider, this.makeStore(), {
				maxChars: embedChunkChars(this.getSettings().embeddingModelId),
			});
		}
		return this.service;
	}

	/** True once the index has been built at least once (see VaultIndexService.isReady). */
	isReady(): boolean {
		return this.service?.isReady() ?? false;
	}

	/** Human-readable index status for the settings tab, with the embedding backend
	 *  once it is known (ADR-179) — `iframe (UI thread)` there is the single fact
	 *  that explains a slow build, and it used to be invisible. */
	getStatus(): string {
		const status = this.status || t("vaultIndexStatusIdle");
		return this.backend ? `${status} ${t("vaultIndexBackend", { backend: this.backend })}` : status;
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
		// The retrieval query is the message PLUS the head of the preceding answer
		// (ADR-180) — a short follow-up otherwise embeds four tokens and retrieves
		// noise, which is exactly the turn that needed the conversation's context.
		const lastAnswer = [...(conversation.messages ?? [])]
			.reverse()
			.find((m) => m?.role === "assistant" && typeof m.content === "string");
		const q = retrievalQuery(query, lastAnswer?.content ?? "");
		if (!q) return [];

		this.refresh(); // background FIRST build only — never awaited; no-op once ready

		const svc = this.ensure();
		if (!svc.isReady()) {
			this.lastAutoContext.set(conversation.id, []);
			return [];
		}

		// Vault RAG keeps the model-agnostic floors: ADR-169 measured conversation
		// pairs, not query-to-note retrieval (vaultRetrievalMinScore names why).
		const minScore = vaultRetrievalMinScore(settings.vaultContextSimilarity);
		const limit = settings.vaultContextMaxNotes > 0 ? settings.vaultContextMaxNotes : 5;
		const startedAt = Date.now();
		const results = await svc.query(q, { minScore, limit, exclude });
		debugLog(settings, `vault RAG: query (${Date.now() - startedAt}ms)`, {
			returned: results.length,
			top: results.slice(0, 5).map((r) => ({ id: r.id, score: Math.round(r.score * 1000) / 1000 })),
		});
		// Filter the RESULTS by the live scope and opt-out, not just the index
		// (ADR-181). The index is a cache of a decision, and it can lag the decision:
		// a note whose `pythia: false` was added on another device, or one left
		// behind by a scope the user has since narrowed, is still in the rows until
		// a rebuild. A privacy control has to hold at the point the text would
		// actually leave the vault, which is here.
		const paths = this.inScopeNow(results.map((r) => r.id));
		this.lastAutoContext.set(conversation.id, paths);
		return paths;
	}

	/** Drop retrieved paths that today's settings would not have indexed. */
	private inScopeNow(paths: string[]): string[] {
		const settings = this.getSettings();
		const norm = (f: string) => (f ?? "").replace(/\/+$/, "");
		const include = settings.vaultContextFolders.map(norm).filter(Boolean);
		const skip = [settings.conversationsFolder, settings.scratchFolder].map(norm).filter(Boolean);
		const kept = paths.filter((path) => {
			if (!isPathInScope(path, include, skip)) return false;
			return !this.optedOutPath(path);
		});
		if (kept.length !== paths.length) {
			debugLog(settings, "vault RAG: dropped retrieved notes the current scope excludes", {
				dropped: paths.filter((p) => !kept.includes(p)),
			});
		}
		return kept;
	}

	/** Build/refresh the index in the background. Coalesced; failures logged only.
	 *  The embedding backend may be OFF-thread (a real Web Worker) or ON the renderer
	 *  UI thread (the iframe fallback — when blob-URL Workers are blocked, e.g. Obsidian
	 *  mobile and some desktop builds). On the UI-thread backend a full build is
	 *  THROTTLED (fine yields + a breather) so it never freezes the app, and an
	 *  already-populated index is served as-is rather than re-embedded each session
	 *  (ADR-125). Incremental edits keep it fresh via `applyChanges`. */
	refresh(opts: { force?: boolean } = {}): void {
		if (this.syncing) return;
		// A COMPLETE index is kept fresh by the watcher's targeted `applyChanges`
		// (ADR-121), so re-running a whole-corpus scan on every turn re-paid the
		// exact cost that ADR removed: reading, chunking and hashing every in-scope
		// note, on the host thread, per send — plus a "Building the vault index…"
		// notice flashing each time. `reindex` passes `force`.
		//
		// COMPLETE, not ready (ADR-181). `isReady()` is true the moment a persisted
		// file is hydrated, and since ADR-179 that file can be a fifth of an
		// interrupted build — gating on it meant such a build was never resumed and
		// reported itself finished. It is also false when the scope changed, so
		// narrowing the folders rebuilds instead of leaving them retrievable.
		if (!opts.force && this.service?.isComplete(this.scopeSignature())) return;
		this.syncing = true;
		void (async () => {
			const startedAt = Date.now();
			let notice: Notice | null = null;
			try {
				// Resolve the backend so we know whether inference is off-thread; ready()
				// is memoized, so this is cheap after the first call.
				const provider = this.getProvider();
				await provider.ready();
				const offThread = provider.isOffThread?.() ?? false;
				this.backend = provider.backend?.() ?? null;
				const svc = this.ensure();

				const scope = this.scopeSignature();
				// UI-thread backend: don't re-embed a vault that is already indexed — that
				// would freeze the app every session. Hydrate the persisted index and, if
				// the build behind it FINISHED under this scope, serve queries against it
				// without rebuilding.
				//
				// `size() > 0` was the old test and became wrong the moment ADR-179 made
				// builds persist mid-flight: a partial file has rows, so an interrupted
				// build was served forever as though complete (ADR-181). A partial or
				// out-of-scope index now falls through and resumes, throttled.
				if (!offThread) {
					await svc.hydrateForQuery();
					if (svc.isComplete(scope)) {
						this.status = t("vaultIndexStatusReady", { count: String(svc.size()) });
						return;
					}
					if (svc.size() > 0) {
						debugLog(this.getSettings(), "vault RAG: resuming an unfinished index on the UI thread", {
							have: svc.size(), indexedScope: svc.indexedScope(), scope,
						});
					}
				}

				const { notes, total, capped } = this.collectIndexableNotes();
				// Warn ONCE per session when the vault is too large and got capped, so
				// the user knows to scope to folders rather than silently missing notes.
				if (capped && !this.capWarned) {
					this.capWarned = true;
					new Notice(t("vaultIndexCapped", { indexed: String(notes.length), total: String(total) }), 10000);
				}
				// Tell the user ONCE when a build runs on the UI thread (slower, throttled).
				if (!offThread && !this.throttleNoticeShown) {
					this.throttleNoticeShown = true;
					new Notice(t("vaultIndexThrottled"), 10000);
				}
				notice = new Notice(t("vaultIndexBuilding"), 0);
				this.status = t("vaultIndexStatusIndexing", { done: "0", total: String(notes.length) });
				// On the UI thread, yield after every note with a breather so Obsidian stays
				// responsive during the build; off-thread keeps the coarse default cadence.
				const throttle = offThread ? {} : { yieldEveryNotes: 1, breatherMs: 12 };
				await svc.sync(notes, (done, tot) => {
					notice?.setMessage(t("vaultIndexProgress", { done: String(done), total: String(tot) }));
					this.status = t("vaultIndexStatusIndexing", { done: String(done), total: String(tot) });
				}, throttle, scope);
				this.status = t("vaultIndexStatusReady", { count: String(notes.length) });
				await this.flushDeferredChanges();
				debugLog(this.getSettings(), `vault RAG: index synced (${Date.now() - startedAt}ms)`, { indexed: notes.length, inScope: total, capped, offThread, backend: this.backend });
			} catch (e) {
				this.status = t("vaultIndexStatusFailed");
				console.warn("[Pythia] vault RAG: index sync failed", e);
			} finally {
				notice?.hide();
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
		// Not ready yet — almost always the first build, which is exactly when the
		// user is still editing. The watcher has already cleared its own batch, so
		// returning here USED to drop these edits for the rest of the session
		// (ADR-181). Hold them instead and replay once the build lands.
		if (!this.isReady()) {
			const buf = (this.deferredChanges ??= { changed: new Map(), deleted: new Set() });
			for (const f of changed) { buf.changed.set(f.path, f); buf.deleted.delete(f.path); }
			for (const path of deleted) { buf.deleted.add(path); buf.changed.delete(path); }
			return;
		}
		const svc = this.ensure();
		const settings = this.getSettings();
		const norm = (f: string) => (f ?? "").replace(/\/+$/, "");
		const include = settings.vaultContextFolders.map(norm).filter(Boolean);
		const skip = [settings.conversationsFolder, settings.scratchFolder].map(norm).filter(Boolean);

		const removes = [...deleted];
		const updates: IndexableNote[] = [];
		for (const file of changed) {
			if (isPathInScope(file.path, include, skip) && !this.optedOut(file)) {
				updates.push({ path: file.path, load: () => this.app.vault.cachedRead(file) });
			} else {
				removes.push(file.path); // edited into an out-of-scope / skip folder
			}
		}
		// One persist for the whole batch (ADR-122), not one per note.
		await svc.applyBatch({ updates, removes }, { cap: settings.vaultContextMaxIndexedNotes });
		this.status = t("vaultIndexStatusReady", { count: String(svc.size()) });
	}

	/** Replay the edits that arrived mid-build (ADR-181). Runs after a completed
	 *  sync, which has already read every note from disk — so anything saved
	 *  BEFORE the build reached it is already current, and this only costs an embed
	 *  for the ones it did not. Cleared first, so a failure cannot replay forever. */
	private async flushDeferredChanges(): Promise<void> {
		const buf = this.deferredChanges;
		this.deferredChanges = null;
		if (!buf || (buf.changed.size === 0 && buf.deleted.size === 0)) return;
		debugLog(this.getSettings(), "vault RAG: replaying edits made during the build", {
			changed: buf.changed.size, deleted: buf.deleted.size,
		});
		await this.applyChanges([...buf.changed.values()], [...buf.deleted]);
	}

	/** Full reindex: clear the index, then rebuild in the background (throttled when
	 *  the backend runs on the UI thread — see `refresh`). */
	async reindex(): Promise<void> {
		if (this.syncing) { new Notice(t("vaultIndexBusy")); return; }
		try {
			await this.ensure().clear();
		} catch (e) {
			console.warn("[Pythia] vault RAG: clear failed", e);
		}
		this.refresh({ force: true }); // an explicit rebuild is the one caller that always runs
	}

	/** Whether this note opts out of the index with `pythia: false` in its
	 *  frontmatter (ADR-180). Read from the metadata cache, so it costs no file
	 *  I/O; an uncached file reads as "not opted out", matching the helper's rule
	 *  that only an explicit false excludes. */
	private optedOutPath(path: string): boolean {
		try {
			const file = this.app.vault.getAbstractFileByPath(path);
			return file instanceof TFile && this.optedOut(file);
		} catch {
			// Same fail-open rule as `optedOut`, and for the same reason: a vault API
			// that cannot resolve the path has not told us the note opted out. An
			// unresolvable path is reported as a missing note downstream anyway,
			// which is the honest outcome — silently dropping every retrieved note
			// because a lookup threw would disable retrieval with no explanation.
			return false;
		}
	}

	private optedOut(file: TFile): boolean {
		try {
			return isIndexingOptedOut(this.app.metadataCache?.getFileCache(file)?.frontmatter);
		} catch {
			// Fail OPEN, deliberately. A cache that is not there yet, or throws, must
			// not decide the scope — and it must certainly not take the whole build
			// down from inside the file scan. Indexing a note is the status quo; the
			// opt-out is an explicit `pythia: false`, which this could not read.
			return false;
		}
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

		// Newest first, so a capped vault indexes the notes actually being worked in
		// rather than whatever order the adapter happened to return (ADR-180). That
		// order is not stable between sessions, which made the cap's membership
		// churn — notes silently entering and leaving retrieval, and re-embedding
		// each time they came back.
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => !this.optedOut(f))
			.sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));
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
