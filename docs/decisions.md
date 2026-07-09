# Pythia — Architectural Decision Records

*Last updated: 2026-07-09 — response-quality pass (ADR-021 through ADR-026).*

Each entry records a decision, the context that drove it, and the consequence. Entries are append-only; superseded decisions are marked rather than deleted.

---

## ADR-001 — No UI framework (no React, Svelte, or shadow DOM)

**Status:** Active

**Context:** Obsidian plugins run inside Electron/WebKit. Frameworks add bundle size, complicate lifecycle management, and often fight Obsidian's own DOM ownership model.

**Decision:** All UI is constructed with Obsidian's imperative DOM helpers (`createDiv`, `createEl`, `MarkdownRenderer.render`). No virtual DOM, no component framework, no shadow DOM.

**Consequence:** UI code is verbose but fully transparent. Obsidian's cleanup hooks work without adaptation. `sidebar.ts` is now 2 033 lines — the size is a direct consequence of this decision and motivates suggestion #11 (split into sub-components).

---

## ADR-002 — API keys in Obsidian SecretStorage, not data.json

**Status:** Active

**Context:** Early versions stored keys as plaintext or Electron-encrypted ciphertext in `data.json`. `data.json` syncs across devices — keys on all sync targets is a security risk.

**Decision:** Keys stored in Obsidian `SecretStorage` (device-specific, never synced). `data.json` stores only a name (e.g. `"pythia-anthropic"`) that keys into SecretStorage. `getSecret()` is `await`ed at every call site (truly async on iOS WebKit).

**Consequence:** Keys must be re-entered on each device. The `legacyDecrypt` migration path converts old formats with a `typeof Buffer !== "undefined"` guard for iOS.

---

## ADR-003 — data.json with eviction cap, not per-file storage

**Status:** Partial — cap implemented; per-file is backlog

**Context:** Obsidian's `saveData`/`loadData` writes a single file. Large files sync slowly. At scale (months of conversations), `data.json` can exceed reliable sync thresholds.

**Decision (short-term):** `maxConversations` setting (default 200). Active and starred conversations are always protected.

**Decision (long-term, pending):** One JSON file per conversation keyed by `id`. See engineering-review #3.

---

## ADR-004 — Mermaid/PlantUML: CSS overflow + MutationObserver, not DOM wrapping

**Status:** Active

**Context:** Mermaid's async renderer locates `.block-language-mermaid` by DOM position. Moving the element into a wrapper breaks rendering.

**Decision:** Never move diagram containers. CSS provides `overflow-x: auto; width: 100%; min-width: 0; position: relative`. A two-phase `MutationObserver` stamps explicit pixel dimensions:
- Phase 1: watches `childList` + `attributes` (`viewBox`, `width`, `height`) on the container
- Phase 2: when SVG is found but unstamped, extends to watch the SVG's own `style` attribute (catches Gantt charts that set `svg.style.maxWidth` instead of `viewBox`)

**Consequence:** Wide diagrams scroll horizontally within their frame. The copy button is positioned `absolute` inside the container — it stays in the top-right corner without scrolling with the SVG content, because it is within the container's padding box.

---

## ADR-005 — outputLanguage stored as locale code, not human-readable string

**Status:** Active

**Context:** Original implementation stored `"English"` / `"German"` as dropdown values and injected them directly into LLM prompts. Translating a UI label would silently break the LLM instruction.

**Decision:** Store ISO 639-1 codes (`"en"`, `"de"`). `LANG_LABELS` map in `messageUtils.ts` translates to English instruction words for the LLM. Adding a language requires one line in the map. Migration converts existing `"English"`/`"German"` values.

---

## ADR-006 — normalizeMessages is generic with a caller-supplied predicate

**Status:** Active

**Context:** Anthropic requires `role === "user"` at position 0; OpenAI allows `role === "system"` at position 0. Two copies existed with a subtle condition difference.

