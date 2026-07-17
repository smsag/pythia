# Pythia — Architecture

*Last updated: 2026-07-17 — `maxTokens` brought to the same three-level override layering (`conversation.maxTokens ?? settings.maxTokens ?? resolveDefaultMaxTokens(model)`) and UI treatment `temperature`/`effort` already had: new global setting (`settings.ts`, Behaviour section) and per-conversation field (`ConversationSettingsModal.ts`, constructor gained `defaultMaxTokens?`), both text inputs since a token count fits neither a slider nor a dropdown. `DEFAULT_MAX_TOKENS` raised from 4096 to 8192; new `DEFAULT_MAX_TOKENS_REASONING = 16384` for OpenAI reasoning models via the existing `isReasoningModel()` check (reasoning tokens share the same budget as visible output, so a low cap risks a silently truncated reply). Deliberately no `setDisabled()` gating for `maxTokens` — every model accepts some form of output cap, only the request field name varies. See ADR-044. Also, note-chunk/`#`-suggestion relevance scoring (`services/noteRelevance.ts`) is now IDF-weighted instead of flat keyword-overlap counting: a shared-by-everyone token like "user" barely moves a candidate's score, while a token unique to one candidate dominates it. Fixes a real bug where a long, multi-section reference doc got excerpted down to the wrong section because several unrelated sections shared enough generic vocabulary with the query to out-rank the one section holding the actual distinctive term. The single-haystack `scoreRelevance`/`scoreRelevanceTokens` functions were replaced (not kept alongside) by batch equivalents (`scoreRelevanceWeighted`/`scoreRelevanceTokensWeighted`) since IDF requires the full candidate set up front to compute document frequency; both consumers (`noteChunking.ts`, `ui/InlineSuggest.ts`) migrated to the batch form. See ADR-043. Also, fork now awaits and carries the source conversation's summary over as context before opening (`cmdForkConversation` resolves `summaryText` synchronously, `generateSummary()` behind a loading Notice when uncached, no more fire-and-forget post-hoc update); the forked conversation's input box is no longer pre-filled with the text that triggered the fork; removed the now-dead `PythiaSidebarView.renderForkBanner()` wrapper (the private `renderForkBannerEl()` already renders on the fork's first paint via the normal message-rebuild path). See ADR-042. Also added PDF attachments as native document/file content blocks (Anthropic `DocumentBlockParam`, OpenAI `ChatCompletionContentPart.File`), dispatched by extension with no new persisted types; new `ContextBuilder.buildAttachedPdfs`, `messageUtils.arrayBufferToBase64` (Buffer-free for mobile), and a hardcoded 20 MB size guard (`MAX_PDF_FILE_SIZE_BYTES`) that skips oversized PDFs with a Notice rather than sending and failing mid-stream; `BaseProvider.resolveUserContent` now splits attachments by extension and each provider splices PDF blocks onto the last user message post-`normalizeMessages`; UI file pickers (`NoteSuggestModal`, `ui/InlineSuggest.ts`, `utils.ts`'s `getFilesInFolder`) widened to include `.pdf`, `suggest/FileSuggest.ts`'s base class deliberately left markdown-only. See ADR-041. Also added `effort` as a first-class parameter (global setting, template frontmatter, per-conversation override) alongside `temperature`, mapped to Anthropic's `output_config.effort` and OpenAI's `reasoning_effort`; both the global settings tab and the conversation settings modal now reactively disable (`Setting.setDisabled()`) the temperature/effort controls when the selected provider+model doesn't support them, closing the gap where the backend silently dropped unsupported values but the UI still showed the control as active. See ADR-040. Also fixed live 400s from the model catalog refresh: `claude-fable-5`/`claude-opus-4-8`/`claude-sonnet-5` reject the `temperature` parameter outright, but `AnthropicService.streamMessage` was still sending it whenever a conversation or global default temperature was set. Added `models/knownModels.ts`'s `supportsTemperature()` (mirrors the existing `isReasoningModel()` pattern) and gated `temperature` on it; refreshed the Anthropic model catalog in `models/knownModels.ts` (retired `claude-opus-4`/`claude-haiku-3-5` IDs swapped for `claude-opus-4-8`/`claude-haiku-4-5`, `claude-sonnet-4-6` bumped to `claude-sonnet-5`; `AnthropicService.fastModel` and `defaultAnthropicModel` updated to match); second-round bug-fix pass: second delete-guard gap closed, resume-mode/eviction/frontmatter/deep-link races fixed, eviction now protects every open sidebar leaf; bug-fix/reliability/observability/maintainability/performance pass: `models/knownModels.ts` (reasoning-model + model-list centralization), additive token/cache accounting, abort-signal capture, retry/tool-loop bounds, single-active-stream enforcement, `debugLog` convention, BaseProvider extraction extended; prompt-tag/marker centralization (`services/promptConstants.ts`); response-quality pass: resumeMode fix, retry/backoff, Anthropic prompt caching, temperature, attached-notes token guard + chunking, relevance-ranked note suggestions.*

---

## What Pythia is

An Obsidian sidebar plugin providing a streaming LLM chat interface tightly integrated with the vault. Conversations are first-class vault objects — stored, resumable, forkable, and cross-device via Obsidian Sync or iCloud. Supports Anthropic and OpenAI providers.

---

## File inventory

| File | Lines | Role |
|---|---:|---|
| `sidebar.ts` | 2 357 | `PythiaSidebarView` — all UI, rendering, streaming, interaction |
| `styles.css` | 1 456 | All plugin CSS (no framework, no CSS-in-JS) |
| `main.ts` | 930 | Plugin entry, commands, conversation lifecycle, data.json watcher |
| `settings.ts` | 460 | Settings schema, defaults, settings tab UI (incl. temperature/effort reactive availability gating) |
| `utils.ts` | 20 | Root-level pure helpers: `getFilesInFolder` (md + pdf), `todayISO` |
| `services/OpenAIProvider.ts` | 317 | OpenAI streaming (extends BaseProvider); retry, temperature/`reasoning_effort`, PDF file-block splice, resumeMode gating, bounded tool loop |
| `services/AnthropicService.ts` | 273 | Anthropic streaming (extends BaseProvider); retry, prompt caching, temperature/`output_config.effort`, PDF document-block splice, resumeMode gating, bounded tool loop |
| `services/BaseProvider.ts` | 200 | Abstract base: shared fields, lifecycle, `resolveUserContent`/`finishOrError` streamMessage helpers (incl. PDF/note attachment split), all generate* utility methods |
| `services/ToolHandler.ts` | 119 | Tool definitions + `ToolHandler` class (injected NoteWriter) |
| `services/NoteWriter.ts` | 200 | Vault write operations; frontmatter merge preserves multi-line field values |
| `services/TemplateLoader.ts` | 110 | Template discovery + frontmatter parsing (incl. `temperature`, `effort`); parallelized reads, empty-folder guard |
| `services/messageUtils.ts` | 143 | Shared: `parseTitleAndSummary`, `normalizeMessages`, `selectHistoryForSend`, `debugLog`, token estimation, lang helpers, `arrayBufferToBase64` (Buffer-free, mobile-safe) |
| `services/LLMRouter.ts` | 77 | Dispatches calls to the active provider |
| `services/ContextBuilder.ts` | 130 | Builds system prompt (incl. grounding instruction), attaches + chunks vault notes (parallelized reads), estimates tokens; `buildAttachedPdfs` reads PDFs as base64 for native document/file blocks |
| `services/promptConstants.ts` | 48 | Shared literal constants: XML-ish prompt tags (`system_prompt`, `attached_note`, …), `TITLE`/`SUMMARY` markers, `DEFAULT_MAX_TOKENS`/`DEFAULT_MAX_TOKENS_REASONING` + `resolveDefaultMaxTokens()`, `MAX_PDF_FILE_SIZE_BYTES` |
| `services/noteChunking.ts` | 72 | Heading-based chunking + relevance-filtered excerpting for oversized attached notes |
| `services/noteRelevance.ts` | 49 | IDF-weighted keyword-overlap scoring (`scoreRelevanceWeighted` + pre-tokenized, batch `scoreRelevanceTokensWeighted`) shared by note chunking and `#` suggestion ranking |
| `services/retry.ts` | 17 | Retry/backoff predicate + schedule for transient failures, incl. 5xx/529; exports `ABORT_ERROR_NAMES` |
| `services/ConversationStore.ts` | 61 | In-memory store + 300 ms debounced persistence; `save()` no-ops for a deleted conversation instead of resurrecting it |
| `services/PromptOptimizerService.ts` | 211 | `run()` command flow + `optimizeText()` (inline review) |
| `services/persistence.ts` | 111 | Pure functions extracted from `main.ts`: `applySettingsMigrations`, `mergeSettings`, `parseConversations`, `shouldRefuseLoad`, `evictConversations` (protects every open leaf's active conversation, tolerates malformed `updatedAt`) |
| `services/apiError.ts` | 37 | HTTP error classification, incl. `server_error` (5xx/529) |
| `services/LLMProvider.ts` | 23 | Provider interface |
| `models/knownModels.ts` | 78 | Single source of truth for known model IDs per provider, the OpenAI reasoning-model set, the Anthropic temperature deny-list/effort allow-list, and model-abbreviation labels |
| `models/settings.ts` | 63 | `PythiaSettings` interface + `DEFAULT_SETTINGS` — no Obsidian dependency; importable in tests |
| `ui/OptimizationController.ts` | 182 | Inline prompt optimizer UI state + flow (extracted from sidebar); generation-counter guard against stale responses |
| `ui/NavigatorController.ts` | 163 | `#` navigator popover logic (extracted from sidebar) |
| `ui/InlineSuggest.ts` | 173 | `#` note-path autocomplete in textarea (md + pdf); relevance-ranked via `noteRelevance`, query tokenized once per keystroke |
| `suggest/` | — | Modal dialogs (picker, delete confirm, settings, etc.); `NoteSuggestModal` overrides `getItems()` to include PDFs, `FileSuggestModal` stays markdown-only (also used by the template picker) |
| `models/types.ts` | 102 | All shared TypeScript interfaces, incl. `ToolLoopLimitError`, `EffortLevel` |
| `locales/en.ts` / `locales/de.ts` | ~300 each | i18n strings (English / German) |
| `tests/` | — | Vitest unit tests (230 tests, ~1 s) |
| `eslint.config.mjs` | 40 | ESLint flat config (typescript-eslint) |
| `vitest.config.ts` | 24 | Coverage configuration |
| `.github/workflows/ci.yml` | — | CI: lint → build → test on push/PR |

---

## Component relationships

```
PythiaPlugin (main.ts)
├── ConversationStore          — persists conversations[] via Obsidian's saveData()
├── watchDataJson()            — polls adapter.stat() every 5 s for cross-device sync
├── LLMRouter                  — routes to AnthropicService or OpenAIProvider
│   ├── AnthropicService       — Anthropic SDK streaming; extends BaseProvider
│   └── OpenAIProvider         — OpenAI SDK streaming; extends BaseProvider
│       BaseProvider           — shared: abort, updateSettings/Key, generate* utilities
│       (all providers share messageUtils for parsing, normalisation, lang helpers,
│        retry.ts for transient-failure backoff, and ContextBuilder for prompt assembly)
├── ContextBuilder             — system prompt + attached-note inlining/chunking
│   └── noteChunking / noteRelevance — heading-based excerpting for oversized notes
├── TemplateLoader             — discovers pythia_template notes in vault
├── NoteWriter                 — writes/updates vault notes
├── ToolHandler                — wraps NoteWriter; executes tool calls from the LLM
└── PythiaSidebarView (sidebar.ts)
    ├── OptimizationController — inline prompt optimizer state + flow
    ├── NavigatorController    — # navigator popover
    ├── InlineSuggest          — textarea autocomplete
    └── suggest/*.ts           — Modal dialogs (opened on demand)
```

---

## Data model (`models/types.ts`)

```
Conversation
  id, name, createdAt, updatedAt
  provider ("anthropic" | "openai"), model, maxTokens?, temperature?, effort? ("low"|"medium"|"high")
  systemPrompt, contextNotes[]   ← permanent per-conv note attachments; sent with every message
  writeMode ("create" | "update" | "rewrite" | "none")
  resumeMode ("full" | "summary")   ← "summary" now actually excludes prior messages from the
                                      API request (see selectHistoryForSend); history itself
                                      is preserved in conv.messages for UI/scrollback
  outputFolder?                  ← default folder for AI-created notes
  messages[]
    id, role, content, timestamp
    attachedNotes[]?             ← per-message note attachments
    tokenUsage?                  ← inputTokens, outputTokens
    chapterName?                 ← 3-5 word LLM title for user turns
  favorites[]                    ← starred assistant messages
    messageId, name              ← name reused from preceding chapterName
  summaryText?, summaryUpdatedAt?, summaryNote?
  savedNotePath?, lastSavedMessageCount?
  forkedFromId?, forkedFromMessageId?, forkedFromSelection?

PythiaSettings
  defaultProvider, defaultAnthropicModel, defaultOpenAIModel
  maxMessagesPerSession, maxConversations   ← eviction cap (default 200)
  outputLanguage ("auto" | "en" | "de")    ← locale code, not display label
  templatesFolder, conversationsFolder, scratchFolder, inboxNote
  autoSaveSummary, defaultResumeMode
  injectActiveNoteOnTemplate, debugMode
  maxTokens?                                ← global max-output-tokens default; undefined = resolveDefaultMaxTokens(model)
  temperature?                              ← global sampling-temperature default (0–1); undefined = API default
  effort?                                   ← global reasoning/output-effort default ("low"|"medium"|"high"); undefined = API default
  maxAttachedNotesTokens                    ← warn above this estimated token count (default 8000); 0 = no warning
  anthropicSecretName, openaiSecretName     ← keys into Obsidian SecretStorage

PluginData (data.json)
  settings: PythiaSettings
  conversations: Conversation[]
```

---

## Key data flows

### Sending a message

```
User types + presses Enter (e.isComposing guard prevents IME false fires)
  → sendMessage() [sidebar.ts]
      → push Message to conv.messages
      → appendMessageBubble() renders user bubble
      → createStreamingBubble() creates live token target
      → LLMRouter.streamMessage(conv, text, conv.contextNotes, …)
          → ContextBuilder.buildSystemPrompt()
              — appends a grounding instruction when contextNotes.length > 0
              — the XML-ish tag names (`system_prompt`, `previous_conversation_summary`,
                `attached_note` and its `path`/`excerpt` attributes) are defined once in
                `services/promptConstants.ts` and reused by `ToolHandler.ts`'s tool-call
                descriptions, which reference `attached_note` by name in prose read by the LLM
          → BaseProvider.resolveUserContent() splits conv.contextNotes by
              extension (path.toLowerCase().endsWith(".pdf")) and fetches both
              kinds in parallel:
              → ContextBuilder.buildAttachedNotesContent(notePaths, newMessage)
                  — attached notes are read in parallel (Promise.all), then notes over
                    NOTE_CHUNK_THRESHOLD_CHARS are split by heading
                    (noteChunking.chunkByHeadings) and filtered to the sections most
                    relevant to `newMessage` (noteRelevance.scoreRelevanceTokensWeighted —
                    IDF-weighted, query tokenized once and reused across every chunk) instead
                    of inlining the whole note; result is tagged excerpt="true"
                  — if the resulting estimated token count exceeds
                    settings.maxAttachedNotesTokens, a Notice warns before sending
              → ContextBuilder.buildAttachedPdfs(pdfPaths)
                  — each PDF is read whole via vault.readBinary (parallelized),
                    size-checked against MAX_PDF_FILE_SIZE_BYTES (20 MB raw) before
                    reading — oversized PDFs are skipped with a Notice, not sent —
                    and base64-encoded (messageUtils.arrayBufferToBase64, Buffer-free
                    for Obsidian mobile); sent whole, uncondensed — no local text
                    extraction or chunking, the model's own PDF understanding
                    handles that
          → selectHistoryForSend(conv.messages, conv.resumeMode)
              — "summary" mode sends no prior messages at all (relies on
                summaryText already in the system prompt); "full" sends everything
          → after loopMessages is built (post-normalizeMessages, whose same-role
              merge does string concatenation and would corrupt array content),
              any pdfAttachments are spliced onto the last user message as native
              content blocks — Anthropic: DocumentBlockParam (base64 + title);
              OpenAI: ChatCompletionContentPart.File (data-URL-prefixed file_data)
              — each provider file does its own splice; see ADR-041
          → Provider SDK streaming call
              — Anthropic: system prompt + tool defs carry cache_control: ephemeral
                (cached after turn 1); temperature/output_config.effort included
                when resolved and supported by the model
              — transient rate-limit/network/server-error (5xx/529) failures before
                any token is emitted are retried with backoff (services/retry.ts),
                up to 2 attempts
              — tool-calling round trips are capped at MAX_TOOL_ROUNDS (25); exceeding
                it throws ToolLoopLimitError, surfaced as a friendly Notice
              — the abort signal is captured once at the top of the call, so an
                abort while a tool confirmation is pending (BaseProvider.abort()
                nulls the controller) still resolves as a clean cancellation
                instead of crashing on a null .signal read
              → onToken() appends text to streaming bubble
              → onComplete() → finalize() (only if the conversation is still the
                    one displayed — defense-in-depth against a torn-down view)
                  → MarkdownRenderer.render() (try/catch)
                  → decorateCodeBlocks()
                      → code blocks: .p-code-frame wrapper + copy button
                      → diagrams ([class*='block-language-']): in-container copy button,
                              fixDiagramSvgSize() — MutationObserver + ResizeObserver
                  → conversationStore.save() (debounced 300 ms; no-ops if the
                        conversation was deleted while the stream was in flight)
                  → generateConversationTitle() fire-and-forget (guarded by ID)
                  → generateChapterName() fire-and-forget (guarded by ID)
              → onError() → console.error (always) + Notice; the streaming bubble
                    is always resolved — finalized with whatever partial text
                    arrived, or removed if none — never left stuck mid-render

Switching to a different conversation or deleting the active one is blocked with
a Notice while isStreaming is true — streaming/abort state is per-view and
per-provider (LLMRouter.abort() sweeps every provider), not per-conversation, so
letting a switch/delete through mid-stream could abort or lose the wrong
conversation's generation. See ADR-032.
```

### Tool call (LLM vault write)

```
LLM requests tool_use / tool_calls during streamMessage
  → onToolCall(call) [sidebar.ts]
      → path guard: for rewrite_note / prepend_note, verify path ∈ conv.contextNotes
      → show confirm chip (pythia-tool-call) in message stream
          → Promise<boolean> resolved by user clicking action or cancel button
      → if cancelled: chip shows "Cancelled"; return error string to LLM
      → if confirmed: plugin.toolHandler.execute(call)
          → ToolHandler (holds NoteWriter) routes to writeNote / prependWithSeparator
          → chip updated to done (green border + clickable link) or error state
```

### Attaching notes to a conversation

All note-attachment paths write to `conv.contextNotes` (persisted) and render in the reference row. Attachments are plain vault-path strings with no type-level distinction between markdown notes and PDFs — dispatch happens by extension at read time (`path.toLowerCase().endsWith(".pdf")`), matching the same pattern used for model-capability checks like `isReasoningModel()`. A template can declare a PDF path in `context_notes` frontmatter with no changes needed in `TemplateLoader.ts`.

| Entry point | Code path | PDF-aware? |
|---|---|---|
| File-menu "Chat about this note" | `attachNoteToInput()` → `conv.contextNotes` | md only (file-menu action is markdown-file-scoped) |
| 📎 toolbar button | `onAttachNote()` → `NoteSuggestModal` → `conv.contextNotes` | yes |
| Inline `#` suggest | `ui/InlineSuggest.ts` callback → `conv.contextNotes` | yes |
| Reference row `+` button | `NoteSuggestModal` callback → `conv.contextNotes` | yes |
| Folder attach | `utils.ts`'s `getFilesInFolder()` → `conv.contextNotes` | yes |
| Template `context_notes` frontmatter | `TemplateLoader.ts` (unfiltered path string) | yes |

`conv.contextNotes` is passed as `attachedNotes` to `streamMessage` on every send, so the LLM always has access to all attached notes and PDFs (see "Sending a message" above for how each kind is resolved and, for PDFs, sent as a native document/file content block instead of inlined text). `suggest/FileSuggest.ts`'s base `FileSuggestModal` deliberately stays markdown-only — it also backs the prompt-optimizer template picker in `settings.ts`, which must never surface a PDF.

The inline `#` suggestion dropdown (`ui/InlineSuggest.ts`) ranks candidate notes by an IDF-weighted keyword-overlap score (`services/noteRelevance.ts`'s `scoreRelevanceTokensWeighted`) between the message being composed and each note's basename, frontmatter title, and headings (read from Obsidian's cached `metadataCache` — no per-keystroke disk reads). A filename match on the typed `#fragment` still dominates and gates the result set; the relevance score is the tiebreaker, which matters most when the fragment is empty or matches several notes equally. For a PDF candidate, `noteHaystack()` has no headings to parse and falls back to the basename alone — the filename-substring match still ranks it correctly. Scoring is batched — the full candidate set's haystacks are gathered before scoring, since IDF weighting needs each token's document frequency across the whole batch, not just one haystack at a time (see ADR-043).

### Conversation rename

Two paths share the same inline-edit UI in the header:

**Manual rename** — a pencil button (`.p-rename-btn`) sits after the title, visible whenever a conversation is active. Clicking it hides the title element and shows a text `<input>` (`.p-rename-input`) pre-filled with the current name and a sparkle button (`.p-rename-llm-btn`). Enter or blur confirms and saves; Escape cancels. Confirmation writes `conv.name` and calls `conversationStore.save`.

**LLM-generated name** — clicking the sparkle button while in rename mode calls `LLMRouter.generateConversationTitle` with the first user and first assistant message content of the conversation (empty strings if none exist). On success the new name is saved and rename mode exits immediately. On failure a `Notice` is shown and the input remains open for manual editing.

The rename flow lives entirely in `sidebar.ts` (`enterRenameMode`, `exitRenameMode`, `onRenameLLM`). No new modal is needed.

### Forking a conversation

Triggered by selecting text in an assistant message bubble and invoking the fork action (`sidebar.ts` → `plugin.cmdForkConversation(sourceConvId, selectedText, sourceMessageId)`). The fork is a new, message-less `Conversation` — it copies the source's `systemPrompt`/`provider`/`model`/`maxTokens`/`temperature`/`effort` but starts with empty `messages`/`contextNotes`.

```
cmdForkConversation(sourceConvId, selectedText, forkedFromMessageId?) [main.ts]
  → resolve summary BEFORE creating the fork, so it's part of the fork's
    context from the moment it opens (not delivered asynchronously after):
      — source.summaryText already cached → reuse it directly, no LLM call
      — source has messages but no cached summary → await LLMRouter.generateSummary(source)
          behind a Notice(t("generatingSummary"), 0) loading indicator;
          cache the result on source (future forks/resumeMode:"summary" reuse it for free)
      — source has no messages → no summary, nothing to carry
  → createConversation(...) with the copied fields above
  → conv.forkedFromId / forkedFromMessageId / forkedFromSelection set
      (forkedFromSelection is display-only — it feeds the fork banner's
      selection excerpt, sidebar.ts's renderForkBannerEl; it does NOT
      pre-fill the new conversation's input box)
  → conv.summaryText/summaryUpdatedAt set from the resolved summary, if any
      — ContextBuilder.buildSystemPrompt() picks this up automatically on
        every future send (a <previous_conversation_summary> tag), independent
        of resumeMode; no extra wiring needed
  → view.setActiveConversation(conv)
      — this alone triggers a full message rebuild, which renders the fork
        banner (conv.forkedFromId set) and the summary bar (conv.summaryText
        set) correctly on first paint — no separate post-hoc refresh call
```

See ADR-042 for why summary resolution is awaited synchronously rather than fired in the background, and why the input box is deliberately left empty.

### Deep-link navigation (`obsidian://pythia`)

`main.ts` registers a protocol handler for `obsidian://pythia`. Supported `cmd` values:

| `cmd` | Behaviour |
|---|---|
| `open` | Activate the sidebar view |
| `new` | Create a new conversation and open it |
| `resume?id=<id>` | Open a specific conversation, scroll to **top** |
| `template?name=<name>` | Create a new conversation from a named template |

All conversation switches scroll to the top. New messages during a live session scroll to the bottom via `scrollToBottom()`.

### Cross-device sync (`watchDataJson`)

```
Every 5 seconds:
  adapter.stat(".obsidian/plugins/pythia/data.json")
    → if mtime > lastKnownMtime AND > 3 s since own write:
        → reloadFromDisk()
            → loadPluginData()
                → iCloud eviction guard: if loaded=0 but in-memory>0, refuse load
                → this.settings = Object.assign({}, DEFAULT_SETTINGS, saved)  ← new object
                → this.conversations = loaded
            → propagate new settings to all services:
                llmRouter, templateLoader, noteWriter, promptOptimizerService
            → getLeavesOfType(PYTHIA_VIEW_TYPE)
            → view.setActiveConversation(still-open or most-recent)
```

**Known limitation:** iCloud Drive does not reliably update `mtime` when a file arrives via sync, so the poller may not fire between devices. The "Reload conversations from disk" command provides a manual escape hatch.

### Persistence

```
ConversationStore.save(conv)
  → updatedAt = now
  → upsert into this.plugin.conversations[]
  → schedulePersist()  ← 300 ms debounce

onunload()
  → conversationStore.flush() ← cancels debounce, writes immediately

persistData()
  → stamp own-write time (for watchDataJson grace window)
  → evict oldest non-starred, non-active conversations beyond maxConversations cap
  → saveData({ settings, conversations })
```

---

## Storage & sync

All plugin data lives in `data.json` (Obsidian's `saveData`/`loadData`). iCloud or Obsidian Sync propagates it. API keys are in Obsidian `SecretStorage` (device-specific, never synced — must be re-entered per device).

**iCloud eviction guard:** if `data.json` is evicted to cloud-only and `loadData()` returns empty, `loadPluginData()` refuses to overwrite non-empty in-memory state.

**Live sync:** `watchDataJson()` polls mtime every 5 s. External writes trigger `reloadFromDisk()`, which reloads the conversation list and refreshes the sidebar.

On load, migrations run:
- `apiKey` → SecretStorage
- `defaultModel` → `defaultAnthropicModel`
- `encryptedApiKey/OpenAIKey` → SecretStorage (`typeof Buffer` guard for iOS)
- `outputLanguage: "English"/"German"` → `"en"/"de"`

---

## Diagram rendering pipeline

1. LLM returns ` ```mermaid … ``` ` in response text
2. `finalize()` calls `MarkdownRenderer.render()` → Obsidian creates `.block-language-mermaid` with `<pre><code>` inside
3. `decorateCodeBlocks()` captures source from `code.innerText` before Mermaid renders, adds in-container copy button
4. `fixDiagramSvgSize()` arms a `MutationObserver` (two-phase: childList + SVG style/attribute) and a `ResizeObserver` fallback to stamp natural pixel dimensions once the renderer inserts/sizes the SVG. Covers Mermaid v10, Vega, and any plugin using `[class*='block-language-']`
5. CSS: `[class*='block-language-'] { overflow-x: auto; width: 100% }` — any diagram renderer scrolls within its frame; `.p-chat { overflow-x: clip }` prevents whole-conversation horizontal scroll

---

## Provider abstraction

Both providers extend `BaseProvider` (which implements `LLMProvider`). `LLMRouter` dispatches by `conversation.provider`.

`BaseProvider` holds: shared fields (`app`, `settings`, `apiKey`, `abortController`), concrete lifecycle methods (`abort`, `updateSettings`, `updateApiKey`), two `streamMessage` helpers shared by both providers (`resolveUserContent` — splits `attachedNotes` into note/PDF paths by extension, fetches both in parallel (`ContextBuilder.buildAttachedNotesContent`/`buildAttachedPdfs`), surfaces missing/oversized-note and missing/oversized-PDF `Notice`s, builds the system prompt, and returns `pdfAttachments` alongside `userContent`/`systemPrompt` for each provider to splice in its own wire format; `finishOrError` — routes a caught error to `onComplete` on user abort or `onError` otherwise, reusing `retry.ts`'s `ABORT_ERROR_NAMES`), and all six generate* utility methods (`generateSummary`, `generateSummaryWithTitle`, `generateChapterName`, `generateConversationTitle`, `summarizeNotes`, `optimizePrompt`).

Each provider implements:
- `resetClient()` — nulls the cached SDK client on credential/settings change
- `fastModel` — cheap model for utility calls (`claude-haiku-4-5` / `gpt-4o-mini`)
- `assistantLabel` — `"Claude"` / `"Assistant"` in conversation transcripts
- `resolveModel(override?)` — falls back to provider-specific default model
- `callUtility(model, userMessage, maxTokens, systemMessage?)` — single-turn non-streaming call
- `streamMessage(...)` — full streaming implementation; the SDK-specific streaming/tool-loop body stays per-provider (Anthropic's Messages API and OpenAI's Chat Completions API have genuinely different shapes there), capped at `MAX_TOOL_ROUNDS = 25` rounds (throws `ToolLoopLimitError` beyond that) and capturing `this.abortController.signal` into a local once at the top of the call — a mid-loop abort (e.g. while a tool confirmation is pending) must not read `.signal` off a controller `BaseProvider.abort()` may have already nulled out

`OpenAIProvider` additionally uses `models/knownModels.ts`'s `isReasoningModel()` to decide, per model: whether the system prompt is injected as a leading `user` message vs. a real `system` role, whether a custom `temperature` is sent, and whether the request uses `max_tokens` or `max_completion_tokens` (the o-series reasoning models reject the first two and require the last). Symmetrically, `AnthropicService` uses `models/knownModels.ts`'s `supportsTemperature()` to decide whether `temperature` is sent at all — Claude Fable 5/Mythos 5 and the Opus 4.7+/Sonnet 5 generation return a 400 if `temperature` is present in the request regardless of its value, so `streamMessage` resolves `temperature` from `conversation.temperature ?? settings.temperature` and then drops it to `undefined` for those model IDs before building the request.

`effort` (`"low"|"medium"|"high"`, capped below the full Anthropic range — see ADR-040) follows the mirror-image gating shape: `AnthropicService` uses `supportsEffort()` (an allow-list, `ANTHROPIC_EFFORT_MODELS`, unlike `ANTHROPIC_NO_TEMPERATURE_MODELS`'s deny-list) to decide whether to send `output_config.effort`; `OpenAIProvider` reuses the existing `isReasoningModel()` gate to decide whether to send `reasoning_effort` — the same o-series models that reject `temperature` are the only ones that accept `reasoning_effort`, so the two parameters are naturally mutually exclusive per model. `output_config` isn't in the installed `@anthropic-ai/sdk`'s TypeScript types (`0.40.1`), so `AnthropicService` declares a local `AnthropicStreamParams` type (`Anthropic.MessageStreamParams & { output_config?: {...} }`) and builds the request as a separately-typed `const` rather than an inline object literal, avoiding TypeScript's excess-property check without a cast or an SDK bump.

The `TITLE:`/`SUMMARY:` markers used by `generateSummaryWithTitle` and parsed by `messageUtils.parseTitleAndSummary` are defined once in `services/promptConstants.ts` (`TITLE_MARKER`, `SUMMARY_MARKER`) so the two can't drift apart. Max-output-tokens resolves as `conversation.maxTokens ?? settings.maxTokens ?? resolveDefaultMaxTokens(model)` in both providers — the same three-level override layering `temperature`/`effort` use. `resolveDefaultMaxTokens()` (`promptConstants.ts`) picks `DEFAULT_MAX_TOKENS` (8192) or, for OpenAI reasoning models (`isReasoningModel()`), the larger `DEFAULT_MAX_TOKENS_REASONING` (16384) — reasoning models spend tokens from this same budget on internal reasoning before producing visible output, so a low cap risks a truncated or empty reply. Unlike temperature/effort, `maxTokens` has no `Setting.setDisabled()` gating anywhere in the UI: every model accepts some form of output-token cap (only the request field *name* varies, via `isReasoningModel()`), so there's no "unsupported" state to gate against.

Shared logic in `services/messageUtils.ts`:
- `parseTitleAndSummary` — parses `TITLE: / SUMMARY:` structured response
- `normalizeMessages<T>(messages, isInvalidFirst)` — coalesces same-role messages
- `selectHistoryForSend(messages, resumeMode)` — returns `[]` in `"summary"` mode, `messages` unchanged in `"full"` mode
- `estimateTokensFromBytes(bytes)` / `estimateTokensFromText(text)` — token count helpers
- `LANG_LABELS`, `langInstruction`, `langSuffix` — output language helpers
- `debugLog(settings, ...args)` — verbose diagnostic trace gated on `settings.debugMode`; used for retry attempts and tool-round outcomes. Genuine errors (as opposed to opt-in diagnostics) use un-gated `console.warn`/`console.error` instead, so they're visible without enabling debug mode first.

Shared logic in `services/retry.ts`:
- `isRetryableError(error)` — true for rate-limit, network, and server-error (5xx/Anthropic 529) classes, never user aborts
- `RETRY_BACKOFF_MS` — two backoff delays; applied only while no tokens have been emitted yet for the current attempt, so a retry never duplicates partial output
- `ABORT_ERROR_NAMES` — the set of error names treated as a user-initiated cancellation, reused by `BaseProvider.finishOrError`

Token/cache usage accounting is additive across every round of the tool-calling loop in both providers (`totalInputTokens`/`totalOutputTokens`, plus `cacheReadTokens`/`cacheCreationTokens` for Anthropic) — a provider only ever reports the sum across the whole turn, never just the last round.

Anthropic-specific: system prompt and tool definitions are sent with `cache_control: { type: "ephemeral" }` (system as the last block, tools on the last tool in the array) so the identical, stable parts of the request are cached across turns of a conversation. OpenAI has no equivalent code path — its API caches eligible prompts automatically server-side.

---

## Infrastructure

- **CI:** `.github/workflows/ci.yml` — lint (`npm run lint`) → type-check + build (`npm run build`) → test (`npm test`). Triggers on push to `main`, PRs, and manual dispatch.
- **ESLint:** `eslint.config.mjs` with `tseslint.configs.recommended`. `no-console: warn`, `no-explicit-any: off`. 0 errors, ~8 intentional warnings.
- **Testing:** Vitest, 207 unit tests across 15 files, ~1 s. Coverage thresholds: statements/lines ≥ 90 %, branches ≥ 80 %, functions ≥ 95 %.
- **Branch protection:** CI must pass before merge. Force-pushes blocked. Merged branches auto-deleted.
- **`minAppVersion`:** `"1.4.0"` — reflects the actual minimum Obsidian version where all used APIs are available.
- **`@anthropic-ai/sdk`:** pinned at `^0.40.0` (bumped from `^0.28.0`) — the minimum version whose main (non-beta) Messages API types support `cache_control`, needed for prompt caching. See ADR for the caching decision.
