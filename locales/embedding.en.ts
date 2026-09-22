// On-device embeddings: the model, related conversations, vault context and its
// index (ADR-199). The first feature area split out of `en.ts`, as engineering-
// review #301 proposed — merged into the table by `en.ts`, so `t()` and the
// `Strings` type are unchanged. `embedding.de.ts` must name the same keys.

const embeddingEn = {
	// ── The section and what it does ─────────────────────────────────────────
	embeddingSectionName:      "On-device semantic search",
	embeddingIntro:            "Pythia can show conversations related to the one you're in, and add relevant notes to a message on its own. Both use a small language model that runs on this device: it turns text into numbers so that similar meanings end up close together. Your notes are indexed locally and are not sent anywhere for this. The model downloads once, on first use.",
	embeddingModelName:        "Model",
	embeddingModelDesc:        "Multilingual (≈ {{multiMb}} MB) matches meaning across languages — a German question finds an English note. English (≈ {{enMb}} MB) is smaller and faster, and understands other languages only through shared words. Used for related conversations and vault context; changing it builds a new index.",
	embeddingModelMobileNote:  "On this device Pythia uses {{model}}: {{chosen}} needs more memory than a phone or tablet allows, and loading it made Obsidian reload. Your choice still applies on desktop.",
	embeddingModelDesktopNote: "Phones and tablets use {{model}} instead — {{chosen}} needs more memory than they allow.",
	embeddingModelLatinNote: "It gives the same results as Multilingual for every language written in Latin letters (German, English, Italian, Spanish, French, …) and shares the desktop's index; notes in Cyrillic, Greek or Asian scripts match only roughly on the phone.",
	relatedFirstRun:           "Preparing the semantic model — the first run downloads it, which can take a minute.",
	relatedSimilarityName:     "Related conversations — how close a match counts",
	relatedSimilarityDesc:     "How similar a conversation must be to appear under \"Show similar\". Strict shows only very close matches; Loose includes weaker ones.",
	relatedSimilarityStrict:   "Strict (fewer, closer)",
	relatedSimilarityBalanced: "Balanced",
	relatedSimilarityLoose:    "Loose (more, looser)",

	// ── Vault context ─────────────────────────────────────────────────────────
	vaultContextSectionName:      "Vault context (semantic RAG)",
	vaultContextIntro:            "With vault context on, each message you send is compared against an index of your notes, and the closest matches are added to the prompt so the answer can draw on them. The index builds in the background the first time it's needed and then follows your edits. A note with pythia: false in its properties is never indexed.",
	vaultContextEnabledName:      "Enable by default",
	vaultContextEnabledDesc:      "Auto-retrieve relevant vault notes into new conversations. Also toggle per conversation from the input toolbar (library icon).",
	vaultContextFoldersName:      "Folders to index",
	vaultContextFoldersDesc:      "One folder path per line to scope the semantic index (leave empty to index the whole vault). Fewer folders = faster indexing on large vaults.",
	vaultContextMaxNotesName:     "Max notes to index",
	vaultContextMaxNotesDesc:     "Upper bound on how many notes are indexed (0 = unlimited). Guards very large vaults from a slow, memory-heavy index — prefer scoping to folders above.",
	vaultContextNotesPerTurnName: "Notes per answer",
	vaultContextNotesPerTurnDesc: "How many relevant notes are added to a message as context. More notes cost more tokens and can bury your actual question.",

	// ── The index: notices while it builds ────────────────────────────────────
	vaultIndexBuilding:     "Building the vault index in the background — answers will start using it once it's ready.",
	vaultIndexProgress:     "Indexing vault for Pythia… {{done}}/{{total}}",
	vaultIndexBusy:         "The vault index is already building — please wait for it to finish.",
	vaultIndexCapped:       "Vault is large: indexing {{indexed}} of {{total}} notes. Scope to folders in Settings, or raise the cap.",
	vaultIndexThrottled:    "This device runs the embedding model on the UI thread (no background worker available), so indexing is throttled to keep the app responsive — it may take a while. It runs once; edits update incrementally.",
	vaultIndexPausedNotice: "Pythia paused the vault index: its last builds ended without finishing, which happens when the app closes or runs out of memory mid-build. Answers work without it. To try again: Settings → Vault context → Build now.",

	// ── The index: the status line in settings ────────────────────────────────
	vaultIndexStatusName:        "Index status",
	vaultIndexStateNotBuilt:     "Not built yet. It builds in the background the first time you send a message with vault context on — or press Build now.",
	vaultIndexStateLoading:      "Loading the model… The first time, it downloads (≈ {{mb}} MB), which can take a minute on a phone.",
	vaultIndexStateBuilding:     "Building… {{done}} of {{total}} notes. Keep working — answers start using the index once it's ready.",
	vaultIndexStateReady:        "Ready — {{count}} notes indexed. Edits are picked up as you make them.",
	vaultIndexStatePartial:      "Unfinished — {{count}} notes indexed so far. The build continues the next time it's needed, or press Build now.",
	vaultIndexStateOutdated:     "Out of date — the folders or the note limit changed since it was built. The next build adds the notes that are new and drops the ones now out of scope; notes already indexed are kept, not embedded again. It runs the next time it's needed, or press Build now.",
	vaultIndexStateFailed:       "The last build failed: {{error}}",
	vaultIndexStateOutOfMemory:  "Stopped — this device ran out of memory while loading the model. This usually happens after Pythia was updated or reloaded inside the running app, which on iOS keeps the old model's memory. Close Obsidian completely (swipe it away), open it again, then press Build now.",
	vaultIndexStatePaused:       "Paused — the last {{count}} builds ended without finishing. That happens when the app is closed mid-build or the device runs out of memory, so Pythia won't load the model on its own — vault context stays off until you press Build now. What is indexed so far is kept.",
	vaultIndexDetailModel:       "Model: {{model}}",
	vaultIndexDetailModelMobile: "Model: {{model}} (mobile)",
	vaultIndexBackend:           "Engine: {{backend}}",
	vaultIndexDetailOff:         "Vault context is off by default — turn it on above, or per conversation with the library icon",
	vaultIndexBuildNow:          "Build now",
	vaultIndexBuildNowTooltip:   "Finish or update the index, keeping what is already indexed",
	vaultContextReindexBtn:      "Rebuild index",
	vaultIndexRebuildTooltip:    "Discard the index and embed every note again",
};

export default embeddingEn;
