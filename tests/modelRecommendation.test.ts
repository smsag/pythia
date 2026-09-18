import { describe, it, expect } from "vitest";
import {
	parseDifficulty, requiredDepth, recommendModel, sendCost, NOTES_BUMP_AT,
	type RecommendationInput,
} from "../services/modelRecommendation";
import { KNOWN_MODELS, getContextWindow } from "../models/knownModels";
import { MODEL_PROFILE } from "../models/modelGuidance";
import { MODEL_PRICING } from "../models/modelPricing";
import type { Provider } from "../models/types";

// ADR-181. No test hard-codes a price (CLAUDE.md, ADR-163): expectations that
// depend on price are computed from MODEL_PRICING, so the weekly price PR
// cannot break them.

describe("parseDifficulty", () => {
	it("splits the rating off the last line", () => {
		expect(parseDifficulty("Explain X in two paragraphs.\n\nDIFFICULTY: standard"))
			.toEqual({ prompt: "Explain X in two paragraphs.", difficulty: "standard" });
	});

	it("tolerates case, markdown emphasis and a trailing period", () => {
		expect(parseDifficulty("P\n**Difficulty:** Deep.").difficulty).toBe("deep");
		expect(parseDifficulty("P\n`DIFFICULTY: light`").difficulty).toBe("light");
	});

	it("returns the reply whole when the rating is missing", () => {
		expect(parseDifficulty("Just a prompt.")).toEqual({ prompt: "Just a prompt.", difficulty: null });
	});

	it("never cuts a prompt that mentions difficulty anywhere but the last line", () => {
		const reply = "DIFFICULTY: rate this essay's difficulty\nfor a first-year student.";
		expect(parseDifficulty(reply)).toEqual({ prompt: reply, difficulty: null });
	});

	it("drops an unknown level to null but still removes the line", () => {
		expect(parseDifficulty("P\nDIFFICULTY: extreme")).toEqual({ prompt: "P", difficulty: null });
	});
});

describe("requiredDepth", () => {
	it("maps the rating to a depth tier", () => {
		expect(requiredDepth({ difficulty: "light", contextNoteCount: 0, researchMode: false })).toBe(1);
		expect(requiredDepth({ difficulty: "deep", contextNoteCount: 0, researchMode: false })).toBe(3);
	});

	it("goes up one for research mode or several notes — the prompt does not show that material", () => {
		expect(requiredDepth({ difficulty: "light", contextNoteCount: 0, researchMode: true })).toBe(2);
		expect(requiredDepth({ difficulty: "standard", contextNoteCount: NOTES_BUMP_AT, researchMode: false })).toBe(3);
		expect(requiredDepth({ difficulty: "deep", contextNoteCount: 9, researchMode: true })).toBe(3);
	});
});

function input(over: Partial<RecommendationInput>): RecommendationInput {
	return {
		difficulty: "standard", provider: "anthropic", currentProvider: "anthropic", currentModel: "claude-opus-5",
		historyTokens: 0, contextNoteCount: 0, researchMode: false, hasPdf: false, templatePinsModel: false,
		...over,
	};
}

const price = (id: string) => (MODEL_PRICING[id] ? MODEL_PRICING[id].input + MODEL_PRICING[id].output : Infinity);

