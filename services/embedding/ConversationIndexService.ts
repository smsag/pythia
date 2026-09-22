import type { Conversation } from "../../models/types";
import type { EmbeddingProvider } from "./EmbeddingProvider";
import { conversationChunks } from "./conversationText";
import {
	diffIndex,
	serializeIndex,
	deserializeIndex,
	type IndexedConversation,
} from "./embeddingIndex";
import { hashPolicyFor, resolveRowHash, type HashPolicy } from "./rowProvenance";
import { DEFAULT_EMBEDDING_MODEL_ID } from "../../models/embeddingModels";
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

	/** A sync is in flight (ADR-202/#362), which the residency asks as well as the
	 *  vault build before releasing a phone's model.
	 *
	 *  The embed loop itself is safe without this: one await per conversation means
	 *  the in-flight count never reaches zero at a macrotask boundary, and
	 *  `visibilitychange` can only run at one. The file read that opens a sync and
	 *  the write that closes it ARE such boundaries, and the model is needed on the
	 *  far side of both — a narrow window, but a real one, and the provider cannot
	 *  see it because nothing is in flight there. */
	isSyncing(): boolean {
		return this.syncing !== null;
	}

	constructor(
		private readonly provider: EmbeddingProvider,
		private readonly store: IndexStore,
		/** `hashPolicy`: which stored rows this device may reuse (ADR-201) — the
		 *  default is exact-hash, the full model's rule. */
		private readonly opts: { maxChars?: number; hashPolicy?: HashPolicy } = {}
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

	/** Bring the index in line with `conversations`; concurrent calls coalesce.
	 *
	 *  `signal` aborts a long first build — embedding a cold vault takes minutes,
	 *  and on the iframe fallback it runs on the UI thread, so a user who closes
	 *  the panel must be able to stop paying for it. Whatever was embedded before
	 *  the abort is kept and persisted, so the next attempt resumes rather than
	 *  starting over. */
	async sync(conversations: Conversation[], opts: { signal?: AbortSignal } = {}): Promise<void> {
		// `.catch` rather than a bare await: an aborted sync rejects, and a waiter
		// must not inherit that rejection — it wants a fresh attempt, not the
		// previous caller's cancellation.
		while (this.syncing) await this.syncing.catch(() => undefined);
		this.syncing = this.doSync(conversations, opts.signal);
		try {
			await this.syncing;
		} finally {
			this.syncing = null;
		}
	}

	private async doSync(conversations: Conversation[], signal?: AbortSignal): Promise<void> {
		await this.load();
		const maxChars = this.opts.maxChars ?? 500;

		const policy = this.opts.hashPolicy ?? hashPolicyFor(DEFAULT_EMBEDDING_MODEL_ID);
		const existing = new Map(this.items.map((i) => [i.id, i.contentHash]));
		// The desired hash is the STORED one when this device accepts that row
		// (ADR-201), so diffIndex sees it as unchanged — a variant keeps the full
		// model's rows, and the full model re-embeds rows a variant tagged.
		const desired = conversations.map((c) => {
			const chunks = conversationChunks(c, maxChars);
			return { id: c.id, contentHash: resolveRowHash(policy, existing.get(c.id), chunks).hash, chunks };
		});
		const { toEmbed, toDrop } = diffIndex(
			existing,
			desired.map((d) => ({ id: d.id, contentHash: d.contentHash }))
		);
		if (toEmbed.length === 0 && toDrop.length === 0) return;

		const byId = new Map(this.items.map((i) => [i.id, i]));
		for (const id of toDrop) byId.delete(id);

		// Rebuild in desired (current-conversation) order, dropping any strays. Also
		// run on abort: a conversation embedded before the stop is worth keeping,
		// so a cancelled first build leaves the next one less to do.
		const commit = async (): Promise<void> => {
			this.items = desired
				.map((d) => byId.get(d.id))
				.filter((i): i is IndexedConversation => i !== undefined);
			await this.store.write(serializeIndex(this.items, this.provider.dim));
		};

		const toEmbedSet = new Set(toEmbed);
		for (const d of desired) {
			if (!toEmbedSet.has(d.id)) continue;
			if (signal?.aborted) {
				await commit();
				throw new DOMException("Embedding index sync aborted", "AbortError");
			}
			const raw = await this.provider.embed(d.chunks);
			byId.set(d.id, { id: d.id, contentHash: d.contentHash, chunks: raw.map(quantize) });
		}

		await commit();
	}

	/** Conversations semantically related to `sourceId`, most-similar first. */
	async getRelated(
		sourceId: string,
		conversations: Conversation[],
		opts: { minScore?: number; limit?: number; signal?: AbortSignal } = {}
	): Promise<RelatedResult[]> {
		await this.sync(conversations, { signal: opts.signal });
		return rankRelated(sourceId, this.items, opts);
	}
}
