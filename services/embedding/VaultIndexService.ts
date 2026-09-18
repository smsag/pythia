import type { EmbeddingProvider } from "./EmbeddingProvider";
import type { IndexStore } from "./ConversationIndexService";
import {
	conversationContentHash,
	serializeIndex,
	deserializeIndex,
	EMPTY_INDEX_META,
	type IndexedConversation,
	type IndexMeta,
} from "./embeddingIndex";
import { quantize, cosine } from "./vectorMath";
import { noteEmbedChunks, type RetrievedNote } from "./vaultRetrieval";

/** Notes processed between cooperative yields during a build (keeps the UI alive). */
const YIELD_EVERY_NOTES = 8;
/** Items scored between cooperative yields during a query rank (ADR-120). */
const RANK_YIELD_EVERY = 2000;
/**
 * Notes EMBEDDED between persists during a build (ADR-179).
 *
 * Before this, `doSync` wrote ONCE, after the last note. Anything that stopped a
 * build — a quit, a plugin reload, a renderer crash, one note throwing — threw
 * away every vector computed in that pass, so a vault whose build could not
 * finish in a single sitting never got an index at all, no matter how many times
 * it was attempted. `ConversationIndexService` commits on abort, but a crash is
 * not an abort, so "resumable" has to mean "already on disk", not "flushed on the
 * way out". 25 embeds is a few seconds of work against a multi-MB write, and an
 * incremental re-sync that embeds nothing still writes nothing.
 */
const PERSIST_EVERY_EMBEDS = 25;
/**
 * Floor on how often a build may rewrite the index, whatever the embed count
 * says (ADR-179).
 *
 * Every persist serializes the WHOLE index — ~19 MB at the 5 000-note cap — which
 * is the cost ADR-122 exists to avoid paying per note. Embeds alone would mean
 * ~200 full rewrites on a cold build at that size, and on a synced vault every
 * one of them is a sync event. Both conditions must hold, so the binding one is
 * whichever is scarcer: on a slow build that is the embed count, on a fast one
 * the clock. Either way the loss window stays ~30s of work, and the write rate
 * stays under 2/min. The real answer is an append-only index that does not
 * rewrite what has not changed — see D-32.
 */
const MIN_PERSIST_INTERVAL_MS = 30_000;
/**
 * Consecutive embed failures that mean the BACKEND is gone, not that one note is
 * bad (ADR-179).
 *
 * Skipping a note whose embed fails is what stops a single huge note from
 * costing the whole build — but applied blindly it turns an unloaded provider or
 * a crashed worker into a "successful" build that silently indexed almost
 * nothing and then reported itself ready. One note failing is data; five in a row
 * is the runtime. The run stops, keeps what it has, and rethrows.
 */
const MAX_CONSECUTIVE_EMBED_FAILURES = 5;

/** A vault note to index: its path (the index id) and a LAZY content loader.
 *  Content is loaded one note at a time during sync and released immediately, so
 *  peak memory is bounded regardless of vault size (ADR-120) — never the whole
 *  vault's text at once. */
export interface IndexableNote {
	path: string;
	load: () => Promise<string>;
}

/**
 * Keeps a vector index of the vault's notes in sync and answers semantic
 * retrieval queries for vault-wide RAG (ADR-116/118/119/120).
 *
 * STREAMED build (ADR-120): notes are read + chunked + embedded ONE AT A TIME
 * and their text released before the next, so a 30k-note vault does not hold
 * ~all its content in memory at once. Only new / content-changed notes are
 * re-embedded (per-note content-hash compare), removed notes drop out, and the
 * packed index is persisted through the injected store.
 *
 * Both the embedding provider and the store are interfaces, so the whole
 * orchestration is unit-tested with fakes. The note index is stored under a
 * separate key from the conversation index (VaultIndexStore's `prefix`).
 */
export class VaultIndexService {
	private items: IndexedConversation[] = [];
	private loaded = false;
	/** What the persisted index says about ITSELF (ADR-181) — whether the build
	 *  that wrote it finished, and the scope its rows were selected under. */
	private meta: IndexMeta = EMPTY_INDEX_META;
	/** Serializes all mutations (sync / updateNote / removeNote / clear) so they
	 *  never interleave — a targeted edit can't race a full build (ADR-121). */
	private chain: Promise<unknown> = Promise.resolve();
	private synced = false;