**Decision:** Single `normalizeMessages<T>(messages, isInvalidFirst)`. Anthropic: `role => role !== "user"`. OpenAI: `role => role === "assistant"`. Predicate at call site makes the difference explicit.

---

## ADR-007 — 300 ms debounced save + flush on unload

**Status:** Active

**Context:** Streaming generates many save triggers per second. Naive saves on every token cause excessive disk I/O and iCloud churn.

**Decision:** `ConversationStore.save()` debounces 300 ms. `onunload()` calls `await conversationStore.flush()` for guaranteed persistence on app close.

**Consequence:** Up to 300 ms of the most recent turn may be lost on hard crash. On clean shutdown, all data is written.

---

## ADR-008 — Chapter names reused for favorites, no API call

**Status:** Active

**Context:** Earlier versions called a dedicated `generateFavoriteName()` API on every star click.

**Decision:** Favorite label taken from the preceding user turn's `chapterName`. Falls back to first 40 chars of the assistant message. `generateFavoriteName()` removed from all provider files.

---

## ADR-009 — Vitest for pure-function tests, no Obsidian mock

**Status:** Active

**Context:** Full integration testing would require a running Obsidian instance, which is impractical in CI.

**Decision:** Vitest unit tests cover only pure functions with no DOM or Obsidian API dependencies. 48 tests, ~200 ms.

---

## ADR-010 — Cross-device sync via polling, not file-system events

**Status:** Active

**Context:** `vault.on("modify")` does not fire for `.obsidian/` system files. No file-system watcher is available at the Obsidian plugin API level. Without detection, the running instance overwrites another device's changes on the next save.

**Decision:** `watchDataJson()` polls `adapter.stat()` every 5 s. When `mtime` advances and the change wasn't by this instance (3 s own-write grace window), `loadPluginData()` is called and the sidebar reloads.

**Consequence:** Up to 5 s lag between a remote write and local refresh. Polling is a known Obsidian plugin pattern for detecting external file changes. If the API adds file-system events in a future version, the polling can be replaced.

---

## ADR-011 — iCloud eviction guard in loadPluginData, not persistData

**Status:** Active

**Context:** When iCloud evicts `data.json` to cloud-only storage, `loadData()` returns empty. If unchecked, `persistData()` writes `conversations: []` back to disk on the next save, permanently wiping all conversations. Earlier guard was in `persistData()` and blocked ALL saves to an empty list — including the user deliberately deleting the last conversation.

**Decision:** Guard moved to `loadPluginData()`. Before overwriting `this.conversations`, if the loaded array is empty but in-memory state is non-empty, the load is refused and existing state is preserved. `persistData()` is unconditional.

**Consequence:** User-initiated "delete all" works correctly. iCloud eviction no longer causes data loss. The guard cannot distinguish between "iOS deleted all conversations" and "iCloud eviction" — it errs on the side of caution (keeps in-memory state).

---

## ADR-012 — Diagram copy button inside container, not sibling

**Status:** Active (supersedes earlier sibling-toolbar approach)

**Context:** Earlier implementation placed a `.p-diag-toolbar` sibling div above the diagram container (always visible) because an absolute button inside an `overflow-x: auto` container was believed to be clipped or scroll with the content.

**Discovery:** With the correct CSS parent chain (`overflow-x: hidden` on `.p-chat`, `min-width: 0` on flex ancestors), the diagram container has a definite CSS width equal to the panel. An `absolute`-positioned button at `top: 6px; right: 6px` within a `position: relative` container sits within the padding box — it is NOT clipped by `overflow-x: auto` and does NOT scroll with the SVG content.

**Decision:** Copy button placed inside `.block-language-mermaid` with `position: absolute`. Hover-to-reveal via CSS (`:hover` on desktop, always visible via `@media (hover: none)` on touch).

**Consequence:** The button is visually integrated with the diagram (appears in the corner on hover), doesn't consume extra vertical space above the diagram, and stays pinned to the visible area as wide diagrams are panned.

