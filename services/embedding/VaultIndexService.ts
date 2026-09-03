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

	constructor(
		private readonly provider: EmbeddingProvider,
		private readonly store: IndexStore,
		private readonly opts: { maxChars?: number } = {}
	) {}

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

	/** Bring the index in line with `notes`; concurrent calls coalesce. */
	async sync(notes: IndexableNote[]): Promise<void> {
		while (this.syncing) await this.syncing;
		this.syncing = this.doSync(notes);
		try {
			await this.syncing;
		} finally {
			this.syncing = null;
		}
	}

	private async doSync(notes: IndexableNote[]): Promise<void> {
		await this.load();
		const maxChars = this.opts.maxChars ?? 500;

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
		if (toEmbed.length === 0 && toDrop.length === 0) return;

		const byId = new Map(this.items.map((i) => [i.id, i]));
		for (const id of toDrop) byId.delete(id);

		const toEmbedSet = new Set(toEmbed);
		for (const d of embeddable) {
			if (!toEmbedSet.has(d.id)) continue;
			const raw = await this.provider.embed(d.chunks);
			byId.set(d.id, { id: d.id, contentHash: d.contentHash, chunks: raw.map(quantize) });
		}

		// Rebuild in desired (current-vault) order, dropping any strays.
		this.items = embeddable
			.map((d) => byId.get(d.id))
			.filter((i): i is IndexedConversation => i !== undefined);
		await this.store.write(serializeIndex(this.items, this.provider.dim));
	}

	/**
	 * Retrieve the notes most semantically relevant to `query`. Syncs the index to
	 * `notes` first (cheap when nothing changed — only new/changed notes re-embed),
	 * then embeds the query and ranks. Returns paths + scores, most-relevant first.
	 */
	async retrieve(
		query: string,
		notes: IndexableNote[],
		opts: { minScore?: number; limit?: number } = {}
	): Promise<RetrievedNote[]> {
		const q = query.trim();
		if (!q) return [];
		await this.sync(notes);
		if (this.items.length === 0) return [];
		const [raw] = await this.provider.embed([q]);
		if (!raw) return [];
		return rankByQuery(quantize(raw), this.items, opts);
	}
}
