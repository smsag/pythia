// Heuristics that decide whether an outgoing user message wants the web for
// that one send when the research toggle is off (ADR-099): it reads as
// time-sensitive — likely to need current information the model can't be sure
// of from training — or it carries a link (ADR-217/228). ADR-226 removed the
// time cues and ADR-229 restored them (the user wanted "the current ECB rate"
// to search by itself), minus the note links a daily note's date lived in.
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

// Compiled once at module load: this runs on every send, and building ~100
// RegExps per keystroke-free send was pure waste. Multi-word cues stay as
// substrings (spaces already bound them).
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORD_CUE_RE = new RegExp(`\\b(?:${CUE_WORDS.filter((c) => !c.includes(" ")).map(escapeRx).join("|")})\\b`);
const PHRASE_CUES = CUE_WORDS.filter((c) => c.includes(" "));
const STEM_CUE_RE = new RegExp(`\\b(?:${STEM_CUES.map(escapeRx).join("|")})`);
// The whole declined word a stem matched, for naming the cue (ADR-230).
const STEM_WORD_RE = new RegExp(`${STEM_CUE_RE.source}\\p{L}*`, "u");

/**
 * Returns true when `text` reads as time-sensitive and should auto-arm web
 * search. `currentYear` anchors the year check; pass the real year at the call
 * site. A year strictly in the future, or the current year, counts as recency
 * intent; older years (historical questions) do not.
 */
export function looksTimeSensitive(text: string, currentYear: number): boolean {
	return timeSensitiveCue(text, currentYear) !== null;
}

/**
 * The cue that makes `text` read as time-sensitive — the word, phrase or year
 * as it appears — or null. What the globe and the search chip name when
 * auto-search fires, so the user can see why it did (ADR-230).
 */
export function timeSensitiveCue(text: string, currentYear: number): string | null {
	if (!text) return null;
	// A [[note link]] names a note, not a moment: a daily note called
	// [[2026-09-26]] or a note titled "Current projects" is no reason to search
	// the web (ADR-229).
	const prose = text.replace(/\[\[[^\]]*\]\]/g, " ");
	const lower = prose.toLowerCase();

	const word = WORD_CUE_RE.exec(lower);
	if (word) return word[0];
	for (const cue of PHRASE_CUES) if (lower.includes(cue)) return cue;
	// Declining German stems: word-start boundary, any suffix.
	const stem = STEM_WORD_RE.exec(lower);
	if (stem) return stem[0];

	let m: RegExpExecArray | null;
	YEAR_RE.lastIndex = 0;
	while ((m = YEAR_RE.exec(prose)) !== null) {
		if (Number(m[1]) >= currentYear) return m[1];
	}
	return null;
}

// An http(s) address with a dotted host. A pasted link is the clearest possible
// sign the user wants the web read, so it auto-arms like a time cue (ADR-217).
const WEB_URL_RE = /\bhttps?:\/\/[^\s/?#]+\.[^\s/?#]+/i;

/**
 * A link typed without its scheme (ADR-228): `www.example.com`, or a host with
 * an alphabetic top-level domain followed by a path (`example.com/article`).
 * A bare `example.com` is not one — in prose that is a name, not a request to
 * read a page. The one pattern for both the auto-arm cue and the read allow-list.
 */
export const BARE_URL_RE = /(?<![\w@/.:-])(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?:\/[^\s<>"'`\]]*)?|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\/[^\s<>"'`\]]*)/gi;

/** True when `text` contains a web link — the read_url tool's cue. */
export function containsWebUrl(text: string): boolean {
	if (!text) return false;
	BARE_URL_RE.lastIndex = 0;
	return WEB_URL_RE.test(text) || BARE_URL_RE.test(text);
}
