import { App, Notice, TFile } from "obsidian";
import type { Conversation } from "../models/types";
import type { PythiaSettings } from "../settings";
import type { EmbeddingProvider } from "./embedding/EmbeddingProvider";
import type { IndexStore } from "./embedding/ConversationIndexService";
import { VaultIndexService, type IndexableNote } from "./embedding/VaultIndexService";
import { retrievalQuery, isIndexingOptedOut } from "./embedding/vaultRetrieval";
import { selectIndexPaths, isPathInScope } from "./embedding/indexScope";
import { vaultRetrievalMinScore } from "./embedding/relatedConversations";
import { embedChunkChars, vectorFamily, type EmbeddingModelId } from "../models/embeddingModels";
import type { BuildGuard } from "./embedding/buildGuard";
import { isOutOfMemoryError } from "./embedding/memoryError";
import { peekIndexMeta } from "./embedding/embeddingIndex";
import { stateFromFile, type VaultIndexStatus } from "./embedding/indexStatus";
import { decideBuild } from "./embedding/buildDecision";
import { hashPolicyFor } from "./embedding/rowProvenance";
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
 *
 * Automatic builds go through a `BuildGuard` (ADR-199): a build the OS killed
 * leaves a marker behind, and after two of those in a row the next one waits
 * for the user instead of crashing the app again on the next send.
 */

/** The index half of the settings status; the plugin adds the model half. */
export type VaultIndexSnapshot = Pick<
	VaultIndexStatus,
	"state" | "count" | "done" | "total" | "error" | "outOfMemory" | "marker" | "backend"
>;

type Phase =
	| { kind: "idle" }
	| { kind: "loading" }
	| { kind: "building"; done: number; total: number }
	/** `loadFailed`: the model never loaded, so the provider has memoized the
	 *  rejection and an automatic retry cannot do anything but fail again (#358). */
	| { kind: "failed"; error: string; outOfMemory: boolean; loadFailed: boolean };
export class VaultRagService {
	private service: VaultIndexService | null = null;
	/** Paths auto-retrieved on the last turn, per conversation id (for the "auto" pills). */
	private lastAutoContext = new Map<string, string[]>();
	private syncing = false;
	private phase: Phase = { kind: "idle" };
	/** One-time "the build is paused" notice per session (ADR-199). */
	private pausedNoticeShown = false;
	private readonly listeners = new Set<() => void>();
	/** One-time "vault too large, capped" warning per session/model. */
	private capWarned = false;
	/** One-time "indexing is throttled on this device" notice per session. */
	private throttleNoticeShown = false;
	/** Which embedding backend actually started, once known (ADR-182). */
	private backend: string | null = null;
	/** Edits that arrived while the index was still building (ADR-184). The
	 *  watcher clears its own batch when it flushes, so without this they were
	 *  dropped for the rest of the session — `applyChanges` no-ops until the index
	 *  is ready, and the first build is exactly when it is not. */
	private deferredChanges: { changed: Map<string, TFile>; deleted: Set<string> } | null = null;
	/** The index file's header, remembered between status reads (#361).
	 *  `undefined` = not read yet, `null` = read and there is no usable file.
	 *  `IndexStore.read()` returns the WHOLE binary — ~19 MB at the 5 000-note cap —
	 *  and the settings row asks for the status on every change event, so a partial
	 *  or out-of-date index had the user paying for that file repeatedly to learn
	 *  64 bytes. Dropped whenever this session could have changed the file. */
	private fileMeta: ReturnType<typeof peekIndexMeta> | undefined = undefined;

	constructor(
		private readonly app: App,
		private readonly getSettings: () => PythiaSettings,
		/** Returns the shared embedding provider, initializing it (and the model) if needed. */
		private readonly getProvider: () => EmbeddingProvider,
		/** Builds the vault-index persistence store for the current model. */
		private readonly makeStore: () => IndexStore,
		private readonly deps: {
			/** The model this device embeds with — `effectiveEmbeddingModel`, never
			 *  the raw setting (ADR-199). */
			modelId: () => EmbeddingModelId;
			/** The crash-loop breaker; absent in tests that do not exercise it. */
			guard?: BuildGuard | null;
		},
	) {}

