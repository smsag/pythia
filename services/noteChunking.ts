import { scoreRelevance } from "./noteRelevance";

/** Notes longer than this are chunked and filtered instead of inlined whole. */
export const NOTE_CHUNK_THRESHOLD_CHARS = 4000;

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

/**
 * For long notes, keeps only the chunks most relevant to `query` (up to
 * `budgetChars`) instead of inlining the whole note — prevents a large
 * attached note from burying the actual question or blowing the context
 * budget. Short notes, or notes without headings to split on, pass through
 * unchanged.
 */
export function selectRelevantChunks(
	content: string,
	query: string,
	budgetChars: number = NOTE_CHUNK_THRESHOLD_CHARS
): { text: string; isExcerpt: boolean } {
	if (content.length <= budgetChars) return { text: content, isExcerpt: false };

	const chunks = chunkByHeadings(content);
	if (chunks.length <= 1) return { text: content, isExcerpt: false };

	const ranked = chunks
		.map((c) => ({ ...c, score: scoreRelevance(query, `${c.heading} ${c.text}`) }))
		.sort((a, b) => b.score - a.score);

	const kept: typeof ranked = [];
	let total = 0;
	for (const c of ranked) {
		if (kept.length > 0 && total >= budgetChars) break;
		kept.push(c);
		total += c.text.length;
	}
	kept.sort((a, b) => a.order - b.order); // restore original document order

	return { text: kept.map((c) => c.text).join("\n\n"), isExcerpt: true };
}
