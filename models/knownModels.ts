import type { Provider } from "./types";
import type { PythiaSettings } from "./settings";

export interface ModelInfo {
	id: string;
	provider: Provider;
	abbreviation: string;
	/** Context window size in tokens. Used for budget allocation. */
	contextWindow: number;
	noTemperature?: boolean;
	supportsEffort?: boolean;
	isReasoning?: boolean;
	isMistralReasoning?: boolean;
	hidden?: boolean;
}

/** Fallback context window for custom/unknown models (128K is a safe floor). */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

export const MODEL_CATALOG: ModelInfo[] = [
	// Anthropic — all current models: 1M tokens
	{ id: "claude-opus-5",     provider: "anthropic", abbreviation: "Opus 5",     contextWindow: 1_000_000, noTemperature: true, supportsEffort: true },
	{ id: "claude-fable-5",    provider: "anthropic", abbreviation: "Fable 5",    contextWindow: 1_000_000, noTemperature: true, supportsEffort: true },
	{ id: "claude-mythos-5",   provider: "anthropic", abbreviation: "Mythos 5",   contextWindow: 1_000_000, noTemperature: true, supportsEffort: true, hidden: true },
	{ id: "claude-opus-4-8",   provider: "anthropic", abbreviation: "Opus 4.8",   contextWindow: 1_000_000, noTemperature: true, supportsEffort: true },
	{ id: "claude-opus-4-7",   provider: "anthropic", abbreviation: "Opus 4.7",   contextWindow: 1_000_000, noTemperature: true, supportsEffort: true },
	{ id: "claude-opus-4-6",   provider: "anthropic", abbreviation: "Opus 4.6",   contextWindow: 1_000_000, supportsEffort: true },
	{ id: "claude-sonnet-5",   provider: "anthropic", abbreviation: "Sonnet 5",   contextWindow: 1_000_000, noTemperature: true, supportsEffort: true },
	{ id: "claude-sonnet-4-6", provider: "anthropic", abbreviation: "Sonnet 4.6", contextWindow: 1_000_000, supportsEffort: true },
	{ id: "claude-haiku-4-5",  provider: "anthropic", abbreviation: "Haiku 4.5",  contextWindow: 200_000 },

	// OpenAI
	{ id: "gpt-4.1",      provider: "openai", abbreviation: "GPT-4.1",      contextWindow: 1_000_000 },
	{ id: "gpt-4.1-mini", provider: "openai", abbreviation: "GPT-4.1 mini", contextWindow: 1_000_000 },
	{ id: "gpt-4.1-nano", provider: "openai", abbreviation: "GPT-4.1 nano", contextWindow: 1_000_000 },
	{ id: "gpt-4o",       provider: "openai", abbreviation: "GPT-4o",       contextWindow: 128_000 },
	{ id: "gpt-4o-mini",  provider: "openai", abbreviation: "GPT-4o mini",  contextWindow: 128_000 },
	{ id: "o3-pro",       provider: "openai", abbreviation: "o3 pro",       contextWindow: 200_000, isReasoning: true },
	{ id: "o3",           provider: "openai", abbreviation: "o3",           contextWindow: 200_000, isReasoning: true },
	{ id: "o3-mini",      provider: "openai", abbreviation: "o3 mini",      contextWindow: 200_000, isReasoning: true },
	{ id: "o4-mini",      provider: "openai", abbreviation: "o4 mini",      contextWindow: 200_000, isReasoning: true },

	// Mistral
	{ id: "mistral-large-latest",    provider: "mistral", abbreviation: "Mistral Large",     contextWindow: 128_000 },
	{ id: "mistral-small-latest",    provider: "mistral", abbreviation: "Mistral Small",     contextWindow: 128_000 },
	{ id: "codestral-latest",        provider: "mistral", abbreviation: "Codestral",         contextWindow: 256_000 },
	{ id: "magistral-medium-latest", provider: "mistral", abbreviation: "Magistral Medium",  contextWindow: 128_000, isMistralReasoning: true },
	{ id: "magistral-small-latest",  provider: "mistral", abbreviation: "Magistral Small",   contextWindow: 128_000, isMistralReasoning: true },
];

// ── Derived exports ───────────────────────────────────────────────────────
// Add a model to MODEL_CATALOG and all of these update automatically.

export const KNOWN_MODELS: Record<Provider, string[]> = MODEL_CATALOG
	.filter((m) => !m.hidden)
	.reduce(
		(acc, m) => { acc[m.provider].push(m.id); return acc; },
		{ anthropic: [], openai: [], mistral: [] } as Record<Provider, string[]>,
	);

export const MODEL_ABBREVIATIONS: Record<string, string> = Object.fromEntries(
	MODEL_CATALOG.map((m) => [m.id, m.abbreviation]),
);

const REASONING_SET = new Set(MODEL_CATALOG.filter((m) => m.isReasoning).map((m) => m.id));
export { REASONING_SET as REASONING_MODELS };

export function isReasoningModel(model: string): boolean {
	return REASONING_SET.has(model);
}

const NO_TEMPERATURE_SET = new Set(MODEL_CATALOG.filter((m) => m.noTemperature).map((m) => m.id));

export function supportsTemperature(model: string): boolean {
	return !NO_TEMPERATURE_SET.has(model);
}

const EFFORT_SET = new Set(MODEL_CATALOG.filter((m) => m.supportsEffort).map((m) => m.id));

export function supportsEffort(model: string): boolean {
	return EFFORT_SET.has(model);
}

const MISTRAL_REASONING_SET = new Set(MODEL_CATALOG.filter((m) => m.isMistralReasoning).map((m) => m.id));
export { MISTRAL_REASONING_SET as MISTRAL_REASONING_MODELS };

export function isMistralReasoningModel(model: string): boolean {
	return MISTRAL_REASONING_SET.has(model) || model.startsWith("magistral-");
}

const CONTEXT_WINDOW_MAP = new Map(MODEL_CATALOG.map((m) => [m.id, m.contextWindow]));

export function getContextWindow(model: string): number {
	return CONTEXT_WINDOW_MAP.get(model) ?? DEFAULT_CONTEXT_WINDOW;
}

export function resolveDefaultModelForProvider(provider: Provider, settings: PythiaSettings): string {
	switch (provider) {
		case "anthropic":
			return settings.defaultAnthropicModel;
		case "openai":
			return settings.defaultOpenAIModel;
		case "mistral":
			return settings.defaultMistralModel;
		default: {
			const exhaustiveCheck: never = provider;
			throw new Error(`Unknown provider: ${String(exhaustiveCheck)}`);
		}
	}
}
