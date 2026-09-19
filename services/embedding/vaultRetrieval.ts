// Pure retrieval logic for vault-wide semantic RAG (ADR-116).
//
// Two pieces, both pure and runtime-free so they are fully unit-testable:
//   • noteEmbedChunks — split a note's markdown into the text chunks that get
//     embedded (heading-aware, then windowed to a char budget), mirroring how
//     conversationChunks feeds the conversation index.
//   • retrievalQuery — the text actually embedded for a turn (ADR-183).
//   • isIndexingOptedOut — the per-note `pythia: false` escape hatch (ADR-183).
//
// Scoring lives in `VaultIndexService.query`, which yields cooperatively over a
// large index. A second, non-yielding copy (`rankByQuery`) existed here until
// ADR-183 and had already drifted — it never learned about `exclude`.

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

/** How much of the preceding answer joins the retrieval query (ADR-183). */
const CARRY_OVER_CHARS = 200;

/**
 * The text actually embedded to retrieve notes for a turn.
 *
 * The bare user message was the query until ADR-183, which makes a follow-up
 * ("and the second one?") a four-token query that retrieves noise or nothing —
 * the turns most in need of the conversation's context were the ones with none.
 * The head of the preceding answer is appended as carry-over: enough to keep the
 * topic in the vector, short enough that the user's actual words still dominate.
 *
 * The message always leads, and carry-over is dropped when the message is long
 * enough to stand on its own — a full question does not need help, and diluting
 * it would move the vector away from what was asked.
 *
 * Pure: takes the strings, not the conversation, so it is testable and cannot
 * reach for anything else.
 */
export function retrievalQuery(message: string, previousAnswer = ""): string {
	const q = message.trim();
	if (!q) return "";
	if (q.length >= CARRY_OVER_CHARS) return q;
	const carry = previousAnswer.trim().slice(0, CARRY_OVER_CHARS).trim();
	return carry ? `${q}\n\n${carry}` : q;
}

/**
 * Whether a note's frontmatter opts it out of the vault index (ADR-183).
 *
 * `pythia: false` keeps a note out of the index entirely, so its text never
 * reaches a cloud model as auto-retrieved context. Folder scope already answers
 * "which parts of the vault", but a single sensitive note inside an otherwise
 * indexed folder had no answer at all — and data minimisation wants the smallest
 * unit to be excludable, not just the largest.
 *
 * Only an explicit `false` (or the string "false") opts out. Anything else,
 * including a missing key or an unreadable cache, indexes as before — a
 * frontmatter typo must not silently drop a note out of retrieval.
 */
export function isIndexingOptedOut(frontmatter: unknown): boolean {
	if (!frontmatter || typeof frontmatter !== "object") return false;
	const value = (frontmatter as Record<string, unknown>).pythia;
	return value === false || value === "false";
}
