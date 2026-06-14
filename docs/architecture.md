# Pythia — Architecture

*Last updated: 2026-06-14 at v1.19.5*

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
| `services/OpenAIProvider.ts` | 264 | OpenAI streaming (extends BaseProvider) |
| `services/AnthropicService.ts` | 197 | Anthropic streaming (extends BaseProvider) |
| `services/BaseProvider.ts` | 132 | Abstract base: shared fields, lifecycle, all generate* utility methods |
| `services/ToolHandler.ts` | 118 | Tool definitions + `ToolHandler` class (injected NoteWriter) |
| `services/NoteWriter.ts` | 186 | Vault write operations |
| `services/TemplateLoader.ts` | 95 | Template discovery + frontmatter parsing |
| `services/messageUtils.ts` | 98 | Shared: `parseTitleAndSummary`, `normalizeMessages`, token estimation, lang helpers |
| `services/LLMRouter.ts` | 72 | Dispatches calls to the active provider |
| `services/ContextBuilder.ts` | 48 | Builds system prompt, attaches vault notes |
| `services/ConversationStore.ts` | 58 | In-memory store + 300 ms debounced persistence |
| `services/PromptOptimizerService.ts` | ~170 | `run()` command flow + `optimizeText()` (inline review) |
| `services/persistence.ts` | ~100 | Pure functions extracted from `main.ts`: `applySettingsMigrations`, `mergeSettings`, `parseConversations`, `shouldRefuseLoad`, `evictConversations` |
| `services/apiError.ts` | 33 | HTTP error classification |
| `services/LLMProvider.ts` | 21 | Provider interface |
| `models/settings.ts` | ~55 | `PythiaSettings` interface + `DEFAULT_SETTINGS` — no Obsidian dependency; importable in tests |
| `ui/OptimizationController.ts` | 171 | Inline prompt optimizer UI state + flow (extracted from sidebar) |
| `ui/NavigatorController.ts` | 163 | `#` navigator popover logic (extracted from sidebar) |
| `ui/InlineSuggest.ts` | 152 | `#` note-path autocomplete in textarea |
| `suggest/` | — | Modal dialogs (picker, delete confirm, settings, etc.) |
| `models/types.ts` | 78 | All shared TypeScript interfaces |
| `locales/en.ts` / `locales/de.ts` | ~283 each | i18n strings (English / German) |
| `tests/` | — | Vitest unit tests (187 tests, ~500 ms) |
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
│       (all providers share messageUtils for parsing, normalisation, lang helpers)
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
  provider ("anthropic" | "openai"), model, maxTokens?
  systemPrompt, contextNotes[]   ← permanent per-conv note attachments; sent with every message
  writeMode ("create" | "update" | "rewrite" | "none")
  resumeMode ("full" | "summary")
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
          → ContextBuilder.buildAttachedNotesContent(conv.contextNotes)
          → Provider SDK streaming call
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

Shared logic in `services/messageUtils.ts`:
- `parseTitleAndSummary` — parses `TITLE: / SUMMARY:` structured response
- `normalizeMessages<T>(messages, isInvalidFirst)` — coalesces same-role messages
- `estimateTokensFromBytes(bytes)` / `estimateTokensFromText(text)` — token count helpers
- `LANG_LABELS`, `langInstruction`, `langSuffix` — output language helpers

---

## Infrastructure

- **CI:** `.github/workflows/ci.yml` — lint (`npm run lint`) → type-check + build (`npm run build`) → test (`npm test`). Triggers on push to `main`, PRs, and manual dispatch.
- **ESLint:** `eslint.config.mjs` with `tseslint.configs.recommended`. `no-console: warn`, `no-explicit-any: off`. 0 errors, ~8 intentional warnings.
- **Testing:** Vitest, 187 unit tests across 12 files, ~500 ms. Coverage thresholds: statements/lines ≥ 90 %, branches ≥ 80 %, functions ≥ 95 %.
- **Branch protection:** CI must pass before merge. Force-pushes blocked. Merged branches auto-deleted.
- **`minAppVersion`:** `"1.4.0"` — reflects the actual minimum Obsidian version where all used APIs are available.
