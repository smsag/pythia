/**
 * URL-scheme safety for externally-supplied references (web-search citation
 * sources — a ref chosen by the model or returned by Tavily). A citation click
 * must never be able to launch a `javascript:`, `data:`, or `file:` URL, so
 * this resolves a ref to a normalized `http(s)` href or `null`.
 *
 * Pure and dependency-free so it is trivially unit-testable and reusable.
 */

/** Resolve an untrusted web ref to a safe, absolute `http(s)` URL string, or
 *  `null` if it isn't one. A bare `domain.com/path` (no scheme) is treated as
 *  `https://`; anything carrying a non-http(s) scheme is rejected outright. */
export function safeHttpUrl(ref: string | undefined | null): string | null {
	const raw = (ref ?? "").trim();
	if (!raw) return null;
	// Prefix https:// only when there is no scheme at all; keep an existing
	// scheme so a hostile `javascript:` ref is judged on its real scheme below
	// rather than being masked into `https://javascript:…`.
	const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
	let parsed: URL;
	try {
		parsed = new URL(candidate);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
	return parsed.href;
}
