# Pythia — Architectural Decision Records

*Last updated: 2026-08-24 — ADR-064 (fork-origin highlight now uses the favorites highlighter mechanism — translucent `color-mix(var(--color-accent) 40%)` mirroring `--text-highlight-bg`, with a readable fallback instead of a solid accent fill).*

*Previously, 2026-08-24 — ADR-063 (max-tokens warning surfaced at the Send button when the effective max-tokens looks too low for the selected reasoning model — the truncation sharp edge of mid-conversation model switching, made visible before send; click opens settings).*

*Previously, 2026-08-24 — ADR-062 (client-executed `web_search` "research mode": a Pythia-run Tavily search exposed as a tool through the existing agentic loop, a per-conversation toolbar toggle, and a `<recent_context>` date/grounding block — recency for every provider without a provider-native search tool).*

*Previously, 2026-08-24 — ADR-061 (content-first summary generation prompts: conversation- and favorites-summary prompts now produce standalone recaps for inline display — banned "This conversation…"-style meta openers, direct fact-phrasing in favorites bullets, and an omittable Action-items section).*

*Previously, 2026-08-24 — ADR-060 (frame the previous-conversation summary as governing context: `PRIOR_SUMMARY_INSTRUCTION` now precedes the `<previous_conversation_summary>` block so forks/resumed conversations stay within the topic and scope of the conversation they continue).*

*Previously, 2026-08-24 — ADR-059 (fork anchor summaries generated via a long-press Open-fork menu — "Summarize conversation" always, "Summarize favorites" only when the fork carries favorites; anchor shows the type just generated; standalone "Summarize fork" button removed).*

