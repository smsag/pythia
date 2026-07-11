import type { Provider } from "./types";

/**
 * Single source of truth for known model IDs per provider. Previously
 * duplicated independently across OpenAIProvider.ts (NO_SYSTEM_ROLE_MODELS),
 * ConversationSettingsModal.ts (MODELS_BY_PROVIDER), settings.ts
 * (ANTHROPIC_MODELS/OPENAI_MODELS), and sidebar.ts (MODEL_ABBREVIATIONS) —
 * that divergence is why o4-mini was listed as selectable everywhere but
 * missing from the one set that actually gates request shape, making every
 * o4-mini request fail.
 */
export const KNOWN_MODELS: Record<Provider, string[]> = {
	anthropic: ["claude-fable-5", "claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5"],
	openai: ["gpt-4o", "gpt-4o-mini", "o3", "o3-mini", "o4-mini"],
};

/**
 * OpenAI reasoning models (o-series). These reject a `system`-role message
 * (the system prompt must be injected as a leading user message instead),
 * reject a custom `temperature`, and reject `max_tokens` — they require
 * `max_completion_tokens` instead.
 */
export const REASONING_MODELS = new Set(["o1", "o1-mini", "o3", "o3-mini", "o4-mini"]);

export function isReasoningModel(model: string): boolean {
	return REASONING_MODELS.has(model);
}

/**
 * Anthropic models that reject the `temperature` parameter outright (Claude
 * Fable 5 / Mythos 5 and the Opus 4.7+ / Sonnet 5 generation dropped sampling
 * parameters from the API — sending `temperature` at all returns a 400,
 * regardless of value).
 */
export const ANTHROPIC_NO_TEMPERATURE_MODELS = new Set([
	"claude-fable-5",
	"claude-mythos-5",
	"claude-opus-4-8",
	"claude-opus-4-7",
	"claude-sonnet-5",
]);

export function supportsTemperature(model: string): boolean {
	return !ANTHROPIC_NO_TEMPERATURE_MODELS.has(model);
}

/**
 * Anthropic models that support the `output_config.effort` request parameter
 * (low/medium/high — the app-wide capped scale; some of these models also
 * accept xhigh/max, but we don't expose those). Allow-list, not a deny-list
 * like ANTHROPIC_NO_TEMPERATURE_MODELS — effort is newly-added-for-some
 * models rather than removed-for-some.
 */
export const ANTHROPIC_EFFORT_MODELS = new Set([
	"claude-fable-5",
	"claude-mythos-5",
	"claude-opus-4-8",
	"claude-opus-4-7",
	"claude-opus-4-6",
	"claude-sonnet-5",
	"claude-sonnet-4-6",
]);

export function supportsEffort(model: string): boolean {
	return ANTHROPIC_EFFORT_MODELS.has(model);
}

export const MODEL_ABBREVIATIONS: Record<string, string> = {
	"claude-fable-5":  "Fable 5",
	"claude-opus-4-8": "Opus 4.8",
	"claude-sonnet-5": "Sonnet 5",
	"claude-haiku-4-5": "Haiku 4.5",
	"gpt-4o":            "GPT-4o",
	"gpt-4o-mini":       "GPT-4o mini",
	"o3":                "o3",
	"o3-mini":           "o3 mini",
	"o4-mini":           "o4 mini",
};
