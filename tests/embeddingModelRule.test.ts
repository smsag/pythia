import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import {
	EMBEDDING_MODELS, EMBEDDING_MODEL_IDS, MOBILE_EMBEDDING_MODEL_ID, effectiveEmbeddingModel,
} from "../models/embeddingModels";

// ADR-198: the multilingual model took Obsidian's WebContent process on iOS to
// ~1.65 GB of a ~2 GB limit, and the first inference got it killed — a hard
// reload every minute or two. These tests fail in the forbidden direction.

describe("effectiveEmbeddingModel — what a device actually runs (ADR-198)", () => {
	it("never hands a phone a model that is not marked mobile, whatever the setting", () => {
		for (const id of EMBEDDING_MODEL_IDS) {
			expect(EMBEDDING_MODELS[effectiveEmbeddingModel(id, true)].mobile).toBe(true);
		}
	});

	it("the mobile substitute is itself allowed on mobile", () => {
		expect(EMBEDDING_MODELS[MOBILE_EMBEDDING_MODEL_ID].mobile).toBe(true);
	});

	it("the multilingual model is the one a phone cannot hold (measured, not a default)", () => {
		expect(EMBEDDING_MODELS["xenova-paraphrase-multilingual-MiniLM-L12-v2"].mobile).toBe(false);
		expect(effectiveEmbeddingModel("xenova-paraphrase-multilingual-MiniLM-L12-v2", true)).toBe(MOBILE_EMBEDDING_MODEL_ID);
	});

	it("leaves the desktop on exactly the model the setting names", () => {
		for (const id of EMBEDDING_MODEL_IDS) expect(effectiveEmbeddingModel(id, false)).toBe(id);
	});

	it("a phone keeps a mobile-capable choice rather than being moved off it", () => {
		expect(effectiveEmbeddingModel("xenova-all-MiniLM-L6-v2", true)).toBe("xenova-all-MiniLM-L6-v2");
	});

	it("an unknown stored id resolves through the default, not through to the raw value", () => {
		const bogus = "not-a-model" as never;
		expect(EMBEDDING_MODEL_IDS).toContain(effectiveEmbeddingModel(bogus, false));
		expect(EMBEDDING_MODELS[effectiveEmbeddingModel(bogus, true)].mobile).toBe(true);
	});
});

describe("one reader of the model setting (ADR-198)", () => {
	// A second reader of `settings.embeddingModelId` would load, index or score
	// with the model the SETTING names — on a phone, the one that crashes it.
	// Everything goes through `plugin.activeEmbeddingModelId()`.
	const root = process.cwd();
	const sources = ["main.ts", "settings.ts", "sidebar.ts", ...["ui", "suggest", "services", "models"].flatMap((d) =>
		readdirSync(resolve(root, d), { recursive: true }).map(String).filter((f) => f.endsWith(".ts")).map((f) => join(d, f)))];

	const ALLOWED: Record<string, number> = {
		"main.ts": 2,                  // activeEmbeddingModelId() + the "substituted?" comparison beside it
		"ui/embeddingSettings.ts": 3,  // the control that edits the setting
	};

	it("no other file reads settings.embeddingModelId", () => {
		const found: Record<string, number> = {};
		for (const f of sources) {
			// Code only: the rule is written about in comments, and that is not a read.
			const code = readFileSync(resolve(root, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
			const n = (code.match(/settings\.embeddingModelId\b/g) ?? []).length;
			if (n > 0) found[f.split("\\").join("/")] = n;
		}
		expect(found).toEqual(ALLOWED);
	});
});
