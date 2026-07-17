/** Lowercase alphanumeric tokens, deduped. Used for cheap keyword-overlap scoring. */
export function tokenize(text: string): string[] {
	return Array.from(new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []));
}

/** Smoothed inverse-document-frequency: a token present in every haystack (df = n)
 *  still contributes a small constant baseline rather than dropping to zero; a
 *  token present in only one or a few haystacks dominates the score. Same
 *  formula as scikit-learn's TfidfVectorizer(smooth_idf=True). */
function idf(df: number, n: number): number {
	return Math.log((n + 1) / (df + 1)) + 1;
}

/**
 * Scores every haystack's relevance to a pre-tokenized query by summing, for
 * each matched query token, how rare that token is across the given haystack
 * set — unlike a flat "+1 per shared token" count, a word shared by every
 * candidate (e.g. "canvas", "user") barely moves the score, while a word
 * unique to one candidate (e.g. "story") dominates it. Requires the full
 * candidate set up front to compute each token's document frequency; returns
 * one score per haystack, aligned by index. No embeddings, no vector store,
 * no persisted index — recomputed fresh from whatever candidates the caller
 * already has in hand.
 */
export function scoreRelevanceTokensWeighted(queryTokens: string[], haystacks: string[]): number[] {
	if (haystacks.length === 0) return [];
	if (queryTokens.length === 0) return haystacks.map(() => 0);

	const tokenSets = haystacks.map((h) => new Set(tokenize(h)));
	const n = haystacks.length;
	const weights = new Map<string, number>();
	for (const tok of queryTokens) {
		const df = tokenSets.reduce((count, set) => count + (set.has(tok) ? 1 : 0), 0);
		weights.set(tok, idf(df, n));
	}

	return tokenSets.map((set) =>
		queryTokens.reduce((score, tok) => score + (set.has(tok) ? weights.get(tok)! : 0), 0)
	);
}

/**
 * Convenience wrapper over scoreRelevanceTokensWeighted for a raw query
 * string — tokenizes once, then delegates. Prefer the *Tokens variant when
 * scoring the same query against haystacks gathered across multiple calls.
 */
export function scoreRelevanceWeighted(query: string, haystacks: string[]): number[] {
	return scoreRelevanceTokensWeighted(tokenize(query), haystacks);
}
