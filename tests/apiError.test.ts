import { describe, it, expect } from "vitest";
import { classifyApiError } from "../services/apiError";

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