*Previously, 2026-08-23 — ADR-058 (fork "branch-back": forked snippets are accent-highlighted in the source and expand an inline anchor with the fork's own summary + open/return links; fork carries the source summary as `forkedFromSummary` context, decoupled from its own `summaryText`).*

*Previously, 2026-08-23 — ADR-057 (summaries reworked into top-of-conversation "Speisekarte" cards, generated only via a long-press Send menu; removed the pinned summary panel, sparkle/refresh icons, favorites modal, auto-save-on-close and note-injection summaries).*

*Previously, 2026-08-23 — ADR-056 (highlight-favorite interaction fixes: tap-to-unfavorite with a relabeled toolbar button, surgical single-highlight removal, single-tap navigator jump, reordered selection toolbar).*

*Previously, 2026-08-23 — ADR-055 (summarize a conversation's favorites into Key learnings + Action items: reuse the utility-call path via `generateFavoritesSummary`, a pure `buildFavoritesDigest` input builder, modal preview with a result cached on the conversation).*

*Previously, 2026-08-23 — ADR-054 (favorites become highlighted text spans: `Favorite` model carries the selected `text`/`occurrenceIndex`; `ui/HighlightPainter.ts` re-finds and paints spans after every render; per-message star replaced by a selection-toolbar action; legacy favorites migrated by `normalizeFavorites`).*

*Previously, 2026-08-17 — ADR-053 (LLM response quality audit: 10-finding implementation — enriched default system prompt, structured grounding instruction, notes moved to system prompt, hybrid resume mode, context window budget trimming, paragraph-level fallback chunking, raised chunk threshold to 12K, always-include-first-chunk, improved CJK token estimation, default effort "high").*

*Previously, 2026-08-17 — ADR-052 (codebase audit: 22-finding cleanup — AbortController race, ConversationStore snapshot-based dirty clearing, writeMode enforcement, dead code/CSS removal, focus-visible accessibility, i18n lazy init, TemplateLoader validation).*

*Previously, 2026-08-17 — ADR-048 (unified model catalog), ADR-049 (BaseProvider concrete defaults), ADR-050 (`buildUI` decomposition + code-block extraction), ADR-051 (`createConversation` options object).*

*Previously, 2026-07-17 — ADR-047 (`buildStreamErrorMessage()` stops discarding the real diagnostic message for status-less Anthropic SDK errors that were being shown to users as a false "check your internet connection" claim).*

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

---

### ADR-037 — Temperature slider replaces text input; collapsible input area

**Status:** Active

**Context:** Two follow-up UX requests on the work from ADR-036. First, the temperature text field required typing a number and clicking Save, with a `Notice` on invalid input (`invalidTemperature`) — the user asked for a slider instead, defaulting to the effective value already in use elsewhere (`conversation.temperature ?? settings.temperature`). Second, there was no way to reclaim vertical space from the input area for the chat scroll area; three collapse patterns already existed in this codebase for other UI (the summary panel's class-toggle, long-message bubble collapse, navigator sections) but none for the input area itself.

**Decision:** `ConversationSettingsModal`'s temperature field is now a `SliderComponent` (`Setting.addSlider`, range 0–1, step 0.05, `setDynamicTooltip()`), initialized to `conversation.temperature ?? defaultTemperature ?? 1.0` (`1.0` being the real API default both providers fall back to when nothing is set — used only to position the slider, never written unless the user acts). The modal's constructor gained a `defaultTemperature?: number` parameter so it can compute this without reaching into `plugin.settings` itself; the sidebar's call site passes `this.plugin.settings.temperature`. Unlike an earlier draft that persisted on every drag, the slider follows the same draft-until-Save convention as provider/model in this same modal: dragging only updates a local variable, and the existing Save button assigns it to `conversation.temperature` alongside provider/model in one `onSave` call; Cancel discards it like any other field in the modal. Because a slider cannot produce invalid input, the `invalidTemperature` Notice/validation path was removed along with its now-dead i18n key.

For the input area, the user chose to mirror the summary panel's pattern exactly rather than a partial collapse (textarea only) or an animated resize: the whole `.p-input-area` (textarea + toolbar) collapses to a thin clickable bar via `toggleClass("collapsed", ...)`, an instant CSS `display` swap with no transition — consistent with the summary panel's precedent, not the textarea's separate animated-height precedent, since this is a whole-section collapse rather than a content resize. A single toggle icon button (Obsidian's `arrow-down`, via `setIcon`) sits in the toolbar to collapse; the same icon is reused (not swapped to a chevron) on the thin bar's expand button, so the control reads as one consistent affordance in both states rather than two different icons for what is the same action in reverse. `inputAreaCollapsed` is an ephemeral view-level field — like `summaryPanelOpen` — but deliberately does *not* reset on conversation switch, since it's a screen-real-estate preference independent of which conversation is open, not conversation state.

**Consequence:** Setting temperature is now a direct-manipulation slider consistent with the rest of the modal's Save/Cancel semantics, with one fewer invalid-input error path to maintain. The chat scroll area can be given significantly more vertical space on demand, with the collapse state persisting across conversation switches for the duration of the session (not across app restarts — it isn't persisted to `data.json`). No new test coverage — `sidebar.ts` and `ConversationSettingsModal.ts` remain outside this codebase's unit-test suite; verified via build/lint/test plus a manual checklist.

---

### ADR-038 — Summary trigger consolidated to the input-area sparkle; regenerate icon replaces the header sparkle

**Status:** Active

**Context:** The header carried its own always-visible sparkle button (`.p-hdr-sparkle`) that duplicated the input-area toolbar's sparkle (`toolbarSparkleBtn`) — both triggered `onGenerateSummary()`, and the header one additionally toggled the panel open/closed once a summary existed. This duplication predates this session's ADRs; it also stood in the way of a clean answer to "how do I look at the current summary vs. start a new one," since both buttons did the same overloaded thing (generate-or-toggle) with no dedicated regenerate affordance once a summary already existed.

**Decision:** The header sparkle button (`headerSparkleEl`, `.p-hdr-sparkle`) is removed entirely, along with its now-dead CSS (`.p-hdr-sparkle`/`.p-hdr-sparkle-active`). The input-area toolbar sparkle (`toolbarSparkleBtn`) becomes the single entry point and now carries the exact generate-or-toggle logic the header button used to have: no summary yet → `onGenerateSummary()` runs and auto-opens the panel on success (unchanged); a summary already exists → `toggleSummaryPanel()` opens (or re-closes) the panel showing whatever was last generated, without triggering a new LLM call. Starting a fresh summary once one exists is now a dedicated action: `updateSummaryBar()` renders a small refresh button (`.p-summary-refresh`, Obsidian's `refresh-cw` icon, 16×16px) next to the summary timestamp inside the open panel body, wired to the same `onGenerateSummary()`. Both the toolbar sparkle and this new refresh button share the existing `.p-sparkle-loading` pulse class during generation — `onGenerateSummary()` now toggles it on `summaryRefreshBtnEl` (nullable, rebuilt on every `updateSummaryBar()` call) in addition to `toolbarSparkleBtn`, so whichever control the user clicked shows the loading state, and the other stays in sync. The toolbar sparkle's click handler, previously a raw `addEventListener`, was upgraded to `registerDomEvent` while touching this line — a pre-existing violation of the project's event-cleanup rule, fixed opportunistically rather than left in place.

**Consequence:** One button in the input area now owns both "show me the summary" and "make a new one," with a clearly separate control for the latter once a summary exists — no more overloaded double-duty header icon, and no more two buttons doing the same thing. `docs/design.md`'s header and summary-bar component specs are updated to match (the header ASCII diagram drops the sparkle; the summary-bar section documents the toolbar trigger and the refresh icon's exact location). No test coverage added — `sidebar.ts` has no dedicated unit-test suite; verified via build/lint/test plus a manual checklist (generate from empty state auto-opens the panel; toggling with an existing summary opens/closes without a new LLM call; the refresh icon regenerates in place and shows the shared loading state).

---

### ADR-039 — Input-area minimize reworked: persistent toolbar, reference row folded in, expand-and-act icons

**Status:** Active

**Context:** Last session's collapsible input area (ADR-037) had three gaps once the user tried it in practice. First, "minimize the whole input area" was meant to include the reference/attached-notes row (`.p-ref-row`, the context-note pills shown above the textarea) — but that row is a separate sibling element with its own independent visibility logic, and stayed visible even when the input area collapsed. Second, collapsing hid the entire toolbar behind a single generic expand button (`.p-input-collapsed-bar`), so none of the toolbar's actions (attach/save/sparkle/optimize/template) were reachable without expanding first — the user wanted all of them usable directly from the minimized state, with a click both expanding the input area and firing that icon's action in one step. Third, ADR-037 deliberately reused the same `arrow-down` glyph for both collapse and expand; the user now wants a directional pair instead.

**Decision:** The two-row design from ADR-037 (a full toolbar for expanded, a separate `.p-input-collapsed-bar` for collapsed) is replaced with **one persistent toolbar** that stays visible in both states — only `.p-textarea`, `.p-send`, and the reference row hide when collapsed. Because collapsed and expanded now share the literal same toolbar element, icon order is identical in both states with no extra bookkeeping. The toggle button (`inputCollapseBtn`, promoted from a local variable to a field so `toggleInputArea()` can update it) swaps both icon and tooltip on every toggle — `arrow-down`/`minimizeInputTooltip` when expanded, `arrow-up`/`expandInputTooltip` when collapsed — reversing ADR-037's same-icon-both-directions choice now that a distinct expand affordance is wanted. The five action buttons (`attachBtn`, `saveBtn`, `toolbarSparkleBtn`, `optimizeBtnEl`, `applyTemplateBtn`) each call a new `ensureInputExpanded()` helper before their existing logic, so clicking any of them while minimized expands the input area and performs the action in the same click; the toggle button itself is the one exception, staying a pure collapse/expand toggle with no side effect. `attachBtn`/`saveBtn`'s raw `addEventListener` calls were upgraded to `registerDomEvent` while touching this code (a pre-existing violation of the project's event-cleanup rule, same opportunistic fix pattern as ADR-038). The reference row's visibility is no longer split across two independent inline-style writers (`renderReferencePills()` and, previously, nothing for the collapse case); a new `referenceRowHasEntries` field plus `updateReferenceRowVisibility()` compute it from both conditions (`hasEntries && !collapsed`) in one place, called from both `renderReferencePills()` and `toggleInputArea()`, avoiding a CSS specificity fight between class-based collapse state and the row's existing entries-based inline `style.display`.

**Consequence:** Minimizing the input area now genuinely reclaims the reference row's space too, not just the textarea. Every toolbar action stays one click away even when minimized, instead of requiring an expand-then-click round trip. No new i18n keys — `minimizeInputTooltip`/`expandInputTooltip` already existed from ADR-037 and are now actually used for both directions instead of being fixed one-per-button. No test coverage added — `sidebar.ts` remains outside this codebase's unit-test suite; verified via build/lint/test plus a manual checklist (attach a note, collapse — pill row disappears with the textarea and Send; click any action icon while collapsed — expands and fires immediately; toggle icon itself only expands, no side action; icon is `arrow-down` expanded / `arrow-up` collapsed; expanding again restores the reference row only if it still has entries).

---

### ADR-040 — `effort` added as a first-class parameter; temperature/effort UI gating extended to both settings surfaces

**Status:** Active

**Context:** #86 fixed live 400s caused by sending `temperature` to models that reject it outright, but the fix was backend-only — the settings tab and conversation modal still showed the temperature control as fully active on those models, silently no-opping the user's input with no explanation. Separately, the same newer models (plus OpenAI's o-series reasoning models) support an `effort` parameter controlling reasoning depth — a different axis from temperature, and the closest thing either provider offers as a steering knob on models where temperature is gone. The request was to (1) make temperature visibly inactive when unsupported, and (2) add `effort` as a global setting + template-frontmatter override, for both providers, with the same treatment.

**Decision:** `effort` follows the exact override-layering `temperature` already has: `PythiaSettings.effort` (global default) → `PythiaTemplate.effort` (frontmatter) → `Conversation.effort` (per-conversation), propagated at the same 6 call sites `temperature` is (`main.ts` ×4, `sidebar.ts` ×1, plus the fork-copy site). The real API scale differs by model — Anthropic's newest models support `low`/`medium`/`high`/`xhigh`/`max`, older effort-capable Anthropic models cap at `max` without `xhigh`, and OpenAI's o-series caps at `low`/`medium`/`high` — but the app-wide `EffortLevel` type is capped at **`"low"|"medium"|"high"` uniformly**, deliberately sacrificing Anthropic's top two levels so the same value is valid input for both providers with zero mapping/clamping logic anywhere in the codebase. Model-capability gating in `models/knownModels.ts` mirrors the existing `isReasoningModel()`/`supportsTemperature()` pattern: `ANTHROPIC_EFFORT_MODELS`/`supportsEffort()` is an **allow-list** (unlike `ANTHROPIC_NO_TEMPERATURE_MODELS`'s deny-list) since effort is newly-added-for-some rather than removed-for-some; OpenAI's side reuses the existing `isReasoningModel()` gate rather than a new model set, since `reasoning_effort` applies to exactly the o-series models that already reject `temperature` — the two parameters are naturally mutually exclusive per model. `output_config.effort` isn't in the installed `@anthropic-ai/sdk`'s TypeScript types (`0.40.1`, confirmed by direct inspection of `node_modules`); rather than bump the SDK or cast the request literal, `AnthropicService` declares a local `AnthropicStreamParams = Anthropic.MessageStreamParams & { output_config?: {...} }` type and builds the request as a separately-typed `const`, which sidesteps TypeScript's excess-property check (that check only fires on object literals assigned directly into a strictly-typed slot, not on an already-typed variable passed through). OpenAI's `reasoning_effort` needed no such workaround — the installed `openai@6.37.0` SDK already types it natively. For UI gating, both `settings.ts` (global tab) and `suggest/ConversationSettingsModal.ts` (per-conversation) now call Obsidian's `Setting.setDisabled()` — no prior precedent for disabling in either file — wired into the existing provider/model dropdown `onChange` handlers (the settings tab's `addModelSetting()` gained an optional `onAnyChange` callback for this), with a shared `paramUnsupportedSuffix` i18n string appended to the description when disabled. One deliberate asymmetry: the temperature slider always writes its *effective* value back on Save (a slider can't represent "unset"), but the effort dropdown *can*, so it defaults to `conversation.effort ?? ""` (not the effective/resolved value) and only writes a real value if the user explicitly picks one — opening and closing the modal without touching effort does not silently pin the current default onto the conversation, unlike temperature's existing behavior.

**Consequence:** Users get a working, mutually-compatible effort control on both providers with no per-provider value translation to reason about, at the cost of Anthropic's top two effort levels never being reachable through the UI or template frontmatter (an accepted tradeoff, not a bug). Temperature and effort now honestly reflect what a given provider+model combination supports in both places a user configures them, closing the gap #86 left open. The global settings tab's gating is advisory rather than authoritative — it reflects `defaultProvider` + the corresponding `default*Model` setting, not every possible per-conversation override, since a conversation can independently pick a different provider/model. Regression tests added in `tests/knownModels.test.ts` (`supportsEffort`), `tests/AnthropicService.test.ts`, and `tests/OpenAIProvider.test.ts` (effort-gating `describe` blocks mirroring the existing temperature-gating pattern). No test coverage for the UI gating itself — `settings.ts` and `suggest/ConversationSettingsModal.ts` are outside this codebase's unit-test suite (same as prior UI-only ADRs); verified via build/lint/test plus manual-verification notes left for the user (switching provider/model should visibly disable the unsupported control in both places; a template with `effort: high` in frontmatter should land on `conversation.effort`).

---

### ADR-041 — PDFs sent as native document/file content blocks, dispatched by extension

**Status:** Active

**Context:** The user wants to attach a PDF as conversation context — specifically, a template that auto-attaches a PDF (`context_notes: [paper.pdf]`) and asks the model to summarize it. Every attach surface in the codebase (`suggest/FileSuggest.ts`, `ui/InlineSuggest.ts`, `utils.ts`'s `getFilesInFolder`) hardcoded `getMarkdownFiles()`/`.extension === "md"`, and `ContextBuilder.ts` read attached files as text via `vault.read()`, which produces garbage for binary content. Both Claude and GPT have built-in PDF understanding (text + visual layout) reachable through their respective SDKs.

**Decision:** PDFs are sent as native base64 `document` (Anthropic) / `file` (OpenAI) content blocks, not extracted locally — no PDF-parsing library, no PDF-specific chunking strategy, and confirmed by direct inspection of `node_modules` that both installed SDKs (`@anthropic-ai/sdk@0.40.1`, `openai@6.37.0`) already type these blocks natively, needing **zero** type workarounds (unlike `effort`'s `AnthropicStreamParams` intersection in ADR-040). No new persisted types: `Conversation.contextNotes`/`Message.attachedNotes`/`PythiaTemplate.contextNotes` all stay plain vault-path strings, dispatched on `path.toLowerCase().endsWith(".pdf")` at read time — the same "no type-level distinction, sniff at point of use" pattern as `isReasoningModel()`/`supportsEffort()`. `services/TemplateLoader.ts` needed no changes; its frontmatter parsing already accepts any path string unfiltered. A new `services/ContextBuilder.ts` function, `buildAttachedPdfs()`, sits alongside (not inside) `buildAttachedNotesContent()` — the two file kinds are fundamentally different at the wire level (inline text vs. a binary content block), and classifying paths independently means a third attachment kind later touches only one function. `BaseProvider.resolveUserContent()` splits `attachedNotes` by extension once, at the single point both providers funnel through, and returns `pdfAttachments` alongside the existing `userContent`/`systemPrompt`. Each provider splices document/file blocks onto the *last* user message immediately after `loopMessages` is built, deliberately **after** `normalizeMessages` runs — that function's same-role merge does string concatenation (`messageUtils.ts`) and would corrupt or crash on array content; `AnthropicService.ts` already had a same-shape precedent (`loopMessages.push({ role: "assistant", content: finalMsg.content as ... })` in the tool loop), while `OpenAIProvider.ts` needed a narrow cast instead since this is the first array-content message in that file. Base64 encoding (`arrayBufferToBase64()`, new in `services/messageUtils.ts`) is **`Buffer`-free** — chunked `btoa` over a `Uint8Array`, processing 0x8000-byte slices to avoid a call-stack overflow from spreading a huge array into `String.fromCharCode` — because Pythia's manifest sets `isDesktopOnly: false` and Node's `Buffer` is unavailable on Obsidian mobile (`main.ts`'s `legacyDecrypt` already documents this constraint, though that guard falls back to an empty string; PDF attach must actually work on mobile, so there's no equivalent fallback here). A hardcoded `MAX_PDF_FILE_SIZE_BYTES = 20MB` constant in `services/promptConstants.ts` — **not a user setting** — guards against Anthropic's ~32MB request-body cap (base64 inflates raw bytes ~37%, so 20MB raw leaves headroom for the encoded payload plus history/system-prompt/tools in the same request). This deliberately diverges from `maxAttachedNotesTokens`'s warn-not-block pattern (ADR-025): that setting is a soft quality tradeoff, but a PDF over the API's hard size cap will 400 regardless of preference, so oversized PDFs are skipped (with a `Notice`, new `oversizedPdfWarning` locale key) rather than sent and left to fail mid-stream. UI file pickers were widened in three of four places: `suggest/NoteSuggest.ts` gained a `getItems()` override (`getFiles()` filtered to `.md`/`.pdf`) covering both `sidebar.ts` attach call sites; `ui/InlineSuggest.ts`'s `#`-dropdown and `utils.ts`'s `getFilesInFolder()` got the same extension filter. `suggest/FileSuggest.ts`'s base class was deliberately left untouched — it's also used standalone for the prompt-optimizer-template picker (`settings.ts`), which must stay markdown-only since templates are always `.md` files with frontmatter.

**Consequence:** A template can now declare `context_notes: [paper.pdf]` with a "summarize this document" system prompt and get a genuine model-generated summary grounded in the PDF's actual content, with no extraction step to maintain. PDF content is resolved fresh on every send (never persisted as base64), matching how markdown-note content already works. One open item, deliberately not resolved here: whether OpenAI's reasoning models (`o3`/`o3-mini`/`o4-mini`) accept `file`-type content parts in Chat Completions at all has no documented answer available in this environment — no speculative `supportsPdf()` gate was added (unlike `supportsTemperature`/`supportsEffort`, which have documented capability tables); a real 400 there fails cleanly through the existing `onError` path and can be gated the same way if it surfaces. Test coverage: `tests/messageUtils.test.ts` (round-trip + chunk-boundary cases for `arrayBufferToBase64`), `tests/ContextBuilder.test.ts` (new `buildAttachedPdfs` describe block, `MockVault` extended with `readBinary`/binary seeding), `tests/AnthropicService.test.ts`/`tests/OpenAIProvider.test.ts` (new PDF-attachment describe blocks asserting the last message's content becomes an array with a document/file block plus trailing text when a PDF is attached, stays a string when it isn't, and stays a string when the PDF is oversized). Not verified in this headless environment, flagged for the user: whether Claude/GPT actually extracts and reasons over a real PDF's content end-to-end; OpenAI's exact `file_data` wire format (data-URL-prefixed, per public docs — not provable from the SDK's type comments alone); `arrayBufferToBase64`'s behavior in Obsidian's actual mobile WebView; real behavior at the 20MB size boundary.

---

### ADR-042 — Fork now awaits the source's summary before opening; input no longer pre-filled with the selection

**Status:** Active

**Context:** `cmdForkConversation` (`main.ts`) copies a source conversation's `systemPrompt`/`provider`/`model`/`maxTokens`/`temperature`/`effort` onto a new, message-less conversation, but never gave the fork any memory of what preceded it. If the source had no cached `summaryText` yet, forking fired an async, fire-and-forget `generateSummary(source)` call whose result was written only onto the *source* conversation (a caching side effect for future `resumeMode: "summary"`/re-fork use) — never onto the fork itself — and even that landed seconds after the fork had already opened. The user asked for the summary to be guaranteed part of the fork's context from the moment it opens, and separately, for the forked conversation's input box to stop being pre-filled with the text that was selected to trigger the fork.

**Decision:** Summary resolution now happens **before** `createConversation()` runs at all, `await`ed directly in the command handler instead of `.then()`-chained: if `source.summaryText` is already cached, it's copied straight onto the fork with no LLM call; otherwise `generateSummary(source)` is awaited (behind a `Notice(t("generatingSummary"), 0)` loading indicator, the same pattern `onGenerateSummary()` already uses in `sidebar.ts`), the result is cached on `source` as before, and then also assigned onto the new `Conversation` before the first `saveConversations()` call. No new delivery mechanism was needed — `ContextBuilder.buildSystemPrompt()` already includes `conversation.summaryText` in a `<previous_conversation_summary>` tag whenever it's set, independent of `resumeMode`, so setting the field is sufficient. This also let two now-redundant pieces of code be deleted: the async `.then()` block's post-hoc `renderForkBanner()` call and the public `renderForkBanner()` wrapper method on `PythiaSidebarView` itself (now dead — `setActiveConversation()` already triggers a full message rebuild that calls the private `renderForkBannerEl()` unconditionally when `conv.forkedFromId` is set, and `updateSummaryBar()` already runs as part of that same rebuild, so both the banner and the summary bar render correctly on the fork's first paint with no extra glue). Separately, `view.prefillInput(selectedText)` was removed from the end of `cmdForkConversation` — the forked conversation's input box now starts empty. `conv.forkedFromSelection = selectedText` is untouched, since the fork banner's selection excerpt (`renderForkBannerEl`, `sidebar.ts`) is a display concern independent of the compose box.

**Consequence:** Forking a conversation that already has a summary is unchanged — instant, no LLM call. Forking a conversation with messages but no summary yet now blocks on one LLM round trip before the new conversation opens (previously: instant open, summary arrived seconds later) — an explicit, requested tradeoff in exchange for the fork never being contextless even briefly. Forking an empty conversation is unchanged. No new types, settings, or locale keys — `generatingSummary`/`forkSummaryFailed` already existed. No test coverage added — `main.ts`'s command handlers have no dedicated unit-test suite (consistent with ADR-036, the prior fork-related ADR); verified via build/lint/test plus the manual checklist in this session's plan (cached-summary fork opens instantly with the bar already populated; uncached-summary fork shows the loading notice and opens with the bar already populated; empty-conversation fork shows neither; forked input box starts empty while the banner still shows the selection excerpt; a message sent in a forked conversation includes `<previous_conversation_summary>` in the system prompt per the `debugMode` console log).

---

### ADR-043 — Note-chunk/suggestion relevance scoring is IDF-weighted, not flat keyword overlap

**Status:** Active

**Context:** A user attached a 34KB multi-framework reference doc (documenting ~30 different diagram/canvas syntaxes) and asked for a "User Story Map." `ContextBuilder`/`selectRelevantChunks` (ADR-026) correctly identified the note as too large to inline whole and excerpted it down to the highest-scoring ~4,000 characters — but the LLM produced an *Opportunity Canvas* instead, because that section, not the User Story Map section, survived the excerpt. Root cause: `scoreRelevanceTokens()` gave +1 point per query token found anywhere in a candidate, with zero regard for how common that token was. Many of the doc's ~30 framework sections share generic vocabulary ("user," "solution," "outcome," "business"), so a large section built from that shared vocabulary could out-score — or tie and then win a tie-break by document position — the one section that actually matched the single truly distinctive query word ("story"). This is a real, reproducible failure mode of ADR-026's dependency-free heuristic, not a model-quality issue; verified directly against the real document that surfaced it (see Consequence).

**Decision:** Replace the flat keyword-overlap scorer with a smoothed inverse-document-frequency (IDF) weighted one — the same `ln((n+1)/(df+1)) + 1` formula scikit-learn's `TfidfVectorizer(smooth_idf=True)` uses. A query token's contribution to a candidate's score is now scaled by how many of the *other candidates in the same ranking batch* also contain that token: a token present in every candidate (e.g. "user," "canvas") contributes almost nothing since it can't discriminate between them, while a token present in only one or two candidates (e.g. "story") dominates. This is still zero-dependency, zero-I/O, zero-cost, and computed fresh per call from whatever candidate set the caller already has — a refinement of ADR-026's stated direction, not a reversal of it, and explicitly a cheaper alternative to full embeddings/vector search (discussed and deferred separately as too large a change to make speculatively). Because computing document frequency requires the full candidate set up front, `services/noteRelevance.ts`'s single-haystack functions (`scoreRelevance`/`scoreRelevanceTokens`) were replaced outright — not kept alongside — with batch equivalents (`scoreRelevanceWeighted`/`scoreRelevanceTokensWeighted`) that score every haystack in one call and return aligned-by-index results; both of the module's two consumers (`services/noteChunking.ts`'s `selectRelevantChunks`, `ui/InlineSuggest.ts`'s `#` dropdown ranking) migrated to the batch form, so the old functions had no remaining callers and were deleted rather than left as dead code, along with their tests. `tokenize()` itself is unchanged.

**Consequence:** Verified directly against the real document that surfaced the bug: re-running `selectRelevantChunks()` on it with a "build me a User Story Map" query now retains the `type: story` section and excludes `type: opportunity` (previously the reverse). Regression coverage added in `tests/noteChunking.test.ts` reproduces the failure shape generically (several sections sharing generic terms with the query, one section holding the single distinctive term) rather than depending on the specific uploaded file. `ui/InlineSuggest.ts`'s ranking has no dedicated unit-test suite (consistent with the rest of the UI layer); verified manually. This does not close the "true semantic/embedding retrieval" backlog item (engineering-review #50) — IDF weighting is still a bag-of-words heuristic with no notion of synonyms or meaning, just a better-calibrated one; full embeddings remains a distinct, larger follow-up if this proves insufficient in practice.

---

### ADR-044 — `maxTokens` brought to override-layering/UI parity with temperature/effort; default raised and made model-aware

**Status:** Active

**Context:** Investigating "is 4096 a reasonable token budget" surfaced that `maxTokens` was the only per-conversation generation parameter without any UI exposure. `Conversation.maxTokens`/`PythiaTemplate.maxTokens` already existed and were already fully propagated through `main.ts`'s `createConversation()` and every call site (including the fork path) — but there was no `PythiaSettings.maxTokens` global default and no field in either `settings.ts` or `suggest/ConversationSettingsModal.ts`, unlike `temperature`/`effort` which both got full three-level override treatment in ADR-040. The only way to set it at all was `max_tokens:` in a template's frontmatter; any conversation not created from such a template was silently stuck at the hardcoded `DEFAULT_MAX_TOKENS = 4096`. Separately, that default was identified as too conservative for how Pythia is actually used — templates are built to produce long structured output — and specifically risky for OpenAI's reasoning models (`isReasoningModel()`), which spend tokens from this same budget on internal reasoning before producing any visible output, risking a silently truncated or empty reply if the cap is too low.

**Decision:** `maxTokens` now follows the exact override-layering `temperature`/`effort` already have: `PythiaSettings.maxTokens` (global default) → `Conversation.maxTokens` (per-conversation, template-seeded or modal-edited) — resolved as `conversation.maxTokens ?? settings.maxTokens ?? resolveDefaultMaxTokens(model)`. The final fallback is new: `services/promptConstants.ts` raises `DEFAULT_MAX_TOKENS` from 4096 to 8192 and adds `DEFAULT_MAX_TOKENS_REASONING = 16384`, with `resolveDefaultMaxTokens(model)` picking between them via the existing `isReasoningModel()` check — reusing that function rather than introducing a new model-capability table, since the only variation that matters here (which models need a larger safety margin) is exactly what `isReasoningModel()` already identifies. `AnthropicService.ts`'s existing hoisted `const maxTokens = ...` line gained the extra `?? this.settings.maxTokens` step; `OpenAIProvider.ts` previously computed this inline via a duplicated ternary at the point the request object is built (inside the retry loop, once per branch) — this is now hoisted once alongside the already-hoisted `temperature`/`reasoningEffort` computations, matching `AnthropicService.ts`'s pattern and removing the duplication. UI-wise: `settings.ts` gained a global text-input `Setting` (Behaviour section, next to temperature/effort) following temperature's exact shape (blank = unset, validated on change) but validating a positive integer instead of a 0–1 float. `ConversationSettingsModal.ts` gained a per-conversation text-input field (constructor gained a `defaultMaxTokens?: number` parameter, mirroring `defaultTemperature`/`defaultEffort`) that pre-fills with the *effective* resolved value like temperature's slider does — but because it's a text field rather than a slider, it can also represent "no override" by being cleared, closer to effort's flexibility than temperature's fixed-value-only limitation. Deliberately **no** `Setting.setDisabled()` gating was added for `maxTokens`, unlike temperature/effort: every model on both providers accepts some form of output-token cap (`max_tokens` or `max_completion_tokens`, varying only by field *name* via `isReasoningModel()`, which the default resolver already accounts for) — there's no "this model rejects the concept outright" case the way there genuinely is for temperature/effort, so no reactive disabling was needed.

**Consequence:** Every conversation now gets the raised (8192, or 16384 for reasoning models) default unless explicitly overridden, closing the gap where only template-authored conversations could ever move off 4096. Regression tests added in `tests/promptConstants.test.ts` (`resolveDefaultMaxTokens`) and new `maxTokens resolution` describe blocks in `tests/AnthropicService.test.ts`/`tests/OpenAIProvider.test.ts` (mirroring the existing temperature-gating test style) cover all three resolution levels plus the reasoning-model field-name branch. Deliberately out of scope: no per-model output-ceiling table/clamping — real API-side max-output limits do vary by model, but building and maintaining that table is new capability-modeling work beyond what was asked; a value a given model actually rejects surfaces as a normal API error through the existing `onError` path, same as any other invalid request today. No test coverage for the UI fields themselves — `settings.ts`/`ConversationSettingsModal.ts` remain outside this codebase's unit-test suite (consistent with prior UI-only ADRs); verified via build/lint/test plus a manual checklist (global field persists and blank-vs-value round-trips correctly; per-conversation field pre-fills with the effective value and Save writes back a cleared field as `undefined`; a reasoning model with no override actually sends `max_completion_tokens: 16384` per the `debugMode` console log).

---

### ADR-045 — Mistral added as a third LLM provider; two-way-ternary bug class audited and closed

**Status:** Active

**Context:** Pythia's provider abstraction (`LLMRouter`'s `Record<Provider, LLMProvider>`, `BaseProvider`'s six shared `generate*` utility methods) was explicitly built to generalize beyond two providers, but had never actually been exercised with a third. Auditing the codebase before writing any Mistral code surfaced a real, latent bug class: several call sites resolved provider-specific behavior with a **two-way** `provider === "anthropic" ? X : Y` (or `=== "openai"`) ternary rather than an exhaustive check — `main.ts`'s `createConversation()` model-default resolution, `main.ts`'s API-key-presence check, and the temperature/effort availability gating in both `settings.ts` and `ConversationSettingsModal.ts`. Confirmed via `tsc -noEmit` that widening `Provider` to include `"mistral"` does **not** fail the build at any of these sites — a ternary silently falls through to its `else` branch for any value not explicitly checked, so a Mistral conversation would have silently inherited Anthropic's default model and settings-derived UI gating, with no compiler signal and no runtime error until a user noticed the wrong behavior. Only `Record<Provider, X>` object-literal sites (already used by `KNOWN_MODELS`, `LLMRouter.providers`) get caught by the compiler when a union member is added.

Mistral's exact wire-level API details (tool-calling schema, streaming chunk shape, system-role support, whether a reasoning-effort equivalent exists) could not be confirmed from documentation alone — several pages blocked automated fetching — so per the user's explicit direction ("lean first pass"), request-building code was written only after installing the real `@mistralai/mistralai` SDK and reading its actual `.d.ts` types, the same discipline ADR-041 already established for the PDF-attachment types.

**Decision, provider integration:**
- `models/types.ts`: `Provider = "anthropic" | "openai" | "mistral"`.
- Every two-way ternary found in the audit above was converted to an **exhaustive `switch`** with a `default: { const exhaustiveCheck: never = provider; throw ... }` case — mirroring the "single source of truth" motivation `models/knownModels.ts` already documents for `KNOWN_MODELS`. New `resolveDefaultModelForProvider()` (`models/knownModels.ts`) centralizes the model-default resolution that used to be an inline ternary at each of its two call sites; `main.ts` gained a matching `hasApiKeyFor(provider)` exhaustive-switch helper for the API-key-presence check; `settings.ts`'s `updateTempEffortAvailability()` and `ConversationSettingsModal.ts`'s `updateParamAvailability()` were both rewritten as exhaustive switches covering all three providers.
- `services/MistralService.ts` (new) extends `BaseProvider`, implementing the same five focused abstract members plus `streamMessage` that `AnthropicService`/`OpenAIProvider` do. It uses the SDK's `MistralCore` class plus the standalone `chatComplete`/`chatStream` functions (`@mistralai/mistralai/funcs/*.js`, unwrapped via `unwrapAsync`) rather than the full `Mistral` client class — the SDK's own `FUNCTIONS.md` documents this "tree-shakeable standalone functions" surface as the intended shape for bundle-size-conscious runtimes, which an Obsidian plugin is. Direct type inspection confirmed two things that let this pass be more complete than originally planned: Mistral's chat API has a native `system`-role message on every model (no OpenAI-o-series-style "inject as leading user message" workaround needed), and the `reasoningEffort` request field carries **no per-model restriction** anywhere in the installed types — unlike OpenAI's `reasoning_effort`, which is genuinely rejected outside the o-series. Both findings meant the plan's "defer effort" non-goal was reversed mid-implementation: `MistralService` wires `reasoningEffort` unconditionally, gated by a always-`true` `supportsMistralEffort()` (documented as such, not a placeholder for a future allow-list). PDF attachments remain out of scope this pass, as planned — unlike the effort case, no SDK type evidence surfaced either way, so `MistralService` shows a `Notice(t("mistralPdfUnsupported", {count}))` warning (not a silent drop) when PDFs are attached to a Mistral conversation.
- `models/knownModels.ts` gained `KNOWN_MODELS.mistral` (Mistral Large/Small, Codestral, Magistral Medium), `MODEL_ABBREVIATIONS` entries, and `MISTRAL_REASONING_MODELS`/`isMistralReasoningModel()` mirroring `REASONING_MODELS`/`isReasoningModel()` — Magistral (Mistral's reasoning line, analogous to OpenAI's o-series) spends output-budget tokens on internal reasoning the same way, confirmed via research that it can consume "2-5x" a standard call's output tokens, so `resolveDefaultMaxTokens()` (`promptConstants.ts`) now checks `isReasoningModel(model) || isMistralReasoningModel(model)` to pick the larger `DEFAULT_MAX_TOKENS_REASONING` for either provider's reasoning line.
- `LLMRouter`'s constructor gained a third `mistral: MistralService` parameter; its `Object.values()`-based `updateSettings`/`abort` loops needed no change, confirming the abstraction's original design intent. `main.ts` gained `plaintextMistralKey`, `MistralService` instantiation, and `setMistralKey()` mirroring the existing two key-setters exactly (no legacy-ciphertext migration path needed — Mistral has no history to migrate). `models/settings.ts` gained `mistralSecretName`/`defaultMistralModel`. `settings.ts`/`ConversationSettingsModal.ts` gained UI parity (key field, model dropdown, provider option). `services/TemplateLoader.ts`'s provider frontmatter validation literal was widened to accept `"mistral"`.

**Decision, two bonus shared-code fixes (not in the original plan, found during SDK type/error-class inspection):** Mistral's SDK uses different error conventions from Anthropic/OpenAI's — a client-aborted request throws `RequestAbortedError` (name `"RequestAbortedError"`, not the `"AbortError"` name Anthropic/OpenAI both use), and Mistral's own `MistralError` exposes the HTTP status as `.statusCode`, not the `.status` both other SDKs use. Both `services/retry.ts` (`ABORT_ERROR_NAMES`) and `services/apiError.ts` (`classifyApiError`) are shared across all three providers, so left unfixed these would have caused two real, silent Mistral-specific bugs: a user-initiated Stop click during a Mistral stream would have been misclassified as a genuine error (falling through `ABORT_ERROR_NAMES`'s name check) rather than a clean cancellation, and a real Mistral API error (e.g. an invalid key, 401) would have been misclassified as `"network"` (falling through the `.status`-only check to the "no status property" branch) rather than the correct `"invalid_key"` class, showing the user the wrong error message. `ABORT_ERROR_NAMES` gained `"RequestAbortedError"`; `classifyApiError` now reads `errRecord.status ?? errRecord.statusCode`.

**Decision, esbuild bundling:** Building against the installed SDK surfaced (only at `npm run build` time, not at `tsc -noEmit`) that `@mistralai/mistralai` unconditionally imports `@opentelemetry/api` — an interfaces-only, lightweight optional peer dependency — through an internal `ClientSDK` → `SDKHooks` → `initHooks()` → `TracingHook` chain that both the full `Mistral` client class *and* the leaner `MistralCore` construct at instantiation time, regardless of whether telemetry is ever used. (First hypothesis — that this was pulled in only via the full class's `.beta`/observability getters, and that `MistralCore` alone would avoid it — was tested by switching to `MistralCore` and rebuilding; the exact same resolution error persisted, disproving it. Root cause was found by tracing the compiled JS import graph directly via `grep -rln "extra/observability"` rather than trusting the types.) The fix is `npm install @opentelemetry/api` as a real dependency — confirmed lightweight (2.8MB, zero new vulnerabilities, interfaces-only). `MistralService.ts` still uses the leaner `MistralCore` + standalone-function API rather than reverting to the simpler full `Mistral` class, since that remains the SDK-documented best practice for a bundle-size-conscious environment even though it didn't turn out to be the fix for this particular error.

**Consequence:** Adding a fourth provider in the future will fail to compile at every ternary-turned-switch site until that provider's branch is added, closing the exact bug class this ADR's audit found — a real regression check for this: switching `defaultProvider` to Mistral now correctly resolves Mistral's own default model and settings, not Anthropic's, confirmed by `tests/knownModels.test.ts`'s new `resolveDefaultModelForProvider` coverage. Mistral gets full streaming, tool-calling, and temperature/effort/maxTokens parity with Anthropic/OpenAI — a more complete first pass than originally planned, because direct SDK type inspection (rather than assuming from public docs) found genuine capability (native system role, unrestricted `reasoningEffort`) instead of the absence the plan defensively assumed. The known cost: bundled `main.js` grew from 340KB to 680KB (roughly doubling) — `@mistralai/mistralai` plus its now-required `@opentelemetry/api` dependency is a meaningfully larger addition than either existing SDK was individually. This is recorded here as a known, accepted tradeoff of the integration, not a hidden regression. Test coverage: new `tests/MistralService.test.ts` (streaming happy path, temperature/reasoningEffort/maxTokens request shaping across all three resolution levels, tool-call round trip with cross-round usage summing, the abort-during-pending-tool-confirmation regression class per ADR-030, the bounded-tool-loop regression class per ADR-031, and the PDF-attachment warning path) mirrors `AnthropicService.test.ts`/`OpenAIProvider.test.ts`'s style but mocks the SDK's standalone-function module paths (`@mistralai/mistralai/core.js`, `funcs/chatComplete.js`, `funcs/chatStream.js`, `types/fp.js`) rather than a single mockable client class, since Mistral's leaner API surface has no such class to mock against. `tests/knownModels.test.ts` extended for `isMistralReasoningModel`/`supportsMistralEffort`/`resolveDefaultModelForProvider`. PDF support for Mistral and vision/image input remain explicit non-goals of this pass, deferred as follow-ups rather than guessed at.

---

### ADR-046 — Code-block/blockquote visual tokens unified with the app's existing "framed box" convention; new blockquote styling; stale doc references corrected

**Status:** Active

**Context:** The user shared three screenshots of AI-message rendering and said the code-block style didn't fit Pythia's design system. Investigation found this was actually two separate, differently-caused issues bundled under one complaint. First, fenced ``` code blocks (`.p-code-frame`) already had deliberate, ADR-004/ADR-012-documented Pythia CSS — but its background token, `var(--code-background)`, was never reconciled against the rest of the app: two other components that solve the identical visual problem (a bordered content frame — `.pythia-tool-call`, the tool-call confirmation chip, and `.p-msg-optimize-result`, the prompt-optimizer result bubble) already use `background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 6px;`, an established convention `.p-code-frame` didn't follow despite solving the same problem. Second, blockquotes (an LLM-quoted statement, with a fenced code block nested inside it, per one screenshot) had **zero** custom Pythia CSS at all — confirmed via grep, `blockquote` appeared nowhere in `styles.css` — so the purple-tinted left bar and italic text the user saw was pure unstyled Obsidian theme default; the nested code block inside it was already correctly wrapped and styled by the existing `.p-code-frame` logic (`decorateCodeBlocks` in `sidebar.ts` selects `pre` elements anywhere in the subtree, blockquote-nested or not), so only the blockquote wrapper itself needed work. Separately, both `CLAUDE.md` and `docs/design.md` cited `docs/pythia-v3.html` ("visual reference — open in browser before any UI work") and `docs/design-system.css` ("token definitions") as mandatory pre-work references; neither file exists in the repo or its git history — confirmed by a direct search including `git log --all`. The user asked to proceed without them, using `CLAUDE.md`'s approved-token table and `docs/design.md`'s prose as the source of truth, and to correct the stale references.

The user also asked for three specific additions while this area was already being touched: a small icon indicating a block is code, correctly and consistently sized copy/copy-confirmed icons, and no green for the copy-confirmed state.

**Decision:**
- **Background token unification** (`styles.css`): `var(--code-background)` → `var(--background-secondary)` at both use sites (`.p-summary-panel-body pre`, `.p-code-frame > pre`). No new token was added to CLAUDE.md's approved table — `--background-secondary` was already on it; the fix is reuse, not addition. `font-family: var(--font-monospace)` was also made explicit on both rules (previously relied on Obsidian's own default `pre`/`code` styling).
- **Dead-variable cleanup** (`styles.css`): `var(--scrollbar-thumb-bg, rgba(128,128,128,0.25))` (3 occurrences — `.p-code-frame > pre`, `.p-ai-body [class*='block-language-']`, `.p-scroll-frame`) referenced a custom property never defined anywhere in the repo, always silently resolving to its fallback. Simplified to the literal `rgba(128,128,128,0.25)`, matching the sibling `::-webkit-scrollbar-thumb` rules that already used the literal directly. Zero visual change — pure correctness cleanup, done while already touching this exact code.
- **New blockquote styling** (`styles.css`, `.p-ai-body blockquote, .p-summary-panel-body blockquote`): `border-left: 3px solid var(--background-modifier-border)` — the app's existing all-purpose divider/border token, deliberately **not** `var(--color-accent)`, since accent is reserved for interactive/active elements (user bubble, buttons, hover states) per CLAUDE.md's token table, and a blockquote is passive quoted content, not an interactive affordance. `padding-left: var(--s3)`, `margin: var(--s1) 0` — spacing-grid values matching the section's other block elements. `font-style: normal; color: var(--text-muted)` — overrides Obsidian's default italic (this app uses italics nowhere else) and marks quoted content as secondary text. No background/box on the wrapper — keeps the "AI message: plain text, no container" principle for the wrapper itself; a `.p-code-frame`-wrapped code block nested inside is unaffected and keeps its own box.
- **Inline single-backtick code** (`styles.css`, `.p-ai-body code:not(pre code), .p-summary-panel-body code:not(pre code)`): previously inherited Obsidian's own inline-code background/padding/radius by default (only `font-size` was overridden). Now explicitly `background: var(--background-secondary); border-radius: 4px; padding: 1px 4px; font-family: var(--font-monospace)` — same background token as block code, `4px` radius matching `.p-code-btn`'s already-established small-control radius. The `:not(pre code)` guard is required so this doesn't stack a second background on top of `.p-code-frame > pre`'s own background for code already inside a fenced block.
- **Code-block type indicator icon** (`sidebar.ts`'s `decorateCodeBlocks()`, `styles.css`'s new `.p-code-type-icon`): a small, **permanently visible** (not hover-gated like the copy button) Lucide `code-2` glyph pinned to the top-left corner of `.p-code-frame`, via `setIcon()` — mirrors the copy button's top-right position, and uses `setIcon()` rather than a custom inline SVG since CLAUDE.md's inline-SVG exception is reserved for the four named design-system icons (attach/save/sparkle/`#`), and this is a passive Obsidian-chrome-style glyph like the copy button already is. Scoped to fenced text blocks only — diagram blocks (`[class*='block-language-']`) are skipped, since a rendered Mermaid/PlantUML diagram is already visually self-identifying. Because it's always visible (not hover-revealed), `.p-code-frame > pre`'s top padding was widened (`8px 10px` → `22px 10px 8px`) to reserve a clear strip so the icon never overlaps the first line of code — the copy button didn't need this because it only appears on hover/touch, over content the user has already scrolled past visually.
- **Copy/copy-confirmed icon sizing and color** (`styles.css`'s `.p-code-btn`): the hit area (`22×22px`) was already fixed, but the icon *glyph* itself was never constrained — `setIcon()` swaps between the "copy" and "check" (copy-confirmed) Lucide icons, which don't share identical proportions, so the two states could render at visibly different sizes. Added `.p-code-btn svg { width: 14px; height: 14px; }`, applying equally to `.p-diag-copy` (diagram copy button) since it already shares the `.p-code-btn` class, and matching the same `14px` size on the new type icon so both corners of the frame read as one consistent icon language. `.p-code-copy.copied`'s color changed from `var(--color-green)` to `var(--color-accent)`, per explicit user instruction — accent is the token this app already uses for interactive/confirmation feedback (send button, hover states); green remains in the app (`.pythia-tool-call-link`, a tool-call "done" state) but for a distinct, persistent semantic state, not a momentary click acknowledgment, so reusing it here would have conflated two different kinds of feedback.
- **Stale doc references corrected**: `CLAUDE.md`'s repo-structure listing and design-system section, and `docs/design.md`'s header, no longer cite `docs/pythia-v3.html`/`docs/design-system.css`. `docs/design.md` is now named explicitly as the single source of truth for design rules in both places.

**Consequence:** Fenced code blocks now visually match the app's other framed-content components instead of using a one-off token; a blockquote (an increasingly common LLM output shape) finally has deliberate Pythia styling instead of rendering as raw, unreviewed Obsidian-theme default; code blocks are now self-identifying via a persistent icon even when collapsed/scrolled past the copy affordance; the copy-confirmation glyph is reliably sized and stays within the app's existing token language instead of introducing an unreviewed one-off green. `CLAUDE.md` and `docs/design.md` no longer point contributors at two files that were cited as mandatory pre-reading but have never existed in this repo. No TypeScript logic changed beyond the one new DOM element in `decorateCodeBlocks()` — `sidebar.ts`'s existing pre-wrapping/copy-button/drag-to-pan logic is otherwise untouched. No test coverage added — `sidebar.ts` and `styles.css` remain outside this codebase's unit-test suite (consistent with every prior UI-only ADR); verified via `tsc`/build/lint plus a manual checklist (fenced code block shows the type icon immediately without overlapping code text, copy → check swap is same-size and accent-colored, a blockquote renders with a neutral bar and no italic, a blockquote containing a fenced code block shows both correctly, inline single-backtick code gets a subtle background chip without doubling up inside a fenced block, and diagram blocks do not receive the type icon).

---

### ADR-047 — `buildStreamErrorMessage()` stops discarding the real diagnostic message for status-less errors

**Status:** Active

**Context:** A user ran a template (`provider: anthropic`, `model: claude-opus-4-8`, `effort: high`, a PDF attached) and got "Network error. Check your internet connection." even though their internet was fine. Root-caused by reading the installed `@anthropic-ai/sdk@0.40.1` directly (same discipline as ADR-041/ADR-045 — verify against real SDK code, not assumption): the SDK's own `APIError.generate(status, ...)` (`node_modules/@anthropic-ai/sdk/error.js`) collapses **any** status-less error into `APIConnectionError`, including two cases with nothing to do with the user's own connectivity — a mid-stream SSE `error` event (the stream already started with a 200; the backend reports a problem, e.g. capacity/overload, over the SSE channel itself, `streaming.js:59-61`), and `MessageStream`'s own catch-all, which re-wraps *any* exception thrown while processing the stream as a bare, status-less `AnthropicError` (`lib/MessageStream.js:40-58`). Verified directly via `node -e` that neither class overrides `.name` (both report `"Error"`), so `classifyApiError`'s `TypeError` check doesn't catch them — they fall straight through its broader `status === undefined → "network"` fallback (`services/apiError.ts:36`), same bucket as a real DNS/fetch failure. That classification isn't itself wrong for retry purposes — `isRetryableError` already treats `"network"` and `"server_error"` identically, so retries already happened correctly before the user ever saw a Notice. The actual bug was one step downstream: `sidebar.ts`'s `onError` callback discarded `error.message` entirely for the `"network"` class and substituted a hardcoded claim about the user's own connection, even though `.message` already held the real diagnostic text (for the SSE case, the backend's actual error payload).

ADR-030 previously reviewed this exact fallback and deliberately declined to add classification heuristics there ("adding a heuristic there would be speculative") — but that review only examined the `instanceof TypeError` branch (tied to the abort-signal-null bug it was fixing at the time), not this second, broader `status === undefined` fallback. This ADR doesn't reverse ADR-030's restraint or add a heuristic to `classifyApiError` itself — classification stays exactly as-is, `"network"` and all. The fix is narrower and doesn't require guessing *why* an error is status-less: stop throwing away diagnostic text the app already has.

**Decision:** The switch previously inlined in `sidebar.ts`'s `onError` callback moved, unchanged in behavior for every other case, into a new `buildStreamErrorMessage(error: Error, model: string): string` in `services/apiError.ts` — colocated with `classifyApiError()`, which it calls, and covered by the same test file (`tests/apiError.test.ts`) rather than left untestable inside `sidebar.ts` (which has no dedicated unit-test suite). For the `"network"` class specifically: if `error.message` is present, it's shown via a new `networkErrorDetail` locale key (`"Request failed: {{detail}}"`) instead of the generic connectivity claim; the original `networkError` string is kept only as a last-resort fallback for the rare case there's truly no message at all. Messages longer than 160 characters are truncated for Notice display (raw SDK/SSE payloads can be verbose JSON) — the untruncated error is already unconditionally logged via `sidebar.ts`'s existing `console.error("[Pythia] stream error:", error)`, unaffected by this change. `classifyApiError`, `retry.ts`, and every provider service file are untouched — retry behavior was already correct; this is purely a messaging fix for what happens after retries are exhausted.

**Consequence:** Users now see the real cause of a failed request instead of an assertion about their own internet connection that may well be false — for the triggering case (an overload/capacity error arriving mid-stream on a large `effort: high` request), the actual backend error text is now visible instead of a generic, misleading string. `services/apiError.ts` importing `../i18n` (a new dependency for that file, though already an established pattern elsewhere in `services/`, e.g. `BaseProvider.ts`) meant `tests/retry.test.ts` — which imports `retry.ts`, which imports `apiError.ts` — needed a minimal `vi.mock("../i18n", ...)` added, since `i18n.ts` reads `window.moment` at module load time and `window` doesn't exist in Vitest's Node environment; this mirrors the mock pattern already used in every provider test file. New tests in `tests/apiError.test.ts` cover `buildStreamErrorMessage`'s `ToolLoopLimitError` special-case, each unchanged friendly-string class, the `"network"` detail-surfacing behavior (including truncation), and the no-message fallback. While making this edit, an unrelated doc-integrity issue from the prior session was also fixed in passing: ADR-045's closing "Consequence" paragraph had been displaced to the very end of this file (after ADR-046) by an imprecise edit; it's now back in its correct place immediately after ADR-045's own content.

---

### ADR-048 — Unified model catalog replaces five parallel data structures

**Status:** Active

**Context:** `models/knownModels.ts` maintained five independently-updated data structures: `KNOWN_MODELS` (per-provider model lists), `MODEL_ABBREVIATIONS` (display labels), `REASONING_MODELS`/`isReasoningModel()` (OpenAI reasoning gate), `ANTHROPIC_NO_TEMPERATURE_MODELS`/`supportsTemperature()` (temperature deny-list), and `ANTHROPIC_EFFORT_MODELS`/`supportsEffort()` (effort allow-list). Adding a model required touching up to 5 separate lists, with no compiler signal if one was missed — the exact bug class that caused #51 (o4-mini) and #86 (temperature on new Anthropic models). The dead `o1`/`o1-mini` entries (removed from OpenAI's API, never reachable) were still present in `REASONING_MODELS`.

**Decision:** All five structures replaced by a single `MODEL_CATALOG: ModelInfo[]` array. Each entry carries the model `id`, `provider`, `abbreviation`, and boolean flags: `noTemperature`, `supportsEffort`, `isReasoning`, `isMistralReasoning`, `hidden`. All existing exports (`KNOWN_MODELS`, `MODEL_ABBREVIATIONS`, `isReasoningModel()`, `isMistralReasoningModel()`, `supportsTemperature()`, `supportsEffort()`, `supportsMistralEffort()`, `resolveDefaultModelForProvider()`) are now computed from `MODEL_CATALOG` via `.filter()` and `.find()` calls, preserving every call site's API unchanged. Dead `o1`/`o1-mini` entries removed.

**Consequence:** Adding a model is a one-line addition to one array. Model capability flags are co-located with the model ID, so it's impossible to list a model as selectable without also declaring its capabilities — the gap that caused #51 and #86 is structurally closed. All existing tests pass unchanged.

---

### ADR-049 — BaseProvider `assistantLabel` and `resolveModel` made concrete with default implementations

**Status:** Active

**Context:** `BaseProvider` declared `assistantLabel` and `resolveModel(override?)` as abstract, requiring every provider to implement them. In practice, `OpenAIProvider` and `MistralService` both returned `"Assistant"` from `assistantLabel`, and all three providers' `resolveModel` implementations were identical one-liners delegating to `resolveDefaultModelForProvider()` — three copies of the same code.

**Decision:** `assistantLabel` is now a concrete getter on `BaseProvider` returning `"Assistant"`. Only `AnthropicService` overrides it (returns `"Claude"`). `resolveModel(override?)` is now a concrete method on `BaseProvider` that calls `resolveDefaultModelForProvider(this.providerType, this.settings)`, using the new `providerType: Provider` field set by the constructor. Removed the redundant overrides from `OpenAIProvider`, `MistralService` (both `assistantLabel` and `resolveModel`), and `AnthropicService` (`resolveModel` only). Also removed the pass-through `streamMessage` wrapper from `BaseProvider` (consolidated into the inherited `streamMessage` from the template method).

**Consequence:** Fewer lines per provider. Adding a fourth provider only requires implementing `resetClient`, `fastModel`, `callUtility`, and the three streaming hooks — `assistantLabel` and `resolveModel` are inherited for free unless the provider needs custom behavior.

---

### ADR-050 — `buildUI` decomposed; `DeleteFileModal` and `CodeBlockDecorator` extracted from sidebar

**Status:** Active (extends ADR-018)

**Context:** `sidebar.ts`'s `buildUI()` was ~380 lines of sequential DOM construction — header, chat area, and input area built in one monolithic method. Additionally, `DeleteFileModal` (a `Modal` subclass) was defined inline in `sidebar.ts`, violating the project rule that all modals go in `suggest/`. Code block decoration (4 methods: `decorateCodeBlocks`, `fixDiagramSvgSize`, `wrapInScrollFrame`, `attachDragToPan`) was tightly coupled to `sidebar.ts` despite being self-contained rendering logic with no view-state dependencies.

**Decision:** `buildUI()` split into three builder methods: `buildHeader()`, `buildChatArea()`, `buildInputArea()`. Each returns `void` and appends to the container. `buildUI()` is now a 4-line coordinator that empties the container, adds the class, and calls the three builders. `DeleteFileModal` extracted to `suggest/DeleteFileModal.ts`. Code block decoration extracted to `ui/CodeBlockDecorator.ts` as four exported functions: `decorateCodeBlocks`, `stampSvgSize` (renamed from `fixDiagramSvgSize` for clarity), `wrapInScrollFrame`, `attachDragToPan`. A `scrollToTop()` helper replaced 3 duplicate `messagesEl.scrollTop = 0` blocks.

**Consequence:** `sidebar.ts` reduced from ~2,342 to ~2,028 lines. The builder methods are navigable by name without scrolling through unrelated DOM construction. Code block decoration is independently readable and could be unit-tested in the future. This is a continuation of ADR-018's decomposition, reaching into the areas that session identified as "the remaining DOM coupling" — the builder split works because it follows the natural sequential structure (header then chat then input) rather than trying to extract interleaved state.

---

### ADR-051 — `createConversation` changed from positional parameters to options object

**Status:** Active

**Context:** `main.ts`'s `createConversation()` took 8 positional parameters (`name`, `systemPrompt`, `contextNotes`, `templateId`, `provider`, `model`, `maxTokens`, `outputFolder`). Most call sites passed only `name` with the rest defaulting, but the template-driven path passed most of them — requiring careful positional alignment with `undefined` gaps. The URI "template" handler was missing `outputFolder` and `writeMode` entirely.

**Decision:** Changed to a single options object: `createConversation(opts: { name, systemPrompt?, contextNotes?, templateId?, provider?, model?, maxTokens?, outputFolder? })`. All 10+ call sites updated. Added `createConversationFromTemplate(tpl, contextNotes?)` helper that encapsulates the template-to-options mapping (including `outputFolder`, `writeMode`, `temperature`, `effort` post-creation assignments), replacing duplicated template-handling logic at two call sites. Added `resolveTemplateContext()` private helper for template context-note resolution. Deleted dead `cmdCopyConversationLink()`. Fixed the URI "template" handler to use `createConversationFromTemplate()`, inheriting the `outputFolder`/`writeMode` it was previously missing.

**Consequence:** Adding a new field to conversation creation is a non-breaking change (add an optional property). Call sites are self-documenting (`{ name: "..." }` vs. positional). The template-creation path is DRY and correct by construction — the URI handler bug (missing `outputFolder`/`writeMode`) was fixed as a natural consequence of the refactor, not a separate patch.

---

### ADR-052 — Codebase audit: 22-finding cleanup

**Status:** Active

**Context:** A comprehensive audit of the codebase identified 22 findings across critical, medium, low, and dead-code categories. Rather than addressing them in separate PRs, all were fixed in a single pass to minimize churn.

**Decision:** Key changes:
- **AbortController race** (BaseProvider): capture the controller in a local const and only null the instance field if it still points to the same controller, preventing a second concurrent request from nulling the first's abort handle.
- **ConversationStore snapshot-based dirty clearing**: replaced `clearDirty()` (which unconditionally emptied the set) with `snapshotDirty()` / `clearDirtySnapshot(snapshot)` so IDs added between the snapshot and the async `saveData()` completion survive for the next persist cycle. Added `cancelPendingPersist()` for `reloadFromDisk()`.
- **writeMode enforcement**: `ToolHandler.execute()` now accepts an optional `allowedTools` set; `sidebar.ts` derives it from `conv.writeMode` via `ToolHandler.allowedToolNames()`.
- **Fork field preservation**: `cmdForkConversation` now copies `contextNotes`, `resumeMode`, `outputFolder`, and `writeMode` from the source.
- **Dead code removal**: `supportsMistralEffort()` (always returned true), `getActiveConversationId()`, `getLastAssistantMessage()`, ~120 lines of dead CSS selectors.
- **Focus-visible accessibility**: added `button:focus-visible` rule (WCAG 2.4.7) to replace the blanket `outline: none`.
- **i18n lazy init**: locale detection deferred to first `t()` call, avoiding a module-load-order dependency on `moment`.
- **TemplateLoader validation**: frontmatter `name`, `model`, and `max_tokens` validated at the system boundary.

**Consequence:** No behavioral changes for users. ConversationStore's API is narrower and race-safe. Dead code removed reduces maintenance surface. Focus-visible restores keyboard accessibility.

---

### ADR-053 — LLM response quality audit: 10-finding implementation

**Status:** Active

**Context:** A structured audit of the LLM prompt-construction and response-quality pipeline identified 10 areas where the plugin's defaults, prompt engineering, or context management produced shallow or suboptimal LLM responses. Findings spanned: empty default system prompt, passive grounding instruction, notes buried in user message, no hybrid resume mode, no context window budget enforcement, heading-only chunking, small chunk threshold, no first-chunk inclusion, imprecise CJK token estimation, and no default effort level.

**Decision:** All 10 findings implemented in a single pass:

1. **Default system prompt** (`promptConstants.ts`): `DEFAULT_SYSTEM_PROMPT` provides explicit depth instructions — comprehensive answers, structured sections, specific details, and tone matching for simple questions. `buildSystemPrompt` always includes a system prompt (falling back to the default when none is set).

2. **Structured grounding instruction** (`promptConstants.ts`): `GROUNDING_INSTRUCTION` replaces the previous one-liner, instructing the model to synthesize across notes, cite paths, analyze rather than summarize, and explicitly flag missing information.

3. **Notes in system prompt** (`BaseProvider.ts`): Attached note content moved from the user message to the system prompt (`systemPrompt + attachedContent`), giving the model stable reference material it can attend to across the full conversation rather than treating it as one-shot user input.

4. **Hybrid resume mode** (`messageUtils.ts`, `types.ts`, `settings.ts`, locale files, `ResumeModeModal.ts`): New `"hybrid"` mode sends the summary (in system prompt) plus the last 6 messages (`HYBRID_TAIL_COUNT`), balancing cost savings with recent-detail fidelity. Added to the resume modal, settings dropdown, and template frontmatter validation.

5. **Context window budget trimming** (`messageUtils.ts`, all three providers): `trimHistoryToBudget()` trims oldest messages when estimated tokens exceed `contextWindow - outputBudget - systemPromptTokens`. `models/knownModels.ts` gained per-model `contextWindow` values (Anthropic 1M, OpenAI gpt-4.1 1M / gpt-4o 128K / o-series 200K, Mistral 128K / Codestral 256K) and a `getContextWindow()` accessor.

6. **Paragraph-level fallback chunking** (`noteChunking.ts`): `chunkByParagraphs()` splits heading-less notes on `\n{2,}` boundaries, enabling relevance-filtered excerpting for notes that use paragraphs instead of headings.

7. **Raised chunk threshold** (`noteChunking.ts`): `NOTE_CHUNK_THRESHOLD_CHARS` raised from 4000 to 12000 — the previous threshold was too aggressive, excerpting notes that could fit whole in the context window.

8. **Always-include-first-chunk** (`noteChunking.ts`): `selectRelevantChunks` now always includes the first chunk (order 0) for framing context before filling remaining budget with highest-scoring chunks.

9. **CJK-aware token estimation** (`messageUtils.ts`): `estimateTokensFromText()` now uses a weighted heuristic — ASCII at ~4 chars/token, non-ASCII at ~1.5 chars/token — instead of a flat ÷4 that undercounted CJK/non-Latin text by 2–3×.

10. **Default effort "high"** (`models/settings.ts`): `DEFAULT_SETTINGS.effort` set to `"high"` so new conversations default to substantive responses without requiring manual configuration.

**Consequence:** LLM responses should be materially deeper and better-grounded for the same conversation inputs. The hybrid resume mode gives users a middle ground between the cost of full history and the quality loss of summary-only. Context window budget enforcement prevents silent truncation on long conversations. The chunk threshold and first-chunk inclusion changes preserve more note content by default while still excerpting truly large notes intelligently.

---

### ADR-054 — Favorites become highlighted text spans

**Status:** Active

**Context:** Favorites were whole-message references (`Favorite { messageId, name }`) toggled by a ☆/★ button under each assistant message; the navigator's "Starred" section jumped to the message row. Users wanted to favorite an arbitrary *span* of text within a conversation, keep it visibly highlighted, and jump back to the exact start of that text — not just to the message that contained it.

**Decision:** Replace message-level favorites with span-level highlight favorites.

1. **Data model** (`models/types.ts`): `Favorite` gains `id`, `text` (the exact selected string), `occurrenceIndex` (which occurrence of `text` within the message, disambiguating duplicates), and `createdAt`. `messageId`/`name` remain. `text`/`occurrenceIndex` are optional so legacy favorites stay representable.

2. **Text, not offsets** (`ui/HighlightPainter.ts`): The message body is produced by `MarkdownRenderer` and re-created on every render, so source-markdown character offsets do not map onto the rendered DOM. Favorites therefore store the exact selected text and are re-located at paint time by walking the body's text nodes (`findRange`). A selection frequently crosses element boundaries, so painting splits the range per text node and wraps each fragment in its own `mark.p-highlight` (rather than `Range.surroundContents`, which throws on boundary-crossing ranges). `repaintBody` runs after every render path (message render, user bubble, favorite add/remove).

3. **Creation via selection** (`sidebar.ts`): The per-message star is removed; a "Favorite" button joins the existing selection toolbar (Copy/Insert/Inbox/Fork). Selections must stay within one message (rejected otherwise with a Notice). Selecting inside an existing highlight toggles it off.

4. **Jump precision** (`sidebar.ts` `scrollToFavorite`): Prefers the painted mark, falls back to re-finding the text, then to the message top.

5. **Legacy favorites** (`services/persistence.ts` `normalizeFavorites`, run from `parseConversations`): Existing `{ messageId, name }` favorites are kept and assigned an `id`; with no `text` they list in the navigator and jump to the message top (no painted highlight). Malformed entries missing `messageId` are dropped. No data loss, no fabricated spans.

**Alternatives rejected:** Storing character offsets (fragile across re-render); auto-converting legacy favorites into whole-message highlights (visually noisy, misrepresents intent); dropping legacy favorites (data loss).

**Consequence:** Favoriting is finer-grained and visually persistent. A new `happy-dom` dev dependency backs DOM-based unit tests for `HighlightPainter`. The token line under AI messages no longer carries a star (shows only token counts when present). i18n keys `addToFavorites`/`removeFromFavorites`/`navNoStarred` were replaced by `favoriteBtn`/`removeHighlight`/`favoriteSpanSingleMessage`/`navNoFavorites`.

---

### ADR-055 — Summarize a conversation's favorites into learnings + actions

**Status:** Active

**Context:** Favorites are the spans a user hand-picks as a conversation's most important insights (ADR-054). They wanted those consolidated into something that aids retention and drives action, rather than re-reading scattered highlights.

**Decision:** Add a per-conversation "summarize favorites" synthesis that reuses the existing utility-call machinery.

1. **Input** (`services/messageUtils.ts` `buildFavoritesDigest`): a pure function (so it lives in the vitest coverage set, unlike provider classes) that pairs each favorite with its nearest preceding user question, orders blocks by message position, uses `fav.text` for span favorites and full message content for legacy ones, skips favorites whose `messageId` no longer resolves, and returns `""` when nothing is usable.

2. **Generation** (`BaseProvider.generateFavoritesSummary`, routed by `LLMRouter`/`LLMProvider`): mirrors `generateSummary` — the conversation's own model (a high-value synthesis, not a `fastModel` micro-task), `maxTokens` 1536, prompt fixed to two Markdown sections (`## Key learnings` synthesized+deduplicated, `## Action items` as `- [ ]` checkboxes), grounded in the digest.

3. **Output** (`suggest/FavoritesSummaryModal.ts`): modal preview of the rendered Markdown with Copy / Save-to-note / Regenerate; result cached on `Conversation.favoritesSummary` for instant reopen. Save-to-note goes through `NoteWriter.saveFavoritesSummaryNote`.

4. **Triggers**: a ✦ action in the navigator Favorites header (`ui/NavigatorController.ts`, via a new `NavigatorDeps.summarizeFavorites`) and a `Pythia: Summarize favorites` command (`main.ts`, also in the command hub).

**Alternatives rejected:** auto-save straight to a note (no preview/iteration); a pinned in-conversation panel (more UI surface, duplicates the resume-summary bar); a new dedicated summary prompt constant (the inline-literal style matches the other `generate*` methods); cross-conversation "summarize all favorites everywhere" (out of scope — the request was per-conversation).

**Consequence:** Favorites become a learning + action artifact. Cost is one main-model call per generation (cached thereafter). `Conversation` gains an optional `favoritesSummary` field (no migration — optional). New i18n keys added to both locales.

---

### ADR-056 — Highlight-favorite interaction fixes

**Status:** Active

**Context:** Three issues were reported against the 1.27.0 highlight-favorites UX: (1) tapping a highlight did nothing — there was no way to unfavorite by tapping; (2) removing/interacting with a highlight could make its (or others') color vanish; (3) jumping to a favorite from the navigator required two taps.

**Decision:**

1. **Tap to unfavorite.** A tap (collapsed selection) inside a `mark.p-highlight` (`onMessageClick`) selects the highlight's whole span via `rangeForHighlight` and opens the selection toolbar with the favorite button relabeled to **Unfavorite** (`setFavButtonMode`, driven by `tappedFavId`). A *dragged* selection never removes a highlight — it always creates a new favorite (overlaps allowed) — so the old "drag anchored inside a mark removes it" heuristic was deleted. This separates the two intents by gesture.

2. **Surgical removal.** `removeFavorite` now calls `removeHighlightById` (unwraps only the target favorite's marks) instead of the clear-all-then-repaint path, so removing one highlight can never drop another's color, and a failed `findRange` can't erase a surviving highlight. `repaintFavorites` also clears stale marks when a message's last favorite is gone.

3. **Single-tap jump.** The navigator item handler closes the popover first, then defers `scrollToFavorite` to `requestAnimationFrame`; `scrollToFavorite` expands a collapsed long bubble (`expandBubbleIfCollapsed`) before measuring so the mark is laid out. This removes the stale/zero-offset first measurement that caused the two-tap behavior.

4. **Toolbar order** reordered to Copy · Favorite/Unfavorite · Branch (Fork) · Insert into note · Save to inbox, per user preference.

**Consequence:** Tapping a highlight is now the primary unfavorite gesture; highlight colors are stable under add/remove; navigator jumps land on the first tap. New i18n key `unfavoriteBtn`; new pure helpers `removeHighlightById`/`rangeForHighlight` are unit-tested.

---

### ADR-057 — Summaries as top-of-conversation cards, generated only via the Send button

**Status:** Active (supersedes the summary-panel UI of ADR-053 and the favorites-modal UI of ADR-055; the underlying generation and data model are unchanged)

**Context:** The conversation summary lived in a pinned panel toggled by an input-toolbar sparkle (+ refresh icon), and the favorites summary opened in a modal launched by a ✦ navigator action. Two different surfaces for two summaries, plus several implicit auto-generation paths. The user wanted both summaries surfaced identically and generated from one obvious place.

**Decision:**
1. **Cards ("Speisekarten").** Both summaries render as collapsible cards (`.p-summary-card`) inside `.p-summary-cards`, prepended to the top of the message list so they scroll with the conversation. A card exists only when its summary exists. Collapsed by default; the expanded body shows the rendered markdown plus Copy / Save-to-note. An `IntersectionObserver` (root = `.p-chat`) re-collapses an expanded card once it scrolls out of view.
2. **Button-only generation.** A long-press on the Send button opens a popover above the button (`.p-send-menu`) with *Summarize Conversation* and *Summarize Favorites* (the latter disabled with no favorites). Choosing one generates or regenerates that summary with current context and reveals its card. This is the sole generation entry point: the auto-save-on-close summary (and its `autoSaveSummary` setting) and the note-injection auto-summary (`generateAndInjectSummary`) are removed. Resume-in-summary-mode and Fork still populate `summaryText` for their own context needs, so a conversation card may legitimately appear from those.
3. **Navigator.** The ✦ action is gone; the Favorites section label links to the favorites card when a favorites summary exists, and is greyed/non-clickable otherwise. Per-highlight jumps and the section chevron are unchanged.
4. **Removed UI.** Pinned `.p-summary-panel` + `updateSummaryBar`/`toggleSummaryPanel`/`refreshSummaryBar`, the toolbar sparkle, the panel refresh icon, and `FavoritesSummaryModal`.

**Alternatives rejected:** a pinned band that never scrolls away (doesn't match "collapses when it leaves the view"); keeping the modal alongside the card (two surfaces again); decoupling resume/fork summaries into a context-only field (larger change, breaks nothing by leaving them).

**Consequence:** One consistent surface and one generation gesture. Summaries no longer appear unbidden on close or note-injection. i18n: added `menuSummarizeConversation`, `menuSummarizeFavorites`, `conversationSummaryTitle`; removed `summarizeTooltip`, `regenerateSummaryTooltip`, `summarizeFavoritesTooltip`, `regenerateBtn`, and the auto-save keys.

---

### ADR-058 — Fork "branch-back": fork summaries anchored at their origin snippet in the source

**Status:** Active

**Context:** A fork is a separate conversation. When a user branches off a snippet to get an explanation, that explanation is stranded in the fork and they lose track of it while reading the source. The connection existed only as a thin fork banner (in the fork) and the navigator's Forks list.

**Decision:** Make the source the hub.
1. **Accent origin marks.** For every child fork (`getAll().filter(forkedFromId === source.id && forkedFromMessageId === msg.id)`), the source paints `forkedFromSelection` inside the branch message as `mark.p-fork-origin` in `--color-accent` — the same highlight-painter machinery as favorites (`paintRange` gained `className`/`dataAttr` params; `repaintForkOrigins`), a different class + `data-fork-id`. `forkedFromOccurrenceIndex` (captured at fork time via `computeOccurrenceIndex`) disambiguates repeated snippets.
2. **Inline anchor on tap.** Tapping a fork-origin mark inserts a quote block (`.p-fork-anchor`) immediately after the snippet showing one summary + "Open fork". Summary precedence: the fork's `favoritesSummary` → its `summaryText` → a "Summarize fork" button that generates on demand (`generateSummary(fork)`, cached on the fork). Only one anchor open at a time. Fork-origin taps take precedence over favorite highlights (the fork wins).
3. **Return path.** The fork's "Forked from" banner link opens the source, scrolls to the snippet, and expands its anchor (`revealForkOrigin`).
4. **Decouple summaries.** `cmdForkConversation` previously copied the source summary into the fork's `summaryText`, which post-card-rework mislabeled it as the fork's own summary. It now stores it in `forkedFromSummary`; `ContextBuilder.buildSystemPrompt` injects `summaryText ?? forkedFromSummary`, preserving the fork's source-context while keeping its own summary genuinely its own for the branch-back display.

**Alternatives rejected:** a top "Forks" card (not tied to reading position); auto-summarizing every fork (cost, and reuse-existing was preferred); making the fork's `summaryText` do double duty (the conflation this fixes).

**Consequence:** Reading the source, the branch points are visible and expandable in place; the fork↔source loop is closed both ways. Scope: one level of forking. New i18n: `summarizeForkBtn`, `openForkBtn`.

### ADR-059 — Fork anchor summaries generated via a long-press Open-fork menu

**Status:** Active (supersedes ADR-058's standalone "Summarize fork" button)

**Context:** ADR-058 gave the inline fork anchor a single "Summarize fork" button that appeared only when the fork had no summary, and only ever generated the *conversation* summary. But a fork can also carry favorites, and once a summary existed there was no in-place way to (re)generate either kind — the anchor was a dead end for anything but the first conversation summary.

**Decision:** Mirror the Send button's long-press summary menu on the anchor's **Open-fork** button.
1. **Long-press opens a menu.** A 450 ms touch+mouse long-press on "Open fork" opens a popover (`.p-fork-menu`, reusing `.p-send-menu` styling) stacked above the button; a short press still opens the fork. The press that opens the menu suppresses the click that would otherwise open the fork (`suppressNextForkOpen`), matching `suppressNextSendClick`.
2. **Two items, favorites conditional.** "Summarize conversation" (`generateSummary(fork)` → `fork.summaryText`, disabled when the fork has no messages) is always present; "Summarize favorites" (`runFavoritesSummary(fork)` → `fork.favoritesSummary`) is **offered only when the fork carries favorites** (per the request: hidden entirely, not merely disabled).
3. **Show the type just generated.** `buildForkAnchor` gained a `preferType` argument; after generating, the anchor re-renders showing the summary just produced even when both kinds exist. With no preference it stays favorites-preferred (ADR-058 precedence).
4. **Single generate control.** The standalone "Summarize fork" button is removed; the menu covers both the no-summary and regenerate cases. Regenerating overwrites in place.

**Alternatives rejected:** keeping the standalone button (couldn't reach favorites or regeneration); a native Obsidian `Menu` (renders as a mobile bottom sheet — the same reason ADR-057 chose a custom popover for the Send menu); disabling rather than hiding the favorites item on a fork with no favorites (the request asked for it to be offered only when favorites exist).

**Consequence:** The anchor is a full generate/regenerate surface consistent with the Send menu. Removed i18n: `summarizeForkBtn`. Reused: `menuSummarizeConversation`, `menuSummarizeFavorites`, `openForkBtn`, `generatingSummary`, `summaryFailed`.

### ADR-060 — Frame the previous-conversation summary as governing context

**Status:** Active

**Context:** A fork (and a "summary" resume-mode conversation) carries the source conversation's summary in the system prompt, wrapped as `<previous_conversation_summary>`. But the block was injected with **no instruction** — unlike attached notes, which get `GROUNDING_INSTRUCTION`. The model therefore treated the summary as ignorable background: a fork of a "technological revolutions" conversation, asked "show me all revolutions of Germany", answered in the generic sense (cultural, political, …) instead of staying within the technological framing the summary established. The summary was reaching the model (plumbing verified, unit-tested); it simply wasn't being *used* as context.

**Decision:** Add `PRIOR_SUMMARY_INSTRUCTION` (in `promptConstants.ts`) and prepend it to the summary block in `buildSystemPrompt`. It tells the model the summary is the *governing context* for the user's questions — interpret and answer within the topic, scope, and framing established there unless the user clearly changes the subject, keeping domain-specific questions within that domain even when the phrasing alone would be broader. Applies whenever a prior summary is present, so both forks (`forkedFromSummary`) and resume-summary conversations (`summaryText`) benefit.

**Alternatives rejected:** restating the framing inside each user message (fragile, pollutes history, not cached); relying on the tag name alone (the whole bug — a name is not an instruction); making it fork-only (resume-summary continuations have the same continuity need).

**Consequence:** Forked/resumed conversations stay on-topic with the conversation they continue. No data-model or i18n change; the instruction is prompt-only. Purely additive to the system prompt (~60 words) and inside Anthropic's cached prefix.

### ADR-061 — Content-first summary generation prompts

**Status:** Active

**Context:** The conversation- and favorites-summary generation prompts were written when summaries were used *only* as model context. Summaries now also surface **to the user inline** — the "Speisekarte" summary cards and the branch-back fork anchor (ADR-054, ADR-058). The conversation-summary prompt framed the task as "summarize this conversation for future reference" and only banned a "Summary of…" heading, so outputs opened with meta-narration ("This conversation is…", "We discussed…") that reads wrong as standalone inline content — and is now redundant with ADR-060's framing instruction on the context side.

**Decision:** Make both summary prompts **content-first** (`services/BaseProvider.ts`).
1. **Conversation summary** (`generateSummary`, `generateSummaryWithTitle`): recap the *substance* as knowledge — lead with the subject matter, with an explicit banned-openers list ("This conversation…", "In this conversation…", "The user…", "We discussed…", "Summary of…"). A positive "begin directly" instruction alone was not holding; the explicit ban is what removes the meta opener.
2. **Favorites summary** (`generateFavoritesSummary`): keep the `## Key learnings` / `## Action items` structure, but require each bullet to state the insight directly (no "The user highlighted…" / "This note says…" phrasing), and allow **omitting the `## Action items` section entirely** when no concrete actions are genuinely warranted (previously the header was mandatory, producing empty sections).

**Alternatives rejected:** two separate summaries (one for display, one for context) — doubles generation cost and storage for a difference the content-first wording already removes; post-processing to strip meta openers (brittle string surgery vs. fixing the prompt); keeping the mandatory Action-items header (emitted empty sections in the card/anchor).

**Consequence:** Summaries read as standalone recaps in the cards and fork anchor while remaining good context (paired with ADR-060). Prompt-only — no data model, no i18n, no stored-summary migration; existing summaries are unchanged until regenerated.

### ADR-062 — Client-executed web search ("research mode") over provider-native search

**Status:** Active

**Context:** Every model Pythia supports answers only from frozen training data, with no path to anything after its cutoff — unlike the "research modes" shipped by major providers. Pythia already grounds answers in vault notes but had no live-recency path. Two options existed: enable each provider's own server-side web-search tool (Anthropic `web_search`, OpenAI/Mistral built-ins), or run the search ourselves and feed results back through the existing tool loop.

**Decision:** Run the search client-side (in the plugin) and expose it as a normal tool. A single `web_search` `ToolDefinition` in `ToolHandler.getToolDefinitions` flows into all three providers automatically (each already maps the shared `ToolDefinition[]` into its own SDK shape), and `ToolHandler.execute` routes `web_search` to a new `services/WebSearchService.ts` that queries **Tavily** via Obsidian's `requestUrl`. The result string is returned through the same `onToolCall → string` contract the note-writing tools use, so `BaseProvider`'s agentic loop feeds it back for a follow-up turn with zero loop changes. A per-conversation `researchMode` flag gates the tool (independent of `writeMode`, since search is read-only and must work even when `writeMode` is `"none"`); it is toggled from a `globe` button in the input toolbar and defaults from the `webSearchDefault` setting. When on, `ContextBuilder.buildSystemPrompt` injects a `<recent_context>` block with the current date and an instruction to prefer `web_search` for time-sensitive questions and cite source URLs.

**Alternatives rejected:**
- *Provider-native search tools* — three separate integrations with divergent shapes, per-provider result/citation formats, and no vault-side control over the backend. The client tool is one implementation behind the existing tool interface.
- *`fetch` instead of `requestUrl`* — most search APIs (Tavily included) do not send CORS headers to a renderer origin; `requestUrl` runs in the Electron main process and bypasses that. The trade-off — a request in flight cannot be aborted — is acceptable for a ~1–3 s search.
- *Always injecting the date block* — gated on `researchMode` instead, so plain conversations are unchanged (and the exact-equality prompt tests stay valid); the guidance is only meaningful when the tool is available.
- *Caching fetched sources into the vault* — deferred; this pass is search + recency only.

**Consequence:** Live recency for all three providers from one tool definition and one execution branch. `WebSearchService` never throws — a missing key, HTTP error, or network failure returns an `"Error: …"` string the model reads and recovers from, matching the note-tool convention. New settings: `searchSecretName` (Tavily key via Obsidian SecretStorage), `webSearchDefault`, `webSearchMaxResults` (caps results, bounding a research turn's token cost). `Conversation`/`PythiaTemplate` gained `researchMode`; templates can preset it via `research_mode` frontmatter. i18n: added `webSearchSection`, `searchKeyName`/`Desc`, `webSearchDefaultName`/`Desc`, `webSearchMaxResultsName`/`Desc`, `researchToggleTooltip`, `research{Enabled,Disabled,NoKey}Notice`, `searchingLabel`, `searchedLabel`, `searchFailedLabel`.

### ADR-063 — Max-tokens warning surfaced at the Send button

**Status:** Active

**Context:** A per-conversation `maxTokens` persists across a provider/model switch, and the model-appropriate default (`resolveDefaultMaxTokens` — larger for reasoning models) only applies when `maxTokens` is unset. So switching a conversation onto a **reasoning model** while a small `maxTokens` is set silently truncates replies: the model spends part of that budget on hidden reasoning before any visible output. The condition was only discoverable by opening the settings modal — the wrong place, since the user notices the problem at send time.

**Decision:** Surface the warning **at the Send button**, where the user acts. A warning icon (`.p-send-hint`, `alert-triangle`, `var(--text-warning)`) appears just left of Send when `isReasoningModel(model)` and the effective max-tokens (`conv.maxTokens ?? settings.maxTokens`) is defined and `< DEFAULT_MAX_TOKENS_REASONING`. Its tooltip names the current value, the model, and the recommended floor; clicking it opens the provider/model settings modal (reusing `onModelBadgeClick`). `updateSendHint()` is driven by `updateModelBadge()`, so it refreshes on render, model change, and template apply. An **unset** max-tokens never warns — the correct default applies automatically.

**Alternatives rejected:** auto-raising a low `maxTokens` on switch (silently overrides an explicit user choice — surfacing beats mutating); warning only inside the settings modal (user sees it too late, after the truncated reply); blocking send (too aggressive — a low cap is legitimate for non-reasoning use and the user may want it anyway).

**Consequence:** The main sharp edge of mid-conversation model switching (ADR discussion) is now visible before the user sends. UI-only + one i18n key (`sendMaxTokensHint`); no data-model change. The heuristic is intentionally conservative (reasoning models + explicit low cap only) to avoid false positives.

### ADR-064 — Fork-origin highlight uses the favorites highlighter mechanism

**Status:** Active (refines ADR-058's fork-origin styling)

**Context:** ADR-058 introduced the fork-origin mark and later polish set it to `color-mix(var(--color-accent) 32%, transparent)` with a solid `var(--color-accent)` fallback. Two issues: the solid-accent fallback (used when `color-mix` is unavailable) puts normal-colored text on a fully opaque accent fill — potentially unreadable; and the fork mark and the favorite mark, though both "highlights," were built on different mechanisms (a raw tint vs. Obsidian's `--text-highlight-bg` highlighter token), so they didn't read as the same kind of mark.

**Decision:** Give the fork-origin mark the **same highlighter mechanism as favorites**, in the accent hue. Favorites paint `--text-highlight-bg` (a ~40% translucent highlight); forks now paint `color-mix(in srgb, var(--color-accent) 40%, transparent)` — the same translucency, accent-hued — with `--text-highlight-bg` itself as the readable no-`color-mix` fallback. Forks and favorites are now the same kind of highlighter, distinguished only by color (accent vs. yellow).

**Alternatives rejected:** accent underline / no fill (loses the shared "highlighter" language with favorites — the chosen consistency goal); keeping the 32% raw tint with a solid-accent fallback (the readability bug); defining a new accent-highlight CSS token (Obsidian has none, and `color-mix` on `--color-accent` expresses it without inventing a token).

**Consequence:** Consistent highlighter treatment across favorites and forks, and no unreadable fallback. CSS-only; no data-model, i18n, or logic change.
