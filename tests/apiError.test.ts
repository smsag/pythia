import { describe, it, expect, vi } from "vitest";

vi.mock("../i18n", () => ({
	t: (key: string, vars?: Record<string, string | number>) =>
		vars ? `${key}(${JSON.stringify(vars)})` : key,
}));

import { classifyApiError, buildStreamErrorMessage } from "../services/apiError";

describe("classifyApiError", () => {
	it("returns 'other' for non-Error values", () => {
		expect(classifyApiError("string")).toBe("other");
		expect(classifyApiError(null)).toBe("other");
		expect(classifyApiError(42)).toBe("other");
	});

	it("returns 'network' for TypeError (fetch-level failure)", () => {
		expect(classifyApiError(new TypeError("Failed to fetch"))).toBe("network");
	});

	it("returns 'network' when the error has no status property", () => {
		expect(classifyApiError(new Error("plain error"))).toBe("network");
	});

	it("returns 'invalid_key' for HTTP 401", () => {
		const err = Object.assign(new Error("Unauthorized"), { status: 401 });
		expect(classifyApiError(err)).toBe("invalid_key");
	});

	it("returns 'invalid_key' for HTTP 403", () => {
		const err = Object.assign(new Error("Forbidden"), { status: 403 });
		expect(classifyApiError(err)).toBe("invalid_key");
	});

	it("returns 'rate_limit' for HTTP 429", () => {
		const err = Object.assign(new Error("Too Many Requests"), { status: 429 });
		expect(classifyApiError(err)).toBe("rate_limit");
	});

	it("returns 'model_not_found' for HTTP 404", () => {
		const err = Object.assign(new Error("Not Found"), { status: 404 });
		expect(classifyApiError(err)).toBe("model_not_found");
	});

	it("returns 'server_error' for HTTP 500", () => {
		const err = Object.assign(new Error("Server Error"), { status: 500 });
		expect(classifyApiError(err)).toBe("server_error");
	});

	it("returns 'server_error' for Anthropic's 529 'overloaded' status", () => {
		const err = Object.assign(new Error("Overloaded"), { status: 529 });
		expect(classifyApiError(err)).toBe("server_error");
	});

	it("returns 'other' for HTTP 400", () => {
		const err = Object.assign(new Error("Bad Request"), { status: 400 });
		expect(classifyApiError(err)).toBe("other");
	});
});

describe("buildStreamErrorMessage", () => {
	it("returns the tool-loop message for a ToolLoopLimitError, regardless of classification", () => {
		const err = new Error("looped");
		err.name = "ToolLoopLimitError";
		expect(buildStreamErrorMessage(err, "gpt-4o")).toBe("toolLoopExceeded");
	});

	it("returns the friendly model-not-found message with the model interpolated", () => {
		const err = Object.assign(new Error("Not Found"), { status: 404 });
		expect(buildStreamErrorMessage(err, "gpt-4o")).toBe('modelNotFound({"model":"gpt-4o"})');
	});

	it("returns the friendly invalid-key message for 401/403", () => {
		const err = Object.assign(new Error("Unauthorized"), { status: 401 });
		expect(buildStreamErrorMessage(err, "m")).toBe("apiKeyRejected");
	});

	it("returns the friendly rate-limit message for 429", () => {
		const err = Object.assign(new Error("Too Many Requests"), { status: 429 });
		expect(buildStreamErrorMessage(err, "m")).toBe("rateLimitHit");
	});

	it("returns the friendly server-overloaded message for 5xx/529", () => {
		const err = Object.assign(new Error("Overloaded"), { status: 529 });
		expect(buildStreamErrorMessage(err, "m")).toBe("serverError");
	});

	it("returns the raw message for an unrecognized ('other') error", () => {
		const err = Object.assign(new Error("Bad Request"), { status: 400 });
		expect(buildStreamErrorMessage(err, "m")).toBe("Bad Request");
	});

	// Regression coverage for the bug this function was extracted to fix: a
	// status-less error (e.g. the Anthropic SDK's APIConnectionError from a
	// mid-stream SSE error event, or a bare AnthropicError re-wrap) carries a
	// real diagnostic message that must not be discarded in favor of a
	// generic, potentially false claim about the user's own connectivity.
	describe("'network'-classified errors (status-less)", () => {
		it("surfaces the real error message instead of the generic connectivity string", () => {
			const err = new Error('{"type":"error","error":{"type":"overloaded_error"}}');
			expect(buildStreamErrorMessage(err, "m")).toBe(
				`networkErrorDetail({"detail":${JSON.stringify(err.message)}})`
			);
		});

		it("truncates an overlong message for Notice display", () => {
			const longMessage = "x".repeat(300);
			const err = new Error(longMessage);
			const expectedDetail = "x".repeat(160) + "…";
			expect(buildStreamErrorMessage(err, "m")).toBe(
				`networkErrorDetail({"detail":${JSON.stringify(expectedDetail)}})`
			);
		});

		it("falls back to the generic connectivity message when there is no message at all", () => {
			const err = new Error();
			expect(buildStreamErrorMessage(err, "m")).toBe("networkError");
		});
	});
});
