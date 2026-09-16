import { describe, it, expect } from "vitest";
import { MODEL_CATALOG } from "../models/knownModels";
import { MODEL_PRICING, PRICING_AS_OF, estimateCost, formatCost, conversationCost, resolvePricing, sanitizePriceOverrides, costSnapshot, messageCost } from "../models/modelPricing";
import type { Message } from "../models/types";

// ADR-163: the cost on a turn label is an estimate from a date-stamped table.

describe("MODEL_PRICING", () => {
	it("has a row for every catalog model, with positive input and output prices", () => {
		for (const m of MODEL_CATALOG) {
			const p = MODEL_PRICING[m.id];
			expect(p, `missing price for ${m.id}`).toBeTruthy();
			expect(p.input).toBeGreaterThan(0);
			expect(p.output).toBeGreaterThan(0);
		}
	});

	it("has no stale rows and a real as-of date", () => {
		const ids = new Set(MODEL_CATALOG.map((m) => m.id));
		for (const id of Object.keys(MODEL_PRICING)) expect(ids.has(id), `stale price for ${id}`).toBe(true);
		expect(PRICING_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe("estimateCost", () => {
	it("prices input and output at their own rates", () => {
		// gpt-4o: $2.50 in, $10 out per million.
		expect(estimateCost("gpt-4o", { inputTokens: 1_000_000, outputTokens: 100_000 })).toBeCloseTo(2.5 + 1.0, 6);
	});

	it("prices Anthropic cache reads at the discount and writes at the premium", () => {
		// sonnet: in 3, out 15, cache read 0.3, cache write 3.75 per million.
		const usd = estimateCost("claude-sonnet-4-6", { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000 });
		expect(usd).toBeCloseTo(0.003 + 0.015 + 0.3 + 3.75, 6);
	});

	it("bills cache counts at the input rate when the row has no cache prices", () => {
		const usd = estimateCost("gpt-4o", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 });
		expect(usd).toBeCloseTo(2.5, 6);
	});

	it("returns null for an unknown model or missing usage — never a wrong number", () => {
		expect(estimateCost("my-custom-model", { inputTokens: 10, outputTokens: 10 })).toBeNull();
		expect(estimateCost(undefined, { inputTokens: 10, outputTokens: 10 })).toBeNull();
		expect(estimateCost("gpt-4o", undefined)).toBeNull();
	});
});

describe("formatCost", () => {
	it("two decimals from a dollar up, two significant digits below, never more than four decimals", () => {
		expect(formatCost(1.234)).toBe("$1.23");
		expect(formatCost(12.5)).toBe("$12.50");
		expect(formatCost(0.5)).toBe("$0.50");
		expect(formatCost(0.0123)).toBe("$0.012");
		expect(formatCost(0.00042)).toBe("$0.0004");
		expect(formatCost(0.000004)).toBe("<$0.0001");
		expect(formatCost(0)).toBe("$0");
	});
});

describe("conversationCost", () => {
	const ai = (id: string, model: string | undefined, usage?: Message["tokenUsage"]): Message =>
		({ id, role: "assistant", content: "", timestamp: "", model, tokenUsage: usage });

	it("sums priced answers and counts unpriced ones separately", () => {
		const msgs: Message[] = [
			{ id: "u", role: "user", content: "", timestamp: "" },
			ai("a", "gpt-4o", { inputTokens: 1_000_000, outputTokens: 0 }),           // $2.50
			ai("b", "custom-x", { inputTokens: 1_000_000, outputTokens: 0 }),         // unpriced
			ai("c", "claude-haiku-4-5", { inputTokens: 0, outputTokens: 1_000_000 }), // $5
			ai("d", "gpt-4o"),                                                        // no usage: ignored
		];
		expect(conversationCost(msgs)).toEqual({ usd: 7.5, priced: 2, unpriced: 1 });
	});

	it("is zero with nothing priced", () => {
		expect(conversationCost([])).toEqual({ usd: 0, priced: 0, unpriced: 0 });
	});
});

describe("price overrides (user corrections, ADR-163)", () => {
	it("replaces only the fields given and keeps the built-in value for the rest", () => {
		const p = resolvePricing("gpt-4o", { "gpt-4o": { output: 12 } });
		expect(p).toEqual({ input: 2.5, output: 12 });
	});

	it("scales Anthropic cache prices with an overridden input price", () => {
		// sonnet: input 3 → 6 doubles cache read 0.3 → 0.6 and cache write 3.75 → 7.5.
		const p = resolvePricing("claude-sonnet-4-6", { "claude-sonnet-4-6": { input: 6 } });
		expect(p).toEqual({ input: 6, output: 15, cacheRead: 0.6, cacheWrite: 7.5 });
	});

	it("never creates a row for a model that has none", () => {
		expect(resolvePricing("my-fine-tune", { "my-fine-tune": { input: 1, output: 1 } })).toBeNull();
	});

	it("flows through estimateCost and conversationCost", () => {
		const usage = { inputTokens: 1_000_000, outputTokens: 0 };
		expect(estimateCost("gpt-4o", usage, { "gpt-4o": { input: 5 } })).toBeCloseTo(5, 6);
		const msgs = [{ id: "a", role: "assistant" as const, content: "", timestamp: "", model: "gpt-4o", tokenUsage: usage }];
		expect(conversationCost(msgs, { "gpt-4o": { input: 5 } }).usd).toBeCloseTo(5, 6);
	});
});

describe("sanitizePriceOverrides (load-time guard)", () => {
	it("keeps finite non-negative numbers for known models and drops everything else", () => {
		const out = sanitizePriceOverrides({
			"gpt-4o": { input: 3, output: "12" },
			"claude-haiku-4-5": { input: NaN, output: -1 },
			"o3": { output: 9 },
			"unknown-model": { input: 1, output: 1 },
			"gpt-4.1": "cheap",
		});
		expect(out).toEqual({ "gpt-4o": { input: 3 }, "o3": { output: 9 } });
	});

	it("returns an empty table for anything that is not an object", () => {
		expect(sanitizePriceOverrides(null)).toEqual({});
		expect(sanitizePriceOverrides([1, 2])).toEqual({});
		expect(sanitizePriceOverrides("x")).toEqual({});
	});
});

describe("cost snapshot (stored at generation, ADR-163)", () => {
	const usage = { inputTokens: 1_000_000, outputTokens: 0 };

	it("stamps the estimate with the table date, and stays undefined for an unpriced model", () => {
		expect(costSnapshot("gpt-4o", usage)).toEqual({ usd: 2.5, asOf: PRICING_AS_OF });
		expect(costSnapshot("my-fine-tune", usage)).toBeUndefined();
		expect(costSnapshot("gpt-4o", undefined)).toBeUndefined();
	});

	it("messageCost prefers the stored snapshot over a live estimate", () => {
		const stored = { usd: 9.99, asOf: "2025-01-01" };
		expect(messageCost({ model: "gpt-4o", tokenUsage: usage, cost: stored })).toEqual(stored);
		expect(messageCost({ model: "gpt-4o", tokenUsage: usage })).toEqual({ usd: 2.5, asOf: PRICING_AS_OF });
		// A user override applies to live estimates only; the snapshot is history.
		expect(messageCost({ model: "gpt-4o", tokenUsage: usage, cost: stored }, { "gpt-4o": { input: 100 } })).toEqual(stored);
	});

	it("conversationCost sums stored snapshots and live estimates alike", () => {
		const msgs = [
			{ id: "a", role: "assistant" as const, content: "", timestamp: "", model: "gpt-4o", tokenUsage: usage, cost: { usd: 1, asOf: "2025-01-01" } },
			{ id: "b", role: "assistant" as const, content: "", timestamp: "", model: "gpt-4o", tokenUsage: usage },
			{ id: "c", role: "assistant" as const, content: "", timestamp: "", model: "gone-model", cost: { usd: 0.5, asOf: "2025-01-01" } },
		];
		expect(conversationCost(msgs)).toEqual({ usd: 4, priced: 3, unpriced: 0 });
	});
});
