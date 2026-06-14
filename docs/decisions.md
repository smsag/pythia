# Pythia — Architectural Decision Records

*Last updated: 2026-06-14 at v1.19.3*

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
