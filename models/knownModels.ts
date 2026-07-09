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
	anthropic: ["claude-fable-5", "claude-opus-4", "claude-sonnet-4-6", "claude-haiku-3-5"],
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

export const MODEL_ABBREVIATIONS: Record<string, string> = {
	"claude-opus-4":     "Opus 4",
	"claude-sonnet-4-6": "Sonnet 4.6",
	"claude-haiku-3-5":  "Haiku 3.5",
	"gpt-4o":            "GPT-4o",
	"gpt-4o-mini":       "GPT-4o mini",
	"o3":                "o3",
	"o3-mini":           "o3 mini",
	"o4-mini":           "o4 mini",
};
