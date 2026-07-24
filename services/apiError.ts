import { t } from "../i18n";

export type ApiErrorClass =
	| "invalid_key"
	| "model_not_found"
	| "rate_limit"
	| "server_error"
	| "network"
	| "other";

/**
 * Maps a raw SDK or fetch error to a coarse error class so callers can show
 * user-friendly messages without depending on SDK internals.
 *
 * The Anthropic and OpenAI SDKs surface HTTP errors as `Error` subclasses
 * with a numeric `.status` property (e.g. `error.status === 401`); Mistral's
 * SDK uses `.statusCode` instead (models/errors/mistralerror.ts) — both are
 * checked. Network-level failures (DNS, timeout, connection refused) arrive
 * as `TypeError` (no status property at all).
 *
 * The `status === undefined` fallback below is also hit by errors that
 * aren't genuine connectivity failures: the Anthropic SDK's own
 * `APIError.generate()` (error.js) collapses ANY status-less error into
 * `APIConnectionError` — including a mid-stream SSE `error` event (e.g. a
 * capacity/overload condition reported after the stream already started
 * with a 200) — and `MessageStream`'s internal catch-all re-wraps any
 * exception during stream processing as a bare `AnthropicError`, also
 * status-less. Neither overrides `.name` (verified against the installed
 * SDK), so they aren't distinguishable from a real `TypeError` by name and
 * fall into this same "network" bucket. `buildStreamErrorMessage()` below
 * is where that distinction actually matters for the user-facing message.
 */
export function classifyApiError(error: unknown): ApiErrorClass {
	if (!(error instanceof Error)) return "other";

	// Network errors (fetch failed, DNS, timeout) — no HTTP status
	if (error instanceof TypeError) return "network";

	const errRecord = error as unknown as Record<string, unknown>;
	const status = errRecord.status ?? errRecord.statusCode;

	if (status === 401 || status === 403) return "invalid_key";
	if (status === 429) return "rate_limit";
	if (status === 404) return "model_not_found";
	// 5xx (and Anthropic's 529 "overloaded") are transient capacity errors, same
	// class of problem as a rate limit — worth retrying, not a hard failure.
	if (typeof status === "number" && status >= 500 && status <= 599) return "server_error";

	// No status property at all → also treat as a network-level failure
	if (status === undefined) return "network";

	return "other";
}

/** Notices shouldn't show a raw multi-hundred-character SDK/SSE payload. */
const MAX_NOTICE_DETAIL_CHARS = 160;

/**
 * Turns a raw streamMessage() failure into the Notice text shown to the
 * user. Centralized here (rather than inlined at the call site) so the
 * "network" case below — which needs `classifyApiError`'s nuance to avoid
 * lying to the user — has direct test coverage.
 */
export function buildStreamErrorMessage(error: Error, model: string): string {
	if (error.name === "ToolLoopLimitError") return t("toolLoopExceeded");

	switch (classifyApiError(error)) {
		case "model_not_found":
			return t("modelNotFound", { model });
		case "invalid_key":
			return t("apiKeyRejected");
		case "rate_limit":
			return t("rateLimitHit");
		case "server_error":
			return t("serverError");
		case "network": {
			// classifyApiError's "network" bucket also catches status-less
			// SDK errors that aren't the user's own connectivity (see the
			// comment above classifyApiError) — when a real message is
			// available, show it instead of asserting something we can't
			// confirm. Only fall back to the generic connectivity string
			// when there's truly nothing else to say.
			if (!error.message) return t("networkError");
			const detail = error.message.length > MAX_NOTICE_DETAIL_CHARS
				? error.message.slice(0, MAX_NOTICE_DETAIL_CHARS) + "…"
				: error.message;
			return t("networkErrorDetail", { detail });
		}
		default:
			return error.message;
	}
}
