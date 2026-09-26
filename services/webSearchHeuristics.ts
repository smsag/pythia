// What in an outgoing message offers web search for that one send when the
// research toggle is off (ADR-099, narrowed by ADR-226): a pasted link. The
// time-sensitive word and year heuristics that used to arm it here are gone —
// they fired on everyday words ("now", "update", "cost") and on daily notes
// named by their date, and each armed send told the model to search first.
//
// Pure and dependency-free so it is trivially unit-testable.

// An http(s) address with a dotted host. A pasted link is the clearest possible
// sign the user wants the web read, and since ADR-226 the only thing that auto-arms
// web search for one message (ADR-217).
const WEB_URL_RE = /\bhttps?:\/\/[^\s/?#]+\.[^\s/?#]+/i;

/** True when `text` contains an http(s) URL — the read_url tool's cue. */
export function containsWebUrl(text: string): boolean {
	return !!text && WEB_URL_RE.test(text);
}
