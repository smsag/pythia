/**
 * Secret redaction for anything that might reach a log, an error dump, or a
 * tool result surfaced to the model.
 *
 * Pythia is a client-side Obsidian plugin: it calls the LLM / search / Upvoty
 * APIs directly, so provider keys necessarily travel in request headers (visible
 * in DevTools' Network tab — an unavoidable property of a server-less plugin).
 * These helpers do NOT change that; they are defense-in-depth for the surfaces
 * we DO control — making sure a key never leaks into `console` output, a logged
 * error object, or a persisted string, even if a future SDK error or payload
 * happens to embed one.
 *
 * Pure and dependency-free so it can wrap every logging path and be unit-tested
 * without any environment.
 */

const REPLACEMENT = "[REDACTED]";

/** Ordered redaction rules. Each replaces the secret span (or a capture group)
 *  with REPLACEMENT. Anchored on known key prefixes and header/JSON key names to
 *  keep false positives near zero. */
const RULES: Array<{ re: RegExp; replace: (m: string, ...g: string[]) => string }> = [
	// `Authorization: Bearer <token>` (header or serialized form).
	{
		re: /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi,
		replace: () => `Bearer ${REPLACEMENT}`,
	},
	// Known provider key prefixes: Anthropic (sk-ant-…), OpenAI (sk-…),
	// Tavily (tvly-…). sk-ant- is listed before sk- so the longer prefix wins.
	{
		re: /\bsk-ant-[A-Za-z0-9._-]{8,}/g,
		replace: () => REPLACEMENT,
	},
	{
		re: /\bsk-[A-Za-z0-9._-]{8,}/g,
		replace: () => REPLACEMENT,
	},
	{
		re: /\btvly-[A-Za-z0-9._-]{8,}/gi,
		replace: () => REPLACEMENT,
	},
	// JSON / query-style `"api_key": "…"`, `authorization=…`, `token: '…'`,
	// `secret: …` — redact the value, keep the key name and structure.
	// Value part uses a negative lookahead so an `Authorization: Bearer <tok>`
	// value (already handled by the Bearer rule above) isn't re-matched here into
	// a doubled `[REDACTED]`.
	{
		re: /(["']?\b(?:api[_-]?key|authorization|access[_-]?token|token|secret|password)\b["']?\s*[:=]\s*)(["']?)((?!Bearer\b|Basic\b)[^"'\s,&}]+)(\2)/gi,
		replace: (_m, prefix: string, quote: string) => `${prefix}${quote}${REPLACEMENT}${quote}`,
	},
];

/** Masks secret-looking substrings (provider keys, bearer tokens, key/value
 *  pairs for auth fields). Returns non-strings' `String()` form, redacted. */
export function redactSecrets(input: unknown): string {
	let text = typeof input === "string" ? input : String(input);
	for (const { re, replace } of RULES) {
		text = text.replace(re, replace as (substring: string, ...args: unknown[]) => string);
	}
	return text;
}

/** Compact, secret-free description of an error for `console.error` — avoids
 *  dumping the whole SDK error object (version-fragile, and a future SDK could
 *  attach request metadata). Includes name, redacted message, and any HTTP
 *  status the SDKs expose (`status` / `statusCode`). */
export function describeErrorForLog(error: unknown): string {
	if (!(error instanceof Error)) return redactSecrets(error);
	const rec = error as unknown as Record<string, unknown>;
	const status = rec.status ?? rec.statusCode;
	const statusPart = status !== undefined ? ` (status ${String(status)})` : "";
	return `${error.name}${statusPart}: ${redactSecrets(error.message)}`;
}
