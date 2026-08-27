import { describe, it, expect } from "vitest";
import { MODEL_CATALOG } from "../models/knownModels";
import { MODEL_GOOD_FOR, goodForModel } from "../models/modelGuidance";

describe("model guidance (good-for examples)", () => {
	it("every catalog model has a non-empty en + de example", () => {
		for (const m of MODEL_CATALOG) {
			const entry = MODEL_GOOD_FOR[m.id];
			expect(entry, `missing guidance for ${m.id}`).toBeTruthy();
			expect(entry.en.trim().length, `empty en for ${m.id}`).toBeGreaterThan(0);
			expect(entry.de.trim().length, `empty de for ${m.id}`).toBeGreaterThan(0);
		}
	});

	it("has no stale entries for models not in the catalog", () => {
		const ids = new Set(MODEL_CATALOG.map((m) => m.id));
		for (const id of Object.keys(MODEL_GOOD_FOR)) {
			expect(ids.has(id), `stale guidance for ${id}`).toBe(true);
		}
	});

	it("goodForModel returns the localized string, or '' for unknown models", () => {
		expect(goodForModel("claude-haiku-4-5", "en")).toContain("Quick");
		expect(goodForModel("claude-haiku-4-5", "de")).toContain("Schnelle");
		expect(goodForModel("some-custom-model", "en")).toBe("");
	});
});