	/** Drop the per-model index/service (on a model change). */
	reset(): void {
		this.service = null;
		this.phase = { kind: "idle" };
		this.capWarned = false;
		this.backend = null;
		this.deferredChanges = null;
		this.fileMeta = undefined; // a different model means a different file
		this.emit();
	}

	/** Called on every status change (settings tab live line). Returns the unsubscribe. */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		for (const l of this.listeners) {
			try { l(); } catch (e) { console.warn("[Pythia] vault RAG: status listener failed", e); }
		}
	}

	/** Obsidian went to the background or came back (ADR-202). While a build runs,
	 *  its marker records that, so an iOS background kill is not counted as a crash. */
	onBackground(hidden: boolean): void {
		if (this.syncing) this.deps.guard?.markBackground(hidden);
	}

	/** Whether a build is running — the embedding model must not be released under it. */
	isBuilding(): boolean {
		return this.syncing;
	}

	/** Plugin unload. A build cut short by a normal unload (quit, reload, disable)
	 *  is not a crash, so its marker must not count toward the pause. */
	dispose(): void {
		if (this.syncing) this.deps.guard?.end();
		this.listeners.clear();
	}

	/**
	 * What this index is an index OF (ADR-184): the folders, the skip folders, the
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
		// The family, not the variant (ADR-200): the desktop's index must read as
		// complete on a phone running the vector-identical variant.
		return JSON.stringify([folders, skip, s.vaultContextMaxIndexedNotes, vectorFamily(this.deps.modelId())]);
	}

	private ensure(): VaultIndexService {
		const provider = this.getProvider(); // also fixes the current model id for makeStore()
		if (!this.service) {
			// Chunks sized to the MODEL's token window rather than a shared 500 chars
			// (ADR-182) — the window is a property of the model, so the chunk is too.
			// The conversation index keeps 500 on purpose: ADR-169's floors were
			// measured there.
			this.service = new VaultIndexService(provider, this.makeStore(), {
				maxChars: embedChunkChars(this.deps.modelId()),
				// Rows shared with the other device are reused only when this model
				// would have produced them (ADR-201).
				hashPolicy: hashPolicyFor(this.deps.modelId()),
			});
		}
		return this.service;
	}

	/** True once the index has been built at least once (see VaultIndexService.isReady). */
	isReady(): boolean {
		return this.service?.isReady() ?? false;
	}

	/**
	 * Where the index stands, for the settings tab (ADR-199). Never loads the
	 * model: a session that has not built reads the file's header instead, so a
	 * complete index on disk says "ready" rather than "builds on first use". The
	 * backend is included once known (ADR-182) — `iframe (UI thread)` is the
	 * single fact that explains a slow build.
	 */
	async status(): Promise<VaultIndexSnapshot> {
		const base: VaultIndexSnapshot = {
			state: "notBuilt", count: 0, done: 0, total: 0, error: null, outOfMemory: false,
			marker: this.deps.guard?.marker() ?? null, backend: this.backend,
		};
		const phase = this.phase;
		if (phase.kind === "loading") return { ...base, state: "loading" };
		if (phase.kind === "building") return { ...base, state: "building", done: phase.done, total: phase.total };
		if (phase.kind === "failed") return { ...base, state: "failed", error: phase.error, outOfMemory: phase.outOfMemory };
		const scope = this.scopeSignature();
		if (this.service?.isComplete(scope)) return { ...base, state: "ready", count: this.service.size() };
		let file = this.fileMeta ?? null;
		if (this.fileMeta === undefined) {
			try {
				const buf = await this.makeStore().read();
				file = buf ? peekIndexMeta(buf) : null;
				this.fileMeta = file;
			} catch (e) {
				// Reported as "not built", which is what the next build will act on —
				// but logged, because an unreadable index file is worth a report. NOT
				// cached: a read that threw has told us nothing to remember.
				console.warn("[Pythia] vault RAG: could not read the index for its status", e);
			}
		}
		const state = stateFromFile(file, scope);
		// Paused whatever the file says (ADR-201). A paused session never loads the
		// model — not even to embed a query — so a COMPLETE index is not used either;
		// calling that "ready" left vault context dead behind a green status with
		// Build now disabled. The count still says what is kept.
		const paused = !(this.deps.guard?.mayAutoBuild() ?? true);
		return { ...base, state: paused ? "paused" : state, count: file?.count ?? 0 };
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
		// (ADR-183) — a short follow-up otherwise embeds four tokens and retrieves
		// noise, which is exactly the turn that needed the conversation's context.
		const lastAnswer = [...(conversation.messages ?? [])]
			.reverse()
			.find((m) => m?.role === "assistant" && typeof m.content === "string");
		const q = retrievalQuery(query, lastAnswer?.content ?? "");
		if (!q) return [];

		this.refresh(); // background FIRST build only — never awaited; no-op once ready

		// The service exists once a build has resolved the provider. Not `ensure()`:
		// that constructs the provider, and a paused build (ADR-199) must not so
		// much as announce a model it is not going to load.
		const svc = this.service;
		if (!svc?.isReady()) {
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
		// (ADR-184). The index is a cache of a decision, and it can lag the decision:
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
	refresh(opts: { force?: boolean; manual?: boolean; clear?: boolean } = {}): void {
		if (this.syncing) return;
		const guard = this.deps.guard;
		// Whether this build runs at all is a decision with six inputs, so it is
		// made in one pure place and tested as a table (ADR-203) — `buildDecision.ts`
		// holds the reasoning behind each answer.
		const decision = decideBuild(opts, {
			syncing: false, // returned above
			// COMPLETE, not ready (ADR-184): `isReady()` is true the moment a
			// persisted file is hydrated, and that file may be a fifth of an
			// interrupted build.
			complete: this.service?.isComplete(this.scopeSignature()) ?? false,
			mayAutoBuild: guard?.mayAutoBuild() ?? true,
			loadFailed: this.phase.kind === "failed" && this.phase.loadFailed,
		});
		if (!decision.run) {
			if (decision.blocked === "paused") {
				if (!this.pausedNoticeShown) {
					this.pausedNoticeShown = true;
					new Notice(t("vaultIndexPausedNotice"), 12000);
				}
				debugLog(this.getSettings(), "vault RAG: automatic build paused after interrupted builds", guard?.marker());
			} else if (decision.blocked === "loadFailed") {
				// No Notice and no marker: the status line already says what happened
				// and names "Build now", and starting the build here is what turned
				// one failed load into a pause (#358).
				debugLog(this.getSettings(), "vault RAG: automatic build skipped — the model failed to load in this session");
			}
			return;
		}
		if (opts.manual) guard?.end();
		this.syncing = true;
		this.fileMeta = undefined; // this build is about to change the file
		guard?.start(this.deps.modelId());
		// Loading, not "building 0 of 0": the model download and load is the longest
		// part of a first build on a phone, and the part that must not look stuck.
		this.setPhase({ kind: "loading" });
		void (async () => {
			const startedAt = Date.now();
			let notice: Notice | null = null;
			/** Whether the model itself loaded. Everything after this point fails
			 *  with a model known to be good, which is a different thing to retry
			 *  (#358/#359) — see `buildDecision.ts`. */
			let loaded = false;
			try {
				// Resolve the backend so we know whether inference is off-thread; ready()
				// is memoized, so this is cheap after the first call.
				const provider = this.getProvider();
				// A press after a failed load must LOAD again (#357). The provider
				// memoizes its rejection for the session — right for automatic retries,
				// which must not hammer an out-of-memory load — so without this reset a
				// manual retry failed in a millisecond and the status never moved: the
				// buttons looked dead.
				if (decision.reloadProvider) provider.unload();
				await provider.ready();
				loaded = true;
				const offThread = provider.isOffThread?.() ?? false;
				this.backend = provider.backend?.() ?? null;
				const svc = this.ensure();
				// "Rebuild index" discards the rows only now, with a model that loaded
				// (#357). Clearing first and then failing to load destroyed a good index
				// for nothing.
				if (opts.clear) await svc.clear();

				const scope = this.scopeSignature();
				// UI-thread backend: don't re-embed a vault that is already indexed — that
				// would freeze the app every session. Hydrate the persisted index and, if
				// the build behind it FINISHED under this scope, serve queries against it
				// without rebuilding.
				//
				// `size() > 0` was the old test and became wrong the moment ADR-182 made
				// builds persist mid-flight: a partial file has rows, so an interrupted
				// build was served forever as though complete (ADR-184). A partial or
				// out-of-scope index now falls through and resumes, throttled.
				if (!offThread) {
					await svc.hydrateForQuery();
					if (svc.isComplete(scope)) {
						guard?.end();
						this.setPhase({ kind: "idle" });
						// The edits buffered while the index was not yet hydrated land
						// HERE or nowhere (#360). This return is the phone's normal path —
						// a complete index, a UI-thread backend — and it used to skip the
						// replay that the build path below does, so every note edited
						// between launch and the first send stayed at its old vector until
						// it happened to be edited again.
						await this.flushDeferredChanges();
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
				this.setPhase({ kind: "building", done: 0, total: notes.length });
				// On the UI thread, yield after every note with a breather so Obsidian stays
				// responsive during the build; off-thread keeps the coarse default cadence.
				const throttle = offThread ? {} : { yieldEveryNotes: 1, breatherMs: 12 };
				await svc.sync(notes, (done, tot) => {
					notice?.setMessage(t("vaultIndexProgress", { done: String(done), total: String(tot) }));
					this.setPhase({ kind: "building", done, total: tot });
				}, throttle, scope);
				guard?.end();
				this.setPhase({ kind: "idle" });
				await this.flushDeferredChanges();
				debugLog(this.getSettings(), `vault RAG: index synced (${Date.now() - startedAt}ms)`, { indexed: notes.length, inScope: total, capped, offThread, backend: this.backend });
			} catch (e) {
				const outOfMemory = isOutOfMemoryError(e);
				// A caught error is not a crash — the process survived to report it —
				// EXCEPT out of memory, which is the same event one allocation short of
				// a kill. Its marker stays, so it counts toward the pause (ADR-199).
				if (!outOfMemory) guard?.end();
				this.setPhase({ kind: "failed", error: e instanceof Error ? e.message : String(e), outOfMemory, loadFailed: !loaded });
				console.warn("[Pythia] vault RAG: index sync failed", e);
			} finally {
				notice?.hide();
				this.syncing = false;
				this.fileMeta = undefined; // the build has rewritten it (or tried to)
				this.emit();
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
		// (ADR-184). Hold them instead and replay once the build lands.
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
		this.fileMeta = undefined; // the batch may have rewritten the file
		this.emit();
	}

	private setPhase(phase: Phase): void {
		this.phase = phase;
		this.emit();
	}

	/** Replay the edits that arrived mid-build (ADR-184). Runs after a completed
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
		// The rows are cleared inside the build, after the model has loaded (#357).
		this.refresh({ force: true, manual: true, clear: true }); // an explicit rebuild is the one caller that always runs
	}

	/** "Build now": finish or resume the index WITHOUT discarding what is there —
	 *  the settings action for a paused, unfinished or outdated index (ADR-199). */
	buildNow(): void {
		if (this.syncing) { new Notice(t("vaultIndexBusy")); return; }
		this.refresh({ force: true, manual: true });
	}

	/** Whether this note opts out of the index with `pythia: false` in its
	 *  frontmatter (ADR-183). Read from the metadata cache, so it costs no file
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
		// rather than whatever order the adapter happened to return (ADR-183). That
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
