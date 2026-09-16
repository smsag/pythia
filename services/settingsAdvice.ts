import { isReasoningModel, isMistralReasoningModel } from "../models/knownModels";
import { DEFAULT_MAX_TOKENS_REASONING, resolveDefaultMaxTokens } from "./promptConstants";

/**
 * The one rule behind every "your token limit is too low for this model"
 * signal (ADR-162): the conversation settings modal, the warning beside Send
 * and the recovery card under a cut-off answer all read it from here, so they
 * can never disagree about when to warn or what to offer.
 *
 * A reasoning model spends the same max-tokens budget on hidden thinking
 * before it writes anything visible, so a cap that is fine for a plain model
 * gives a truncated or empty reply on a reasoning one. The sharp edge is the
 * *switch*: a conversation pinned to 2000 on a plain model keeps 2000 when it
 * moves to a reasoning model, and nothing about the reply says why it stopped.
 */
export interface MaxTokensAdvice {
	/** `clear`: the conversation's own override is what is too low, and dropping
	 *  it lets the model-aware default apply — the override then follows the
	 *  model again (principle 6). `pin`: there is nothing to clear — the global
	 *  setting, or the absence of any override, resolves too low — so this
	 *  conversation needs a value of its own. */
	kind: "clear" | "pin";
	effective: number;
	recommended: number;
}

/** Reasoning model of either provider family. */
export function isThinkingModel(model: string): boolean {
	return isReasoningModel(model) || isMistralReasoningModel(model);
}

/** The max-tokens the next send will actually use. */
export function effectiveMaxTokens(
	model: string,
	conversationMaxTokens: number | undefined,
	globalMaxTokens: number | undefined,
): number {
	return conversationMaxTokens ?? globalMaxTokens ?? resolveDefaultMaxTokens(model);
}

export function maxTokensAdvice(
	model: string,
	conversationMaxTokens: number | undefined,
	globalMaxTokens: number | undefined,
): MaxTokensAdvice | null {
	if (!isThinkingModel(model)) return null;
	const effective = effectiveMaxTokens(model, conversationMaxTokens, globalMaxTokens);
	const recommended = DEFAULT_MAX_TOKENS_REASONING;
	if (effective >= recommended) return null;
	const afterClear = globalMaxTokens ?? resolveDefaultMaxTokens(model);
	const kind = conversationMaxTokens !== undefined && afterClear >= recommended ? "clear" : "pin";
	return { kind, effective, recommended };
}

/** Upper bound for the raise-and-retry action. Doubling from the defaults
 *  reaches it after three rounds; beyond it a provider rejects the request as
 *  over its output cap, which then surfaces as an ordinary API error rather
 *  than another silent truncation. */
export const RETRY_MAX_TOKENS_CEILING = 65_536;

/** The limit to retry with after a truncated reply: double the cap the reply
 *  hit, never below the model's own default, never above the ceiling. */
export function raisedMaxTokens(model: string, effective: number): number {
	return Math.min(RETRY_MAX_TOKENS_CEILING, Math.max(effective * 2, resolveDefaultMaxTokens(model)));
}
