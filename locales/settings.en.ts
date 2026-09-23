/**
 * The settings tab's strings, split out of `en.ts` the way the embedding strings
 * were (ADR-199, review #301): both locale files sat just under the file-size
 * ceiling, and ADR-206's section intros are the strings that would have broken it.
 *
 * Section names and intros come first, in the order the tab renders them. Every
 * section has an intro naming its remit, because the embedding block's intro was
 * the only thing in the tab that said what a group of rows was FOR (ADR-206).
 */
const settingsEn = {
	// ── Sections, in render order (ADR-206) ───────────────────────────────────
	connectionsSection:      "Connections",
	connectionsIntro:        "Which services Pythia can reach. Keys live in Obsidian's secret storage and are never written to data.json.",
	newConvSection:          "New conversations",
	newConvIntro:            "What a new conversation starts with. Every setting in this section can be changed for one conversation from the header or its settings dialog — doing that never changes the value here.",
	answeringSection:        "While answering",
	answeringIntro:          "Rules that apply to every answer in every conversation. Unlike the section above, these cannot be set per conversation.",
	promptOptimizerIntro:    "The ✦ optimizer rewrites a prompt before you send it, and can rate how demanding the task is.",
	notesSection:            "Notes Pythia writes",
	notesIntro:              "Where the notes you go on to read and edit yourself are kept. Each folder sits with the feature that writes to it, so the vault index and the conversation archive have their own further down.",
	glossarySection:         "Glossary",
	glossaryIntro:           "Terms and people you look up with Define are kept as one note each, so Obsidian Bases and Dataview can browse them.",
	storageSection:          "History and storage",
	storageIntro:            "How many conversations Pythia keeps, where their notes go, and what that costs. Pythia rewrites its whole storage file after every message, so the size below matters more than the count.",
	troubleshootingSection:  "Troubleshooting",
	troubleshootingIntro:    "For when something is not working. Anything about vault context is answered by the index status row above first.",

	// ── Shared row copy ───────────────────────────────────────────────────────
	overridablePerConv:      "Conversations follow this unless you pin a different value.",
	apiKeyDesc:              "Select a secret from Obsidian's secret storage. Keys are never written to data.json.",
	connectionKeySet:        "A key is selected.",
	connectionKeyMissing:    "No key yet — Pythia cannot use this provider.",
	connectionSearchMissing: "No key yet — web search stays off.",

	// ── Connections ───────────────────────────────────────────────────────────
	anthropicKeyName:        "Anthropic API key",
	openaiKeyName:           "OpenAI API key",
	mistralKeyName:          "Mistral API key",
	searchKeyName:           "Tavily API key",
	searchKeyDesc:           "Select a secret from Obsidian's secret storage. Enables the web_search tool so models can look up current information. Keys are never written to data.json.",

	// ── New conversations ─────────────────────────────────────────────────────
	defaultProviderName:     "Provider",
	defaultProviderDesc:     "Provider new conversations use when no template names one.",
	defaultModelName:        "Model",
	defaultModelDesc:        "Model new {{provider}} conversations use when no template names one. Switch the provider above to set another provider's model.",
	customModelOption:       "Custom…",
	providerAnthropic:       "Anthropic",
	providerOpenAI:          "OpenAI",
	providerMistral:         "Mistral",
	effortName:              "Effort",
	effortDesc:              "Reasoning/output effort sent to models that support it. Leave unset to use the model's own default.",
	effortUnsetOption:       "(unset — use model default)",
	effortLevelLow:          "Low",
	effortLevelMedium:       "Medium",
	effortLevelHigh:         "High",
	effortSegmentDefault:    "Default",
	effortSegmentDefaultWith: "Default · {{v}}",
	temperatureName:         "Temperature",
	temperatureDesc:         "Sampling temperature (0–1). Lower is more focused and deterministic, higher more varied. Leave blank to use the model's own default.",
	maxTokensName:           "Max tokens per reply",
	maxTokensDesc:           "Maximum tokens the model may generate per reply. A reasoning model spends part of this same budget on hidden reasoning before writing anything visible, so too low a value risks a truncated or empty reply. Leave blank to use the model-aware default.",
	paramValueDefault:       "{{v}} · default",
	paramInvalidNumber:      "whole number ≥ 1",
	paramUnsupportedSuffix:  "(not supported by the selected model)",
	outputLanguageName:      "Answer language",
	outputLanguageDesc:      "Language Pythia answers in — chat replies and generated text alike (titles, summaries, chapter names, definitions).",
	outputLanguageObsidian:  "Obsidian language",
	outputLanguageAuto:      "Conversation language",
	outputLanguageGerman:    "German",
	outputLanguageEnglish:   "English",
	outputLanguageItalian:   "Italian",
	outputLanguageSpanish:   "Spanish",
	convLanguageLabel:       "Language",
	convLanguageDesc:        "Language of the answers and of everything generated for this conversation — title, summary and term definitions included. \"Language of the conversation\" answers in whatever language you write in. Default follows the plugin setting. Answers already written are not translated.",
	convLanguageDefault:     "Default ({{v}})",
	resumeModeName:          "Resume mode",
	resumeModeDesc:          "How much of a conversation is sent back to the model when you continue it.",
	resumeModeSummaryOpt:    "Summary — lower token cost",
	resumeModeHybridOpt:     "Hybrid — summary + recent messages",
	resumeModeFullOpt:       "Full history — higher fidelity",
	webSearchDefaultName:    "Research mode on",
	webSearchDefaultDesc:    "Start new conversations with web search allowed. The globe in the input toolbar toggles it per conversation.",

	// ── While answering ───────────────────────────────────────────────────────
	customInstructionsName:  "Custom instructions",
	customInstructionsDesc:  "Standing instructions added to every conversation, on top of its own system prompt — e.g. tone, formatting, or things to always avoid. Applies to conversations you have already started too; leave blank for none.",
	customInstructionsPlaceholder: "e.g. Answer concisely. Prefer bullet points. Always respond in British English.",
	webSearchAutoArmName:    "Auto-search on time-sensitive questions",
	webSearchAutoArmDesc:    "When research mode is off, allow a web search for a single message if it looks time-sensitive (latest, current, prices, news, a recent year…). Requires a Tavily key. The globe pulses when this fires.",
	webSearchMaxResultsName: "Web search results per query",
	webSearchMaxResultsDesc: "How many results to fetch for each search. Fewer results use fewer tokens. Leave at 0 to use the default (5).",
	maxAttachedNotesTokensName: "Attached notes token warning",
	maxAttachedNotesTokensDesc: "Warn when attached notes exceed this many estimated tokens before sending. Set to 0 to disable the warning.",
	attachedNotesTokenWarning: "Attached notes are large (~{{tokens}} tokens) — this may push out room for the conversation itself or bury your question.",
	injectActiveNoteOnTemplateName: "Inject active note when using a template",
	injectActiveNoteOnTemplateDesc: "When starting a conversation from a template, automatically include the currently open note as additional context (e.g. the job ad, brief, or article you want to work on).",

	// ── Notes Pythia writes ───────────────────────────────────────────────────
	templatesFolderName:     "Templates folder",
	templatesFolderDesc:     "Vault folder scanned for pythia_template notes.",
	scratchFolderName:       "Default notes folder",
	scratchFolderDesc:       "Default vault folder for notes Pythia creates via create_note. Templates can override this per conversation.",
	inboxNoteName:           "Inbox note",
	inboxNoteDesc:           "Note that receives timestamped entries from the 'Save to inbox' selection action.",
	chooseFolderBtn:         "Choose folder",

	// ── History and storage ───────────────────────────────────────────────────
	convsFolderName:         "Conversations folder",
	convsFolderDesc:         "Where conversation summary notes are saved. Never indexed for vault context.",
	messageCapName:          "Message cap per session",
	messageCapDesc:          "Maximum messages per conversation before further sends are blocked. Leave empty for no limit.",
	maxConversationsName:    "Conversation history limit",
	maxConversationsDesc:    "Maximum conversations kept in storage. Leave empty for no limit. When the limit is reached the oldest are removed — kept are conversations with a starred passage, the one open in a Pythia panel, and any a merge link points at. With \"Archive before deleting\" on they are written to a note first; without it they are deleted permanently. Lowering this asks first.",
	noLimitPlaceholder:      "no limit",
	archiveBeforeEvictionName: "Archive before deleting",
	archiveBeforeEvictionDesc: "When the history limit removes a conversation, write it to a note in the vault first. A conversation whose note cannot be written is kept rather than deleted.",
	archiveFolderName:       "Archive folder",
	archiveFolderDesc:       "Where archived conversations are written. One note per conversation, with the full transcript.",
	storageSizeLine:         "Storage: {{size}} in data.json, {{count}} conversation(s).",
	storageWarnLine:         "Storage: {{size}} in data.json, {{count}} conversation(s). Pythia rewrites this whole file after every message, and sync moves all of it — lower the limit, or archive conversations you no longer need.",
	storageHighNotice:       "[Pythia] data.json has grown to {{size}} ({{count}} conversations). Every message rewrites the whole file — lower the history limit or archive older conversations.",
	showMoreRows:            "Show more ({{count}} left)",
	archiveConvBtn:          "Archive",
	archiveConvHint:         "Archive writes the whole conversation to a note in {{folder}}, then removes it here.",
	archivedOneNotice:       "[Pythia] Archived to {{path}}",
	archiveOneFailedNotice:  "[Pythia] Could not archive \"{{name}}\", so it was not deleted. See the console for the reason.",
	archivedNotice:          "[Pythia] Archived {{count}} conversation(s) to {{folder}} and removed them from storage (history limit).",
	evictedNotice:           "[Pythia] Removed {{count}} conversation(s) — the history limit was reached. Turn on \"Archive before deleting\" to keep a note of them.",
	archiveFailedNotice:     "[Pythia] Could not archive {{count}} conversation(s), so they were kept. See the console for the reason.",
	capConfirmTitle:         "Delete conversations?",
	capConfirmTitleArchive:  "Archive and remove conversations?",
	capConfirmBody:          "A limit of {{cap}} deletes {{count}} conversation(s) from storage. This cannot be undone.",
	capConfirmBodyArchive:   "A limit of {{cap}} removes {{count}} conversation(s) from storage. Each is written to a note in {{folder}} first.",
	capConfirmArchiveBtn:    "Archive {{count}}",
	capConfirmKept:          "Kept: conversations with a starred passage, the one open in a Pythia panel, and any a merge link points at.",
	capConfirmRemove:        "Delete {{count}}",

	// ── Troubleshooting ───────────────────────────────────────────────────────
	debugModeName:           "Debug mode",
	debugModeDesc:           "Log API calls, payloads, and the embedding path to the developer console. The console is where a bug report's evidence comes from.",
};

export default settingsEn;
