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
