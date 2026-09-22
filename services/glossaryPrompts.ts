/**
 * The glossary's four prompts (ADR-136/149/151/166/206).
 *
 * Pure builders, taking the already-resolved output-language label the way
 * `titlePrompts.ts` does — so what a lookup asks for is testable without a
 * provider, and the wording lives in one file rather than inside the class that
 * happens to send it.
 *
 * They are kept together because they answer to each other: define and describe
 * share a reply format and a language line, and the translation prompt exists to
 * fill in what define could not ask for at the time.
 */

import {
	DEFINITION_MARKER,
	VARIANTS_MARKER,
	TRANSLATIONS_MARKER,
	CONTEXT_MARKER,
	TERM_MARKER,
} from "./promptConstants";
import { langInstruction } from "./messageUtils";

/** How much of the surrounding message travels with a lookup. Enough for the
 *  sense of a term to be clear, short enough for a gloss the reader waits on. */
const PASSAGE_CHARS = 1200;

/** How much of a definition travels with a translation request. */
const DEFINITION_CHARS = 2000;

/**
 * The language line for a definition or person entry (ADR-166).
 *
 * A named language is instructed exactly as every utility prompt does. AUTO is
 * the one place this departs from ADR-148's "add no instruction": in a chat turn
 * silence lets the model follow the user, but this prompt is written in English,
 * so silence made the model answer in English whatever the passage said — and
 * the note kept that English for good. Naming the passage keeps AUTO's meaning
 * (follow the conversation) instead of inventing a language.
 */
export function definitionLanguageLine(languageLabel: string): string {
	return languageLabel
		? langInstruction(languageLabel)
		: "\n\nWrite the definition in the language the passage is written in.";
}

/**
 * The languages a lookup asks for the term in (ADR-206).
 *
 * English always, because it is the language a vault's second reader is most
 * likely to use and the one an answer drifts into; plus the language this
 * conversation answers in, when it names one.
 *
 * ADR-149 asked only for languages the *passage* already used, which made a
 * cross-language form something that happened by accident: a German term met in
 * a German answer recorded no English equivalent, so "cartel law" went unmarked
 * in every English answer afterwards. A surface form the glossary does not hold
 * is a term the reader is left alone with.
 */
export function translationTargets(languageLabel: string): string {
	return languageLabel && languageLabel !== "English" ? `English and ${languageLabel}` : "English";
}

/**
 * Define one term as it is used in a specific passage (ADR-136).
 *
 * The passage is the whole point. A dictionary can say what "Bauteil" means in
 * general; only the surrounding sentences can say which sense an answer meant,
 * and that sense is what the reader is stuck on. Sending the passage is also
 * what keeps this from needing a new prompt in the conversation.
 *
 * The same call also returns the term's other surface forms, because the model
 * that just read the passage knows whether "Zählern" is the same word and
 * whether the answer's English "cartel law" means it too. Asking separately
 * would double the latency of a lookup the reader is waiting on.
 */
export function defineTermPrompt(term: string, passage: string, languageLabel: string): string {
	return (
		`Define the term "${term}" as it is used in the passage below, and list its other surface forms.\n\n` +
		`Reply in EXACTLY this format — no other text before or after:\n` +
		`${DEFINITION_MARKER}:\n<two or three sentences>\n` +
		`${VARIANTS_MARKER}: <forms separated by | , or leave empty>\n` +
		`${TRANSLATIONS_MARKER}: <lang: term, separated by | , or leave empty>\n` +
		`${CONTEXT_MARKER}: <one sentence from the passage, or leave empty>\n\n` +
		`For the definition: explain the sense that applies here, not every possible meaning. ` +
		`Do not repeat the passage, do not add a heading, do not use the word "context".\n` +
		// ISO 704's rules for a terminological definition. They matter because the
		// definition is read away from this passage — in the glossary note, or by
		// another tool — where a circular or "is when" definition says nothing at
		// all (ADR-149).
		`Write it as a terminological definition: name the broader category the term belongs to and ` +
		`then what distinguishes it from others in that category, so that the definition could be ` +
		`substituted for the term in a sentence. Never define a term with itself or a word built ` +
		`from it, and never open with "is when", "is where" or "describes the fact that".\n` +
		`For the variants: the inflected forms of this term **in the same language** a reader would ` +
		`meet in running text (plural, genitive, dative, declined adjective forms), plus a common ` +
		`abbreviation or spelling variant if one exists. Forms only — never related concepts, never ` +
		`explanations, never a translation, and never a form so generic it would match unrelated ` +
		`sentences. Leave the line empty if there are none.\n` +
		`For the translations: the term's established equivalent in ${translationTargets(languageLabel)}, ` +
		`plus any other language the passage itself uses — each written as an ISO 639-1 code, a colon ` +
		`and the term ("en: cartel law"). Give them even when the passage is monolingual, and give none ` +
		`for the language the term itself is in. Only an established, domain-specific equivalent: never ` +
		`a coinage, never a description, and never a common everyday word that would match unrelated ` +
		`sentences. Leave a language out when the term travels into it unchanged — a proper noun, a ` +
		`product name, an acronym — or when it has no single accepted equivalent there.\n` +
		`For the context: copy ONE short sentence or clause from the passage in which the term ` +
		`actually appears, verbatim and unedited. Leave the line empty if no single sentence shows ` +
		`it in use.` +
		`${definitionLanguageLine(languageLabel)}\n\nPassage:\n${passage.slice(0, PASSAGE_CHARS)}`
	);
}

