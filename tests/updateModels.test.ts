import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCatalogDetails, formatWindow, syncContextWindows, findDeprecated, findNewModels, suggestRow, renderReport } from "../scripts/update-models.mjs";
import type { CatalogDetail } from "../scripts/update-models.mjs";
import { MODEL_CATALOG } from "../models/knownModels";

// ADR-179: the catalog is checked against models.dev. Facts (context windows)
// are rewritten for a PR; decisions (new and deprecated models) are only
// reported, never applied.

const ROOT = resolve(__dirname, "..");
const knownModelsSource = readFileSync(resolve(ROOT, "models/knownModels.ts"), "utf8");

const chat = (extra: Record<string, unknown> = {}) => ({
	modalities: { input: ["text", "image"], output: ["text"] },
	tool_call: true,
	limit: { context: 200_000 },
	...extra,
});

describe("readCatalogDetails", () => {
	it("reads every catalog model with its window and hidden flag, straight from the source", () => {
		expect(readCatalogDetails(knownModelsSource)).toEqual(
			MODEL_CATALOG.map((m) => ({ id: m.id, provider: m.provider, contextWindow: m.contextWindow, hidden: m.hidden === true })),
		);
	});
});

describe("formatWindow — the gate before an upstream number becomes source", () => {
	it("groups digits the way the catalog writes them", () => {
		expect(formatWindow(1_047_576)).toBe("1_047_576");
		expect(formatWindow(128_000)).toBe("128_000");
		expect(formatWindow(512)).toBe("512");
	});

	it("refuses anything but a positive integer", () => {
		for (const bad of [NaN, Infinity, 0, -1, 1.5, "128000", null, undefined]) {
			expect(() => formatWindow(bad), String(bad)).toThrow(/not a usable number/);
		}
	});
});

describe("syncContextWindows", () => {
	const source = [
		`\t{ id: "gpt-4.1",      provider: "openai", abbreviation: "GPT-4.1",      contextWindow: 1_000_000 },`,
		`\t{ id: "gpt-4.1-mini", provider: "openai", abbreviation: "GPT-4.1 mini", contextWindow: 1_000_000 },`,
		`\t{ id: "claude-mythos-5", provider: "anthropic", abbreviation: "Mythos 5", contextWindow: 1_000_000, hidden: true },`,
	].join("\n");
	const catalog = readCatalogDetails(source);
	const upstream = {
		anthropic: { models: {} },
		openai: { models: { "gpt-4.1": chat({ limit: { context: 1_047_576 } }), "gpt-4.1-mini": chat({ limit: { context: 1_000_000 } }) } },
	};

	it("rewrites only the line whose window changed, and only its number", () => {
		const { source: out, changes } = syncContextWindows(source, upstream, catalog, {}, new Set(["claude-mythos-5"]));
		expect(changes).toEqual([{ id: "gpt-4.1", from: 1_000_000, to: 1_047_576 }]);
		expect(out).toBe(source.replace("GPT-4.1\",      contextWindow: 1_000_000", "GPT-4.1\",      contextWindow: 1_047_576"));
	});

	it("does not touch `gpt-4.1-mini` when only `gpt-4.1` changed — the id is matched whole", () => {
		const { source: out } = syncContextWindows(source, upstream, catalog, {}, new Set(["claude-mythos-5"]));
		expect(out.split("\n")[1]).toBe(source.split("\n")[1]);
	});

	it("fails on a catalog model with no upstream row, like the price script", () => {
		expect(() => syncContextWindows(source, upstream, catalog, {}, new Set())).toThrow(/claude-mythos-5 \(anthropic\)/);
	});

	it("refuses a broken upstream size instead of writing it", () => {
		const bad = { ...upstream, openai: { models: { ...upstream.openai.models, "gpt-4.1": chat({ limit: { context: "big" } }) } } };
		expect(() => syncContextWindows(source, bad, catalog, {}, new Set(["claude-mythos-5"]))).toThrow(/not a usable number/);
	});

	it("the committed catalog is in step with itself: no change when upstream says what it says", () => {
		const cat = readCatalogDetails(knownModelsSource);
		const up: Record<string, { models: Record<string, unknown> }> = { anthropic: { models: {} }, openai: { models: {} }, mistral: { models: {} } };
		for (const m of cat) up[m.provider].models[m.id === "magistral-small-latest" ? "magistral-small" : m.id] = chat({ limit: { context: m.contextWindow } });
		const { source: out, changes } = syncContextWindows(knownModelsSource, up, cat);
		expect(changes).toEqual([]);
		expect(out).toBe(knownModelsSource);
	});
});

