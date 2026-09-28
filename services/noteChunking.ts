import { scoreRelevanceTokensWeighted, tokenize } from "./noteRelevance";

/** Notes longer than this are chunked and filtered instead of inlined whole.
 *  12,000 chars ≈ 3,000 tokens — a fraction of modern context windows (200K–1M). */
export const NOTE_CHUNK_THRESHOLD_CHARS = 12000;

interface Chunk {
	heading: string;
	text: string;
	order: number;
}

/** Splits markdown into chunks at each heading line (any level 1–6). */
export function chunkByHeadings(content: string): Chunk[] {
	const lines = content.split("\n");
	const chunks: Chunk[] = [];
	let heading = "";
	let current: string[] = [];

	const flush = () => {
		const text = current.join("\n").trim();
		if (text.length > 0) chunks.push({ heading, text, order: chunks.length });
	};

	for (const line of lines) {
		if (/^#{1,6}\s/.test(line)) {
			flush();
			heading = line.replace(/^#{1,6}\s*/, "").trim();
			current = [line];
		} else {
			current.push(line);
		}
	}
	flush();

	return chunks;
}

/** Splits content into chunks at double-newline boundaries.
 *  Fallback for notes without markdown headings. */
function chunkByParagraphs(content: string): Chunk[] {
	const blocks = content.split(/\n{2,}/);
	return blocks
		.map((text, i) => ({ heading: "", text: text.trim(), order: i }))
		.filter((c) => c.text.length > 0);
}

/** A cut piece of a chunk shorter than this is noise, not context: it is left out. */
const MIN_PARTIAL_CHARS = 200;
const CHUNK_SEPARATOR = "\n\n";

/**
 * For long notes, keeps only the chunks most relevant to `query` (up to
 * `budgetChars`) instead of inlining the whole note — prevents a large
 * attached note from burying the actual question or blowing the context
 * budget. Short notes pass through unchanged. Notes without headings fall
 * back to paragraph-level chunking.
 *
 * `budgetChars` is a hard ceiling on the text returned. The old loop compared
 * AFTER adding (so the last chunk could double the budget) and returned a note
 * it could not split whole — a single-section note of any size reached the
 * prompt uncut. Now: the most relevant chunk goes in first (cut to the budget
 * if it alone is larger), then the note's first chunk for framing, then the
 * rest by rank; a chunk that does not fit is cut to the room left, and a note
 * that cannot be split is cut to the budget.
 */
export function selectRelevantChunks(
	content: string,
	query: string,
	budgetChars: number = NOTE_CHUNK_THRESHOLD_CHARS
): { text: string; isExcerpt: boolean } {
	if (content.length <= budgetChars) return { text: content, isExcerpt: false };

	let chunks = chunkByHeadings(content);
	if (chunks.length <= 1) {
		chunks = chunkByParagraphs(content);
		if (chunks.length <= 1) return { text: content.slice(0, budgetChars), isExcerpt: true };
	}

	const queryTokens = tokenize(query);
	const haystacks = chunks.map((c) => `${c.heading} ${c.text}`);
	const scores = scoreRelevanceTokensWeighted(queryTokens, haystacks);
	const ranked = chunks
		.map((c, i) => ({ ...c, score: scores[i] }))
		.sort((a, b) => b.score - a.score);

	const kept: { order: number; text: string }[] = [];
	let used = 0;
	const add = (c: Chunk, minPartial: number): void => {
		const sep = kept.length > 0 ? CHUNK_SEPARATOR.length : 0;
		const room = budgetChars - used - sep;
		if (room <= 0) return;
		if (c.text.length > room && room < minPartial) return;
		const text = c.text.slice(0, room);
		kept.push({ order: c.order, text });
		used += sep + text.length;
	};

	// The most relevant chunk always goes in, cut to the budget when larger.
	const top = ranked[0];
	add(top, 0);
	// Then the first chunk (introduction/overview) for framing context.
	const firstChunk = ranked.find((c) => c.order === 0);
	if (firstChunk && firstChunk !== top) add(firstChunk, MIN_PARTIAL_CHARS);
	for (const c of ranked) {
		if (c === top || c === firstChunk) continue;
		add(c, MIN_PARTIAL_CHARS);
	}
	kept.sort((a, b) => a.order - b.order); // restore original document order

	return { text: kept.map((c) => c.text).join(CHUNK_SEPARATOR), isExcerpt: true };
}
