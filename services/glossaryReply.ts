/**
 * Reading the glossary's structured replies (ADR-136/149/206).
 *
 * Split out of `messageUtils.ts` when ADR-206 added the translation reply: the
 * lookup's shapes are one subject with one set of rules — what counts as a
 * surface form, which marker wins when a model reorders them, and what a reply
 * with no markers at all means — and they belong beside each other rather than
 * among the token counters and date formatters.
 *
 * Everything here is pure, and every rejection is a mark the reader would
 * otherwise meet in the wrong place.
 */

import {
	DEFINITION_MARKER,
	VARIANTS_MARKER,
	TRANSLATIONS_MARKER,
	CONTEXT_MARKER,
	TERM_MARKER,
} from "./promptConstants";

/** Upper bound on stored variants. A term has a handful of real surface forms;
 *  a longer list means the model started inventing related words, and each one
 *  is a phrase that gets marked in every conversation. */
const MAX_VARIANTS = 8;

/**
 * Clean one surface form out of a model's list, or "" when what came back is not
 * usable as one.
 *
 * The one cleaner, shared by every form a reply can carry — variants,
 * translations, and the translated term of ADR-206. It was written once per
 * caller before that, which is how `en: none` became a surface form that marked
 * the word "none" in every answer.
 *
 * Length is the load-bearing part: a one-character form matches far too much,
 * and anything over 60 characters is a sentence the model wrote instead of a
 * term.
 */
