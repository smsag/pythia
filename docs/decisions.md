# Pythia — Architectural Decision Records

*Last updated: 2026-07-10 — ADR-036 (per-conversation temperature editing; fork carries temperature over).*

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

---

### ADR-027 — Prompt-tag and structured-output markers centralized in `promptConstants.ts`

**Status:** Active

**Context:** `ContextBuilder.ts` wrapped system-prompt-adjacent content in literal XML-ish tags (`<system_prompt>`, `<previous_conversation_summary>`, `<attached_note path="..." excerpt="true">`). `ToolHandler.ts`'s tool descriptions referenced the `<attached_note>` tag and its `path` attribute by name in hardcoded prose, independently of `ContextBuilder` — a rename in one would silently desync the other, since the LLM only sees prose, not a type error. Separately, `BaseProvider.generateSummaryWithTitle` demanded an exact `TITLE:`/`SUMMARY:` output format via a prompt string, parsed back by `messageUtils.parseTitleAndSummary`'s regex — the same fragile two-copies-of-one-literal problem.

**Decision:** New `services/promptConstants.ts` holds the cross-file literal contracts as named constants: `SYSTEM_PROMPT_TAG`, `PREVIOUS_SUMMARY_TAG`, `ATTACHED_NOTE_TAG`, `ATTACHED_NOTE_PATH_ATTR`, `ATTACHED_NOTE_EXCERPT_ATTR`, `TITLE_MARKER`, `SUMMARY_MARKER`. `ContextBuilder.ts` and `ToolHandler.ts` both import the attached-note tag/attribute constants; `BaseProvider.ts` and `messageUtils.ts` both import the TITLE/SUMMARY markers. The module holds only genuine cross-file contracts — single-file duplication (e.g. the "reply with only the title" phrase repeated across two `BaseProvider.ts` methods) stays a local constant in that file rather than being added here, to avoid building a generic prompt-builder abstraction.

**Consequence:** Renaming a tag or marker is now a one-line change with the type checker enforcing every call site updates together. Prompt wording sent to the LLM is unchanged (refactor is behavior-preserving); `PromptOptimizerService.ts`'s independent template-based convention was reviewed and intentionally left as a third, separate pattern — it has no XML tags or TITLE/SUMMARY contract to desync.

---

### ADR-028 — OpenAI reasoning-model handling unified in `models/knownModels.ts`

**Status:** Active

