import type { Provider, EffortLevel, OutputLanguage } from "./types";

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
	/** Maximum conversations kept in data.json. Oldest non-starred are evicted.
	 *  0 = no limit — the settings field shows an EMPTY box for it (ADR-172), so
	 *  "no limit" is the absence of a number rather than a magic one. */
	maxConversations: number;
	/** Write a conversation to a vault note before the history limit deletes it
	 *  (ADR-172). On by default: the vault is the durable store, and an eviction
	 *  the user never asked for must not be the end of the content. */
	archiveBeforeEviction: boolean;
	/** Folder the archive notes are written to. */
	archiveFolder: string;
	/** When true, the currently active note is injected as context when starting from a template. */
	injectActiveNoteOnTemplate: boolean;
	/** Vault path for the inbox note used by the "Save to inbox" selection action. */
	inboxNote: string;
	/** Vault path of the single-note glossary written by builds up to 2.13.x.
	 *  Read-only since ADR-150 — the migration command's source. */
	glossaryNote: string;
	/** Root folder of the glossary (ADR-150): `Terms/`, `Themes/` live under it. */
	glossaryFolder: string;
	/** Language Pythia answers in — chat replies and every utility prompt
	 *  (titles, summaries, chapter names, glossary definitions).
	 *  "auto" = follow the conversation language, "obsidian" = follow Obsidian's
	 *  UI locale. Otherwise an ISO 639-1 locale code. See ADR-148. */
	outputLanguage: OutputLanguage;
	debugMode: boolean;
	/** Show the estimated USD cost on every assistant turn label and a total per
	 *  conversation in the history panel (ADR-163). */
	showCost: boolean;
	/** Vault path of the Pythia template used by the "New conversation from prompt" command. */
	promptOptimizerTemplateId: string;
	/** Prompt framework applied by the inline optimizer. */
	defaultPromptFramework: "none" | "CO-STAR" | "RACE" | "RISEN";
	/** The optimizer also rates the task and suggests the cheapest model of the
	 *  preferred provider that is deep enough — offered, never applied (ADR-181). */
	optimizerSuggestsModel: boolean;
	/** Default max-output-tokens sent to both providers. Undefined = use the model-aware default (services/promptConstants.ts). */
	maxTokens?: number;
	/** Default sampling temperature (0–1) sent to both providers. Undefined = use the API's own default. */
	temperature?: number;
	/** Default reasoning/output effort sent to models that support it. Undefined = use the API's own default. */
	effort?: EffortLevel;
	/** Warn when attached notes exceed this many estimated tokens. 0 = no limit. */
	maxAttachedNotesTokens: number;
	/** Free-text standing instructions appended to every chat system prompt (after
	 *  the conversation's own system prompt). Empty = none. */
	customInstructions: string;
	/** Default state of the per-conversation web-search "research" toggle for new conversations. */
	webSearchDefault: boolean;
	/** Auto-arm web search for a single send when the message looks time-sensitive,
	 *  even with the research toggle off (ADR-099). Requires a Tavily key. */
	webSearchAutoArm: boolean;
	/** Maximum web-search results fetched per query. 0 = use the built-in default. */
	webSearchMaxResults: number;
	/** When true, each chat turn draws the most relevant vault notes in as context,
	 *  found by Schreibstube's search by meaning (ADR-116, ADR-224). Off by default. */
	vaultContextEnabled: boolean;
	/** Maximum notes drawn in per turn when vault context is on. */
	vaultContextMaxNotes: number;
	/** Vault folders vault context may draw from. Empty = the whole vault (minus
	 *  Pythia's own conversations/scratch folders). */
	vaultContextFolders: string[];
}

export const DEFAULT_SETTINGS: PythiaSettings = {
	anthropicSecretName: "pythia-anthropic",
	openaiSecretName: "pythia-openai",
	mistralSecretName: "pythia-mistral",
	searchSecretName: "pythia-tavily",
	defaultProvider: "anthropic",
	defaultAnthropicModel: "claude-sonnet-5",
	defaultOpenAIModel: "gpt-5.4-mini",
	defaultMistralModel: "mistral-large-latest",
	templatesFolder: "Pythia/Templates",
	conversationsFolder: "Pythia/Conversations",
	scratchFolder: "Pythia/Scratch",
	defaultResumeMode: "full",
	maxMessagesPerSession: 100,
	maxConversations: 450,
	archiveBeforeEviction: true,
	archiveFolder: "Pythia/Archive",
	injectActiveNoteOnTemplate: false,
	inboxNote: "Pythia/Inbox.md",
	glossaryNote: "Pythia/Glossary.md",
	glossaryFolder: "Glossary",
	outputLanguage: "auto",
	debugMode: false,
	showCost: false,
	promptOptimizerTemplateId: "",
	defaultPromptFramework: "none",
	optimizerSuggestsModel: true,
	temperature: 0.7,
	effort: "high",
	maxAttachedNotesTokens: 8000,
	customInstructions: "",
	webSearchDefault: false,
	webSearchAutoArm: true,
	webSearchMaxResults: 5,
	vaultContextEnabled: false,
	vaultContextMaxNotes: 5,
	vaultContextFolders: [],
};