	constructor(
		private readonly provider: EmbeddingProvider,
		private readonly store: IndexStore,
		/** `persistIntervalMs` overrides MIN_PERSIST_INTERVAL_MS — a test seam, so the
		 *  mid-build flush can be exercised without a fake clock (a real build's
		 *  embeds take seconds; a fake provider's take microseconds). */
		private readonly opts: { maxChars?: number; persistIntervalMs?: number } = {}
	) {}

	private enqueue<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.chain.then(fn, fn); // run regardless of the prior op's outcome
		this.chain = run.then(() => undefined, () => undefined); // keep the chain alive on error
		return run;
	}

	/** Number of indexed notes (for status + cap checks). */
	size(): number {
		return this.items.length;
	}

	/** Wipe the index (in-memory + persisted) and mark it not-ready, so the next
	 *  sync re-embeds every note from scratch. Backs the "reindex" action (ADR-119). */
	clear(): Promise<void> {
		return this.enqueue(async () => {
			this.items = [];
			this.synced = false;
			this.meta = EMPTY_INDEX_META;
			this.loaded = true; // don't let a later load() repopulate from the old store
			await this.store.write(serializeIndex([], this.provider.dim, EMPTY_INDEX_META));
		});
	}

	/** True once at least one sync has completed — i.e. the model is loaded and the
	 *  index is populated, so `query` can run fast (only the query is embedded).
	 *  Retrieval is gated on this so a turn never waits on the first-use model
	 *  download / whole-vault embedding (ADR-118). */
	isReady(): boolean {
		return this.synced;
	}

	/**
	 * Whether a build has ever run to COMPLETION for `scope` (ADR-181).
	 *
	 * `isReady()` only says the index can answer a query — hydrating a persisted
	 * file sets it, and since ADR-179 that file may be a fifth of a build that was
	 * interrupted. Anything deciding whether to BUILD must ask this instead, or a
	 * partial index reports itself finished and is never resumed.
	 *
	 * A scope that differs from the one the rows were selected under is also not
	 * complete: narrowing the folders has to drop what is now outside them, and
	 * only a rebuild does that.
	 */
	isComplete(scope: string): boolean {
		return this.meta.complete && this.meta.scope === scope;
	}

	/** The scope the persisted rows were selected under, for diagnostics. */
	indexedScope(): string {
		return this.meta.scope;
	}

	private async load(): Promise<void> {
		if (this.loaded) return;
		const buf = await this.store.read();
		if (buf) {
			try {
				const { items, dim, meta } = deserializeIndex(buf);
				// A dim mismatch means a different model built the index — drop it and
				// let the next sync rebuild from scratch.
				if (dim === this.provider.dim) { this.items = items; this.meta = meta; }
			} catch {
				this.items = [];
				this.meta = EMPTY_INDEX_META;
			}
		}
		this.loaded = true;
	}

	/** Bring the index in line with `notes` (full build / manual reindex). Serialized
	 *  behind the op chain. `onProgress` (processed, total) fires as notes are handled.
	 *  `throttle` controls how hard the build yields the thread: on a UI-thread backend
	 *  (no Worker) pass a fine cadence + a breather so a large build never freezes the
	 *  app (ADR-125). Defaults keep the off-thread cadence. */
	sync(
		notes: IndexableNote[],
		onProgress?: (processed: number, total: number) => void,
		throttle: { yieldEveryNotes?: number; breatherMs?: number } = {},
		/** The scope these notes were selected under, recorded so a later session
		 *  can tell whether the index still matches the settings (ADR-181). */
		scope = "",
	): Promise<void> {
		return this.enqueue(() => this.doSync(notes, onProgress, throttle, scope));
	}

	/**
	 * Hydrate the index from persisted storage and mark it queryable WITHOUT
	 * embedding any notes. For environments that have no off-thread embedding
	 * backend (Obsidian mobile: the Web Worker blob is blocked, so a full build
	 * would run hundreds of inferences on the UI thread and freeze the app). A
	 * `query` embeds only the query string — cheap even on the main thread — so
	 * retrieval works against an index that was built and synced from desktop. If
	 * nothing is persisted (or it's from a different model), the index stays empty
	 * and queries return []. Never re-embeds a note.
	 */
	hydrateForQuery(): Promise<void> {
		return this.enqueue(async () => {
			await this.load();
			this.synced = true; // queryable against whatever loaded (possibly empty)
		});
	}

	/**
	 * Targeted incremental update of a SINGLE note (ADR-121) — re-embed it if its
	 * content changed, add it if new, drop it if now empty/unreadable. No-ops unless
	 * the index is already built (`isReady`); a not-yet-built index is handled by a
	 * full `sync`. `cap` (when > 0) prevents ADDING a new note past the note cap.
	 * This is what the vault watcher calls on an edit, so a single note change costs
	 * one embed instead of rescanning the whole corpus.
	 */
	updateNote(note: IndexableNote, opts: { cap?: number } = {}): Promise<void> {
		return this.applyBatch({ updates: [note], removes: [] }, opts);
	}

	/** Targeted removal of a single note from the index (delete / moved out of scope). */
	removeNote(path: string): Promise<void> {
		return this.applyBatch({ updates: [], removes: [path] }, {});
	}

	/**
	 * Apply a BATCH of targeted changes with a SINGLE persist (ADR-122): removes,
	 * then updates (re-embed changed, add new within `cap`, drop emptied/unreadable).
	 * All mutations are made in memory and the index is serialized + written at most
	 * ONCE — so the watcher flushing N edited notes costs one `.bin` write, not N.
	 * No-ops until the index is built (`isReady`).
	 */
	applyBatch(changes: { updates: IndexableNote[]; removes: string[] }, opts: { cap?: number } = {}): Promise<void> {
		return this.enqueue(() => this.doApplyBatch(changes, opts));
	}

	private async doApplyBatch(changes: { updates: IndexableNote[]; removes: string[] }, opts: { cap?: number }): Promise<void> {
		await this.load();
		if (!this.synced) return; // patch only a built index; a full build handles the rest
		let dirty = false;
		for (const path of changes.removes) dirty = this.removeInMemory(path) || dirty;
		let n = 0;
		for (const note of changes.updates) {
			dirty = (await this.updateInMemory(note, opts.cap)) || dirty;
			if (++n % YIELD_EVERY_NOTES === 0) await new Promise((r) => setTimeout(r, 0));
		}
		// Targeted edits keep whatever the index already claims about itself: a
		// watcher flush neither completes an unfinished build nor invalidates a
		// finished one.
		if (dirty) await this.store.write(serializeIndex(this.items, this.provider.dim, this.meta)); // one write for the batch
	}

	/** Re-embed / add / drop a single note IN MEMORY (no persist). Returns whether
	 *  the index changed. Empty/unreadable content drops the note. */
	private async updateInMemory(note: IndexableNote, cap?: number): Promise<boolean> {
		const maxChars = this.opts.maxChars ?? 500;
		let chunks: string[];
		try {
			chunks = noteEmbedChunks(await note.load(), maxChars);
		} catch {
			return this.removeInMemory(note.path); // unreadable → drop
		}
		if (chunks.length === 0) return this.removeInMemory(note.path); // emptied → drop

		const hash = conversationContentHash(chunks);
		const idx = this.items.findIndex((i) => i.id === note.path);
		if (idx >= 0 && this.items[idx].contentHash === hash) return false; // unchanged
		if (idx < 0 && cap && cap > 0 && this.items.length >= cap) return false; // cap new adds

		const raw = await this.provider.embed(chunks);
		const item = { id: note.path, contentHash: hash, chunks: raw.map(quantize) };
		if (idx >= 0) this.items[idx] = item;
		else this.items.push(item);
		return true;
	}

	/** Drop a note from the in-memory index (no persist). Returns whether it changed. */
	private removeInMemory(path: string): boolean {
		const before = this.items.length;
		this.items = this.items.filter((i) => i.id !== path);
		return this.items.length !== before;
	}

	private async doSync(
		notes: IndexableNote[],
		onProgress?: (processed: number, total: number) => void,
		throttle: { yieldEveryNotes?: number; breatherMs?: number } = {},
		scope = "",
	): Promise<void> {
		await this.load();
		const maxChars = this.opts.maxChars ?? 500;
		const yieldEvery = Math.max(1, throttle.yieldEveryNotes ?? YIELD_EVERY_NOTES);
		const breatherMs = Math.max(0, throttle.breatherMs ?? 0);

		// Reuse unchanged vectors by (path → item); rebuild the survivor list in
		// note order. `kept` holds only Int8 vectors (the index we need anyway);
		// note text and chunk strings are held only for the note being processed.
		const existing = new Map(this.items.map((i) => [i.id, i]));
		const kept: IndexedConversation[] = [];
		const seen = new Set<string>();
		/** Every note this pass has finished with, INCLUDING ones it skipped or
		 *  dropped — `seen` holds only survivors, and a mid-build snapshot must not
		 *  resurrect a note we just decided to drop. */
		const handled = new Set<string>();
		const desired = new Set(notes.map((n) => n.path));
		const total = notes.length;
		let embedded = 0;
		let processed = 0;
		let persistedEmbeds = 0;
		let failedInARow = 0;
		let lastPersistAt = Date.now();
		const persistIntervalMs = this.opts.persistIntervalMs ?? MIN_PERSIST_INTERVAL_MS;

		// A mid-build snapshot = what this pass has rebuilt so far, PLUS the notes it
		// has not reached yet whose vectors are still valid. Persisting only `kept`
		// would make every interrupted build delete the tail of its own index.
		//
		// Reads `existing` — captured once, before the loop — rather than `this.items`,
		// which `persist` reassigns. The two are equivalent today (everything in
		// `kept` is also in `handled`, so the filter drops it either way); `existing`
		// is immutable for the length of the build, so the snapshot cannot depend on
		// what `persist` happens to do to the live field. Belt and braces, not a fix.
		const snapshot = (): IndexedConversation[] => [
			...kept,
			...[...existing.values()].filter((i) => !handled.has(i.id) && desired.has(i.id)),
		];
		// Memory follows disk. Without the assignment the two diverge the moment a
		// build is interrupted: `load()` is a no-op once `loaded` is set, so the NEXT
		// sync on this same instance would rebuild `existing` from the stale
		// pre-sync list and re-embed everything the failed pass had just persisted.
		// The resume only worked across a restart, which is exactly the case a unit
		// test with a fresh service instance fails to notice.
		// A mid-build write is explicitly INCOMPLETE. That is the whole point: the
		// rows are worth keeping, and the next session must still know the build
		// never finished, or it serves a fraction of the vault and calls it done.
		const persist = async (items: IndexedConversation[], complete: boolean): Promise<void> => {
			await this.store.write(serializeIndex(items, this.provider.dim, { complete, scope }));
			this.items = items;
			this.meta = { complete, scope };
			persistedEmbeds = embedded;
			lastPersistAt = Date.now();
		};

		try {
			for (const note of notes) {
				processed++;
				handled.add(note.path);
				let chunks: string[];
				try {
					chunks = noteEmbedChunks(await note.load(), maxChars);
				} catch {
					onProgress?.(processed, total);
					continue; // unreadable note — skip (drops it from the index if it was there)
				}
				if (chunks.length === 0) { onProgress?.(processed, total); continue; } // empty note

				const hash = conversationContentHash(chunks);
				const prev = existing.get(note.path);
				if (prev && prev.contentHash === hash) {
					kept.push(prev); // unchanged — reuse vectors, no re-embed
					seen.add(note.path);
					// Resets the failure streak too. Not resetting here would let five
					// bad notes SCATTERED through a mostly-unchanged vault abort the
					// build — reinstating the very bug this guard sits next to. A dead
					// backend still trips it, because a cold build embeds every note.
					failedInARow = 0;
				} else {
					try {
						const raw = await this.provider.embed(chunks);
						kept.push({ id: note.path, contentHash: hash, chunks: raw.map(quantize) });
						seen.add(note.path);
						embedded++;
						failedInARow = 0;
					} catch (e) {
						// ONE note must not cost the build. Before ADR-179 this threw
						// straight out of `doSync`, so a single note the backend choked on
						// (an embed timeout on a very long one) discarded the whole pass and
						// did it again on every retry — the index could never become ready.
						// Drop it, say so, carry on — until it stops looking like one bad
						// note and starts looking like a dead backend.
						console.warn(`[Pythia] vault RAG: skipping "${note.path}" — embed failed`, e);
						if (++failedInARow >= MAX_CONSECUTIVE_EMBED_FAILURES) throw e;
					}
				}
				onProgress?.(processed, total);
				// Flush what is embedded so far, so an interruption costs at most the
				// last few notes instead of the entire build (ADR-179). Counted in
				// EMBEDS, not notes processed: the `continue` paths above (unreadable,
				// empty) jump past this check, so a modulus on `processed` could stride
				// over the flush point and skip it.
				if (
					embedded - persistedEmbeds >= PERSIST_EVERY_EMBEDS &&
					Date.now() - lastPersistAt >= persistIntervalMs
				) {
					await persist(snapshot(), false);
				}
				// Cooperative yield: on the UI-thread (iframe) backend, embedding runs on the
				// renderer thread, so hand control back — finely, with a breather (ADR-125) —
				// so a large build never freezes the app. Off-thread, the coarse default is fine.
				if (processed % yieldEvery === 0) await new Promise((r) => setTimeout(r, breatherMs));
			}
		} catch (e) {
			// Abort, unload, anything else: keep the work rather than the tidiness.
			// The rescue write gets its own guard — if the STORE is what failed (a full
			// disk, an evicted iCloud file), retrying it here would replace the real
			// cause with a duplicate of itself and lose the diagnosis.
			if (embedded > persistedEmbeds) {
				try {
					await persist(snapshot(), false);
				} catch (writeErr) {
					console.warn("[Pythia] vault RAG: could not persist partial index", writeErr);
				}
			}
			throw e;
		}

		// Persist when the index changed (an embed since the last flush, or a note
		// present before is gone) — and ALSO when the file on disk does not yet say
		// this scope is complete, because that flag is the whole answer to "must I
		// build?" and a no-op sync is exactly when it is most likely to be wrong.
		const dropped = [...existing.keys()].some((id) => !seen.has(id));
		this.items = kept;
		const changed = embedded > persistedEmbeds || dropped;
		if (changed || !this.meta.complete || this.meta.scope !== scope) {
			await persist(this.items, true);
		}
		this.synced = true;
	}

	/**
	 * Rank the ALREADY-INDEXED notes against `query`, most-relevant first. Embeds
	 * only the query (fast — the model is loaded once the index is ready), never
	 * the vault, so it is safe to await inside a chat turn. Ranking scans the index
	 * COOPERATIVELY (yielding every few thousand notes) so a large corpus never
	 * blocks the UI thread in one burst (ADR-120). Returns [] when the index isn't
	 * ready or nothing clears the floor; `exclude` paths are dropped before `limit`.
	 */
	async query(
		text: string,
		opts: { minScore?: number; limit?: number; exclude?: Iterable<string> } = {}
	): Promise<RetrievedNote[]> {
		const q = text.trim();
		if (!q || !this.synced || this.items.length === 0) return [];
		const [raw] = await this.provider.embed([q]);
		if (!raw) return [];
		const queryVec = quantize(raw);
		const minScore = opts.minScore ?? 0.35;
		const excluded = new Set(opts.exclude ?? []);

		const scored: RetrievedNote[] = [];
		let scanned = 0;
		for (const item of this.items) {
			if (item.chunks.length > 0 && !excluded.has(item.id)) {
				let best = -Infinity;
				for (const chunk of item.chunks) {
					const s = cosine(chunk, queryVec);
					if (s > best) best = s;
				}
				if (Number.isFinite(best) && best >= minScore) scored.push({ id: item.id, score: best });
			}
			if (++scanned % RANK_YIELD_EVERY === 0) await new Promise((r) => setTimeout(r, 0));
		}
		scored.sort((a, b) => b.score - a.score);
		return typeof opts.limit === "number" ? scored.slice(0, opts.limit) : scored;
	}
}