---

### ADR-14 — Inline optimizer review flow (in-conversation, not input prefill)

**Context:** The original `PromptOptimizerService.run()` optimized a prompt and prefilled the result straight into the textarea of a new conversation. Users had no way to compare the optimized version against their original input, or reject it without losing their work.

**Decision:** Add a separate `optimizeText()` path that keeps the interaction entirely in the current conversation's message stream. The original input appears as a ghost preview bubble; the optimized result appears as a bordered result bubble with three action buttons — "Use this" (confirms + sends), "Discard" (restores original), and "↺" (re-runs the optimizer). State is held in a transient `optimizationState` object on `PythiaSidebarView`; nothing is persisted until the user confirms.

**Consequence:** Users can review and compare before committing, try multiple versions, and still fall back to their original prompt. The existing `run()` command (palette → new conversation from prompt) is unchanged.

---

### ADR-013 — Promise-based confirm chip before all vault writes

**Context:** The LLM can be given `create_note`, `prepend_note`, and `rewrite_note` tools. Early versions executed write tool calls immediately on the LLM's request, with no user confirmation step. This led to uninvited vault modifications (e.g. the LLM silently rewriting a note when the user only asked for a critique).

**Decision:** Every tool call that writes to the vault is intercepted in `onToolCall()` (sidebar.ts) before execution. A confirm chip is rendered in the message stream showing the operation and file name, with an action button (Create / Overwrite / Prepend) and a Cancel button. The callback returns a `Promise<boolean>` that resolves only when the user clicks one of those buttons, effectively pausing the LLM stream. If the user cancels, the chip shows "Cancelled" and an error string is returned to the LLM as the tool result, which typically causes it to reply in chat instead.

**Consequence:** No vault write can happen without explicit per-operation user approval. The `enableNoteCreation` setting (which previously toggled whether the LLM received the create tool at all) was removed — the confirm chip makes that toggle redundant.

---

### ADR-016 — BaseProvider abstract class

**Context:** `AnthropicService` and `OpenAIProvider` had identical field layouts (`app`, `settings`, `apiKey`, `abortController`), identical concrete lifecycle methods (`abort`, `updateSettings`, `updateApiKey`), and structurally parallel implementations of six generate* utility methods with the same prompts and only the API call differing.

**Decision:** Extract an abstract `BaseProvider` class in `services/BaseProvider.ts`. Shared fields and lifecycle methods are concrete in the base. The six generate* methods are also concrete in the base, delegating the actual API call to an abstract `callUtility(model, userMessage, maxTokens, systemMessage?)` hook. Each provider implements `callUtility` (one API call + response extraction), `resetClient`, `fastModel`, `assistantLabel`, and `resolveModel`. `streamMessage` remains fully abstract and provider-specific.

**Consequence:** ~105 lines removed from AnthropicService, ~130 from OpenAIProvider. Adding a third provider (e.g. Google Gemini) only requires implementing five focused abstract members plus `streamMessage`.

---

### ADR-017 — ToolHandler as an injected class, not a function with a passed writer

**Context:** `ToolHandler.ts` originally exported a standalone `executeToolCall(writer, call)` function. Every call site in `sidebar.ts` passed `this.plugin.noteWriter` explicitly, coupling the sidebar to `NoteWriter` for no reason other than forwarding it to another module.

**Decision:** `executeToolCall` is replaced by a `ToolHandler` class whose constructor receives `NoteWriter` as a dependency. `plugin.toolHandler` is constructed once in `main.ts` after `plugin.noteWriter`. `sidebar.ts` calls `this.plugin.toolHandler.execute(call)` with no knowledge of `NoteWriter`.

**Consequence:** `sidebar.ts` no longer imports or references `NoteWriter`. The `NoteWriter` dependency is expressed structurally (constructor injection) rather than at every call site. Tests construct `new ToolHandler(mockWriter)` directly.

---

### ADR-018 — sidebar.ts split stopped after two controller extractions

