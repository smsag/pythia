// Plain-language "good for" example tasks per model, shown under each row in the
// model picker (Idea 1 / ADR-102). Deliberately phrased as recognizable everyday
// tasks — a user matches their own intent to an example — rather than capability
// jargon like "deep reasoning" or "fast/slow", which most users can't rank.
//
// Kept out of the `t()` string table because the natural lookup is dynamic (by
// model id), which the dead-key i18n test can't see; a per-id { en, de } map
// localizes it without tripping that check. Every non-hidden MODEL_CATALOG entry
// must have an entry here — enforced by tests/modelGuidance.test.ts.

export const MODEL_GOOD_FOR: Record<string, { en: string; de: string }> = {
	// ── Anthropic ────────────────────────────────────────────────────────────
	"claude-opus-5-5":   { en: "Long chapters, in-depth comparisons, tricky problems", de: "Lange Kapitel, tiefe Vergleiche, knifflige Probleme" },
	"claude-opus-5":     { en: "Long chapters, in-depth comparisons, tricky problems", de: "Lange Kapitel, tiefe Vergleiche, knifflige Probleme" },
	"claude-fable-5-1":  { en: "Demanding analysis, long multi-step tasks",            de: "Anspruchsvolle Analysen, lange mehrstufige Aufgaben" },
	"claude-fable-5":    { en: "Stories, creative writing, brainstorming ideas",       de: "Geschichten, kreatives Schreiben, Ideen sammeln" },
	"claude-mythos-5":   { en: "Complex tasks, in-depth analysis",                     de: "Komplexe Aufgaben, tiefe Analyse" },
	"claude-opus-4-8":   { en: "Long chapters, in-depth comparisons, tricky problems", de: "Lange Kapitel, tiefe Vergleiche, knifflige Probleme" },
	"claude-opus-4-7":   { en: "Long chapters, in-depth comparisons, tricky problems", de: "Lange Kapitel, tiefe Vergleiche, knifflige Probleme" },
	"claude-opus-4-6":   { en: "Long chapters, in-depth comparisons, tricky problems", de: "Lange Kapitel, tiefe Vergleiche, knifflige Probleme" },
	"claude-sonnet-5":   { en: "Everyday questions, explaining topics, drafting text",  de: "Alltagsfragen, Themen erklären, Texte entwerfen" },
	"claude-sonnet-4-6": { en: "Everyday questions, explaining topics, drafting text",  de: "Alltagsfragen, Themen erklären, Texte entwerfen" },
	"claude-haiku-4-5":  { en: "Quick facts, short rewrites, simple asks",              de: "Schnelle Fakten, kurze Umformulierungen, Einfaches" },

	// ── OpenAI ───────────────────────────────────────────────────────────────
	"gpt-6-astra":   { en: "The hardest problems, long careful analysis",   de: "Die schwersten Probleme, lange sorgfältige Analyse" },
	"gpt-6-sol":     { en: "Complex work and code, at a mid price",         de: "Komplexe Aufgaben und Code, zum mittleren Preis" },
	"gpt-6-luna":    { en: "Quick, simple tasks, very low cost",            de: "Schnelle, einfache Aufgaben, sehr günstig" },
	"gpt-5.6":       { en: "Complex work, careful analysis, hard problems", de: "Komplexe Aufgaben, sorgfältige Analyse, schwere Probleme" },
	"gpt-5.6-terra": { en: "Everyday questions and analysis, balanced",     de: "Alltagsfragen und Analysen, ausgewogen" },
	"gpt-5.6-luna":  { en: "Quick everyday tasks at lower cost",            de: "Schnelle Alltagsaufgaben, günstiger" },
	"gpt-5.4-mini": { en: "Everyday questions and analysis, lower cost",   de: "Alltagsfragen und Analysen, günstiger" },
	"gpt-5.4-nano": { en: "Quick, simple tasks, very low cost",            de: "Schnelle, einfache Aufgaben, sehr günstig" },
	"gpt-4.1":      { en: "Everyday questions, very long documents",       de: "Alltagsfragen, sehr lange Dokumente" },
	"gpt-4.1-mini": { en: "Quick everyday tasks at lower cost",            de: "Schnelle Alltagsaufgaben, günstiger" },
	"gpt-4.1-nano": { en: "Very quick, simple tasks",                      de: "Sehr schnelle, einfache Aufgaben" },
	"gpt-4o":       { en: "Everyday questions, working with images",       de: "Alltagsfragen, Arbeiten mit Bildern" },
	"gpt-4o-mini":  { en: "Quick, simple tasks, low cost",                 de: "Schnelle, einfache Aufgaben, günstig" },
	"o3-pro":       { en: "Hard problems: math, logic, careful analysis",  de: "Schwere Probleme: Mathe, Logik, sorgfältige Analyse" },
	"o3":           { en: "Step-by-step problems and analysis",            de: "Schritt-für-Schritt-Probleme und Analyse" },
	"o3-mini":      { en: "Quicker step-by-step problems",                 de: "Schnellere Schritt-für-Schritt-Probleme" },
	"o4-mini":      { en: "Quick problem-solving tasks",                   de: "Schnelle Aufgaben zum Problemlösen" },

	// ── Mistral ──────────────────────────────────────────────────────────────
	"mistral-large-latest":    { en: "Everyday questions, general tasks",   de: "Alltagsfragen, allgemeine Aufgaben" },
	"mistral-medium-latest":   { en: "Everyday questions, multilingual work", de: "Alltagsfragen, mehrsprachige Aufgaben" },
	"mistral-small-latest":    { en: "Quick, simple tasks, low cost",       de: "Schnelle, einfache Aufgaben, günstig" },
	"codestral-latest":        { en: "Writing and explaining code",         de: "Code schreiben und erklären" },
	"magistral-medium-latest": { en: "Step-by-step reasoning problems",     de: "Schritt-für-Schritt-Denkaufgaben" },
	"magistral-small-latest":  { en: "Quicker reasoning tasks",             de: "Schnellere Denkaufgaben" },
	"zai-glm-5-3":             { en: "Step-by-step problems, very long documents", de: "Schritt-für-Schritt-Probleme, sehr lange Dokumente" },
};

