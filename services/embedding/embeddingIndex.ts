// The conversation vector index: its in-memory shape, a content hash for
// incremental reuse, an add/drop diff against the current conversation set, and a
// compact binary (de)serialization for persistence in the plugin directory.

export interface IndexedConversation {
	id: string;
	/** Hash of the embed-source text; a change means re-embed (see conversationContentHash). */
	contentHash: string;
	/** One Int8 vector per chunk of the conversation. */
	chunks: Int8Array[];
}

/**
 * Stable FNV-1a hash of a conversation's embed-source chunks. Cheap and
 * dependency-free; used only to detect when a conversation's content changed and
 * its vectors must be recomputed — not for security.
 */
export function conversationContentHash(chunks: string[]): string {
	let h = 0x811c9dc5;
	// The separator is a NUL, so no chunk boundary can be forged by chunk text.
	// Written as an ESCAPE, never as a literal NUL byte: a raw one in the source
	// makes git treat this whole file as binary and stop showing its diffs.
	const s = chunks.join("\u0000");
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16);
}

export interface IndexDiff {
	/** Conversation ids that are new or whose content changed — need (re)embedding. */
	toEmbed: string[];
	/** Conversation ids in the index that no longer exist — drop from the index. */
	toDrop: string[];
}

/**
 * Compare the persisted index (id → contentHash) with the current desired set and
 * report which conversations to re-embed and which to drop. This is the whole
 * incremental strategy: only changed/new conversations are ever re-embedded.
 */
export function diffIndex(
	existing: Map<string, string>,
	desired: { id: string; contentHash: string }[]
): IndexDiff {
	const desiredIds = new Set(desired.map((d) => d.id));
	const toEmbed = desired.filter((d) => existing.get(d.id) !== d.contentHash).map((d) => d.id);
	const toDrop = [...existing.keys()].filter((id) => !desiredIds.has(id));
	return { toEmbed, toDrop };
}

// ── Binary format ─────────────────────────────────────────────────────────────
// [magic u32 "PYEI"][version u8][dim u16][count u32][metaLen u32][meta JSON][Int8 blob]
// meta = { complete, scope, rows: [{ id, h: contentHash, c: chunkCount }, …] };
// the blob is every item's chunks concatenated in row order.
//
// v2 (ADR-184) added `complete` and `scope`, because an index has to record two
// things about ITSELF that outlive the session that wrote it:
//
//   • `complete` — whether the build that wrote this file finished. ADR-182 made
//     a build persist every 25 embeds so an interruption is resumable; that also
//     means "the file has rows in it" stopped meaning "the vault is indexed".
//     Anything reading size() to decide whether to build was, from that moment,
//     able to call a fifth of a vault done.
//   • `scope` — the folders and cap the rows were selected under. Narrowing the
//     scope has to drop what is now out of it, and nothing else can tell.
//
// A v1 file is refused, which the caller already treats as "no index" and
// rebuilds. That migration is free this release: ADR-182's chunk-size change
// invalidates every content hash anyway.
//
// `keeper` (ADR-220) is optional and needs no version: which kind of device last
// wrote the file. A phone does not rewrite an index a desktop keeps. A file
// without it — or one written by a release that drops unknown fields — reads as
// "no keeper", which is the behaviour before ADR-220: every device writes.
// `writtenAt` (epoch ms) comes with it, so a phone can say how old the desktop's
// copy is.

const MAGIC = 0x50594549; // "PYEI"
const VERSION = 2;
const HEADER_LEN = 4 + 1 + 2 + 4 + 4;

/** What an index knows about itself, beyond its rows (ADR-184). */
export interface IndexMeta {
	/** Whether the build that wrote this file ran to completion. */
	complete: boolean;
	/** The scope the rows were selected under — see `scopeSignature`. */
	scope: string;
	/** Which kind of device last wrote the file (ADR-220). Absent: unknown. */
	keeper?: IndexKeeper;
	/** When it did, in epoch milliseconds (ADR-220). Absent: unknown. */
	writtenAt?: number;
}

/** The two kinds of device that can keep a shared index (ADR-220). */
export type IndexKeeper = "desktop" | "mobile";

/** A keeper read from a header, validated: anything else is "unknown". */
export function readKeeper(value: unknown): IndexKeeper | undefined {
	return value === "desktop" || value === "mobile" ? value : undefined;
}

/** A write time read from a header, validated: a positive finite number or nothing. */
export function readWrittenAt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** The optional ADR-220 fields, validated, present only when valid. */
function signature(head: { keeper?: unknown; writtenAt?: unknown } | null | undefined): Pick<IndexMeta, "keeper" | "writtenAt"> {
	const keeper = readKeeper(head?.keeper);
	const writtenAt = readWrittenAt(head?.writtenAt);
	return { ...(keeper ? { keeper } : {}), ...(writtenAt ? { writtenAt } : {}) };
}

export const EMPTY_INDEX_META: IndexMeta = { complete: false, scope: "" };

