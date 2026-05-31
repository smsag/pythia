# Pythia — Architecture

*Last updated: 2026-05-31 at v1.11.2*

---

## What Pythia is

An Obsidian sidebar plugin that provides a streaming LLM chat interface tightly integrated with the user's vault. Conversations are first-class vault objects — they are stored, resumable, forkable, and cross-device via Obsidian Sync or iCloud.

---

## File inventory

| File | Lines | Role |
|---|---:|---|
| `sidebar.ts` | ~1 930 | `PythiaSidebarView` — all UI, rendering, streaming, interaction |
| `styles.css` | ~1 200 | All plugin CSS (no framework, no CSS-in-JS) |
| `main.ts` | ~760 | Plugin entry point: wiring, commands, conversation lifecycle |
| `settings.ts` | ~380 | Settings schema, defaults, settings tab UI |
| `services/OpenAIProvider.ts` | ~370 | OpenAI streaming + utility calls |
| `services/AnthropicService.ts` | ~310 | Anthropic streaming + utility calls |
| `services/messageUtils.ts` | ~84 | Shared: `parseTitleAndSummary`, `normalizeMessages`, language helpers |
| `services/LLMRouter.ts` | ~68 | Dispatches calls to the active provider |
| `services/ConversationStore.ts` | ~58 | In-memory store + 300 ms debounced persistence |
| `services/ContextBuilder.ts` | ~50 | Builds system prompt, attaches vault notes |
| `services/NoteWriter.ts` | ~135 | Vault write operations |
| `services/ToolHandler.ts` | ~63 | `create_note` tool definition + execution |
| `services/apiError.ts` | ~33 | HTTP error classification |
| `services/TemplateLoader.ts` | ~87 | Template discovery + frontmatter parsing |
| `services/LLMProvider.ts` | ~20 | Provider interface |
| `ui/InlineSuggest.ts` | ~152 | `#` note-path autocomplete in textarea |
| `suggest/` | — | Modal dialogs (picker, delete confirm, settings, etc.) |
| `models/types.ts` | ~76 | All shared TypeScript interfaces |
| `locales/en.ts` / `locales/de.ts` | ~215 each | i18n strings (English / German) |
| `tests/` | — | Vitest unit tests for pure functions |

---

## Component relationships

```
PythiaPlugin (main.ts)
├── ConversationStore          — persists conversations[] via Obsidian's saveData()
├── LLMRouter                  — routes to AnthropicService or OpenAIProvider
│   ├── AnthropicService       — Anthropic SDK streaming + utilities
│   └── OpenAIProvider         — OpenAI SDK streaming + utilities
│       (both share messageUtils for parseTitleAndSummary, normalizeMessages, lang helpers)
├── TemplateLoader             — discovers pythia_template notes in vault
├── NoteWriter                 — writes/updates vault notes
└── PythiaSidebarView (sidebar.ts)
    ├── InlineSuggest          — textarea autocomplete
    └── suggest/*.ts           — Modal dialogs (opened on demand)
```

---

## Data model (`models/types.ts`)

```
Conversation
  id, name, createdAt, updatedAt
  provider ("anthropic" | "openai"), model, maxTokens?
  systemPrompt, contextNotes[]   ← resolved at creation time
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
  maxMessagesPerSession, maxConversations   ← eviction cap
  outputLanguage ("auto" | "en" | "de")
  templatesFolder, conversationsFolder, scratchFolder, inboxNote
  autoSaveSummary, defaultResumeMode
  enableNoteCreation, injectActiveNoteOnTemplate, debugMode
  anthropicSecretName, openaiSecretName     ← keys into Obsidian SecretStorage

PluginData (data.json)
  settings: PythiaSettings
  conversations: Conversation[]
```

---

## Key data flows

### Sending a message

