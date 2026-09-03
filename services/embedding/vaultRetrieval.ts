// Pure retrieval logic for vault-wide semantic RAG (ADR-116).
//
// Two pieces, both pure and runtime-free so they are fully unit-testable:
//   • noteEmbedChunks — split a note's markdown into the text chunks that get
//     embedded (heading-aware, then windowed to a char budget), mirroring how
//     conversationChunks feeds the conversation index.
//   • rankByQuery — score an already-embedded index against a query vector and
//     return the best-matching note ids, most-relevant first.
//
// The index itself, its diff/serialize helpers, and the cosine/quantize math are
// all shared with the conversation index (embeddingIndex.ts, vectorMath.ts) — a
// note is just another {id, contentHash, chunks} row, keyed by vault path.

import { cosine } from "./vectorMath";
import type { IndexedConversation } from "./embeddingIndex";
import { chunkByHeadings } from "../noteChunking";

/** A scored note from a vault-retrieval query. */
export interface RetrievedNote {
	/** Vault path of the note (the index id). */
	id: string;
	/** Best chunk-to-query cosine, ≈ [-1, 1]. */
	score: number;
}

/**
 * Split a note's markdown into embed-source chunks. Sections are cut at headings
 * (reusing the note-chunking splitter so retrieval and attached-note excerpting
 * agree on structure), then any section longer than `maxChars` is hard-windowed
 * so a long note contributes several vectors and a topic buried deep still gets
 * its own chunk. `maxChars` should track the model's token budget (≈4 chars/token).
 *
 * Pure and deterministic: the same content always yields the same chunks, which
 * is what the content-hash incremental reuse relies on.
 */
export function noteEmbedChunks(content: string, maxChars = 500): string[] {
	const text = typeof content === "string" ? content : "";
	const sections = chunkByHeadings(text).map((c) => c.text.trim()).filter(Boolean);
	// A note with no headings (chunkByHeadings still returns one block) or an empty
	// note: fall back to the whole trimmed body as a single section.
	const source = sections.length > 0 ? sections : [text.trim()].filter(Boolean);

	const chunks: string[] = [];
	for (const section of source) {
		let rest = section;
		while (rest.length > maxChars) {
			chunks.push(rest.slice(0, maxChars));
			rest = rest.slice(maxChars);
		}
		if (rest.trim()) chunks.push(rest);
	}
	return chunks;
}

/**
 * Rank the notes in `index` by similarity to `queryVec`, keeping only those at or
 * above `minScore`, most-similar first. A note's score is its best chunk-to-query
 * cosine (the closest single chunk), matching the max-pairwise measure the
 * related-conversations ranking uses.
 *
 * Pure: operates on a prebuilt in-memory index and a query vector, so it is fully
 * testable with fabricated vectors and independent of the embedding runtime.
 */
export function rankByQuery(
	queryVec: Int8Array,
	index: IndexedConversation[],
	opts: { minScore?: number; limit?: number } = {}
): RetrievedNote[] {
	const { minScore = 0.35, limit } = opts;
	const ranked = index
		.filter((i) => i.chunks.length > 0)
		.map((i) => {
			let best = -Infinity;
			for (const chunk of i.chunks) {
				const s = cosine(chunk, queryVec);
				if (s > best) best = s;
			}
			return { id: i.id, score: best };
		})
		.filter((r) => Number.isFinite(r.score) && r.score >= minScore)
		.sort((a, b) => b.score - a.score);

	return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}
