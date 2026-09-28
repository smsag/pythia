import { describe, it, expect, vi } from "vitest";

// services/retry.ts -> services/apiError.ts -> ../i18n, which reads
// window.moment at module load time (Obsidian-only global, absent in Node).
vi.mock("../i18n", () => ({ t: (key: string) => key }));

import { APIUserAbortError as AnthropicUserAbortError, APIConnectionError as AnthropicConnectionError } from "@anthropic-ai/sdk/core/error";
import { APIUserAbortError as OpenAIUserAbortError } from "openai/core/error";
import { isAbortError, isRetryableError, RETRY_BACKOFF_MS, sleep } from "../services/retry";

describe("isRetryableError", () => {
	it("returns true for a rate-limit error (HTTP 429)", () => {
		const err = Object.assign(new Error("Too Many Requests"), { status: 429 });
		expect(isRetryableError(err)).toBe(true);
	});

	it("returns true for a network-level error (no status)", () => {
		expect(isRetryableError(new TypeError("Failed to fetch"))).toBe(true);
	});

	it("returns true for a server error (HTTP 500)", () => {
		const err = Object.assign(new Error("Server Error"), { status: 500 });
		expect(isRetryableError(err)).toBe(true);
	});

	it("returns true for Anthropic's 529 'overloaded' status", () => {
		const err = Object.assign(new Error("Overloaded"), { status: 529 });
		expect(isRetryableError(err)).toBe(true);
	});

	it("returns false for an invalid-key error (HTTP 401)", () => {
		const err = Object.assign(new Error("Unauthorized"), { status: 401 });
		expect(isRetryableError(err)).toBe(false);
	});

	it("returns false for a model-not-found error (HTTP 404)", () => {
		const err = Object.assign(new Error("Not Found"), { status: 404 });
		expect(isRetryableError(err)).toBe(false);
	});

	it("returns false for AbortError even though it has no status", () => {
		const err = new Error("aborted");
		err.name = "AbortError";
		expect(isRetryableError(err)).toBe(false);
	});

	it("returns false for APIUserAbortError", () => {
		const err = new Error("aborted");
		err.name = "APIUserAbortError";
		expect(isRetryableError(err)).toBe(false);
	});

	it("returns false for ToolCancelledError", () => {
		const err = new Error("cancelled");
		err.name = "ToolCancelledError";
		expect(isRetryableError(err)).toBe(false);
	});

	it("returns false for the SDKs' real APIUserAbortError, whose name is just \"Error\"", () => {
		const anthropic = new AnthropicUserAbortError();
		const openai = new OpenAIUserAbortError();
		// The reason a name list was not enough.
		expect(anthropic.name).toBe("Error");
		expect(isRetryableError(anthropic)).toBe(false);
		expect(isRetryableError(openai)).toBe(false);
	});

	it("returns false for any error once the request's signal has fired", () => {
		const stop = new AbortController();
		stop.abort();
		expect(isRetryableError(new TypeError("Failed to fetch"), stop.signal)).toBe(false);
	});

	it("returns true for the SDK's real connection error", () => {
		expect(isRetryableError(new AnthropicConnectionError({ message: undefined }))).toBe(true);
	});

	it("returns false for a status-less error that is not a connection failure (a missing key)", () => {
		expect(isRetryableError(new Error("Anthropic API key not configured"))).toBe(false);
	});

	it("returns false for non-Error values", () => {
		expect(isRetryableError("oops")).toBe(false);
	});
});

describe("isAbortError", () => {
	it("recognises both SDKs' abort classes, the abort names and a fired signal", () => {
		expect(isAbortError(new AnthropicUserAbortError())).toBe(true);
		expect(isAbortError(new OpenAIUserAbortError())).toBe(true);
		expect(isAbortError(Object.assign(new Error("x"), { name: "RequestAbortedError" }))).toBe(true);
		const stop = new AbortController();
		stop.abort();
		expect(isAbortError(new Error("anything"), stop.signal)).toBe(true);
	});

	it("is false for an ordinary error on a live signal", () => {
		expect(isAbortError(new Error("Overloaded"), new AbortController().signal)).toBe(false);
	});
});

describe("RETRY_BACKOFF_MS", () => {
	it("defines two backoff delays", () => {
		expect(RETRY_BACKOFF_MS).toHaveLength(2);
		expect(RETRY_BACKOFF_MS[0]).toBeLessThan(RETRY_BACKOFF_MS[1]);
	});
});

describe("sleep", () => {
	it("resolves after roughly the given delay", async () => {
		const start = Date.now();
		await sleep(10);
		expect(Date.now() - start).toBeGreaterThanOrEqual(9);
	});
});
