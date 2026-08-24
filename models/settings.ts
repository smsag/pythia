import type { Provider, EffortLevel } from "./types";

export interface PythiaSettings {
	/** Secret ID referencing the Anthropic API key in Obsidian SecretStorage. */
	anthropicSecretName: string;
	/** Secret ID referencing the OpenAI API key in Obsidian SecretStorage. */
	openaiSecretName: string;
	/** Secret ID referencing the Mistral API key in Obsidian SecretStorage. */
	mistralSecretName: string;
	/** Secret ID referencing the Tavily web-search API key in Obsidian SecretStorage. */
	searchSecretName: string;
	/** Which provider to use when creating new conversations. */
	defaultProvider: Provider;
	/** Default Anthropic model (used when template does not specify one). */
	defaultAnthropicModel: string;
	/** Default OpenAI model (used when template does not specify one). */
	defaultOpenAIModel: string;
	/** Default Mistral model (used when template does not specify one). */
	defaultMistralModel: string;
	templatesFolder: string;
	conversationsFolder: string;
	scratchFolder: string;
	defaultResumeMode: "full" | "summary" | "hybrid";
	/** Soft cap on messages per conversation session. 0 = unlimited. */
	maxMessagesPerSession: number;
	/** Maximum conversations kept in data.json. Oldest non-starred are evicted. 0 = unlimited. */
	maxConversations: number;
	/** When true, the currently active note is injected as context when starting from a template. */
	injectActiveNoteOnTemplate: boolean;
	/** Vault path for the inbox note used by the "Save to inbox" selection action. */
	inboxNote: string;
	/** Language for AI-generated text (titles, summaries, chapter names).
	 *  "auto" = follow the conversation language. Otherwise an ISO 639-1 locale code. */
	outputLanguage: "auto" | "en" | "de";
	debugMode: boolean;
	/** Vault path of the Pythia template used by the "New conversation from prompt" command. */
	promptOptimizerTemplateId: string;
	/** Prompt framework applied by the inline optimizer. */
	defaultPromptFramework: "none" | "CO-STAR" | "RACE" | "RISEN";
	/** Default max-output-tokens sent to both providers. Undefined = use the model-aware default (services/promptConstants.ts). */
	maxTokens?: number;
	/** Default sampling temperature (0–1) sent to both providers. Undefined = use the API's own default. */
	temperature?: number;
	/** Default reasoning/output effort sent to models that support it. Undefined = use the API's own default. */
	effort?: EffortLevel;
	/** Warn when attached notes exceed this many estimated tokens. 0 = no limit. */
	maxAttachedNotesTokens: number;
	/** Default state of the per-conversation web-search "research" toggle for new conversations. */
	webSearchDefault: boolean;
	/** Maximum web-search results fetched per query. 0 = use the built-in default. */
	webSearchMaxResults: number;
}

export const DEFAULT_SETTINGS: PythiaSettings = {
	anthropicSecretName: "pythia-anthropic",
	openaiSecretName: "pythia-openai",
	mistralSecretName: "pythia-mistral",
	searchSecretName: "pythia-tavily",
	defaultProvider: "anthropic",
	defaultAnthropicModel: "claude-sonnet-5",
	defaultOpenAIModel: "gpt-4o",
	defaultMistralModel: "mistral-large-latest",
	templatesFolder: "Pythia/Templates",
	conversationsFolder: "Pythia/Conversations",
	scratchFolder: "Pythia/Scratch",
	defaultResumeMode: "full",
	maxMessagesPerSession: 100,
	maxConversations: 200,
	injectActiveNoteOnTemplate: false,
	inboxNote: "Pythia/Inbox.md",
	outputLanguage: "auto",
	debugMode: false,
	promptOptimizerTemplateId: "",
	defaultPromptFramework: "none",
	temperature: 0.7,
	effort: "high",
	maxAttachedNotesTokens: 8000,
	webSearchDefault: false,
	webSearchMaxResults: 5,
};
