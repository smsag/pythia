import type { Provider } from "./types";
import type { PythiaSettings } from "./settings";

export interface ModelInfo {
	id: string;
	provider: Provider;
	abbreviation: string;
	noTemperature?: boolean;
	supportsEffort?: boolean;
	isReasoning?: boolean;
	isMistralReasoning?: boolean;
	hidden?: boolean;
}

export const MODEL_CATALOG: ModelInfo[] = [
	// Anthropic
	{ id: "claude-opus-5",     provider: "anthropic", abbreviation: "Opus 5",     noTemperature: true, supportsEffort: true },
	{ id: "claude-fable-5",    provider: "anthropic", abbreviation: "Fable 5",    noTemperature: true, supportsEffort: true },
	{ id: "claude-mythos-5",   provider: "anthropic", abbreviation: "Mythos 5",   noTemperature: true, supportsEffort: true, hidden: true },
	{ id: "claude-opus-4-8",   provider: "anthropic", abbreviation: "Opus 4.8",   noTemperature: true, supportsEffort: true },
	{ id: "claude-opus-4-7",   provider: "anthropic", abbreviation: "Opus 4.7",   noTemperature: true, supportsEffort: true },
	{ id: "claude-opus-4-6",   provider: "anthropic", abbreviation: "Opus 4.6",   supportsEffort: true },
	{ id: "claude-sonnet-5",   provider: "anthropic", abbreviation: "Sonnet 5",   noTemperature: true, supportsEffort: true },
	{ id: "claude-sonnet-4-6", provider: "anthropic", abbreviation: "Sonnet 4.6", supportsEffort: true },
	{ id: "claude-haiku-4-5",  provider: "anthropic", abbreviation: "Haiku 4.5" },

	// OpenAI
	{ id: "gpt-4.1",      provider: "openai", abbreviation: "GPT-4.1" },
	{ id: "gpt-4.1-mini", provider: "openai", abbreviation: "GPT-4.1 mini" },
	{ id: "gpt-4.1-nano", provider: "openai", abbreviation: "GPT-4.1 nano" },
	{ id: "gpt-4o",       provider: "openai", abbreviation: "GPT-4o" },
	{ id: "gpt-4o-mini",  provider: "openai", abbreviation: "GPT-4o mini" },
	{ id: "o3-pro",       provider: "openai", abbreviation: "o3 pro",  isReasoning: true },
	{ id: "o3",           provider: "openai", abbreviation: "o3",      isReasoning: true },
	{ id: "o3-mini",      provider: "openai", abbreviation: "o3 mini", isReasoning: true },
	{ id: "o4-mini",      provider: "openai", abbreviation: "o4 mini", isReasoning: true },

	// Mistral
	{ id: "mistral-large-latest",    provider: "mistral", abbreviation: "Mistral Large" },
	{ id: "mistral-small-latest",    provider: "mistral", abbreviation: "Mistral Small" },
	{ id: "codestral-latest",        provider: "mistral", abbreviation: "Codestral" },
	{ id: "magistral-medium-latest", provider: "mistral", abbreviation: "Magistral Medium", isMistralReasoning: true },
	{ id: "magistral-small-latest",  provider: "mistral", abbreviation: "Magistral Small",  isMistralReasoning: true },
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
