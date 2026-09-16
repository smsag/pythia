import { describe, it, expect } from "vitest";
import { MODEL_CATALOG } from "../models/knownModels";
import { MODEL_PRICING, PRICING_AS_OF, estimateCost, formatCost, conversationCost, costSnapshot, messageCost, priceUsage } from "../models/modelPricing";
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

// The table is rewritten from models.dev weekly, so no test below hard-codes
// a price: arithmetic runs on synthetic rows, and anything that goes through
// the real table computes its expectation from MODEL_PRICING.

describe("priceUsage (arithmetic on a synthetic row)", () => {
	it("prices input and output at their own rates", () => {
		expect(priceUsage({ input: 2.5, output: 10 }, { inputTokens: 1_000_000, outputTokens: 100_000 })).toBeCloseTo(2.5 + 1.0, 6);
	});

	it("prices cache reads at the discount and writes at the premium", () => {
		const row = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
		const usd = priceUsage(row, { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000 });
		expect(usd).toBeCloseTo(0.003 + 0.015 + 0.3 + 3.75, 6);
	});

	it("bills cache counts at the input rate when the row has no cache prices", () => {
		expect(priceUsage({ input: 2.5, output: 10 }, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })).toBeCloseTo(2.5, 6);
	});
});

describe("estimateCost (through the real table)", () => {
	it("prices a known model from its row", () => {
		const p = MODEL_PRICING["gpt-4o"];
		expect(estimateCost("gpt-4o", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(p.input + p.output, 6);
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

describe("cost snapshot (stored at generation, ADR-163)", () => {
	const usage = { inputTokens: 1_000_000, outputTokens: 0 };
	const gpt4oIn = MODEL_PRICING["gpt-4o"].input;

	it("stamps the estimate with the table date, and stays undefined for an unpriced model", () => {
		expect(costSnapshot("gpt-4o", usage)).toEqual({ usd: gpt4oIn, asOf: PRICING_AS_OF });
		expect(costSnapshot("my-fine-tune", usage)).toBeUndefined();
		expect(costSnapshot("gpt-4o", undefined)).toBeUndefined();
	});

	it("messageCost prefers the stored snapshot over a live estimate", () => {
		const stored = { usd: 9.99, asOf: "2025-01-01" };
		expect(messageCost({ model: "gpt-4o", tokenUsage: usage, cost: stored })).toEqual(stored);
		expect(messageCost({ model: "gpt-4o", tokenUsage: usage })).toEqual({ usd: gpt4oIn, asOf: PRICING_AS_OF });
	});

	it("conversationCost sums stored snapshots and live estimates alike", () => {
		const msgs = [
			{ id: "a", role: "assistant" as const, content: "", timestamp: "", model: "gpt-4o", tokenUsage: usage, cost: { usd: 1, asOf: "2025-01-01" } },
			{ id: "b", role: "assistant" as const, content: "", timestamp: "", model: "gpt-4o", tokenUsage: usage },
			{ id: "c", role: "assistant" as const, content: "", timestamp: "", model: "gone-model", cost: { usd: 0.5, asOf: "2025-01-01" } },
		];
		expect(conversationCost(msgs)).toEqual({ usd: 1 + gpt4oIn + 0.5, priced: 3, unpriced: 0 });
	});
});
