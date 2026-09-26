// The vault index's journal (ADR-221, closes D-35).
//
// The index was one serialized array, so every write rewrote all of it — about
// 19 MB at the 5 000-note cap — whether one note had changed or a thousand. That
// is why crash-safe flushing had to be rate-limited (ADR-182), why a phone typing
// next to a loaded model reloaded (ADR-219), and why each edit was a 19 MB sync
// event on every device.
//
// The journal is the rows that changed since the index file (the "base") was
// written: re-embedded or added rows, and the ids dropped. It uses the index's own
// format, and is tied to its base by the base's `writtenAt`. An edit rewrites the
// journal (kilobytes). The base is rewritten only by a full sync, a takeover, or
// once the journal has grown past `shouldCompact`, which folds it back in.
//
// A journal whose base is not the one on disk is ignored. That happens after a
// compaction (the old journal lingers until the next edit overwrites it) or when a
// sync delivers the two files out of order. Its notes then answer from the base's
// older vectors until the content hash re-embeds them at the next sync or edit: a
// stale answer, never a wrong row.
//
// Rewritten whole rather than appended: `appendBinary` needs Obsidian 1.12.3, the
// manifest promises 1.4.0, and a file this small costs nothing to rewrite.

import type { IndexStore } from "./ConversationIndexService";
import {
	deserializeIndex,
	readWrittenAt,
	serializeIndex,
	type IndexedConversation,
	type IndexKeeper,
} from "./embeddingIndex";

/** A journal smaller than this never forces a compaction, however small the base. */
export const COMPACT_MIN_ROWS = 50;
/** The share of the base's rows a journal may reach before it is folded back in. */
export const COMPACT_SHARE = 0.05;

/**
 * Whether the journal has outgrown its base. Relative, because what a journal
 * costs to read on every launch grows with it while the base's rewrite costs the
 * same whatever it holds; floored, so a small vault is not rewritten for every
 * other edit.
 */
export function shouldCompact(journalRows: number, baseRows: number): boolean {
	return journalRows >= Math.max(COMPACT_MIN_ROWS, Math.ceil(baseRows * COMPACT_SHARE));
}

export interface JournalContent {
	/** The `writtenAt` of the base this journal extends. */
	base: number;
	upserts: IndexedConversation[];
	removed: string[];
	keeper?: IndexKeeper;
	writtenAt?: number;
}

export function serializeJournal(j: JournalContent, dim: number): ArrayBuffer {
	return serializeIndex(
		j.upserts,
		dim,
		{ complete: false, scope: "", keeper: j.keeper, writtenAt: j.writtenAt },
		{ journalOf: j.base, removed: j.removed },
	);
}

/** A journal read from disk, validated; null when it cannot vouch for itself. */
export function deserializeJournal(buf: ArrayBuffer, dim: number): JournalContent | null {
	try {
		const { items, dim: fileDim, meta, header } = deserializeIndex(buf);
		const base = readWrittenAt(header.journalOf);
		if (fileDim !== dim || base === undefined) return null;
		const removed = Array.isArray(header.removed)
			? header.removed.filter((id): id is string => typeof id === "string")
			: [];
		return { base, upserts: items, removed, keeper: meta.keeper, writtenAt: meta.writtenAt };
	} catch {
		// A torn or foreign file is not a journal. Its notes answer from the base
		// until they are re-embedded, which is the same outcome as no journal.
		return null;
	}
}

/** The base's rows with the journal applied: upserts replace or add, removals drop. */
export function applyJournal(items: IndexedConversation[], j: Pick<JournalContent, "upserts" | "removed">): IndexedConversation[] {
	const superseded = new Set([...j.removed, ...j.upserts.map((u) => u.id)]);
	return [...items.filter((i) => !superseded.has(i.id)), ...j.upserts];
}

/** The journal of one index: what changed since its base, in memory and on disk. */
export class IndexJournal {
	private readonly upserts = new Map<string, IndexedConversation>();
	private readonly removed = new Set<string>();
	/** The base this journal extends; undefined when there is none it can name. */
	private base: number | undefined;

	constructor(private readonly store: IndexStore) {}

	get rows(): number {
		return this.upserts.size + this.removed.size;
	}

	/** A base was written or loaded: the journal starts over against it. */
	reset(base: number | undefined): void {
		this.upserts.clear();
		this.removed.clear();
		this.base = base;
	}

	/** A row changed in memory: its new state, or `undefined` when it was dropped. */
	record(id: string, item: IndexedConversation | undefined): void {
		if (item) {
			this.upserts.set(id, item);
			this.removed.delete(id);
		} else {
			this.upserts.delete(id);
			this.removed.add(id);
		}
	}

	/** Whether the next write may go here rather than rewrite the base: there is a
	 *  base to attach to (a file from before ADR-220 has no `writtenAt`), and the
	 *  journal has not outgrown it. */
	canTake(baseRows: number): boolean {
		return this.base !== undefined && !shouldCompact(this.rows, baseRows);
	}

	async write(dim: number, sig: { keeper?: IndexKeeper; writtenAt?: number }): Promise<void> {
		if (this.base === undefined) throw new Error("IndexJournal.write: no base to extend");
		await this.store.write(serializeJournal(
			{ base: this.base, upserts: [...this.upserts.values()], removed: [...this.removed], ...sig },
			dim,
		));
	}

	/**
	 * Read the journal on disk and apply it to a freshly loaded base. When it
	 * extends that base, its entries become this journal's, so the next write
	 * carries them forward instead of dropping them.
	 */
	async load(
		base: number | undefined,
		items: IndexedConversation[],
		dim: number,
	): Promise<{ items: IndexedConversation[]; keeper?: IndexKeeper; writtenAt?: number }> {
		this.reset(base);
		if (base === undefined) return { items };
		let buf: ArrayBuffer | null;
		try {
			buf = await this.store.read();
		} catch (e) {
			console.warn("[Pythia] vault RAG: the index journal could not be read — using the index without it", e);
			return { items };
		}
		const j = buf ? deserializeJournal(buf, dim) : null;
		if (!j || j.base !== base) return { items }; // a stale journal: see the header
		for (const u of j.upserts) this.upserts.set(u.id, u);
		for (const id of j.removed) this.removed.add(id);
		return { items: applyJournal(items, j), keeper: j.keeper, writtenAt: j.writtenAt };
	}
}
