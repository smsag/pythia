import { APIUserAbortError as AnthropicUserAbortError } from "@anthropic-ai/sdk/core/error";
import { APIUserAbortError as OpenAIUserAbortError } from "openai/core/error";
import { classifyApiError } from "./apiError";

/** Backoff delays (ms) between retry attempts — two retries: quick, then a bit longer. */
export const RETRY_BACKOFF_MS = [500, 1500];

/** Names that mean "the user stopped this". Not enough on their own: the
 *  Anthropic and OpenAI SDKs' `APIUserAbortError` never overrides `.name`, so it
 *  reads "Error" — hence the `instanceof` checks and the signal in `isAbortError`. */
export const ABORT_ERROR_NAMES = new Set([
	"AbortError",
	"APIUserAbortError",
	"ToolCancelledError",
	// Mistral SDK's own name for a client-aborted HTTP request (models/errors/httpclienterrors.ts).
	"RequestAbortedError",
]);

/**
 * True when `error` is the user pressing Stop — the ONE abort rule, read by the
 * retry loops and by `BaseProvider.finishOrError`. The request's own signal is
 * the strongest evidence: once it has fired, whatever the SDK threw on the way
 * out is the stop, not a failure to retry or report.
 */
export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
	if (signal?.aborted) return true;
	if (!(error instanceof Error)) return false;
	if (error instanceof AnthropicUserAbortError || error instanceof OpenAIUserAbortError) return true;
	return ABORT_ERROR_NAMES.has(error.name);
}

/** True for transient errors worth retrying (rate limits, network blips); never for user aborts. */
export function isRetryableError(error: unknown, signal?: AbortSignal): boolean {
	if (isAbortError(error, signal)) return false;
	const errClass = classifyApiError(error);
	return errClass === "rate_limit" || errClass === "network" || errClass === "server_error";
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