```
User types + presses Enter
  → sendMessage() [sidebar.ts]
      → push Message to conv.messages
      → appendMessageBubble() renders user bubble
      → createStreamingBubble() creates live token target
      → LLMRouter.streamMessage()
          → ContextBuilder.buildSystemPrompt()
          → ContextBuilder.buildAttachedNotesContent()
          → Provider SDK streaming call
              → onToken() appends text to streaming bubble
              → onComplete()
                  → finalize(): re-renders bubble with MarkdownRenderer
                  → decorateCodeBlocks(): copy buttons, diagram SVG stamps
                  → conversationStore.save() (debounced 300 ms)
                  → generateConversationTitle() fire-and-forget (first exchange)
                  → generateChapterName() fire-and-forget (guarded by ID check)
```

### Loading a conversation

```
setActiveConversation(conv)
  → autoScroll reset, pendingAttachedNotes cleared
  → navigatorOutsideCleanup() — detach stale listener
  → renderHeader(), renderReferencePills(), renderFavoritesBar()
  → updateSummaryBar() — renders summaryText if present
  → renderMessages() — full DOM rebuild from conv.messages[]
      → for each message: appendMessageBubble()
          → MarkdownRenderer.render() (try/catch)
          → decorateCodeBlocks()
  → backfillChapterNames() — serial API requests for unnamed user turns
```

### Persistence

```
ConversationStore.save(conv)
  → updatedAt = now
  → upsert into this.plugin.conversations[]
  → schedulePersist()  ← 300 ms debounce

ConversationStore.flush()  [called from onunload()]
  → cancelPersist()
  → persistData()

persistData()
  → evict oldest non-starred, non-active conversations beyond maxConversations cap
  → saveData({ settings, conversations })  ← Obsidian writes to data.json
```

---

## Storage

All plugin data lives in `data.json` (Obsidian's `saveData`/`loadData` API), which Obsidian Sync and iCloud propagate across devices. API keys are stored separately in Obsidian's `SecretStorage` (device-specific, never synced by design).

On load, `loadPluginData()` runs migrations:
- `apiKey` → SecretStorage (removed from data.json)
- `defaultModel` → `defaultAnthropicModel`
- `encryptedApiKey` / `encryptedOpenAIKey` → SecretStorage (`typeof Buffer` guard for iOS)
- `outputLanguage: "English"` / `"German"` → `"en"` / `"de"`

---

## Provider abstraction

Both providers implement `LLMProvider` (interface in `services/LLMProvider.ts`). `LLMRouter` dispatches calls based on `conversation.provider`. Shared logic lives in `services/messageUtils.ts`:

- `parseTitleAndSummary` — parses LLM's `TITLE: / SUMMARY:` structured response
- `normalizeMessages<T>(messages, isInvalidFirst)` — coalesces same-role messages; predicate differs by provider (Anthropic requires first = user; OpenAI allows system first)
- `LANG_LABELS`, `langInstruction`, `langSuffix` — output language helpers

---

## Obsidian-specific constraints

- **No framework** — all UI is Obsidian's imperative DOM helpers (`createDiv`, `createEl`, etc.)
- **No raw `addEventListener`** — use `registerDomEvent` / `registerEvent` for automatic cleanup
- **ItemView lifecycle** — `onOpen()` → `buildUI()`, `onClose()` → cleanup + optional auto-save summary
- **Leaf structure** — `containerEl.children[0]` is the header (never touch); `children[1]` is the content pane
- **Mermaid rendering** — async post-processor; diagram DOM must never be moved after render begins. MutationObserver watches `viewBox`/`width`/`height` attribute changes to stamp SVG pixel dimensions after Mermaid inserts the SVG

---

## Testing

`npm test` runs 36 Vitest unit tests in ~200 ms with no Obsidian dependency.

| File | Coverage |
|---|---|
| `tests/messageUtils.test.ts` | `parseTitleAndSummary`, `normalizeMessages`, `langInstruction`, `langSuffix`, `LANG_LABELS` |
| `tests/apiError.test.ts` | `classifyApiError` |

CI runs `npm test` on every push and PR via `.github/workflows/ci.yml`.
