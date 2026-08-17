import { describe, it, expect } from "vitest";
import {
	KNOWN_MODELS,
	REASONING_MODELS,
	isReasoningModel,
	MODEL_ABBREVIATIONS,
	supportsEffort,
	isMistralReasoningModel,
	supportsMistralEffort,
	resolveDefaultModelForProvider,
} from "../models/knownModels";
import type { PythiaSettings } from "../models/settings";

describe("isReasoningModel", () => {
	it("is true for every OpenAI o-series model", () => {
		for (const model of ["o3", "o3-mini", "o4-mini"]) {
			expect(isReasoningModel(model)).toBe(true);
		}
	});

	it("is false for non-reasoning models", () => {
		for (const model of ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4-6"]) {
			expect(isReasoningModel(model)).toBe(false);
		}
	});

	it("every OpenAI model selectable in KNOWN_MODELS agrees with REASONING_MODELS", () => {
		// Regression guard for the exact bug this module fixes: a model listed as
		// selectable but missing from the reasoning-model set (e.g. o4-mini).
		for (const model of KNOWN_MODELS.openai) {
			const looksLikeReasoningModel = /^o\d/.test(model);
			expect(REASONING_MODELS.has(model)).toBe(looksLikeReasoningModel);
		}
	});
});

describe("supportsEffort", () => {
	it("is true for every model in the effort allow-list", () => {
		for (const model of [
			"claude-fable-5", "claude-mythos-5", "claude-opus-4-8", "claude-opus-4-7",
			"claude-opus-4-6", "claude-sonnet-5", "claude-sonnet-4-6",
		]) {
			expect(supportsEffort(model)).toBe(true);
		}
	});

	it("is false for models that reject the effort parameter", () => {
		for (const model of ["claude-haiku-4-5", "gpt-4o", "o4-mini"]) {
			expect(supportsEffort(model)).toBe(false);
		}
	});
});

describe("MODEL_ABBREVIATIONS", () => {
	it("has an entry for every known OpenAI and Anthropic reasoning/non-reasoning model it documents", () => {
		expect(MODEL_ABBREVIATIONS["o4-mini"]).toBe("o4 mini");
		expect(MODEL_ABBREVIATIONS["gpt-4o"]).toBe("GPT-4o");
	});

	it("has an entry for every known Mistral model", () => {
		for (const model of KNOWN_MODELS.mistral) {
			expect(MODEL_ABBREVIATIONS[model]).toBeDefined();
		}
	});
});

describe("isMistralReasoningModel", () => {
	it("is true for the Magistral line", () => {
		for (const model of ["magistral-medium-latest", "magistral-small-latest", "magistral-new-model"]) {
			expect(isMistralReasoningModel(model)).toBe(true);
		}
	});

	it("is false for non-Magistral Mistral models", () => {
		for (const model of ["mistral-large-latest", "mistral-small-latest", "codestral-latest"]) {
			expect(isMistralReasoningModel(model)).toBe(false);
		}
	});
});

describe("supportsMistralEffort", () => {
	it("is true for every known Mistral model (no per-model restriction in the installed SDK types)", () => {
		for (const model of KNOWN_MODELS.mistral) {
			expect(supportsMistralEffort(model)).toBe(true);
		}
	});
});

describe("resolveDefaultModelForProvider", () => {
	function makeSettings(): PythiaSettings {
		return {
			defaultAnthropicModel: "claude-sonnet-5",
			defaultOpenAIModel: "gpt-4o",
			defaultMistralModel: "mistral-large-latest",
		} as PythiaSettings;
	}

	it("resolves the matching default-model setting for each provider", () => {
		const settings = makeSettings();
		expect(resolveDefaultModelForProvider("anthropic", settings)).toBe("claude-sonnet-5");
		expect(resolveDefaultModelForProvider("openai", settings)).toBe("gpt-4o");
		expect(resolveDefaultModelForProvider("mistral", settings)).toBe("mistral-large-latest");
	});
});
