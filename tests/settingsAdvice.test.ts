import { describe, it, expect } from "vitest";
import { maxTokensAdvice, raisedMaxTokens, effectiveMaxTokens, RETRY_MAX_TOKENS_CEILING } from "../services/settingsAdvice";
import { DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS_REASONING } from "../services/promptConstants";

// ADR-162: one rule behind the modal advice, the Send warning and the recovery card.

describe("maxTokensAdvice", () => {
	it("says nothing for a plain model, however low the cap", () => {
		expect(maxTokensAdvice("gpt-4o", 2000, undefined)).toBeNull();
		expect(maxTokensAdvice("claude-sonnet-4-6", undefined, 500)).toBeNull();
	});

	it("says nothing when a reasoning model already has the recommended budget", () => {
		expect(maxTokensAdvice("o3", undefined, undefined)).toBeNull();
		expect(maxTokensAdvice("o3", DEFAULT_MAX_TOKENS_REASONING, undefined)).toBeNull();
		expect(maxTokensAdvice("magistral-medium-latest", 20000, 100)).toBeNull();
	});

	it("the switch case: a 2000 pinned on a plain model, moved to a reasoning model → clear the override", () => {
		// Clearing lets the model-aware default (16384) apply, and the value follows the model from then on.
		expect(maxTokensAdvice("o3", 2000, undefined)).toEqual({ kind: "clear", effective: 2000, recommended: DEFAULT_MAX_TOKENS_REASONING });
	});

	it("pins when clearing would not help because the global setting is the low value", () => {
		expect(maxTokensAdvice("o3", undefined, 2000)).toEqual({ kind: "pin", effective: 2000, recommended: DEFAULT_MAX_TOKENS_REASONING });
		// An override on top of a too-low global: clearing falls back to the global, so still pin.
		expect(maxTokensAdvice("o3", 3000, 2000)?.kind).toBe("pin");
	});

	it("an override below the floor with a healthy global → clear (the global is not the problem)", () => {
		expect(maxTokensAdvice("o4-mini", 4000, 32000)?.kind).toBe("clear");
	});
});

describe("effectiveMaxTokens", () => {
	it("resolves conversation → global → model default", () => {
		expect(effectiveMaxTokens("gpt-4o", 1234, 5678)).toBe(1234);
		expect(effectiveMaxTokens("gpt-4o", undefined, 5678)).toBe(5678);
		expect(effectiveMaxTokens("gpt-4o", undefined, undefined)).toBe(DEFAULT_MAX_TOKENS);
		expect(effectiveMaxTokens("o3", undefined, undefined)).toBe(DEFAULT_MAX_TOKENS_REASONING);
	});
});

describe("raisedMaxTokens", () => {
	it("doubles the cap the reply hit", () => {
		expect(raisedMaxTokens("gpt-4o", 8192)).toBe(16384);
	});
	it("never retries below the model's own default", () => {
		expect(raisedMaxTokens("o3", 2000)).toBe(DEFAULT_MAX_TOKENS_REASONING);
	});
	it("stops at the ceiling", () => {
		expect(raisedMaxTokens("gpt-4o", 60000)).toBe(RETRY_MAX_TOKENS_CEILING);
	});
});
