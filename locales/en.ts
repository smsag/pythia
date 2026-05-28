const en = {
	// ── Sidebar header ────────────────────────────────────────────────────────
	noConversation:         "No conversation",
	changeModelTooltip:     "Change provider / model",
	deleteConvTooltip:      "Delete conversation",
	newConvTooltip:         "New conversation",
	templateLabel:          "Template: {{name}}",

	// ── Summary banner ────────────────────────────────────────────────────────
	summaryLabel:               "Summary",
	showMore:                   "Show more",
	showLess:                   "Show less",
	regenerateSummaryTooltip:   "Regenerate summary",

	// ── Fork banner ───────────────────────────────────────────────────────────
	forkedFromLabel:            "Forked from",
	forkSummaryGenerating:      "Generating fork summary…",
	forkSummaryFailed:          "Could not generate fork summary: {{error}}",

	// ── Context / favorites sections ─────────────────────────────────────────
	referenceSection: "Reference",
	favoritesSection: "Favorites",

	// ── Empty states ─────────────────────────────────────────────────────────
	noActiveConversationHint:  "No active conversation.",
	startFromPaletteHint:      'Use the command palette to start one (Ctrl/Cmd+P → "Pythia:").',
	startConversationBelow:    "Start the conversation below.",
	chaptersEmpty:             "No chapters yet",

	// ── Message bubbles ───────────────────────────────────────────────────────
	addToFavorites:     "Add to favorites",
	removeFromFavorites:"Remove from favorites",
	tokenCount:         "↑{{input}} ↓{{output}}",
	tokenCountTitle:    "Input: {{input}} tokens · Output: {{output}} tokens",

	// ── Tool call chips ───────────────────────────────────────────────────────
	creatingNote: "Creating note: {{path}}",
	createdNote:  "✓ Created [[{{name}}]]",

	// ── Selection toolbar ─────────────────────────────────────────────────────
	copyBtn:     "Copy",
	insertBtn:   "Insert into note",
	inboxBtn:    "Save to inbox",
	forkBtn:     "Fork",

	// ── Input toolbar ─────────────────────────────────────────────────────────
	inputPlaceholder:    "Type a message… (Enter to send, Shift+Enter for new line)",
	sendBtn:             "Send",
	stopBtn:             "Stop",
	attachNoteTooltip:   "Attach note",
	saveResponseTooltip: "Save response",
	summarizeTooltip:    "Summarize conversation",
	showChaptersTooltip: "Show chapters",

	// ── Notices ───────────────────────────────────────────────────────────────
	copied:                    "Copied",
	copyFailed:                "Copy failed",
	noActiveNoteToInsert:      "No active note to insert into.",
	insertedIntoNote:          "Inserted into note",
	savedToInbox:              "Saved to inbox",
	failedSaveToInbox:         "Failed to save to inbox: {{error}}",
	noMessagesToSave:          "No messages to save.",
	nothingNewToSave:          "Nothing new to save since last save.",
	savedToPath:               "Saved to {{path}}",
	saveFailed:                "Save failed: {{error}}",
	noActiveConvToSend:        "No active conversation. Start one from the command palette.",
	messageLimitReached:       "Message limit reached ({{cap}}). Start a new conversation or raise the limit in Settings → Pythia.",
	noMessagesToSummarize:     "No messages to summarize.",
	generatingSummary:         "Generating summary…",
	summaryFailed:             "Summary failed: {{error}}",
	fileNotFound:              "File not found: {{path}}",

	// ── API error notices (sendMessage) ────────────────────────────────────────
	modelNotFound:  "Model \"{{model}}\" not found. Open settings to change it.",
	apiKeyRejected: "API key rejected. Check Settings → Pythia.",
	rateLimitHit:   "Rate limit hit. Try again in a moment.",
	networkError:   "Network error. Check your internet connection.",

	// ── Save conversation modal ───────────────────────────────────────────────
	saveConvTitle:  "Save conversation to note",
	filePathLabel:  "File path",

	// ── Main / commands ───────────────────────────────────────────────────────
	sendToPythia:           "Send to Pythia",
	chatAboutNote:          "Chat about this note",
	chatAboutFolder:        "Chat about this folder",
	noMarkdownInFolder:     "No markdown files found in this folder.",
	summaryGenerationFailed:"Summary generation failed: {{error}}",
	noActiveNoteForCommand: "No active note. Open a note first.",
	clipboardReadFailed:    "Could not read clipboard. Grant clipboard access and try again.",
	clipboardEmpty:         "Clipboard is empty.",
	noConversations:        "No conversations found.",
	noFavorites:            "No favorites found.",
	noPastConversations:    "No past conversations found.",
	setApiKeyFirst:         "Set your API key in Settings → Pythia before generating a summary.",
	generatingConvSummary:  "Generating conversation summary…",
	conversationDeleted:    "Conversation deleted.",
	attachedAsContext:      "Attached \"{{name}}\" as context.",
	noTemplatesFound:       "No templates found in \"{{folder}}\". Create a note with `pythia_template: true` in its frontmatter.",
	loadedTemplate:         "Loaded template \"{{name}}\" with {{count}} context note(s).",
	deepLinkError:          "Pythia deep link error: {{error}}",
	uriMissingId:           "Pythia URI: missing 'id' parameter.",
	uriMissingName:         "Pythia URI: missing 'name' parameter.",
	convNotFound:           "Pythia: conversation \"{{id}}\" not found.",
	templateNotFound:       "Pythia: template \"{{name}}\" not found.",
	unknownAction:          "Pythia: unknown action \"{{action}}\".",
	migrateAnthropicFailed: "Could not migrate your Anthropic API key. Please re-enter it in Settings → Pythia.",
	migrateOpenAIFailed:    "Could not migrate your OpenAI API key. Please re-enter it in Settings → Pythia.",

	// ── Services ──────────────────────────────────────────────────────────────
	anthropicKeyNotConfigured: "Anthropic API key not configured. Set it in Settings → Pythia.",
	openaiKeyNotConfigured:    "OpenAI API key not configured. Set it in Settings → Pythia.",
	contextNotesWarning:       "Warning: {{count}} context note(s) not found and were skipped.",

	// ── Settings ─────────────────────────────────────────────────────────────
	settingsTitle:           "Pythia",
	anthropicSection:        "Anthropic",
	openaiSection:           "OpenAI",
	defaultsSection:         "Defaults",
	vaultFoldersSection:     "Vault folders",
	behaviourSection:        "Behaviour",
	featuresSection:         "Features",
	anthropicKeyName:        "Anthropic API key",
	anthropicKeyDesc:        "Select a secret from Obsidian's secret storage. Keys are never written to data.json.",
	defaultAnthropicModel:   "Default Anthropic model",
	defaultAnthropicModelDesc:"Used when a template does not specify a model.",
	openaiKeyName:           "OpenAI API key",
	openaiKeyDesc:           "Select a secret from Obsidian's secret storage. Keys are never written to data.json.",
	defaultOpenAIModel:      "Default OpenAI model",
	defaultOpenAIModelDesc:  "Used when a template does not specify a model.",
	defaultProviderName:     "Default provider",
	defaultProviderDesc:     "Provider used when creating new conversations without a template.",
	templatesFolderName:     "Templates folder",
	templatesFolderDesc:     "Vault folder scanned for pythia_template notes.",
	convsFolderName:         "Conversations folder",
	convsFolderDesc:         "Where conversation summary notes are saved.",
	scratchFolderName:       "Scratch folder",
	scratchFolderDesc:       "Where ad-hoc conversation notes are saved.",
	inboxNoteName:           "Inbox note",
	inboxNoteDesc:           "Note that receives timestamped entries from the 'Save to inbox' selection action.",
	autoSaveName:            "Auto-save summary on close",
	autoSaveDesc:            "Generate and save a summary note when a conversation is closed.",
	resumeModeName:          "Default resume mode",
	resumeModeDesc:          "How conversations are resumed unless overridden per-conversation.",
	resumeModeSummaryOpt:    "Summary — lower token cost",
	resumeModeFullOpt:       "Full history — higher fidelity",
	messageCapName:          "Message cap per session",
	messageCapDesc:          "Maximum messages per conversation before further sends are blocked. Set to 0 for unlimited.",
	debugModeName:           "Debug mode",
	debugModeDesc:           "Log API calls and payloads to the developer console.",
	enableNoteCreationName:  "Allow AI to create notes",
	enableNoteCreationDesc:  "Pass a create_note tool to the AI so it can write vault notes on request. When enabled, you can ask Pythia to create a note in plain language.",
	chooseFolderBtn:         "Choose folder",
	customModelOption:       "Custom…",
	providerAnthropic:       "Anthropic",
	providerOpenAI:          "OpenAI",

	// ── Suggest modals ────────────────────────────────────────────────────────
	searchConversations: "Search conversations…",
	searchFavorites:     "Search favorites…",
	searchFolders:       "Search vault folders…",
	searchNotes:         "Search vault notes…",
	searchTemplates:     "Search templates…",
	instrNavigate:       "to navigate",
	instrOpen:           "to open",
	instrDismiss:        "to dismiss",
	instrSelect:         "to select",
	instrAttach:         "to attach",
	instrUseTemplate:    "to use template",

	// ── Delete file modal ─────────────────────────────────────────────────────
	deleteFileTitle:   "Delete file",
	deleteFileConfirm: "Delete \"{{name}}\" from the vault? This cannot be undone.",
	deleteBtn:         "Delete",
	cancelBtn:         "Cancel",

	// ── Delete conversation modal ─────────────────────────────────────────────
	deleteConvTitle:   "Delete conversation",
	deleteConvConfirm: "Delete \"{{name}}\"? This cannot be undone.",

	// ── Resume mode modal ─────────────────────────────────────────────────────
	resumeConvTitle:   "Resume conversation",
	resumeConvDesc:    "How would you like to resume \"{{name}}\"?",
	summaryModeBtn:    "Summary",
	summaryModeTitle:  "Send an AI-generated summary as context — lower token cost",
	fullModeBtn:       "Full history",
	fullModeTitle:     "Re-send all previous messages — higher fidelity, higher token cost",
	resumeHint:        "Summary is recommended for long conversations. Full history preserves all nuance.",

	// ── Conversation settings modal ────────────────────────────────────────────
	convSettingsTitle: "Conversation settings",
	providerLabel:     "Provider",
	modelLabel:        "Model",
	saveBtn:           "Save",
	okBtn:             "OK",
};

export type Strings = typeof en;
export default en;
