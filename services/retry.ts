import { classifyApiError } from "./apiError";

/** Backoff delays (ms) between retry attempts — two retries: quick, then a bit longer. */
export const RETRY_BACKOFF_MS = [500, 1500];

export const ABORT_ERROR_NAMES = new Set([
	"AbortError",
	"APIUserAbortError",
	"ToolCancelledError",
	// Mistral SDK's own name for a client-aborted HTTP request (models/errors/httpclienterrors.ts).
	"RequestAbortedError",
]);

/** True for transient errors worth retrying (rate limits, network blips); never for user aborts. */
export function isRetryableError(error: unknown): boolean {
	if (error instanceof Error && ABORT_ERROR_NAMES.has(error.name)) return false;
	const errClass = classifyApiError(error);
	return errClass === "rate_limit" || errClass === "network" || errClass === "server_error";
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
