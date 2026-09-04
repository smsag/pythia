import type { EmbeddingProvider } from "./EmbeddingProvider";
import type { IndexStore } from "./ConversationIndexService";
import {
	conversationContentHash,
	serializeIndex,
	deserializeIndex,
	type IndexedConversation,
} from "./embeddingIndex";
import { quantize, cosine } from "./vectorMath";
import { noteEmbedChunks, type RetrievedNote } from "./vaultRetrieval";

/** Notes processed between cooperative yields during a build (keeps the UI alive). */
const YIELD_EVERY_NOTES = 8;
/** Items scored between cooperative yields during a query rank (ADR-120). */
const RANK_YIELD_EVERY = 2000;

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
	/** Serializes all mutations (sync / updateNote / removeNote / clear) so they
	 *  never interleave — a targeted edit can't race a full build (ADR-121). */
	private chain: Promise<unknown> = Promise.resolve();
	private synced = false;

	constructor(
		private readonly provider: EmbeddingProvider,
		private readonly store: IndexStore,
		private readonly opts: { maxChars?: number } = {}
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
			this.loaded = true; // don't let a later load() repopulate from the old store
			await this.store.write(serializeIndex([], this.provider.dim));
		});
	}

	/** True once at least one sync has completed — i.e. the model is loaded and the
	 *  index is populated, so `query` can run fast (only the query is embedded).
	 *  Retrieval is gated on this so a turn never waits on the first-use model
	 *  download / whole-vault embedding (ADR-118). */
	isReady(): boolean {
		return this.synced;
	}

	private async load(): Promise<void> {
		if (this.loaded) return;
		const buf = await this.store.read();
		if (buf) {
			try {
				const { items, dim } = deserializeIndex(buf);
				// A dim mismatch means a different model built the index — drop it and
				// let the next sync rebuild from scratch.
				if (dim === this.provider.dim) this.items = items;
			} catch {
				this.items = [];
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
	): Promise<void> {
		return this.enqueue(() => this.doSync(notes, onProgress, throttle));
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
		if (dirty) await this.store.write(serializeIndex(this.items, this.provider.dim)); // one write for the batch
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
		const total = notes.length;
		let embedded = 0;
		let processed = 0;

		for (const note of notes) {
			processed++;
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
			} else {
				const raw = await this.provider.embed(chunks);
				kept.push({ id: note.path, contentHash: hash, chunks: raw.map(quantize) });
				embedded++;
			}
			seen.add(note.path);
			onProgress?.(processed, total);
			// Cooperative yield: on the UI-thread (iframe) backend, embedding runs on the
			// renderer thread, so hand control back — finely, with a breather (ADR-125) —
			// so a large build never freezes the app. Off-thread, the coarse default is fine.
			if (processed % yieldEvery === 0) await new Promise((r) => setTimeout(r, breatherMs));
		}

		// Persist only when the index actually changed (an embed happened, or a note
		// present before is gone) — avoids rewriting a large .bin on a no-op sync.
		const dropped = [...existing.keys()].some((id) => !seen.has(id));
		this.items = kept;
		if (embedded > 0 || dropped) await this.store.write(serializeIndex(this.items, this.provider.dim));
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
