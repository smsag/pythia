import { describe, it, expect } from "vitest";
import {
	KNOWN_MODELS,
	REASONING_MODELS,
	isReasoningModel,
	MODEL_ABBREVIATIONS,
	supportsEffort,
	isMistralReasoningModel,
	resolveDefaultModelForProvider,
} from "../models/knownModels";
import type { PythiaSettings } from "../models/settings";
import {
	EMBEDDING_MODELS,
	DEFAULT_EMBEDDING_MODEL_ID,
	embedChunkChars,
	type EmbeddingModelId,
} from "../models/embeddingModels";

describe("isReasoningModel", () => {
	it("is true for every OpenAI o-series and GPT-5 model", () => {
		for (const model of ["o3", "o3-mini", "o4-mini", "gpt-5.6", "gpt-5.4-mini", "gpt-5.4-nano"]) {
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
		// GPT-5 and later reason too: they reject temperature and max_tokens the
		// same way the o-series does (ADR-179).
		for (const model of KNOWN_MODELS.openai) {
			const looksLikeReasoningModel = /^(o\d|gpt-([5-9]|\d\d))/.test(model);
			expect(REASONING_MODELS.has(model)).toBe(looksLikeReasoningModel);
		}
	});
});

describe("supportsEffort", () => {
	it("is true for every model in the effort allow-list", () => {
		for (const model of [
			"claude-fable-5-1", "claude-fable-5", "claude-mythos-5", "claude-opus-4-8", "claude-opus-4-7",
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

import { parameterSupport, mistralReasoningEffort, MODEL_CATALOG } from "../models/knownModels";
import { EFFORT_LEVELS } from "../models/types";

describe("parameterSupport (one rule for the settings tab and the conversation modal)", () => {
	it("anthropic follows the catalog flags", () => {
		expect(parameterSupport("anthropic", "claude-sonnet-5")).toEqual({ temperature: false, effort: true });
		expect(parameterSupport("anthropic", "claude-haiku-4-5")).toEqual({ temperature: true, effort: false });
	});
	it("openai reasoning models swap temperature for effort", () => {
		expect(parameterSupport("openai", "o3")).toEqual({ temperature: false, effort: true });
		expect(parameterSupport("openai", "gpt-4o")).toEqual({ temperature: true, effort: false });
	});
	it("mistral takes effort only on the adjustable-reasoning models; magistral rejects temperature (#303)", () => {
		expect(parameterSupport("mistral", "magistral-medium-latest")).toEqual({ temperature: false, effort: false });
		expect(parameterSupport("mistral", "mistral-large-latest")).toEqual({ temperature: true, effort: false });
		expect(parameterSupport("mistral", "mistral-small-latest")).toEqual({ temperature: true, effort: true });
		expect(parameterSupport("mistral", "mistral-medium-latest")).toEqual({ temperature: true, effort: true });
	});
});

describe("default models", () => {
	// A default the picker cannot show is a default nobody can pick back after
	// changing it. Hiding a deprecated model (ADR-179) must move the default first.
	it("every provider's default model is a selectable catalog model", async () => {
		const { DEFAULT_SETTINGS } = await import("../models/settings");
		expect(KNOWN_MODELS.anthropic).toContain(DEFAULT_SETTINGS.defaultAnthropicModel);
		expect(KNOWN_MODELS.openai).toContain(DEFAULT_SETTINGS.defaultOpenAIModel);
		expect(KNOWN_MODELS.mistral).toContain(DEFAULT_SETTINGS.defaultMistralModel);
	});
});

describe("mistralReasoningEffort (#303)", () => {
	it("never produces a value the Mistral API does not list, for any catalog model and level", () => {
		for (const m of MODEL_CATALOG.filter((x) => x.provider === "mistral")) {
			for (const level of EFFORT_LEVELS) {
				expect([undefined, "none", "high"], `${m.id} ${level}`).toContain(mistralReasoningEffort(m.id, level));
			}
		}
	});

	it("sends something exactly where the header says effort applies", () => {
		for (const m of MODEL_CATALOG.filter((x) => x.provider === "mistral")) {
			expect(mistralReasoningEffort(m.id, "high") !== undefined, m.id).toBe(parameterSupport("mistral", m.id).effort);
		}
	});

	it("sends nothing when no level is set", () => {
		expect(mistralReasoningEffort("mistral-small-latest", undefined)).toBeUndefined();
	});
});

// ── ADR-182: chunk size follows the model's token window ─────────────────────
describe("embedChunkChars (ADR-182)", () => {
	it("gives every model a chunk that fits its own token window", () => {
		for (const m of Object.values(EMBEDDING_MODELS)) {
			const chars = embedChunkChars(m.id);
			expect(chars).toBeGreaterThan(0);
			// The window is the contract: a chunk must not need more tokens than the
			// model will read. 3.3 chars/token is the pessimistic end for German
			// through XLM-R, so this is the floor, not an estimate of the average.
			expect(chars).toBeLessThanOrEqual(m.maxTokens * 4);
			expect(chars / m.maxTokens).toBeLessThanOrEqual(4);
		}
	});

	it("reads maxTokens rather than a shared constant — the field is no longer dead", () => {
		// Before ADR-182 both models chunked at a hardcoded 500 chars while declaring
		// different windows. A model with a bigger window must now get a bigger chunk.
		const en = embedChunkChars("xenova-all-MiniLM-L6-v2");
		const multi = embedChunkChars("xenova-paraphrase-multilingual-MiniLM-L12-v2");
		expect(EMBEDDING_MODELS["xenova-all-MiniLM-L6-v2"].maxTokens)
			.toBeGreaterThan(EMBEDDING_MODELS["xenova-paraphrase-multilingual-MiniLM-L12-v2"].maxTokens);
		expect(en).toBeGreaterThan(multi);
	});

	it("keeps the default model's chunk under the 500 chars that overran it", () => {
		// 500 chars is ~150 tokens of German against a 128-token window.
		expect(embedChunkChars(DEFAULT_EMBEDDING_MODEL_ID)).toBeLessThan(500);
	});

	it("falls back to the default model's window for an unknown id", () => {
		expect(embedChunkChars("nope" as EmbeddingModelId))
			.toBe(embedChunkChars(DEFAULT_EMBEDDING_MODEL_ID));
	});
});
