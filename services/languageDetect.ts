/**
 * Which language a piece of text is written in, by function words (ADR-166).
 *
 * Used for two questions the glossary asks while the reader waits: what
 * language is this answer in (the target when the language setting is AUTO),
 * and what language is a stored definition in (so it is not "translated" into
 * the language it already has). A model call could answer both, but it would
 * cost latency on every anchor opened; function words answer them locally and
 * the same way every time.
 *
 * Deliberately narrow: the languages Pythia's users write in and their close
 * neighbours. Anything else — or a text too short to tell — is `null`, and the
 * caller treats that as "unknown", never as a guess.
 */

const STOPWORDS: Record<string, string[]> = {
	de: ["der", "die", "das", "und", "ist", "nicht", "ein", "eine", "einen", "einem", "einer", "mit", "auf", "für", "von", "dem", "den", "zu", "sich", "auch", "als", "wird", "werden", "bei", "oder", "wie", "nach", "aus", "über", "durch", "kann", "sind", "hat", "noch", "nur", "zum", "zur", "im", "des", "dass"],
	en: ["the", "and", "is", "are", "of", "to", "that", "this", "with", "for", "not", "was", "were", "be", "by", "from", "which", "it", "an", "or", "as", "have", "has", "can", "their", "its", "into", "used", "such"],
	fr: ["le", "les", "des", "est", "et", "une", "un", "du", "dans", "pour", "pas", "qui", "sur", "avec", "au", "aux", "sont", "par", "ce", "cette", "ou", "il", "elle", "ses", "leur", "être"],
	it: ["il", "gli", "della", "delle", "del", "che", "è", "non", "per", "una", "sono", "con", "dei", "anche", "come", "nella", "nel", "alla", "lo", "questo", "questa", "ma", "più", "degli"],
	es: ["el", "los", "las", "del", "que", "es", "y", "en", "una", "por", "con", "para", "se", "su", "al", "como", "más", "pero", "sus", "este", "esta", "son", "lo", "entre"],
	pt: ["o", "os", "as", "do", "da", "dos", "das", "que", "é", "não", "um", "uma", "para", "com", "em", "no", "na", "por", "se", "mais", "como", "são", "ao", "ou"],
	nl: ["het", "een", "en", "van", "is", "dat", "niet", "op", "te", "zijn", "met", "voor", "als", "ook", "aan", "er", "maar", "om", "wordt", "bij", "door", "naar", "deze"],
};

const LOOKUP: Map<string, string[]> = (() => {
	const map = new Map<string, string[]>();
	for (const [lang, words] of Object.entries(STOPWORDS)) {
		for (const w of words) map.set(w, [...(map.get(w) ?? []), lang]);
	}
	return map;
})();

/** Fewer hits than this and the text is too short to call. */
const MIN_HITS = 2;

/**
 * ISO 639-1 code of the language `text` is written in, or null when it cannot
 * be told apart with confidence. The winner needs at least two function-word
 * hits and half as many again as the runner-up, so a German answer quoting an
 * English phrase is still German, a short definition whose "das" is also
 * Portuguese is still German, and a two-word label is nobody's.
 */
export function detectLanguage(text: string): string | null {
	const scores = new Map<string, number>();
	for (const token of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
		for (const lang of LOOKUP.get(token) ?? []) scores.set(lang, (scores.get(lang) ?? 0) + 1);
	}
	const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
	const [best, second] = ranked;
	if (!best || best[1] < MIN_HITS) return null;
	if (second && best[1] < second[1] * 1.5) return null;
	return best[0];
}
