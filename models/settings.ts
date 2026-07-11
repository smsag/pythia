import type { Provider } from "./types";

export interface PythiaSettings {
	/** Secret ID referencing the Anthropic API key in Obsidian SecretStorage. */
	anthropicSecretName: string;
	/** Secret ID referencing the OpenAI API key in Obsidian SecretStorage. */
	openaiSecretName: string;
	/** Which provider to use when creating new conversations. */
	defaultProvider: Provider;
	/** Default Anthropic model (used when template does not specify one). */
	defaultAnthropicModel: string;
	/** Default OpenAI model (used when template does not specify one). */
	defaultOpenAIModel: string;
	templatesFolder: string;
	conversationsFolder: string;
	scratchFolder: string;
	autoSaveSummary: boolean;
	defaultResumeMode: "full" | "summary";
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
	/** Default sampling temperature (0–1) sent to both providers. Undefined = use the API's own default. */
	temperature?: number;
	/** Warn when attached notes exceed this many estimated tokens. 0 = no limit. */
	maxAttachedNotesTokens: number;
}

export const DEFAULT_SETTINGS: PythiaSettings = {
	anthropicSecretName: "pythia-anthropic",
	openaiSecretName: "pythia-openai",
	defaultProvider: "anthropic",
	defaultAnthropicModel: "claude-sonnet-5",
	defaultOpenAIModel: "gpt-4o",
	templatesFolder: "Pythia/Templates",
	conversationsFolder: "Pythia/Conversations",
	scratchFolder: "Pythia/Scratch",
	autoSaveSummary: true,
	defaultResumeMode: "full",
	maxMessagesPerSession: 100,
	maxConversations: 200,
	injectActiveNoteOnTemplate: false,
	inboxNote: "Pythia/Inbox.md",
	outputLanguage: "auto",
	debugMode: false,
	promptOptimizerTemplateId: "",
	defaultPromptFramework: "none",
	maxAttachedNotesTokens: 8000,
};
