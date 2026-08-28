import type { Conversation } from "../../models/types";
import type { EmbeddingProvider } from "./EmbeddingProvider";
import { conversationChunks } from "./conversationText";
import {
	conversationContentHash,
	diffIndex,
	serializeIndex,
	deserializeIndex,
	type IndexedConversation,
} from "./embeddingIndex";
import { quantize } from "./vectorMath";
import { rankRelated, type RelatedResult } from "./relatedConversations";

/** Persistence for the packed index — a model-keyed `.bin` in the plugin dir in
 *  production, an in-memory buffer in tests. */
export interface IndexStore {
	read(): Promise<ArrayBuffer | null>;
	write(buf: ArrayBuffer): Promise<void>;
}

/**
 * Keeps the conversation vector index in sync and answers "related conversations"
 * queries. Only new or content-changed conversations are re-embedded (via
 * `diffIndex`); removed ones are dropped; the result is persisted through the
 * injected store. Both the embedding provider and the store are interfaces, so the
 * whole orchestration is unit-tested with fakes — no model runtime required.
 */
export class ConversationIndexService {
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
				// A dim mismatch means the persisted index was built by a different
				// model — drop it and let the next sync rebuild from scratch.
				if (dim === this.provider.dim) this.items = items;
			} catch {
				this.items = [];
			}
		}
		this.loaded = true;
	}

	/** Bring the index in line with `conversations`; concurrent calls coalesce. */
	async sync(conversations: Conversation[]): Promise<void> {
		while (this.syncing) await this.syncing;
		this.syncing = this.doSync(conversations);
		try {
			await this.syncing;
		} finally {
			this.syncing = null;
		}
	}

	private async doSync(conversations: Conversation[]): Promise<void> {
		await this.load();
		const maxChars = this.opts.maxChars ?? 500;

		const desired = conversations.map((c) => {
			const chunks = conversationChunks(c, maxChars);
			return { id: c.id, contentHash: conversationContentHash(chunks), chunks };
		});
		const existing = new Map(this.items.map((i) => [i.id, i.contentHash]));
		const { toEmbed, toDrop } = diffIndex(
			existing,
			desired.map((d) => ({ id: d.id, contentHash: d.contentHash }))
		);
		if (toEmbed.length === 0 && toDrop.length === 0) return;

		const byId = new Map(this.items.map((i) => [i.id, i]));
		for (const id of toDrop) byId.delete(id);

		const toEmbedSet = new Set(toEmbed);
		for (const d of desired) {
			if (!toEmbedSet.has(d.id)) continue;
			const raw = await this.provider.embed(d.chunks);
			byId.set(d.id, { id: d.id, contentHash: d.contentHash, chunks: raw.map(quantize) });
		}

		// Rebuild in desired (current-conversation) order, dropping any strays.
		this.items = desired
			.map((d) => byId.get(d.id))
			.filter((i): i is IndexedConversation => i !== undefined);
		await this.store.write(serializeIndex(this.items, this.provider.dim));
	}

	/** Conversations semantically related to `sourceId`, most-similar first. */
	async getRelated(
		sourceId: string,
		conversations: Conversation[],
		opts: { minScore?: number; limit?: number } = {}
	): Promise<RelatedResult[]> {
		await this.sync(conversations);
		return rankRelated(sourceId, this.items, opts);
	}
}
