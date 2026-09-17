import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCatalog, buildTable, renderTable, spliceGenerated, readCommittedTable, fmt, NO_UPSTREAM, UPSTREAM_IDS } from "../scripts/update-pricing.mjs";
import { MODEL_CATALOG } from "../models/knownModels";
import { MODEL_PRICING, PRICING_AS_OF } from "../models/modelPricing";

// ADR-163: the price table is generated from models.dev by a script that
// fails on anything it cannot prove, and the generated block round-trips.

const ROOT = resolve(__dirname, "..");
const knownModelsSource = readFileSync(resolve(ROOT, "models/knownModels.ts"), "utf8");
const pricingSource = readFileSync(resolve(ROOT, "models/modelPricing.ts"), "utf8");

describe("readCatalog", () => {
	it("reads every catalog model from knownModels.ts, hidden ones included", () => {
		const rows = readCatalog(knownModelsSource);
		const expected = MODEL_CATALOG.map((m) => ({ id: m.id, provider: m.provider }));
		expect(rows).toEqual(expected);
	});
});

describe("buildTable", () => {
	const catalog = [{ id: "claude-sonnet-4-6", provider: "anthropic" }, { id: "gpt-4o", provider: "openai" }];
	const upstream = {
		anthropic: { models: { "claude-sonnet-4-6": { cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 } } } },
		openai: { models: { "gpt-4o": { cost: { input: 2.5, output: 10 } } } },
	};

	it("maps cost fields, including cache prices where upstream has them", () => {
		expect(buildTable(upstream, catalog)).toEqual({
			"claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
			"gpt-4o": { input: 2.5, output: 10 },
		});
	});

	it("fails on a catalog model with no upstream row, naming it and nearby ids", () => {
		const cat = [...catalog, { id: "gpt-4o-mini", provider: "openai" }];
		expect(() => buildTable(upstream, cat)).toThrow(/gpt-4o-mini \(openai\) — upstream has: gpt-4o/);
	});

	it("resolves a renamed upstream id through the mapping", () => {
		const up = { openai: { models: { "gpt-4o-2024": { cost: { input: 1, output: 2 } } } } };
		expect(buildTable(up, [{ id: "gpt-4o", provider: "openai" }], { "gpt-4o": "gpt-4o-2024" })).toEqual({ "gpt-4o": { input: 1, output: 2 } });
	});

	it("skips models declared as not listed upstream instead of failing on them", () => {
		const cat = [...catalog, { id: "claude-mythos-5", provider: "anthropic" }];
		expect(buildTable(upstream, cat, {}, new Set(["claude-mythos-5"]))).not.toHaveProperty("claude-mythos-5");
		expect(() => buildTable(upstream, cat, {}, new Set())).toThrow(/claude-mythos-5/);
	});

	it("the committed mappings name real catalog models", () => {
		const ids = new Set(MODEL_CATALOG.map((m) => m.id));
		for (const id of [...Object.keys(UPSTREAM_IDS), ...NO_UPSTREAM]) expect(ids.has(id), id).toBe(true);
		// A model is either mapped or declared missing, never both.
		for (const id of NO_UPSTREAM) expect(UPSTREAM_IDS).not.toHaveProperty(id);
	});

	it("fails when the upstream schema has no models for a provider", () => {
		expect(() => buildTable({ openai: {} }, [{ id: "gpt-4o", provider: "openai" }])).toThrow(/schema changed/);
	});
});

describe("renderTable + spliceGenerated", () => {
	it("round-trips the committed table: regenerating from its own values changes nothing", () => {
		// Read the committed rows back through the real module, render them, and
		// splice them into the file: the result must equal the file. This is what
		// keeps a hand edit and the script agreeing on formatting.
		const catalog = readCatalog(knownModelsSource);
		const block = renderTable(MODEL_PRICING, catalog, PRICING_AS_OF);
		expect(spliceGenerated(pricingSource, block)).toBe(pricingSource);
		// The file parser the script uses for kept rows agrees with the module.
		expect(readCommittedTable(pricingSource)).toEqual(MODEL_PRICING);
	});

	it("refuses a file without markers", () => {
		expect(() => spliceGenerated("export const x = 1;", "y")).toThrow(/markers/);
	});
});

describe("fmt — the last gate before upstream numbers become source", () => {
	it("formats an ordinary price to at most 4 decimals, without trailing zeros", () => {
		expect(fmt(3)).toBe("3");
		expect(fmt(2.5)).toBe("2.5");
		expect(fmt(0.12345)).toBe("0.1235");
		expect(fmt(0)).toBe("0");
	});

	it("never emits exponent notation for a very small price", () => {
		// `String(0.000001)` is "0.000001", but `String(1e-7)` is "1e-7" — which
		// would compile and then price nothing correctly.
		expect(fmt(0.0000001)).not.toContain("e");
	});

	// The reason this function is exported: a hostile or broken upstream cannot
	// reach it as a string (toFixed throws), but it CAN reach it as NaN, and
	// `input: NaN` is valid TypeScript that compiles into a shipped price table.
	it("refuses a non-finite number rather than emitting NaN into the source", () => {
		expect(() => fmt(NaN)).toThrow(/not a usable number/);
		expect(() => fmt(Infinity)).toThrow(/not a usable number/);
		expect(() => fmt(-Infinity)).toThrow(/not a usable number/);
	});

	it("refuses a negative price", () => {
		// No provider charges a negative rate; a negative here means the upstream
		// schema moved and we are reading the wrong field.
		expect(() => fmt(-1)).toThrow(/not a usable number/);
	});

	it("refuses a non-number outright", () => {
		expect(() => fmt("2.5")).toThrow(/not a usable number/);
		expect(() => fmt(null)).toThrow(/not a usable number/);
		expect(() => fmt(undefined)).toThrow(/not a usable number/);
	});
});
