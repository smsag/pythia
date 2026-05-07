export type ApiErrorClass =
	| "invalid_key"
	| "model_not_found"
	| "rate_limit"
	| "network"
	| "other";

/**
 * Maps a raw SDK or fetch error to a coarse error class so callers can show
 * user-friendly messages without depending on SDK internals.
 *
 * Both the Anthropic and OpenAI SDKs surface HTTP errors as `Error` subclasses
 * with a numeric `.status` property (e.g. `error.status === 401`).
 * Network-level failures (DNS, timeout, connection refused) arrive as
 * `TypeError` (no `.status`).
 */
export function classifyApiError(error: unknown): ApiErrorClass {
	if (!(error instanceof Error)) return "other";

	// Network errors (fetch failed, DNS, timeout) — no HTTP status
	if (error instanceof TypeError) return "network";

	const status = (error as unknown as Record<string, unknown>).status;

	if (status === 401 || status === 403) return "invalid_key";
	if (status === 429) return "rate_limit";
	if (status === 404) return "model_not_found";

	// No status property at all → also treat as a network-level failure
	if (status === undefined) return "network";

	return "other";
}