**Context:** `sidebar.ts` was ~2,374 lines. The suggestion (#11) was to split it into dedicated sub-component files. Two controllers were extracted: `OptimizationController` (inline prompt optimizer state) and `NavigatorController` (`#` navigator popover), reducing the file to ~2,112 lines.

**Decision:** Stop further decomposition. The remaining code in `sidebar.ts` is the `PythiaSidebarView` class body — DOM construction, message rendering, streaming, event wiring. Extracting it further would require large `Deps` interfaces to forward `app`, `plugin`, DOM refs, and callbacks into each sub-class. This adds boilerplate without real testability gains: the DOM coupling to Obsidian's `ItemView` lifecycle means unit tests still cannot exercise these components in isolation. Performance is unaffected (esbuild bundles all files identically). The two extracted controllers represent the natural seam — self-contained state machines with clear inputs/outputs — not an argument for splitting everything else.

**Consequence:** sidebar.ts remains a large file by line count. The extractable controllers (those with self-contained state) have been moved. The view body stays co-located, which is the correct trade-off given the DOM-coupled architecture.

---

### ADR-020 — Incremental DOM rendering in `renderMessages`

**Status:** Active

**Context:** `renderMessages()` previously called `messagesEl.empty()` followed by re-rendering every message via `MarkdownRenderer.render()` on every `setActiveConversation()` call. The 5-second cross-device sync poller calls `setActiveConversation()` for the currently open conversation each time it fires — causing the full DOM to be torn down and rebuilt even when nothing changed.

**Decision:** Track two fields on the view — `renderedConvId` and `lastRenderedMsgId`. `renderMessages` has three paths:
1. **Skip** — same conversation, tail message ID unchanged → only handle scroll and long-press wiring, no DOM work.
2. **Append-only** — same conversation, `lastRenderedMsgId` found in `conv.messages`, new messages after it → append only the new rows. Used e.g. when sync reload finds messages added from another device.
3. **Full rebuild** — different conversation, or anchor message not found (delete-last-exchange invalidated it).

`sendMessage()` and `confirmDeleteLastExchange()` update `lastRenderedMsgId` directly since they manipulate the DOM without calling `renderMessages`.

**Consequence:** The 5-second sync poller no longer causes visible DOM flicker on long conversations. Conversation switches still do a full rebuild (unavoidable). The incremental path is correct under delete-last-exchange because the deleted message ID falls out of `conv.messages`, triggering the full-rebuild fallback on the next `renderMessages` call.

---

### ADR-019 — All services must implement `updateSettings`; `reloadFromDisk` propagates

**Status:** Active

**Context:** `loadPluginData()` builds `this.settings = Object.assign({}, DEFAULT_SETTINGS, saved)` — a **new object** every call. Services that stored `this.settings` at construction time (or via a prior `updateSettings()`) held stale references after a cross-device sync triggered `reloadFromDisk()`. Prior to this fix, `saveSettings()` notified only `templateLoader` and `noteWriter`, and `reloadFromDisk()` notified nobody.

**Decision:** The `LLMProvider` interface gains `updateSettings(settings)`. `LLMRouter` forwards the call to all providers. `PromptOptimizerService` adds `updateSettings`. `reloadFromDisk()` calls `updateSettings` on `llmRouter`, `templateLoader`, `noteWriter`, and `promptOptimizerService` immediately after `loadPluginData()`. `saveSettings()` does the same for consistency (harmless for the in-place mutation path; required for correctness if the path ever changes).

**Consequence:** Any new service that reads from `this.settings` must also accept `updateSettings(settings: PythiaSettings): void` and be registered in both `reloadFromDisk()` and `saveSettings()`.

---

### ADR-15 — Prompt framework as a settings-level default, not per-message

**Context:** Structured prompting frameworks (RACE, COAST, RISEN, CARE) improve optimizer output quality, but requiring users to select a framework on every optimize action adds friction.

**Decision:** Expose `defaultPromptFramework` in Settings → Pythia (dropdown: None / RACE / COAST / RISEN / CARE). The inline optimizer appends `"Apply the ${framework} prompt framework."` to the user message when a framework other than "none" is selected. The setting is global, not per-conversation, since framework preference is personal rather than context-specific.

**Consequence:** Simple, low-friction. Users set it once. If they need a different framework for a specific prompt they can temporarily switch settings — acceptable given this is an optimizer, not a per-message control.

---

### ADR-021 — `resumeMode: "summary"` gates the API request, not `conv.messages`

**Status:** Active

**Context:** `resumeMode` was stored on every conversation and exposed in Settings with copy promising "lower token cost," but `AnthropicService`/`OpenAIProvider` always sent the full `conversation.messages` history regardless of its value — the field had no effect on the actual API request. Its only real effect was in `main.ts` `cmdResumeConversation`: choosing "summary" set `conv.messages = []`, permanently deleting the transcript from the conversation object with no backup, the moment the user picked that option.

**Decision:** Add `selectHistoryForSend(messages, resumeMode)` (`services/messageUtils.ts`) — returns `[]` for `"summary"`, the messages unchanged for `"full"`/undefined. Both providers call it when building `historyMessages`, relying on `summaryText` already present in the system prompt (`ContextBuilder.buildSystemPrompt`) as the only context sent in summary mode. `cmdResumeConversation` no longer clears `conv.messages` — history is preserved for UI/scrollback and for switching back to `"full"` later.

**Consequence:** The token-cost trade-off the setting always claimed to make is now real, and resuming in summary mode is no longer destructive. `conv.messages` and "what's sent to the API" are now explicitly decoupled concepts; any future per-conversation trimming should extend `selectHistoryForSend`, not mutate `conv.messages`.

---

### ADR-022 — Retry only while no tokens have been emitted for the current attempt

**Status:** Active

**Context:** A transient `rate_limit` (429) or network failure previously failed the whole turn immediately, even though these are often momentary. A naive retry-the-whole-request approach risks duplicating output if a connection drops mid-stream after some tokens were already forwarded to `onToken`.

**Decision:** `services/retry.ts` exports `isRetryableError` (true only for `classifyApiError` results `"rate_limit"`/`"network"`, false for aborts) and a two-step `RETRY_BACKOFF_MS` schedule. Each provider tracks the emitted-text length at the start of an attempt; on failure, it retries with backoff only if that length hasn't grown (Anthropic: per tool-loop round-trip, checked against `fullText`; OpenAI: naturally satisfied since `chat.completions.create()` rejects before any chunk is consumed).

**Consequence:** Momentary rate limits/network blips are now often invisible to the user. A failure after partial output still surfaces immediately as before — no risk of duplicated or interleaved partial responses.

---

### ADR-023 — Anthropic prompt caching required bumping the pinned SDK version

**Status:** Active

**Context:** The system prompt and tool definitions are identical on every turn of a conversation and are often the largest stable part of the request, but nothing was cached — each turn re-sent and re-billed them in full. The pinned `@anthropic-ai/sdk` (`^0.28.0`) only exposed `cache_control` under the old `client.beta.promptCaching.messages` beta namespace (different types from the main Messages API); using it would have meant swapping every Anthropic type reference in `AnthropicService.ts`, not just adding two fields.

**Decision (confirmed with the user before proceeding):** Bump `@anthropic-ai/sdk` to `^0.40.0` — the smallest version confirmed to carry `cache_control` in the main (non-beta) Messages API types — rather than jumping to latest or using the beta endpoint. `system` is now sent as `[{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]`; the last tool in the tools array also gets `cache_control: { type: "ephemeral" }`, caching the whole tool-definitions block.

**Consequence:** Full `tsc`/lint/test pass confirmed no breakage in the 0.28→0.40 range for the APIs Pythia actually uses. OpenAI has no equivalent code path — its API already caches eligible prompts automatically server-side.

---

### ADR-024 — Temperature is optional and resolved per-request, not stored with a hard default

**Status:** Active

**Context:** Neither provider exposed any sampling control; both API calls only sent `model`/`max_tokens`/`system`/`messages`/`tools`. Users had no way to make responses more deterministic (factual Q&A) or more varied (brainstorming) short of switching models.

**Decision:** `temperature?: number` added to `PythiaSettings` (global default, `undefined` = don't send the field at all, i.e. defer to the API's own default) and to `PythiaTemplate`/`Conversation` (per-template/per-conversation override), resolved as `conversation.temperature ?? settings.temperature` — the same pattern as `maxTokens`. OpenAI's `o1`/`o3` reasoning-model family rejects a custom temperature (the same set that already can't take a system-role message, `NO_SYSTEM_ROLE_MODELS`), so the OpenAI provider resolves to `undefined` for those models regardless of settings.

