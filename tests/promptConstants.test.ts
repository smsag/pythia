import { describe, it, expect } from "vitest";
import { resolveDefaultMaxTokens, DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS_REASONING } from "../services/promptConstants";

describe("resolveDefaultMaxTokens", () => {
	it("returns the reasoning-model default for OpenAI o-series models", () => {
		for (const model of ["o1", "o1-mini", "o3", "o3-mini", "o4-mini"]) {
			expect(resolveDefaultMaxTokens(model)).toBe(DEFAULT_MAX_TOKENS_REASONING);
		}
	});

	it("returns the general default for non-reasoning models", () => {
		for (const model of ["gpt-4o", "gpt-4o-mini", "claude-sonnet-5", "claude-haiku-4-5"]) {
			expect(resolveDefaultMaxTokens(model)).toBe(DEFAULT_MAX_TOKENS);
		}
	});

	it("the reasoning default is larger than the general default", () => {
		expect(DEFAULT_MAX_TOKENS_REASONING).toBeGreaterThan(DEFAULT_MAX_TOKENS);
	});
});
