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
	"claude-opus-5":     { en: "Long chapters, in-depth comparisons, tricky problems", de: "Lange Kapitel, tiefe Vergleiche, knifflige Probleme" },
	"claude-fable-5":    { en: "Stories, creative writing, brainstorming ideas",       de: "Geschichten, kreatives Schreiben, Ideen sammeln" },
	"claude-mythos-5":   { en: "Complex tasks, in-depth analysis",                     de: "Komplexe Aufgaben, tiefe Analyse" },
	"claude-opus-4-8":   { en: "Long chapters, in-depth comparisons, tricky problems", de: "Lange Kapitel, tiefe Vergleiche, knifflige Probleme" },
	"claude-opus-4-7":   { en: "Long chapters, in-depth comparisons, tricky problems", de: "Lange Kapitel, tiefe Vergleiche, knifflige Probleme" },
	"claude-opus-4-6":   { en: "Long chapters, in-depth comparisons, tricky problems", de: "Lange Kapitel, tiefe Vergleiche, knifflige Probleme" },
	"claude-sonnet-5":   { en: "Everyday questions, explaining topics, drafting text",  de: "Alltagsfragen, Themen erklären, Texte entwerfen" },
	"claude-sonnet-4-6": { en: "Everyday questions, explaining topics, drafting text",  de: "Alltagsfragen, Themen erklären, Texte entwerfen" },
	"claude-haiku-4-5":  { en: "Quick facts, short rewrites, simple asks",              de: "Schnelle Fakten, kurze Umformulierungen, Einfaches" },

	// ── OpenAI ───────────────────────────────────────────────────────────────
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
	"mistral-small-latest":    { en: "Quick, simple tasks, low cost",       de: "Schnelle, einfache Aufgaben, günstig" },
	"codestral-latest":        { en: "Writing and explaining code",         de: "Code schreiben und erklären" },
	"magistral-medium-latest": { en: "Step-by-step reasoning problems",     de: "Schritt-für-Schritt-Denkaufgaben" },
	"magistral-small-latest":  { en: "Quicker reasoning tasks",             de: "Schnellere Denkaufgaben" },
};

/** The "good for" example string for a model in the given language, or "" when
 *  the model has no entry (e.g. a custom/unknown model the user typed in). */
export function goodForModel(id: string, lang: "en" | "de"): string {
	return MODEL_GOOD_FOR[id]?.[lang] ?? "";
}
