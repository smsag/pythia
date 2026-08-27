// Heuristics that decide whether an outgoing user message reads as
// "time-sensitive" — likely to need current information the model can't be sure
// of from training. Used to auto-arm the web_search tool for a single send when
// the research toggle is off (ADR-099), so search fires when the user expects it
// without them remembering to flip the globe.
//
// Deliberately conservative: this only *offers* the tool for that turn; the model
// still decides whether to actually search. False positives cost nothing but an
// unused tool in the request; the real failure mode we're fixing is false
// negatives (needed current info, tool wasn't even available), so the cue set
// leans toward catching recency intent.
//
// Pure and dependency-free so it is trivially unit-testable.

// Whole-word recency/uncertainty cues. Matched case-insensitively on word
// boundaries so "nowhere" doesn't match "now" and "newser" doesn't match "news".
// Multi-word entries (with a space) are matched as plain substrings.
const CUE_WORDS: string[] = [
	// ── English ──────────────────────────────────────────────────────────────
	// explicit recency
	"latest", "current", "currently", "recent", "recently", "now", "today",
	"tonight", "yesterday", "nowadays", "up-to-date", "up to date", "so far",
	"this year", "this month", "this week", "these days", "as of",
	// news / events
	"news", "headline", "headlines", "breaking", "announced", "announcement",
	"released", "release", "launch", "launched", "update", "updated",
	// changeable facts
	"price", "prices", "pricing", "cost", "costs", "stock", "shares", "market",
	"rate", "rates", "weather", "forecast", "score", "results", "standings",
	"schedule", "deadline", "version", "changelog",
	// present-status questions
	"who is the", "who's the", "still alive", "who won", "election",

	// ── German (Deutsch) ─────────────────────────────────────────────────────
	// Non-declining / fixed forms; declining stems live in STEM_CUES below.
	"heute", "gestern", "jetzt", "nun", "heutzutage",
	"nachrichten", "neuigkeiten", "schlagzeile", "schlagzeilen", "eilmeldung",
	"wetter", "markt", "kosten",
	"preis", "preise", "preisen",
	"kurs", "kurse", "kursen", "aktienkurs", "aktienkurse", "wechselkurs", "zinssatz",
	"aktie", "aktien",
	"vorhersage", "prognose", "ergebnis", "ergebnisse", "tabellenstand",
	"fahrplan", "zeitplan", "frist", "wahl", "wahlen",
	// present-status / recency phrases (substring)
	"dieses jahr", "in diesem jahr", "diesen monat", "diese woche", "heute abend",
	"wer ist der", "wer ist die", "wer hat gewonnen", "noch am leben",
];

// German stems whose surface form declines (aktuell → aktuelle/aktuellste,
// veröffentlicht → veröffentlichung). Matched as `\b<stem>` (word-start boundary,
// any suffix) so every inflection counts; boundaries keep them from matching
// mid-compound (e.g. "\bwahl" would still need the stem to start a word).
const STEM_CUES: string[] = [
	"aktuell",     // aktuell, aktuelle, aktuellste, aktuellsten
	"neuest", "neust", // neueste, neuesten, neuste
	"derzeit",     // derzeit, derzeitig, derzeitige
	"momentan",
	"kürzlich", "neulich", "jüngst",
	"veröffentlich", // veröffentlicht, veröffentlichung, veröffentlichte
	"angekündig",  // angekündigt, angekündigte
	"aktualisier", // aktualisiert, aktualisierung
	"erschien", "erschein", // erschienen, erscheint, erscheinen
];

// Time-sensitive when the text names a year at or beyond this one. Anchored to a
// caller-supplied "now" year (no Date.now() here — keeps the module pure and the
// caller in control, matching the codebase's no-argless-Date convention).
const YEAR_RE = /\b(20\d{2})\b/g;

/**
 * Returns true when `text` reads as time-sensitive and should auto-arm web
 * search. `currentYear` anchors the year check; pass the real year at the call
 * site. A year strictly in the future, or the current year, counts as recency
 * intent; older years (historical questions) do not.
 */
export function looksTimeSensitive(text: string, currentYear: number): boolean {
	if (!text) return false;
	const lower = text.toLowerCase();

	for (const cue of CUE_WORDS) {
		if (cue.includes(" ")) {
			// Multi-word cue: plain substring is fine (spaces already bound it).
			if (lower.includes(cue)) return true;
		} else if (new RegExp(`\\b${cue}\\b`).test(lower)) {
			return true;
		}
	}

	// Declining German stems: word-start boundary, any suffix.
	for (const stem of STEM_CUES) {
		if (new RegExp(`\\b${stem}`).test(lower)) return true;
	}

	let m: RegExpExecArray | null;
	YEAR_RE.lastIndex = 0;
	while ((m = YEAR_RE.exec(text)) !== null) {
		if (Number(m[1]) >= currentYear) return true;
	}

	return false;
}
