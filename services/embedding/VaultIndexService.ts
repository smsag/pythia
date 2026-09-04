import type { EmbeddingProvider } from "./EmbeddingProvider";
import type { IndexStore } from "./ConversationIndexService";
import {
	conversationContentHash,
	diffIndex,
	serializeIndex,
	deserializeIndex,
	type IndexedConversation,
} from "./embeddingIndex";
import { quantize } from "./vectorMath";
import { noteEmbedChunks, rankByQuery, type RetrievedNote } from "./vaultRetrieval";

/** Embeds between cooperative yields to the event loop during a large index build. */
const YIELD_EVERY_EMBEDS = 8;

/** A vault note to index: its path (the index id) and current markdown body. */
export interface IndexableNote {
	path: string;
	content: string;
}

/**
 * Keeps a vector index of the vault's notes in sync and answers semantic
 * retrieval queries for vault-wide RAG (ADR-116). Structurally identical to
 * `ConversationIndexService` — only new or content-changed notes are re-embedded
 * (via `diffIndex`), removed notes are dropped, and the packed index is persisted
 * through the injected store. Both the embedding provider and the store are
 * interfaces, so the whole orchestration is unit-tested with fakes.
 *
 * The note index is stored under a separate key from the conversation index (see
 * VaultIndexStore's `prefix`) so the two never collide, even though they share the
 * same binary format and math.
 */
export class VaultIndexService {
	private items: IndexedConversation[] = [];
	private loaded = false;
	private syncing: Promise<void> | null = null;
	private synced = false;

	constructor(
		private readonly provider: EmbeddingProvider,
		private readonly store: IndexStore,
		private readonly opts: { maxChars?: number } = {}
	) {}

	/** Wipe the index (in-memory + persisted) and mark it not-ready, so the next
	 *  sync re-embeds every note from scratch. Backs the "reindex" action (ADR-119). */
	async clear(): Promise<void> {
		this.items = [];
		this.synced = false;
		this.loaded = true; // don't let a later load() repopulate from the old store
		await this.store.write(serializeIndex([], this.provider.dim));
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

	/** Bring the index in line with `notes`; concurrent calls coalesce. `onProgress`
	 *  (done, total) fires as notes are embedded so the UI can show a bar. */
	async sync(notes: IndexableNote[], onProgress?: (done: number, total: number) => void): Promise<void> {
		while (this.syncing) await this.syncing;
		this.syncing = this.doSync(notes, onProgress);
		try {
			await this.syncing;
		} finally {
			this.syncing = null;
		}
	}

	private async doSync(notes: IndexableNote[], onProgress?: (done: number, total: number) => void): Promise<void> {
		await this.load();
		const maxChars = this.opts.maxChars ?? 500;
		// Mark ready as soon as a sync completes (even a no-op one over an existing
		// index), so retrieval can start using whatever is indexed.
		const markReady = () => { this.synced = true; };

		const desired = notes.map((n) => {
			const chunks = noteEmbedChunks(n.content, maxChars);
			return { id: n.path, contentHash: conversationContentHash(chunks), chunks };
		});
		// A note that yields no chunks (empty file) is skipped entirely — nothing to embed.
		const embeddable = desired.filter((d) => d.chunks.length > 0);

		const existing = new Map(this.items.map((i) => [i.id, i.contentHash]));
		const { toEmbed, toDrop } = diffIndex(
			existing,
			embeddable.map((d) => ({ id: d.id, contentHash: d.contentHash }))
		);
		if (toEmbed.length === 0 && toDrop.length === 0) { markReady(); return; }

		const byId = new Map(this.items.map((i) => [i.id, i]));
		for (const id of toDrop) byId.delete(id);

		const toEmbedSet = new Set(toEmbed);
		let done = 0;
		for (const d of embeddable) {
			if (!toEmbedSet.has(d.id)) continue;
			const raw = await this.provider.embed(d.chunks);
			byId.set(d.id, { id: d.id, contentHash: d.contentHash, chunks: raw.map(quantize) });
			onProgress?.(++done, toEmbed.length);
			// Cooperative yield: even off the send path, embedding runs on the shared
			// renderer thread, so periodically hand control back to the event loop so
			// Obsidian stays responsive while a large (re)index runs (ADR-119).
			if (done % YIELD_EVERY_EMBEDS === 0) await new Promise((r) => setTimeout(r, 0));
		}

		// Rebuild in desired (current-vault) order, dropping any strays.
		this.items = embeddable
			.map((d) => byId.get(d.id))
			.filter((i): i is IndexedConversation => i !== undefined);
		await this.store.write(serializeIndex(this.items, this.provider.dim));
		markReady();
	}

	/**
	 * Rank the ALREADY-INDEXED notes against `query`, most-relevant first. Embeds
	 * only the query (fast — the model is loaded once the index is ready), never
	 * the vault, so it is safe to await inside a chat turn. Returns [] when the
	 * index isn't ready yet (see `isReady`) or nothing clears the floor. Paths in
	 * `exclude` (already-attached notes) are dropped before the limit is applied.
	 */
	async query(
		text: string,
		opts: { minScore?: number; limit?: number; exclude?: Iterable<string> } = {}
	): Promise<RetrievedNote[]> {
		const q = text.trim();
		if (!q || !this.synced || this.items.length === 0) return [];
		const [raw] = await this.provider.embed([q]);
		if (!raw) return [];
		const excluded = new Set(opts.exclude ?? []);
		// Rank unbounded, drop excluded, THEN apply the limit — so excluding an
		// already-attached top hit doesn't shrink the returned set below `limit`.
		const ranked = rankByQuery(quantize(raw), this.items, { minScore: opts.minScore })
			.filter((r) => !excluded.has(r.id));
		return typeof opts.limit === "number" ? ranked.slice(0, opts.limit) : ranked;
	}
}