**Context:** `o4-mini` was listed as a selectable OpenAI model in three places (`settings.ts`, `ConversationSettingsModal.ts`, `sidebar.ts`'s abbreviation map) but was missing from `OpenAIProvider.ts`'s separately-maintained `NO_SYSTEM_ROLE_MODELS` set — the one list that actually gates request shape. Every request against `o4-mini` therefore sent a `system`-role message and a custom `temperature`, both rejected by OpenAI's o-series reasoning models, guaranteeing a 400 on a model the UI advertised as usable. Separately, reasoning models also reject `max_tokens` and require `max_completion_tokens`, which no code path handled.

**Decision:** `models/knownModels.ts` is now the single source of truth: `KNOWN_MODELS` (per-provider selectable models), `REASONING_MODELS`/`isReasoningModel()` (the o-series gate), and `MODEL_ABBREVIATIONS` (moved from `sidebar.ts`). `OpenAIProvider.ts` uses `isReasoningModel()` to decide `system`-role placement, temperature inclusion, and `max_tokens` vs. `max_completion_tokens` in both `callUtility` and `streamMessage`. `settings.ts` and `ConversationSettingsModal.ts` import `KNOWN_MODELS` instead of hardcoding their own lists.

**Consequence:** A model can no longer be "selectable" in the UI without also being correctly classified for request shaping — adding a model is a one-line change to one file. `o4-mini` now works end-to-end.

---

### ADR-029 — Token and cache usage accumulate additively across every tool-call round

**Status:** Active

**Context:** `AnthropicService.ts` already summed `input_tokens`/`output_tokens` across every round of the tool-calling loop; `OpenAIProvider.ts` instead kept only the most recent round's `chunk.usage`, silently discarding the cost of every round before the last. A multi-tool-call OpenAI turn therefore showed a materially undercounted token total in the sidebar. Separately, Anthropic's `cache_read_input_tokens`/`cache_creation_input_tokens` — the numbers needed to confirm prompt caching (ADR-023) is actually working — were read from the API response but discarded entirely.

**Decision:** `OpenAIProvider.ts` now accumulates `totalInputTokens`/`totalOutputTokens` the same way `AnthropicService.ts` does, only reporting `tokenUsage` when the API actually returned usage data (preserves the prior `undefined` behavior when it doesn't). `TokenUsage` (`models/types.ts`) gains optional `cacheReadTokens`/`cacheCreationTokens`, populated by `AnthropicService.ts` and surfaced via the new debug-log convention (ADR-033) rather than the sidebar UI — this is an observability fix, not a UI feature.

**Consequence:** Token totals are now correct for both providers regardless of tool-call rounds. Cache effectiveness is now visible with `debugMode` enabled, closing a blind spot where a caching regression could ship unnoticed short of a bill increase.

---

### ADR-030 — Abort signal captured once per streamMessage call

**Status:** Active

**Context:** Both providers reused `this.abortController.signal` inside the tool-calling round-trip loop. `BaseProvider.abort()` nulls `this.abortController` on any abort. If the user clicked Stop while a tool-confirmation chip was awaiting the user's click (`await onToolCall(...)`), the next round trip's request construction read `.signal` off a now-`null` controller, throwing a bare `TypeError` — caught by the outer handler, but `classifyApiError`'s `TypeError → "network"` fallback then misreported a clean user cancellation as "Network error."

**Decision:** Both providers capture `const signal = this.abortController.signal;` once, immediately after creating the controller, and use that local for every round trip instead of re-reading `this.abortController.signal`. An abort mid-loop now surfaces as a real `AbortError` from the SDK against the (already-aborted) captured signal, which the existing abort-classification path already handles as a clean `onComplete(fullText)`. `classifyApiError`'s network fallback was deliberately left as-is — the fix removes the only realistic source of a bug being masked by it; adding a heuristic there would be speculative.

**Consequence:** Clicking Stop during a pending tool confirmation now cancels cleanly with no crash and no misleading error Notice.

---

### ADR-031 — Retry extended to 5xx/529; tool-call loop is bounded

**Status:** Active

**Context:** `classifyApiError` only recognized 401/403/429/404 and a no-status case as retryable-adjacent classes; any 5xx (including Anthropic's `overloaded_error`, HTTP 529) fell through to `"other"` and was never retried, despite being exactly the transient capacity error the retry mechanism (ADR-recorded in the #43 resolution) exists for. Separately, both providers' tool-calling `while (true)` loops had no iteration cap — a model stuck calling the same tool repeatedly would loop indefinitely, burning API cost with no circuit breaker beyond the user manually clicking Stop.

**Decision:** `classifyApiError` gains a `"server_error"` class for HTTP 500–599 (covers 529 the same way, since it's exposed via the same `.status` property), and `retry.ts`'s `isRetryableError` treats it as retryable alongside `rate_limit`/`network`. Both providers now cap tool-call rounds at `MAX_TOOL_ROUNDS = 25`; exceeding it throws a new `ToolLoopLimitError` (`models/types.ts`), which propagates through the existing error path to a friendly Notice rather than a crash or a silent infinite loop.

**Consequence:** Transient provider-side overload now gets the same automatic retry as rate limits. A confused model can no longer loop unboundedly — it fails cleanly after a generous but bounded number of rounds.

---

### ADR-032 — Single active stream is a deliberate constraint, not an accidental gap

**Status:** Active

**Context:** Streaming/abort state (`isStreaming`, `AbortController`) is per-view and per-provider, not per-conversation — `LLMRouter.abort()` sweeps every provider regardless of which conversation is actually generating. Nothing previously stopped a user from switching to (or deleting) a different conversation while a stream was in flight: switching let a "Stop" click on an unrelated conversation abort the real generation, and the completing stream's `finalize()` would force-scroll and re-render whatever conversation happened to be displayed. Deleting a conversation mid-stream had a related failure — see ADR referenced in the #61 resolution below. Separately, a stream that failed with an error left its `.pythia-streaming` bubble stuck mid-render forever, with no console trace of the underlying error.

**Decision:** Rather than building true per-conversation concurrent streaming (separate abort controllers, a streaming registry, detached render targets — a multi-day feature disproportionate to a bug-fix pass), the existing single-stream constraint is made *correct*: `setActiveConversation()` and `handleDeleteConversation()` both block the action with a Notice while `isStreaming` is true for a different conversation. `sendMessage()`'s completion callback also gained a defense-in-depth check (`activeConversation?.id === conv.id`) before touching `messagesEl`/`autoScroll`, covering the view-teardown edge case. On error, the streaming bubble now always resolves — `console.error` logs the real error, and whatever partial text arrived is finalized (or the empty row removed) instead of being left stuck.

**Consequence:** Users can no longer accidentally abort or corrupt the wrong conversation's generation. True concurrent per-conversation streaming remains a considered-and-rejected alternative, recorded here rather than silently deferred, should the product ever need it.

---

### ADR-033 — `debugLog` convention; three previously-silent failure paths now log

**Status:** Active

**Context:** `debugMode` only ever logged the outgoing request payload in each provider, right before sending — nothing about retry attempts, tool-call round outcomes, or several genuinely swallowed errors (`TemplateLoader.loadTemplate`'s catch-all, `backfillChapterNames`'s catch, `CommandHubModal`'s fire-and-forget `action()`) was visible anywhere, with or without debug mode. This made "it just failed" or "it feels slow" bug reports nearly undiagnosable from the report alone.

**Decision:** `debugLog(settings, ...args)` (`services/messageUtils.ts`) is a 3-line helper — verbose, opt-in diagnostics only, gated on `debugMode`. Both providers now call it on each retry attempt and at the end of each tool-call round (where the token/cache accounting from ADR-029 becomes visible). Genuine errors get an *un-gated* `console.warn`/`console.error` instead, since they're one-time developer-facing signals that should be visible without opting into debug mode first: `TemplateLoader.loadTemplate`'s parse-failure catch, `backfillChapterNames`'s per-message catch (now matching the logging already present at its sibling call site), and `CommandHubModal.onChooseSuggestion`'s command-action catch (which also now shows a `commandFailed` Notice — previously a command failure was completely silent). `backfillChapterNames` also gained a small `Set<string>` in-flight guard to stop overlapping serial backfill runs on rapid re-open of the same conversation.

Deliberately not done: threading `settings`/logging into `ToolHandler.execute` — its errors already surface as visible strings in the confirmation chip, and `ToolHandler` is intentionally constructed with just a `NoteWriter` (prior extraction decision); adding a settings dependency there would be scope creep for no user-visible gain.

**Consequence:** Retry behavior, tool-round outcomes, and cache stats are now inspectable with `debugMode` on. Three previously-invisible failure modes (bad template frontmatter, chapter-name backfill failures, command-hub failures) now always produce a console trace, and the last of those also produces a user-visible Notice.

---

### ADR-034 — BaseProvider extraction extended; duplicate suggest modals merged

**Status:** Active

**Context:** `AnthropicService.ts` and `OpenAIProvider.ts` had two more byte-identical (or near-identical) blocks beyond what the original `BaseProvider` extraction (prior #32 resolution) covered: the attached-notes fetch + missing/oversized-note `Notice`s, and the abort-vs-error classification in each `catch` block. This duplication is exactly what let ADR-028's and ADR-029's bugs diverge between the two files in the first place — one file got the abort-null-pointer bug, the other got the token-undercounting bug, where a shared implementation would have had (and fixed) one bug instead of two different ones. Separately, `suggest/FileSuggest.ts` and `suggest/NoteSuggest.ts` were byte-for-byte identical `FuzzySuggestModal` subclasses differing only in placeholder/instruction copy.

**Decision:** `BaseProvider.ts` gains `resolveUserContent()` (attached-notes fetch + Notices + system-prompt build, returned together since both providers need all three) and `finishOrError()` (the shared abort-vs-error catch classification, reusing `retry.ts`'s already-exported `ABORT_ERROR_NAMES` rather than a third copy of that set). Both providers call these instead of duplicating the logic. `DEFAULT_MAX_TOKENS` (`promptConstants.ts`, added alongside the reasoning-model fix) replaces the `?? 4096` magic number in both. The two providers' actual streaming/tool-loop bodies stay separate — Anthropic's Messages API and OpenAI's Chat Completions API have genuinely different shapes there, and forcing a shared abstraction over that would violate the project's anti-premature-abstraction stance. `FileSuggestModal` gained an optional `{ placeholder?, selectInstruction? }` constructor parameter; `NoteSuggestModal` is now a one-line subclass passing note-specific copy, with zero call-site changes required.

**Consequence:** Less duplicated surface for future bugs to diverge across; renaming/fixing either shared behavior is now a one-file change. Both refactors are behavior-preserving and landed only after the bug fixes and their regression tests were already green, so a regression here couldn't hide behind a broken baseline.

---

### ADR-035 — Second-round bug-fix pass: streaming-guard gap, resume/eviction/frontmatter/deep-link races

**Status:** Active

**Context:** A follow-up three-agent audit, run after the first bug-fix pass shipped (1.21.1), found a second wave of concrete correctness bugs the first pass's scope didn't cover: a second, unguarded path into conversation deletion; a resume-with-summary flow that could resurrect a deleted conversation; conversation eviction that could crash on malformed data and only ever protected one sidebar leaf; silent multi-line YAML frontmatter corruption reachable directly by LLM tool output; a deep-link handler that double-decoded already-decoded text; and a summary-generation flow that could force-open the wrong conversation's summary panel. All were verified against source before fixing; the audit's remaining medium/low findings and pre-existing architectural backlog (#3 per-conversation storage, #50 embedding retrieval, #73/#74 caching/candidate-cap) were reviewed and explicitly deferred, not silently dropped.

**Decision, one entry per bug:**
- **Delete-via-picker bypass** (`sidebar.ts`): the conversation-switcher's delete callback (reached via `ConversationSuggestModal`) now gets the same `isStreaming` guard `handleDeleteConversation()` already had — a second entry point into the same code path needs the same protection, not a one-off fix.
- **Resume-mode race** (`main.ts`, `cmdResumeConversation`): after the (multi-second) summary-generation await, check the conversation still exists via `conversationStore.getById()` before reactivating it; show a Notice and bail instead of resurrecting a phantom conversation. Applied after both the `"summary"` and `"full"` branches, since the underlying risk (time passing while a modal is open) isn't specific to summary generation.
- **Eviction robustness** (`services/persistence.ts`, `main.ts`): `evictConversations`'s sort now tolerates a missing/invalid `updatedAt` (`(a.updatedAt ?? "").localeCompare(...)`) instead of assuming every record is well-formed, and the eviction call was moved inside `persistData`'s existing try/catch so a future edge case there can't silently break all future saves for the session.
- **Multi-leaf eviction** (same files): `evictConversations`'s third parameter widened from a single `activeId: string | null` to `activeIds: string[]`, collected from every open `PYTHIA_VIEW_TYPE` leaf instead of just the first — Pythia's view can legitimately be open in more than one leaf, and eviction must protect all of them, not just one.
- **Frontmatter merge** (`services/NoteWriter.ts`): `mergeFrontmatterFields` now groups each top-level frontmatter key together with its indented continuation lines (list items, block scalars) into one block before deciding whether to keep it, instead of capturing only the bare `key:` line and silently discarding everything under it. This is reachable directly by LLM tool output (`prepend_note`/`rewrite_note` with multi-line frontmatter), not just manual misuse.
- **Deep-link double-decode** (`main.ts`): the `inject` action's `decodeURIComponent(params.text)` was redundant — Obsidian's protocol handler already decodes URL params — and threw a `URIError` on any text containing a bare `%` (e.g. "50% off"), a common realistic input. Removed; `params.text` is used as-is.
- **Summary stale-conversation race** (`sidebar.ts`, `onGenerateSummary`): the UI side effects (`renderHeader()`, `updateSummaryBar()`, `toggleSummaryPanel()`) now only run `if (this.activeConversation?.id === conv.id)`, matching the pattern already established in `sendMessage()`'s completion callback — the summary itself always saves to the right conversation; only the UI reveal is guarded.

**Consequence:** All 7 fixes are behavior-preserving except for the two error paths that now show a Notice where they previously did nothing (resume-race, delete-while-streaming) — that's the intended visible improvement. New regression tests cover the eviction edge cases (malformed `updatedAt`, multi-leaf protection) and the frontmatter merge (list and block-scalar continuation lines, both new-key and existing-key cases). `sidebar.ts`/`main.ts` fixes have no dedicated unit-test suite (consistent with the rest of this codebase) and are verified by build/lint/test plus a documented manual-check list.

---

### ADR-036 — Per-conversation temperature is user-editable after creation; fork carries it over

**Status:** Active

**Context:** A user request to "allow setting temperature per template, overriding the default" turned out to already be fully implemented (ADR-024): `PythiaTemplate.temperature` is parsed and validated by `TemplateLoader.ts`, and every template-driven conversation-creation call site in `main.ts` already copies it onto the new `Conversation.temperature`, resolved by both providers as `conversation.temperature ?? settings.temperature`. Investigating this surfaced two related gaps: `cmdForkConversation` copied `provider`/`model`/`maxTokens` from the source conversation but not `temperature`, so forking silently reverted to the global default; and there was no UI to view or change a conversation's `temperature` after creation at all — it was fixed forever at creation time from template/global settings.

**Decision:** `cmdForkConversation` (`main.ts`) now also assigns `conv.temperature = source.temperature;`, the same idiom already used for the template-driven paths (`temperature` isn't a `createConversation()` constructor parameter, unlike `maxTokens`, so it's always set as a separate post-creation assignment — this was simply the one call site missing it). `suggest/ConversationSettingsModal.ts` (opened via the model badge) gains a third field alongside provider/model: a temperature text input, blank meaning "use the global default." Following this modal's existing convention, the value is only committed on the Save button click (not per-keystroke like the global settings tab). On Save, an out-of-range or non-numeric value shows `new Notice(t("invalidTemperature"))` and keeps the modal open with the input unchanged, rather than silently discarding it — a deliberate improvement over the equivalent field in `settings.ts`, which was flagged in the prior audit round as silently dropping invalid input with no feedback (still open there; not fixed by this ADR, but this new field was built correctly from the start rather than copying the known-bad pattern).

**Consequence:** Temperature can now be changed on any existing conversation, not just fixed at creation time from a template or the global default. Forking preserves whatever temperature the source conversation had. No test coverage added — `ConversationSettingsModal.ts` and `main.ts` have no dedicated unit-test suite, consistent with the rest of the modal/command-handler layer in this codebase; verified via build/lint/test plus a manual checklist.
