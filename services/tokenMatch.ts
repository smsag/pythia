/**
 * How well one query token answers one candidate token — the single matching
 * rule shared by conversation search (ADR-168).
 *
 * The rule it replaces was one-directional: a candidate matched only when it
 * was equal to the query token or STARTED with it. That answers the
 * as-you-type case ("kayak" → "kayaking") and nothing else, so two everyday
 * misses were silent:
 *
 *   query "boundaries" · doc "bound"        → no hit (the user typed the longer form)
 *   query "Vertrag"    · doc "Mietvertrag"  → no hit (German compounds are head-FINAL,
 *                                             so the word searched for sits at the END)
 *
 * The compound case is the one that hurts in a German-first vault, and neither
 * is fixable by a stemmer: stemming is language-specific, lossy on compounds,
 * and cannot be corrected by hand.
 *
 * Graded, not boolean. A match found by walking backwards from a longer query,
 * or by looking inside a compound, is a real hit but a weaker claim than the
 * word the user actually typed — so it returns a fraction, and the caller
 * multiplies its IDF weight by it. Boolean matching would let an infix hit
 * outrank an exact one on a rarer token.
 *
 * The length floors are the whole safety story. Without them a 2–3 character
 * stopword ("in", "der", "und") reverse-matches every long query token and
 * every conversation enters the result set — which is the same as no search at
 * all. Anchored at a word boundary wherever possible for the same reason: an
 * unanchored infix of "trag" would match "tragen" for a query about
 * "Mietvertrag".
 *
 * No edit distance. Typo tolerance is a separate decision with its own noise
 * budget and its own cost profile; it is not smuggled in here.
 */

/** Exact hit — the word the user typed is in the document. */
const EXACT = 1;
/** The document word starts with what has been typed so far ("kayak" → "kayaking"). */
const PREFIX = 0.9;
/** The typed word sits inside a longer document word ("Vertrag" → "Mietvertrag"). */
const INFIX = 0.6;
/** The document holds a shorter form of the typed word ("boundaries" → "bound"). */
const REVERSE = 0.5;

/** Minimum typed length before looking INSIDE a document word. Below this an
 *  infix is noise: three characters occur inside most words of any language. */
const MIN_INFIX_QUERY = 5;
/** Minimum document-word length for a reverse (query-starts-with-candidate)
 *  hit — keeps stopwords from matching every long query token. */
const MIN_REVERSE_HEAD = 4;
/** Minimum document-word length for a reverse SUFFIX hit. Higher than the head
 *  floor because a compound's tail is where the accidental matches live
 *  ("Mietvertrag" ends with "trag" as well as with "vertrag"). */
const MIN_REVERSE_TAIL = 5;

/**
 * The strength of the best match for `queryToken` anywhere in `candidateTokens`,
 * from 1 (exact) down to 0 (no match at all).
 *
 * Both inputs are expected to be `tokenize()` output — lowercased, NFC-normalized
 * word tokens — so this does no normalizing of its own.
 */
export function matchStrength(candidateTokens: string[], queryToken: string): number {
	if (!queryToken) return 0;
	let best = 0;
	for (const c of candidateTokens) {
		if (c === queryToken) return EXACT; // nothing can beat it — stop looking
		if (c.startsWith(queryToken)) {
			best = Math.max(best, PREFIX);
		} else if (queryToken.length >= MIN_INFIX_QUERY && c.includes(queryToken)) {
			best = Math.max(best, INFIX);
		} else if (
			(c.length >= MIN_REVERSE_HEAD && queryToken.startsWith(c)) ||
			(c.length >= MIN_REVERSE_TAIL && queryToken.endsWith(c))
		) {
			best = Math.max(best, REVERSE);
		}
	}
	return best;
}

/** Whether a query token matches at all. The boolean view of `matchStrength`,
 *  for callers that count documents rather than score them. */
export function tokenMatches(candidateTokens: string[], queryToken: string): boolean {
	return matchStrength(candidateTokens, queryToken) > 0;
}

/** Results scoring below this fraction of the best result are dropped.
 *
 *  Graded matching makes "score > 0" too weak a filter on its own: a single
 *  weak reverse hit on a common word would put the whole corpus in the list,
 *  ranked but unusable. The floor is RELATIVE, not absolute — IDF weights move
 *  with corpus size, so an absolute cut-off would mean something different in a
 *  20-conversation vault than in a 2000-conversation one. */
export const RELEVANCE_FLOOR = 0.15;

/** Drop results far below the best one. Input must be sorted descending. */
export function applyRelevanceFloor<T extends { score: number }>(sorted: T[]): T[] {
	const top = sorted[0]?.score ?? 0;
	if (top <= 0) return [];
	const cutoff = top * RELEVANCE_FLOOR;
	return sorted.filter((r) => r.score >= cutoff);
}
