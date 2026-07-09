# Pythia — Architecture

*Last updated: 2026-07-09 — prompt-tag/marker centralization (`services/promptConstants.ts`); response-quality pass: resumeMode fix, retry/backoff, Anthropic prompt caching, temperature, attached-notes token guard + chunking, relevance-ranked note suggestions.*

---

## What Pythia is

An Obsidian sidebar plugin providing a streaming LLM chat interface tightly integrated with the vault. Conversations are first-class vault objects — stored, resumable, forkable, and cross-device via Obsidian Sync or iCloud. Supports Anthropic and OpenAI providers.

---

## File inventory

| File | Lines | Role |
|---|---:|---|
| `sidebar.ts` | 2 111 | `PythiaSidebarView` — all UI, rendering, streaming, interaction |
| `styles.css` | 1 456 | All plugin CSS (no framework, no CSS-in-JS) |
| `main.ts` | 905 | Plugin entry, commands, conversation lifecycle, data.json watcher |
| `settings.ts` | 419 | Settings schema, defaults, settings tab UI |
| `services/OpenAIProvider.ts` | 298 | OpenAI streaming (extends BaseProvider); retry, temperature, resumeMode gating |
| `services/AnthropicService.ts` | 240 | Anthropic streaming (extends BaseProvider); retry, prompt caching, temperature, resumeMode gating |
| `services/BaseProvider.ts` | 136 | Abstract base: shared fields, lifecycle, all generate* utility methods |
| `services/ToolHandler.ts` | 119 | Tool definitions + `ToolHandler` class (injected NoteWriter) |
| `services/NoteWriter.ts` | 186 | Vault write operations |
| `services/TemplateLoader.ts` | 95 | Template discovery + frontmatter parsing (incl. `temperature`) |
| `services/messageUtils.ts` | 117 | Shared: `parseTitleAndSummary`, `normalizeMessages`, `selectHistoryForSend`, token estimation, lang helpers |
| `services/LLMRouter.ts` | 72 | Dispatches calls to the active provider |
| `services/ContextBuilder.ts` | 72 | Builds system prompt (incl. grounding instruction), attaches + chunks vault notes, estimates tokens |
| `services/promptConstants.ts` | 25 | Shared literal constants: XML-ish prompt tags (`system_prompt`, `attached_note`, …) and `TITLE`/`SUMMARY` markers, referenced by ContextBuilder, ToolHandler, BaseProvider, messageUtils |
| `services/noteChunking.ts` | 69 | Heading-based chunking + relevance-filtered excerpting for oversized attached notes |
| `services/noteRelevance.ts` | 18 | Pure keyword-overlap scoring shared by note chunking and `#` suggestion ranking |
| `services/retry.ts` | 17 | Retry/backoff predicate + schedule for transient API failures |
| `services/ConversationStore.ts` | 58 | In-memory store + 300 ms debounced persistence |
| `services/PromptOptimizerService.ts` | ~170 | `run()` command flow + `optimizeText()` (inline review) |
| `services/persistence.ts` | ~100 | Pure functions extracted from `main.ts`: `applySettingsMigrations`, `mergeSettings`, `parseConversations`, `shouldRefuseLoad`, `evictConversations` |
| `services/apiError.ts` | 33 | HTTP error classification |
| `services/LLMProvider.ts` | 21 | Provider interface |
| `models/settings.ts` | 61 | `PythiaSettings` interface + `DEFAULT_SETTINGS` — no Obsidian dependency; importable in tests |
| `ui/OptimizationController.ts` | 171 | Inline prompt optimizer UI state + flow (extracted from sidebar) |
| `ui/NavigatorController.ts` | 163 | `#` navigator popover logic (extracted from sidebar) |
| `ui/InlineSuggest.ts` | 171 | `#` note-path autocomplete in textarea; relevance-ranked via `noteRelevance` |
| `suggest/` | — | Modal dialogs (picker, delete confirm, settings, etc.) |
| `models/types.ts` | 87 | All shared TypeScript interfaces |
| `locales/en.ts` / `locales/de.ts` | ~290 each | i18n strings (English / German) |
| `tests/` | — | Vitest unit tests (183 tests, ~1 s) |
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
  provider ("anthropic" | "openai"), model, maxTokens?, temperature?
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
  temperature?                              ← global sampling-temperature default (0–1); undefined = API default
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
          → ContextBuilder.buildAttachedNotesContent(conv.contextNotes, newMessage)
              — notes over NOTE_CHUNK_THRESHOLD_CHARS are split by heading
                (noteChunking.chunkByHeadings) and filtered to the sections most
                relevant to `newMessage` (noteRelevance.scoreRelevance) instead
                of inlining the whole note; result is tagged excerpt="true"
              — if the resulting estimated token count exceeds
                settings.maxAttachedNotesTokens, a Notice warns before sending
          → selectHistoryForSend(conv.messages, conv.resumeMode)
              — "summary" mode sends no prior messages at all (relies on
                summaryText already in the system prompt); "full" sends everything
          → Provider SDK streaming call
              — Anthropic: system prompt + tool defs carry cache_control: ephemeral
                (cached after turn 1); temperature included when resolved
              — transient rate-limit/network failures before any token is emitted
                are retried with backoff (services/retry.ts), up to 2 attempts
              → onToken() appends text to streaming bubble
              → onComplete() → finalize()
                  → MarkdownRenderer.render() (try/catch)
                  → decorateCodeBlocks()
                      → code blocks: .p-code-frame wrapper + copy button
                      → diagrams ([class*='block-language-']): in-container copy button,
                              fixDiagramSvgSize() — MutationObserver + ResizeObserver
                  → conversationStore.save() (debounced 300 ms)
                  → generateConversationTitle() fire-and-forget (guarded by ID)
                  → generateChapterName() fire-and-forget (guarded by ID)
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