/** The "good for" example string for a model in the given language, or "" when
 *  the model has no entry (e.g. a custom/unknown model the user typed in). */
export function goodForModel(id: string, lang: "en" | "de"): string {
	return MODEL_GOOD_FOR[id]?.[lang] ?? "";
}

/**
 * Three relative axes per model, each 1–3 (ADR-162): how fast it answers, how
 * deep it goes, and what one message costs relative to the rest of the
 * catalog. Relative tiers rather than prices or latencies, because both change
 * monthly and per provider while the *ranking* between a small and a large
 * model does not. A user picks by outcome — faster or better, and what it
 * costs — which is the question an id and a context window never answer.
 * Every non-hidden MODEL_CATALOG entry must have one — enforced by
 * tests/modelGuidance.test.ts.
 */
export type Tier = 1 | 2 | 3;
export interface ModelProfile { speed: Tier; depth: Tier; cost: Tier }

export const MODEL_PROFILE: Record<string, ModelProfile> = {
	// ── Anthropic ────────────────────────────────────────────────────────────
	"claude-opus-5-5":   { speed: 1, depth: 3, cost: 3 },
	"claude-opus-5":     { speed: 1, depth: 3, cost: 3 },
	"claude-fable-5-1":  { speed: 1, depth: 3, cost: 3 },
	"claude-fable-5":    { speed: 1, depth: 3, cost: 3 },
	"claude-mythos-5":   { speed: 1, depth: 3, cost: 3 },
	"claude-opus-4-8":   { speed: 1, depth: 3, cost: 3 },
	"claude-opus-4-7":   { speed: 1, depth: 3, cost: 3 },
	"claude-opus-4-6":   { speed: 1, depth: 3, cost: 3 },
	"claude-sonnet-5":   { speed: 2, depth: 2, cost: 2 },
	"claude-sonnet-4-6": { speed: 2, depth: 2, cost: 2 },
	"claude-haiku-4-5":  { speed: 3, depth: 1, cost: 1 },

	// ── OpenAI ───────────────────────────────────────────────────────────────
	"gpt-6-astra":   { speed: 1, depth: 3, cost: 3 },
	"gpt-6-sol":     { speed: 2, depth: 3, cost: 2 },
	"gpt-6-luna":    { speed: 3, depth: 1, cost: 1 },
	"gpt-5.6":       { speed: 1, depth: 3, cost: 3 },
	"gpt-5.6-terra": { speed: 2, depth: 2, cost: 2 },
	"gpt-5.6-luna":  { speed: 3, depth: 1, cost: 1 },
	"gpt-5.4-mini": { speed: 2, depth: 2, cost: 2 },
	"gpt-5.4-nano": { speed: 3, depth: 1, cost: 1 },
	"gpt-4.1":      { speed: 2, depth: 2, cost: 2 },
	"gpt-4.1-mini": { speed: 3, depth: 1, cost: 1 },
	"gpt-4.1-nano": { speed: 3, depth: 1, cost: 1 },
	"gpt-4o":       { speed: 2, depth: 2, cost: 2 },
	"gpt-4o-mini":  { speed: 3, depth: 1, cost: 1 },
	"o3-pro":       { speed: 1, depth: 3, cost: 3 },
	"o3":           { speed: 1, depth: 3, cost: 3 },
	"o3-mini":      { speed: 2, depth: 2, cost: 2 },
	"o4-mini":      { speed: 2, depth: 2, cost: 2 },

	// ── Mistral ──────────────────────────────────────────────────────────────
	"mistral-large-latest":    { speed: 2, depth: 2, cost: 2 },
	"mistral-medium-latest":   { speed: 2, depth: 2, cost: 2 },
	"mistral-small-latest":    { speed: 3, depth: 1, cost: 1 },
	"codestral-latest":        { speed: 3, depth: 2, cost: 1 },
	"magistral-medium-latest": { speed: 1, depth: 3, cost: 2 },
	"magistral-small-latest":  { speed: 2, depth: 2, cost: 1 },
	"zai-glm-5-3":             { speed: 2, depth: 2, cost: 2 },
};

const AXIS_LABELS: Record<"en" | "de", [string, string, string]> = {
	en: ["Speed", "Depth", "Cost"],
	de: ["Tempo", "Tiefe", "Kosten"],
};

/** `●●○` for a tier — geometric marks, not icons, so the row stays text. */
export function tierDots(tier: Tier): string {
	return "●".repeat(tier) + "○".repeat(3 - tier);
}

/** One mono-friendly line — `Speed ●●○ · Depth ●●● · Cost ●●●` — or "" for a
 *  model with no profile (a custom id the user typed in). */
export function profileLine(id: string, lang: "en" | "de"): string {
	const p = MODEL_PROFILE[id];
	if (!p) return "";
	const [s, d, c] = AXIS_LABELS[lang];
	return `${s} ${tierDots(p.speed)} · ${d} ${tierDots(p.depth)} · ${c} ${tierDots(p.cost)}`;
}