/**
 * Describe a person named in an answer (ADR-151).
 *
 * Deliberately different from `defineTermPrompt` in one way that matters: the
 * passage is the primary source and the model's own knowledge is the fallback,
 * stated in that order, because a person is far more likely than a term to be
 * someone the model has never heard of — a colleague, a client, a local
 * counterparty. A model that leads with recall invents a plausible biography;
 * one told to prefer the passage says what the conversation actually
 * established. What it produces is stored as `source: model` either way, so the
 * note never presents a generated claim as a recorded one.
 */
export function describePersonPrompt(name: string, passage: string, languageLabel: string): string {
	return (
		`Who is "${name}", as referred to in the passage below?\n\n` +
		`Reply in EXACTLY this format — no other text before or after:\n` +
		`${DEFINITION_MARKER}:\n<two or three sentences>\n` +
		`${VARIANTS_MARKER}: <other names this person is called, separated by | , or leave empty>\n` +
		`${CONTEXT_MARKER}: <one sentence from the passage, or leave empty>\n\n` +
		`Use the passage first: say what it establishes about this person — their role, ` +
		`their relation to the subject, what they did. Only add what you independently know ` +
		`if you are confident it is the same person, and never pad the answer with generic ` +
		`description to reach three sentences.\n` +
		`If the passage does not make clear who this is and you do not recognise the name, ` +
		`say exactly that in one sentence rather than guessing — an invented biography is ` +
		`worse than an empty entry, because it will be read later as something that was recorded.\n` +
		`For the variants: other names the same person is called in running text — surname ` +
		`alone, given name alone, an initial form, a former name. Names only, never roles, ` +
		`and never a name so common it would match unrelated sentences.\n` +
		`For the context: copy ONE short sentence or clause from the passage naming this ` +
		`person, verbatim. Leave the line empty if none does.` +
		`${definitionLanguageLine(languageLabel)}\n\nPassage:\n${passage.slice(0, PASSAGE_CHARS)}`
	);
}

/**
 * Translate a stored glossary definition for display (ADR-166), and — when a
 * term is named — ask for its equivalent in the same breath (ADR-206).
 *
 * Exempt from the output-language rule, like the prompt optimizer: the target
 * language is the whole request.
 *
 * Without a term the reply is the translation itself, exactly as it was before
 * ADR-206. That is the person case: a name is not translated, so asking for one
 * could only produce an invented one.
 */
export function translateDefinitionPrompt(definition: string, language: string, term?: string): string {
	const head =
		`Translate this glossary definition into ${language}. Keep its meaning and its precision: ` +
		`use the established ${language} terminology, and keep proper names, code and Markdown as they are. ` +
		`If it is already in ${language}, return it unchanged. `;
	const body = `\n\nDefinition:\n${definition.slice(0, DEFINITION_CHARS)}`;
	if (!term) return `${head}Reply with the translation only — no preamble, no quotation marks.${body}`;
	return (
		`${head}\n\nReply in EXACTLY this format — no other text before or after:\n` +
		`${TERM_MARKER}: <the established ${language} equivalent of "${term}", or leave empty>\n` +
		`${DEFINITION_MARKER}:\n<the translation>\n\n` +
		`For the term: only an established, domain-specific equivalent — never a coinage, never a ` +
		`description, and never a common everyday word that would match unrelated sentences. Leave it ` +
		`empty when the term travels into ${language} unchanged, or when it has no single accepted ` +
		`equivalent there.${body}`
	);
}