All note-attachment paths write to `conv.contextNotes` (persisted) and render in the reference row:

| Entry point | Code path |
|---|---|
| File-menu "Chat about this note" | `attachNoteToInput()` → `conv.contextNotes` |
| 📎 toolbar button | `onAttachNote()` → `conv.contextNotes` |
| Inline `[[` suggest | InlineSuggest callback → `conv.contextNotes` |
| Reference row `+` button | `NoteSuggestModal` callback → `conv.contextNotes` |

`conv.contextNotes` is passed as `attachedNotes` to `streamMessage` on every send, so the LLM always has access to all attached notes.

The inline `#` suggestion dropdown (`ui/InlineSuggest.ts`) ranks candidate notes by a cheap keyword-overlap score (`services/noteRelevance.ts`) between the message being composed and each note's basename, frontmatter title, and headings (read from Obsidian's cached `metadataCache` — no per-keystroke disk reads). A filename match on the typed `#fragment` still dominates and gates the result set; the relevance score is the tiebreaker, which matters most when the fragment is empty or matches several notes equally.

### Conversation rename

Two paths share the same inline-edit UI in the header:

**Manual rename** — a pencil button (`.p-rename-btn`) sits after the title, visible whenever a conversation is active. Clicking it hides the title element and shows a text `<input>` (`.p-rename-input`) pre-filled with the current name and a sparkle button (`.p-rename-llm-btn`). Enter or blur confirms and saves; Escape cancels. Confirmation writes `conv.name` and calls `conversationStore.save`.

**LLM-generated name** — clicking the sparkle button while in rename mode calls `LLMRouter.generateConversationTitle` with the first user and first assistant message content of the conversation (empty strings if none exist). On success the new name is saved and rename mode exits immediately. On failure a `Notice` is shown and the input remains open for manual editing.

The rename flow lives entirely in `sidebar.ts` (`enterRenameMode`, `exitRenameMode`, `onRenameLLM`). No new modal is needed.

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

`BaseProvider` holds: shared fields (`app`, `settings`, `apiKey`, `abortController`), concrete lifecycle methods (`abort`, `updateSettings`, `updateApiKey`), and all six generate* utility methods (`generateSummary`, `generateSummaryWithTitle`, `generateChapterName`, `generateConversationTitle`, `summarizeNotes`, `optimizePrompt`).

Each provider implements:
- `resetClient()` — nulls the cached SDK client on credential/settings change
- `fastModel` — cheap model for utility calls (`claude-haiku-3-5` / `gpt-4o-mini`)
- `assistantLabel` — `"Claude"` / `"Assistant"` in conversation transcripts
- `resolveModel(override?)` — falls back to provider-specific default model
- `callUtility(model, userMessage, maxTokens, systemMessage?)` — single-turn non-streaming call
- `streamMessage(...)` — full streaming implementation

The `TITLE:`/`SUMMARY:` markers used by `generateSummaryWithTitle` and parsed by `messageUtils.parseTitleAndSummary` are defined once in `services/promptConstants.ts` (`TITLE_MARKER`, `SUMMARY_MARKER`) so the two can't drift apart.

Shared logic in `services/messageUtils.ts`:
- `parseTitleAndSummary` — parses `TITLE: / SUMMARY:` structured response
- `normalizeMessages<T>(messages, isInvalidFirst)` — coalesces same-role messages
- `selectHistoryForSend(messages, resumeMode)` — returns `[]` in `"summary"` mode, `messages` unchanged in `"full"` mode
- `estimateTokensFromBytes(bytes)` / `estimateTokensFromText(text)` — token count helpers
- `LANG_LABELS`, `langInstruction`, `langSuffix` — output language helpers

Shared logic in `services/retry.ts`:
- `isRetryableError(error)` — true only for rate-limit/network failures, never user aborts
- `RETRY_BACKOFF_MS` — two backoff delays; applied only while no tokens have been emitted yet for the current attempt, so a retry never duplicates partial output

Anthropic-specific: system prompt and tool definitions are sent with `cache_control: { type: "ephemeral" }` (system as the last block, tools on the last tool in the array) so the identical, stable parts of the request are cached across turns of a conversation. OpenAI has no equivalent code path — its API caches eligible prompts automatically server-side.

---

## Infrastructure

- **CI:** `.github/workflows/ci.yml` — lint (`npm run lint`) → type-check + build (`npm run build`) → test (`npm test`). Triggers on push to `main`, PRs, and manual dispatch.
- **ESLint:** `eslint.config.mjs` with `tseslint.configs.recommended`. `no-console: warn`, `no-explicit-any: off`. 0 errors, ~8 intentional warnings.
- **Testing:** Vitest, 183 unit tests across 12 files, ~1 s. Coverage thresholds: statements/lines ≥ 90 %, branches ≥ 80 %, functions ≥ 95 %.
- **Branch protection:** CI must pass before merge. Force-pushes blocked. Merged branches auto-deleted.
- **`minAppVersion`:** `"1.4.0"` — reflects the actual minimum Obsidian version where all used APIs are available.
- **`@anthropic-ai/sdk`:** pinned at `^0.40.0` (bumped from `^0.28.0`) — the minimum version whose main (non-beta) Messages API types support `cache_control`, needed for prompt caching. See ADR for the caching decision.