describe("findDeprecated", () => {
	const catalog: CatalogDetail[] = [
		{ id: "o3-mini", provider: "openai", contextWindow: 1, hidden: false },
		{ id: "o1", provider: "openai", contextWindow: 1, hidden: true },
		{ id: "gpt-4o", provider: "openai", contextWindow: 1, hidden: false },
	];
	const upstream = { openai: { models: { "o3-mini": { status: "deprecated" }, o1: { status: "deprecated" }, "gpt-4o": {} } } };

	it("names offered models upstream retired, and skips ones already hidden", () => {
		expect(findDeprecated(upstream, catalog, {}, new Set())).toEqual([{ id: "o3-mini", provider: "openai" }]);
	});
});

describe("findNewModels", () => {
	const catalog: CatalogDetail[] = [{ id: "claude-opus-5", provider: "anthropic", contextWindow: 1, hidden: false }];
	const models: Record<string, unknown> = {
		"claude-opus-5": chat({ release_date: "2026-07-24" }),
		"claude-fable-5-1": chat({ release_date: "2026-09-01" }),
		"claude-sibling": chat({ release_date: "2026-07-24" }),
		"claude-older": chat({ release_date: "2026-01-01" }),
		"claude-fable-5-1-20260901": chat({ release_date: "2026-09-01" }),
		"claude-retired": chat({ release_date: "2026-09-02", status: "deprecated" }),
		"claude-image": chat({ release_date: "2026-09-02", modalities: { input: ["text"], output: ["image"] } }),
		"claude-no-tools": chat({ release_date: "2026-09-02", tool_call: false }),
		"claude-undated": chat({}),
		"claude <b>x</b>": chat({ release_date: "2026-09-03" }),
	};
	const upstream = { anthropic: { models }, openai: { models: {} }, mistral: { models: {} } };

	it("lists chat models from the newest catalog model's release day on, newest first", () => {
		expect(findNewModels(upstream, catalog, {}, new Set()).map((m) => m.id)).toEqual(["claude-fable-5-1", "claude-sibling"]);
	});

	it("never passes an upstream id that is not a plain id into the report", () => {
		expect(findNewModels(upstream, catalog, {}, new Set()).some((m) => m.id.includes("<"))).toBe(false);
	});

	it("treats a mapped catalog model as known under its upstream id", () => {
		const cat: CatalogDetail[] = [{ id: "fable-alias", provider: "anthropic", contextWindow: 1, hidden: false }];
		const ids = findNewModels(upstream, cat, { "fable-alias": "claude-fable-5-1" }, new Set()).map((m) => m.id);
		expect(ids).not.toContain("claude-fable-5-1");
	});
});

describe("suggestRow", () => {
	it("reads the provider-behaviour flags the catalog branches on", () => {
		expect(suggestRow({ id: "claude-x", provider: "anthropic", releaseDate: "", row: chat({ temperature: false, reasoning_options: [{ type: "effort" }], limit: { context: 1_000_000 } }) }))
			.toBe(`{ id: "claude-x", provider: "anthropic", abbreviation: "TODO", contextWindow: 1_000_000, noTemperature: true, supportsEffort: true },`);
		expect(suggestRow({ id: "gpt-x", provider: "openai", releaseDate: "", row: chat({ reasoning: true }) })).toContain("isReasoning: true");
		expect(suggestRow({ id: "m-x", provider: "mistral", releaseDate: "", row: chat({ reasoning: true }) })).toContain("isMistralReasoning: true");
	});

	it("never emits a broken window, it marks it", () => {
		expect(suggestRow({ id: "gpt-x", provider: "openai", releaseDate: "", row: chat({ limit: {} }) })).toContain("/* unknown */");
	});
});

describe("renderReport", () => {
	it("is empty when there is nothing to decide — the workflow closes the issue on that", () => {
		expect(renderReport({ newModels: [], deprecated: [], asOf: "2026-09-18" })).toBe("");
	});

	it("names both kinds of decision and what adding a model takes", () => {
		const report = renderReport({
			newModels: [{ id: "gpt-x", provider: "openai", releaseDate: "2026-09-04", row: chat({ status: "beta" }) }],
			deprecated: [{ id: "o3-mini", provider: "openai" }],
			asOf: "2026-09-18",
		});
		expect(report).toContain("| openai | `gpt-x` | 2026-09-04 | 200_000 | beta |");
		expect(report).toContain("- `o3-mini` (openai)");
		expect(report).toContain("MODEL_PROFILE");
		expect(report).toContain("hidden: true");
	});
});