describe("recommendModel — the pick", () => {
	const providers: Provider[] = ["anthropic", "openai", "mistral"];
	const levels = ["light", "standard", "deep"] as const;

	it("is the cheapest adequate model of the preferred provider: lowest cost tier, then lowest price, then catalog order", () => {
		for (const provider of providers) {
			for (const difficulty of levels) {
				// A current model on another provider, so "already there" never applies.
				const pick = recommendModel(input({ provider, difficulty, currentProvider: provider === "openai" ? "anthropic" : "openai", currentModel: "x" }));
				const depth = requiredDepth({ difficulty, contextNoteCount: 0, researchMode: false });
				const adequate = KNOWN_MODELS[provider].filter((id) => MODEL_PROFILE[id] && MODEL_PROFILE[id].depth >= depth);
				if (adequate.length === 0) { expect(pick).toBeNull(); continue; }
				const tier = Math.min(...adequate.map((id) => MODEL_PROFILE[id].cost));
				const inTier = adequate.filter((id) => MODEL_PROFILE[id].cost === tier);
				const best = Math.min(...inTier.map(price));
				const expected = inTier.find((id) => price(id) === best);
				expect(pick, `${provider} ${difficulty}`).toBe(expected);
			}
		}
	});

	it("only ever picks a visible model of the preferred provider", () => {
		const pick = recommendModel(input({ provider: "openai", difficulty: "light" }));
		expect(KNOWN_MODELS.openai).toContain(pick);
	});

	it("never picks a model whose window cannot hold the history", () => {
		for (const historyTokens of [150_000, 190_000, 400_000]) {
			const pick = recommendModel(input({ provider: "openai", difficulty: "light", currentProvider: "anthropic", historyTokens }));
			if (pick) expect(getContextWindow(pick)).toBeGreaterThan(historyTokens * 1.2);
		}
	});
});

describe("recommendModel — when it says nothing", () => {
	it("a template armed for the next send already chose the model", () => {
		expect(recommendModel(input({ difficulty: "light", templatePinsModel: true }))).toBeNull();
	});

	it("a PDF is attached and the preferred provider takes no PDF input", () => {
		expect(recommendModel(input({ provider: "mistral", currentProvider: "mistral", currentModel: "mistral-large-latest", hasPdf: true }))).toBeNull();
	});

	it("the current model is already the pick", () => {
		const pick = recommendModel(input({ difficulty: "light", currentProvider: "openai", currentModel: "x" }));
		expect(pick).not.toBeNull();
		expect(recommendModel(input({ difficulty: "light", currentModel: pick! }))).toBeNull();
	});

	it("the current model is adequate and costs the same — no churn to a sibling at one price", () => {
		const deepPick = recommendModel(input({ difficulty: "deep", currentProvider: "openai", currentModel: "x" }))!;
		const samePrice = KNOWN_MODELS.anthropic.filter((id) => id !== deepPick && MODEL_PROFILE[id]?.depth === 3
			&& MODEL_PROFILE[id].cost === MODEL_PROFILE[deepPick].cost && price(id) === price(deepPick));
		for (const current of samePrice) {
			expect(recommendModel(input({ difficulty: "deep", currentModel: current })), current).toBeNull();
		}
	});

	it("a downgrade would re-read a long history cold for more than staying on the cached model costs", () => {
		for (const historyTokens of [0, 20_000, 150_000]) {
			const pick = recommendModel(input({ difficulty: "light", currentModel: "claude-opus-5", historyTokens }));
			const cheapest = recommendModel(input({ difficulty: "light", currentProvider: "openai", currentModel: "x", historyTokens }));
			const stay = sendCost("claude-opus-5", historyTokens, true)!;
			const move = sendCost(cheapest!, historyTokens, false)!;
			expect(pick, String(historyTokens)).toBe(move >= stay ? null : cheapest);
		}
	});
});

describe("recommendModel — upgrades", () => {
	it("suggests a deeper model when the current one is not deep enough, whatever it costs", () => {
		const shallow = KNOWN_MODELS.anthropic.find((id) => MODEL_PROFILE[id]?.depth === 1)!;
		const pick = recommendModel(input({ difficulty: "deep", currentModel: shallow, historyTokens: 150_000 }));
		expect(pick).not.toBeNull();
		expect(MODEL_PROFILE[pick!].depth).toBe(3);
	});

	it("follows the preferred provider even when the conversation is on another one", () => {
		const pick = recommendModel(input({ provider: "openai", currentProvider: "anthropic", currentModel: "claude-sonnet-5" }));
		expect(KNOWN_MODELS.openai).toContain(pick);
	});
});
