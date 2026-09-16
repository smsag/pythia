import { describe, it, expect } from "vitest";
import { MODEL_CATALOG } from "../models/knownModels";
import { MODEL_GOOD_FOR, goodForModel, MODEL_PROFILE, profileLine, tierDots } from "../models/modelGuidance";

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

describe("model profile (speed · depth · cost — ADR-162)", () => {
	it("every catalog model has a profile with each axis in 1..3", () => {
		for (const m of MODEL_CATALOG) {
			const p = MODEL_PROFILE[m.id];
			expect(p, `missing profile for ${m.id}`).toBeTruthy();
			for (const axis of ["speed", "depth", "cost"] as const) {
				expect([1, 2, 3], `${m.id}.${axis}`).toContain(p[axis]);
			}
		}
	});

	it("has no stale profiles for models not in the catalog", () => {
		const ids = new Set(MODEL_CATALOG.map((m) => m.id));
		for (const id of Object.keys(MODEL_PROFILE)) expect(ids.has(id), `stale profile for ${id}`).toBe(true);
	});

	it("renders three dots per axis and localizes the axis names", () => {
		expect(tierDots(2)).toBe("●●○");
		expect(profileLine("claude-haiku-4-5", "en")).toBe("Speed ●●● · Depth ●○○ · Cost ●○○");
		expect(profileLine("claude-haiku-4-5", "de")).toMatch(/^Tempo .* · Tiefe .* · Kosten /);
		expect(profileLine("some-custom-model", "en")).toBe("");
	});
});
