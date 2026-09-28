import { APIConnectionError as AnthropicConnectionError } from "@anthropic-ai/sdk/core/error";
import { APIConnectionError as OpenAIConnectionError } from "openai/core/error";
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
 * checked.
 *
 * "network" is reserved for what really is a connection failure: the SDKs'
 * own connection errors (Anthropic/OpenAI `APIConnectionError` and its timeout
 * subclass, Mistral's `ConnectionError`/`RequestTimeoutError`) and a `TypeError`
 * whose message is a fetch failure. Everything else without a status is
 * "other" — a missing API key, a bare `AnthropicError` re-wrap from
 * `MessageStream`, a user abort — so it is neither retried nor reported as the
 * user's connectivity. The Anthropic SDK's `APIError.generate()` still wraps a
 * mid-stream SSE `error` event (e.g. an overload after a 200) as an
 * `APIConnectionError`; that stays "network", and `buildStreamErrorMessage()`
 * below shows its real message rather than a generic connectivity claim.
 */
/** Chromium ("Failed to fetch"), WebKit ("Load failed"), Node undici ("fetch
 *  failed"), Firefox ("NetworkError when attempting…"), plus the generic words
 *  the SDKs' own connection wrappers use. */
const NETWORK_TYPEERROR_RX = /fetch|network|load failed|connection|socket|ECONN|ENOTFOUND|EAI_AGAIN|timed? ?out/i;

/** Mistral's HTTP-client errors set `.name` as a class field (a string literal,
 *  so it survives minification): httpclienterrors.ts. */
const MISTRAL_CONNECTION_ERROR_NAMES = new Set(["ConnectionError", "RequestTimeoutError"]);

function isConnectionError(error: Error): boolean {
	if (error instanceof AnthropicConnectionError || error instanceof OpenAIConnectionError) return true;
	return MISTRAL_CONNECTION_ERROR_NAMES.has(error.name);
}

export function classifyApiError(error: unknown): ApiErrorClass {
	if (!(error instanceof Error)) return "other";

	// Network errors (fetch failed, DNS, timeout) arrive as TypeError with no
	// HTTP status. But so does a programming error ("Cannot read properties of
	// undefined"), and calling that a connectivity problem hides the bug and
	// retries it twice. Only the messages fetch implementations actually use
	// count as network; any other TypeError is reported as what it says.
	if (error instanceof TypeError) return NETWORK_TYPEERROR_RX.test(error.message) ? "network" : "other";
	if (isConnectionError(error)) return "network";

	const errRecord = error as unknown as Record<string, unknown>;
	const status = errRecord.status ?? errRecord.statusCode;

	if (status === 401 || status === 403) return "invalid_key";
	if (status === 429) return "rate_limit";
	if (status === 404) return "model_not_found";
	// 5xx (and Anthropic's 529 "overloaded") are transient capacity errors, same
	// class of problem as a rate limit — worth retrying, not a hard failure.
	if (typeof status === "number" && status >= 500 && status <= 599) return "server_error";

	// No status and not a connection error: a missing key, an SDK re-wrap, a
	// bug. Never "network" — that would retry it and blame the user's connection.
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