export function serializeIndex(
	items: IndexedConversation[],
	dim: number,
	info: IndexMeta = EMPTY_INDEX_META,
): ArrayBuffer {
	const meta = {
		complete: info.complete === true,
		scope: typeof info.scope === "string" ? info.scope : "",
		...signature(info),
		rows: items.map((it) => ({ id: it.id, h: it.contentHash, c: it.chunks.length })),
	};
	const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
	const totalChunks = items.reduce((n, it) => n + it.chunks.length, 0);
	const buf = new ArrayBuffer(HEADER_LEN + metaBytes.length + totalChunks * dim);
	const dv = new DataView(buf);
	let o = 0;
	dv.setUint32(o, MAGIC); o += 4;
	dv.setUint8(o, VERSION); o += 1;
	dv.setUint16(o, dim); o += 2;
	dv.setUint32(o, items.length); o += 4;
	dv.setUint32(o, metaBytes.length); o += 4;
	new Uint8Array(buf, o, metaBytes.length).set(metaBytes); o += metaBytes.length;

	const blob = new Int8Array(buf, o);
	let row = 0;
	for (const it of items) {
		for (const chunk of it.chunks) {
			if (chunk.length !== dim) {
				throw new Error(`serializeIndex: chunk dim ${chunk.length} != ${dim} for "${it.id}"`);
			}
			blob.set(chunk, row * dim);
			row++;
		}
	}
	return buf;
}

/**
 * What a persisted index says about itself — rows, completeness, scope — read
 * from the header alone (ADR-199). For the settings status line, which must be
 * able to say "ready" or "unfinished" without loading the model: `deserializeIndex`
 * needs no model either, but copies every vector. Null for anything unreadable,
 * which the status reports as "not built".
 */
export function peekIndexMeta(buf: ArrayBuffer): (IndexMeta & { count: number }) | null {
	try {
		const dv = new DataView(buf);
		if (buf.byteLength < HEADER_LEN || dv.getUint32(0) !== MAGIC || dv.getUint8(4) !== VERSION) return null;
		const count = dv.getUint32(7);
		const metaLen = dv.getUint32(11);
		if (HEADER_LEN + metaLen > buf.byteLength) return null;
		const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, HEADER_LEN, metaLen))) as {
			complete?: unknown; scope?: unknown; keeper?: unknown; writtenAt?: unknown;
		};
		return {
			count,
			complete: head?.complete === true,
			scope: typeof head?.scope === "string" ? head.scope : "",
			...signature(head),
		};
	} catch {
		// Malformed JSON in a header is the same fact as a bad magic: this file
		// cannot vouch for an index, and the caller says "not built".
		return null;
	}
}

export function deserializeIndex(
	buf: ArrayBuffer,
): { items: IndexedConversation[]; dim: number; meta: IndexMeta } {
	const dv = new DataView(buf);
	let o = 0;
	if (dv.getUint32(o) !== MAGIC) throw new Error("deserializeIndex: bad magic"); o += 4;
	const version = dv.getUint8(o); o += 1;
	if (version !== VERSION) throw new Error(`deserializeIndex: unsupported version ${version}`);
	const dim = dv.getUint16(o); o += 2;
	const count = dv.getUint32(o); o += 4;
	const metaLen = dv.getUint32(o); o += 4;
	if (o + metaLen > buf.byteLength) throw new Error("deserializeIndex: truncated meta");
	const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o, metaLen))) as {
		complete?: unknown; scope?: unknown; keeper?: unknown; writtenAt?: unknown; rows?: unknown;
	};
	o += metaLen;
	const meta = head?.rows as { id: string; h: string; c: number }[];
	if (!Array.isArray(meta) || meta.length < count) throw new Error("deserializeIndex: meta/count mismatch");
	// Validated at the boundary, not trusted: a hand-edited or truncated header
	// must read as "not complete, no scope", which makes the next build redo the
	// work rather than serve a file nobody can vouch for (principle 1).
	const info: IndexMeta = {
		complete: head?.complete === true,
		scope: typeof head?.scope === "string" ? head.scope : "",
		...signature(head),
	};

	const blobStart = o;
	// A file cut short (a sync that delivered half of it) used to deserialize
	// into short vectors, and every later cosine() threw "length mismatch" — the
	// index was unusable until a manual rebuild. Refuse it here; the caller
	// treats a throw as "no index" and rebuilds.
	const totalChunks = meta.slice(0, count).reduce((n, m) => n + (m.c | 0), 0);
	if (blobStart + totalChunks * dim > buf.byteLength) throw new Error("deserializeIndex: truncated vectors");
	const items: IndexedConversation[] = [];
	let row = 0;
	for (let i = 0; i < count; i++) {
		const m = meta[i];
		const chunks: Int8Array[] = [];
		for (let c = 0; c < m.c; c++) {
			const start = blobStart + row * dim;
			chunks.push(new Int8Array(buf.slice(start, start + dim)));
			row++;
		}
		items.push({ id: m.id, contentHash: m.h, chunks });
	}
	return { items, dim, meta: info };
}