**Consequence:** Existing conversations/templates without a `temperature` field are unaffected (field is optional, no migration needed). Users who want deterministic output for a specific template set it in that template's frontmatter; everyone else sees no behavior change.

---

### ADR-025 — Warn on oversized attached notes rather than silently truncating

**Status:** Active

**Context:** `ContextBuilder.buildAttachedNotesContent` inlined full note content with no size check. A large attached note can silently bury the user's actual question or crowd out room for the conversation itself, degrading answer quality with no visible symptom the user could diagnose.

**Decision:** Sum `estimateTokensFromText` (`services/messageUtils.ts`) across the inlined attached-notes content and compare against a new `maxAttachedNotesTokens` setting (default 8000, `0` disables). When exceeded, show a `Notice` (mirroring the existing `missingNotes` warning pattern) *before* sending — the request still goes through; the goal is visibility, not blocking, since occasionally sending a large note on purpose is legitimate.

**Consequence:** Users get a visible signal the first time this happens instead of silently wondering why answers seem to ignore their question. Paired with ADR-026, the common case (a long note with headings) is chunked automatically rather than just warned about.

---

### ADR-026 — Relevance ranking and chunking use keyword overlap, not embeddings

**Status:** Active

**Context:** Pythia is described as "RAG-powered" but had no retrieval at all — note attachment was 100% manual by path, discovery was plain filename substring matching, and long notes were inlined whole with no regard for what the user was actually asking. A full embedding-based semantic search (vector index, incremental re-embedding, an embeddings-capable provider even for Anthropic-only users) is a multi-day feature with product decisions (where the index lives, given ADR-003's `data.json` size concerns; which provider embeds when only an Anthropic key is configured) that shouldn't be made speculatively in the same pass as the other response-quality fixes here.

**Decision:** Ship a dependency-free, no-new-I/O approximation instead: `services/noteRelevance.ts` scores keyword overlap between a query and a haystack (deduped lowercase alphanumeric tokens). Two consumers:
- `ui/InlineSuggest.ts` (the `#` attach dropdown) ranks candidate notes by this score against each note's basename + frontmatter title + headings, read via Obsidian's already-cached `metadataCache.getFileCache()` — no per-keystroke disk reads. A filename match on the typed fragment still gates/dominates the result set; relevance is the tiebreaker, so it matters most when the fragment is empty or matches several notes equally.
- `services/noteChunking.ts` splits notes over `NOTE_CHUNK_THRESHOLD_CHARS` (4000) into heading-delimited chunks and keeps only the highest-scoring chunks (restored to original document order) up to the same budget, tagging the result `excerpt="true"` with a leading note in the inlined text. Notes without headings, or under the threshold, pass through unchanged — chunking without headings to split on isn't attempted.

**Consequence:** Meaningfully better note surfacing and less context dilution today, with zero new dependencies, no vector store, and no embeddings API requirement. True semantic search (embeddings/vector similarity) remains open as a follow-up — see the engineering review backlog — once this heuristic's real-world limits are understood.
