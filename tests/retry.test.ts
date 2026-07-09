import { describe, it, expect } from "vitest";
import { isRetryableError, RETRY_BACKOFF_MS, sleep } from "../services/retry";

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

	it("returns false for non-Error values", () => {
		expect(isRetryableError("oops")).toBe(false);
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