export function cleanSurfaceForm(raw: string): string {
	// Strip the decoration models add around list items: bullets, quotes,
	// a trailing period, and the "(plural)" style annotations.
	const cleaned = raw
		.replace(/\([^)]*\)/g, " ")
		.replace(/^[\s\-\u2013\u2014*\u2022\u201c\u201d\u2018\u2019"']+/, "")
		// `*` is stripped at both ends, not just the leading one: a model that
		// emphasises a form writes `*Zählern*`, and a trailing asterisk left on it
		// becomes part of the surface form and stops it ever matching.
		.replace(/[\s.;:*\u201c\u201d\u2018\u2019"']+$/, "")
		.trim();
	if (cleaned.length < 2 || cleaned.length > 60) return "";
	if (/^(none|keine|n\/a|-)$/i.test(cleaned)) return "";
	return cleaned;
}

/** What `translateDefinition` returns: the definition in the target language and,
 *  when one was asked for and given, the term's equivalent in it (ADR-206). */
export interface TranslatedDefinition {
	definition: string;
	/** "" when none was asked for, none exists, or the model declined. */
	term: string;
}

/**
 * Parse the reply to `translateDefinition` (ADR-206):
 *   TERM: cartel law
 *   DEFINITION:
 *   Cartel law is the body of rules that …
 *
 * Tolerant of a reply with no markers at all, which is what the prompt asked for
 * before ADR-206 and what a model still returns when it ignores the format: the
 * whole reply is the definition and no form is recorded. Losing a good
 * translation to a strict parser would be far worse than losing the form, which
 * the next lookup can still supply.
 */
export function parseTranslationReply(raw: string): TranslatedDefinition {
	const termMatch = raw.match(new RegExp(`^${TERM_MARKER}:[ \\t]*(.*)$`, "im"));
	const defMatch = raw.match(new RegExp(`^${DEFINITION_MARKER}:\\s*([\\s\\S]*)`, "im"));
	const definition = (defMatch
		? defMatch[1]
		: raw.replace(new RegExp(`^${TERM_MARKER}:.*$`, "gim"), "")
	).trim();
	return { definition, term: cleanSurfaceForm(termMatch ? termMatch[1] : "") };
}

/**
 * Parses the structured response produced by `defineTerm` (ADR-136/149):
 *   DEFINITION:
 *   <two or three sentences>
 *   VARIANTS: Zählers | Zählern
 *   TRANSLATIONS: en: counter | it: contatore
 *   CONTEXT: …der Zähler wird monatlich abgelesen…
 *
 * Variants are same-language forms and translations are language-tagged; they
 * were one flat list until ADR-149, which could not say which language a form
 * belonged to.
 *
 * Variants are separated by `|` because a surface form may contain spaces
 * ("sparse coding"). Commas are accepted as a fallback separator for the case
 * where the model ignores the format — but only when no `|` is present, so a
 * correctly formatted reply is never re-split.
 *
 * The definition falls back to the whole reply with the marker lines stripped:
 * a lookup that returns prose without markers is still a usable definition, and
 * losing it to a strict parser would be worse than losing the variants.
 */
export function parseDefinitionReply(raw: string): {
	definition: string;
	variants: string[];
	translations: { lang: string; term: string }[];
	context: string;
} {
	const translationsMatch = raw.match(new RegExp(`^${TRANSLATIONS_MARKER}:[ \\t]*(.*)$`, "im"));
	const contextMatch = raw.match(new RegExp(`^${CONTEXT_MARKER}:[ \\t]*(.*)$`, "im"));
	const variantsMatch = raw.match(new RegExp(`^${VARIANTS_MARKER}:[ \\t]*(.*)$`, "im"));
	// Split at the first marker line rather than matching up to it: with the `m`
	// flag a trailing `$` anchors to the first line break, which would truncate a
	// multi-paragraph definition to its opening sentence. The earliest of the
	// three markers wins, because a model that reorders them must not be able to
	// drag a stray marker line into the definition.
	const markerAt = [variantsMatch, translationsMatch, contextMatch]
		.map((m) => m?.index)
		.filter((i): i is number => typeof i === "number" && i > 0);
	const head = markerAt.length > 0 ? raw.slice(0, Math.min(...markerAt)) : raw;
	const defMatch = head.match(new RegExp(`^${DEFINITION_MARKER}:\\s*([\\s\\S]*)`, "im"));

	const definition = (defMatch ? defMatch[1] : head
		.replace(new RegExp(`^${DEFINITION_MARKER}:[ \\t]*`, "im"), "")
		.replace(new RegExp(`^(?:${VARIANTS_MARKER}|${TRANSLATIONS_MARKER}|${CONTEXT_MARKER}):.*$`, "gim"), "")
	).trim();

	const rawList = variantsMatch ? variantsMatch[1].trim() : "";
	const pieces = rawList.includes("|") ? rawList.split("|") : rawList.split(",");
	const seen = new Set<string>();
	const variants: string[] = [];
	for (const piece of pieces) {
		const cleaned = cleanSurfaceForm(piece);
		if (!cleaned) continue;
		const key = cleaned.toLocaleLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		variants.push(cleaned);
		if (variants.length >= MAX_VARIANTS) break;
	}
	// `lang: term`, the shape the prompt asks for. An item without a language code
	// is dropped rather than guessed at: a translation whose language is unknown
	// cannot be filed under one, and guessing would be a silent mislabel.
	const translations: { lang: string; term: string }[] = [];
	const rawTranslations = translationsMatch ? translationsMatch[1].trim() : "";
	const tPieces = rawTranslations.includes("|") ? rawTranslations.split("|") : rawTranslations.split(",");
	for (const piece of tPieces) {
		const m = /^\s*\(?([A-Za-z]{2,3})\)?\s*[:=-]\s*(.+?)\s*$/.exec(piece.replace(/["'\u201c\u201d]/g, ""));
		if (!m) continue;
		// The same cleaner as the variants above: a translation is a surface form
		// like any other, so `en: none` must not become one.
		const term = cleanSurfaceForm(m[2]);
		if (!term) continue;
		const lang = m[1].toLowerCase();
		if (translations.some((t) => t.lang === lang && t.term.toLocaleLowerCase() === term.toLocaleLowerCase())) continue;
		translations.push({ lang, term });
		if (translations.length >= MAX_VARIANTS) break;
	}

	// One sentence, kept verbatim — it is an attested example, so "cleaning" it
	// would defeat the point. Only the model's own decoration comes off.
	const context = (contextMatch ? contextMatch[1] : "")
		.replace(/^[\s\-\u2013\u2014*\u2022]+/, "")
		.replace(/^[\u201c\u201e"']|[\u201d"']$/g, "")
		.trim();

	return { definition, variants, translations, context: /^(none|keine|n\/a|-)$/i.test(context) ? "" : context };
}
