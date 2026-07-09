/** Lowercase alphanumeric tokens, deduped. Used for cheap keyword-overlap scoring. */
export function tokenize(text: string): string[] {
	return Array.from(new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []));
}

/**
 * Scores how relevant `haystack` (a note's title/headings) is to `query` (the
 * user's in-progress message) by counting shared tokens. No embeddings or
 * vector store — a cheap keyword-overlap heuristic used to rank the "#" note
 * attach suggestions so topically relevant notes surface above arbitrary
 * vault order, without reading full file content on every keystroke.
 */
export function scoreRelevance(query: string, haystack: string): number {
	const queryTokens = tokenize(query);
	if (queryTokens.length === 0) return 0;
	const haystackTokens = new Set(tokenize(haystack));
	return queryTokens.reduce((score, tok) => score + (haystackTokens.has(tok) ? 1 : 0), 0);
}
