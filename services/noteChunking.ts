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

/**
 * For long notes, keeps only the chunks most relevant to `query` (up to
 * `budgetChars`) instead of inlining the whole note — prevents a large
 * attached note from burying the actual question or blowing the context
 * budget. Short notes pass through unchanged. Notes without headings fall
 * back to paragraph-level chunking.
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
		if (chunks.length <= 1) return { text: content, isExcerpt: false };
	}

	const queryTokens = tokenize(query);
	const haystacks = chunks.map((c) => `${c.heading} ${c.text}`);
	const scores = scoreRelevanceTokensWeighted(queryTokens, haystacks);
	const ranked = chunks
		.map((c, i) => ({ ...c, score: scores[i] }))
		.sort((a, b) => b.score - a.score);

	const kept: typeof ranked = [];
	let total = 0;

	// Always include the first chunk (introduction/overview) for framing context.
	const firstChunk = ranked.find((c) => c.order === 0);
	if (firstChunk) {
		kept.push(firstChunk);
		total += firstChunk.text.length;
	}

	for (const c of ranked) {
		if (c.order === 0) continue; // already added
		if (kept.length > 0 && total >= budgetChars) break;
		kept.push(c);
		total += c.text.length;
	}
	kept.sort((a, b) => a.order - b.order); // restore original document order

	return { text: kept.map((c) => c.text).join("\n\n"), isExcerpt: true };
}
