import type { Message, MessageCost, TokenUsage } from "./types";

/**
 * List prices per model, USD per million tokens (ADR-163). The cost shown on a
 * turn label is `estimateCost(model, usage)` — computed at render time from the
 * token counts already on every assistant message, so past answers get a
 * number too and nothing new is stored.
 *
 * Prices rot. `PRICING_AS_OF` is the date this table was last pulled from
 * models.dev; the label says "≈" and its tooltip names the source and the
 * date, so a stale table is a visible estimate, not a silent lie. There is
 * no per-user correction: a wrong price is fixed upstream, where everyone
 * benefits, and reaches users with the next weekly pull request. A model with no row shows no cost — a missing
 * number is honest, a wrong one is not. Every non-hidden MODEL_CATALOG entry
 * must have a row (tests/modelPricing.test.ts).
 *
 * The table is generated: `scripts/update-pricing.mjs` pulls models.dev,
 * maps every catalog model to its upstream id and rewrites the block between
 * the GENERATED markers, and a weekly workflow opens a pull request when it
 * changed — so every price reaches users through a diff a human has read,
 * never through a fetch at build or run time.
 *
 * Cache tokens: Anthropic reports cache reads and writes *separately from*
 * `input_tokens`, at a discount (reads) and a premium (writes). Rows without
 * cache prices bill those counts at the input rate, which for the OpenAI and
 * Mistral providers is the only rate this plugin can see.
 */
export interface ModelPricing {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
}

// BEGIN GENERATED PRICES — rewritten by `npm run update:pricing` (scripts/update-pricing.mjs)
export const PRICING_AS_OF = "2026-09-16";

export const MODEL_PRICING: Record<string, ModelPricing> = {
	// ── Anthropic ─────────────────────────────────────────────────────────────
	"claude-opus-5":     { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
	"claude-fable-5":    { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
	"claude-mythos-5":   { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
	"claude-opus-4-8":   { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
	"claude-opus-4-7":   { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
	"claude-opus-4-6":   { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
	"claude-sonnet-5":   { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
	"claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	"claude-haiku-4-5":  { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },

	// ── OpenAI ────────────────────────────────────────────────────────────────
	"gpt-4.1":      { input: 2, output: 8, cacheRead: 0.5 },
	"gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1 },
	"gpt-4.1-nano": { input: 0.1, output: 0.4, cacheRead: 0.025 },
	"gpt-4o":       { input: 2.5, output: 10, cacheRead: 1.25 },
	"gpt-4o-mini":  { input: 0.15, output: 0.6, cacheRead: 0.075 },
	"o3-pro":       { input: 20, output: 80 },
	"o3":           { input: 2, output: 8, cacheRead: 0.5 },
	"o3-mini":      { input: 1.1, output: 4.4, cacheRead: 0.55 },
	"o4-mini":      { input: 1.1, output: 4.4, cacheRead: 0.275 },

	// ── Mistral ───────────────────────────────────────────────────────────────
	"mistral-large-latest":    { input: 0.5, output: 1.5 },
	"mistral-small-latest":    { input: 0.15, output: 0.6 },
	"codestral-latest":        { input: 0.3, output: 0.9 },
	"magistral-medium-latest": { input: 2, output: 5 },
	"magistral-small-latest":  { input: 0.5, output: 1.5 },
};
// END GENERATED PRICES

/** The arithmetic, separate from the table so it can be tested on a synthetic
 *  row: the table changes weekly, and a test that hard-codes a price breaks
 *  the pricing workflow on the first real price change. */
export function priceUsage(p: ModelPricing, usage: TokenUsage): number {
	const per = 1_000_000;
	return (
		usage.inputTokens * p.input +
		usage.outputTokens * p.output +
		(usage.cacheReadTokens ?? 0) * (p.cacheRead ?? p.input) +
		(usage.cacheCreationTokens ?? 0) * (p.cacheWrite ?? p.input)
	) / per;
}

/** Estimated USD for one reply, or null when the model has no price row. */
export function estimateCost(model: string | undefined, usage: TokenUsage | undefined): number | null {
	if (!model || !usage) return null;
	const p = MODEL_PRICING[model];
	return p ? priceUsage(p, usage) : null;
}

/** `$1.23` from a dollar up; below it two significant digits (`$0.012`,
 *  `$0.0004`) and never more than four decimals — at these magnitudes a third
 *  digit is noise in a 9px label. Anything under half a hundredth of a cent
 *  reads `<$0.0001` rather than a row of zeros. */
export function formatCost(usd: number): string {
	if (usd === 0) return "$0";
	if (usd < 0.00005) return "<$0.0001";
	if (usd >= 1) return `$${usd.toFixed(2)}`;
	const digits = Math.min(4, 1 - Math.floor(Math.log10(usd)));
	return `$${usd.toFixed(digits)}`;
}

/** The snapshot to store on a new assistant message: the estimate under the
 *  prices in force now, stamped with the table's date. Undefined when the
 *  model has no row, so a message never carries a made-up number. */
export function costSnapshot(model: string | undefined, usage: TokenUsage | undefined): MessageCost | undefined {
	const usd = estimateCost(model, usage);
	return usd === null ? undefined : { usd, asOf: PRICING_AS_OF };
}

/** What the label shows: the stored snapshot when the message has one, else
 *  a live estimate for a message that predates snapshots. */
export function messageCost(msg: Pick<Message, "model" | "tokenUsage" | "cost">): MessageCost | null {
	if (msg.cost) return msg.cost;
	const usd = estimateCost(msg.model, msg.tokenUsage);
	return usd === null ? null : { usd, asOf: PRICING_AS_OF };
}

/** Sum over a conversation's assistant turns. `unpriced` counts the turns that
 *  carry token usage but have no price row (a custom model), so a total can
 *  say when it is a floor rather than the whole bill. */
export function conversationCost(messages: Message[]): { usd: number; priced: number; unpriced: number } {
	let usd = 0, priced = 0, unpriced = 0;
	for (const m of messages) {
		if (m.role !== "assistant" || (!m.tokenUsage && !m.cost)) continue;
		const c = messageCost(m);
		if (c === null) unpriced++;
		else { usd += c.usd; priced++; }
	}
	return { usd, priced, unpriced };
}
