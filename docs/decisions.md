# Pythia — Architectural Decision Records

*Last updated: 2026-05-31 at v1.11.2*

Each entry records a decision, the context that drove it, and the consequence. Entries are append-only; superseded decisions are marked rather than deleted.

---

## ADR-001 — No UI framework (no React, Svelte, or shadow DOM)

**Status:** Active

**Context:** Obsidian plugins run inside Electron/WebKit. Frameworks add bundle size, complicate lifecycle management, and often fight Obsidian's own DOM ownership model (the leaf header, workspace events, etc.).

**Decision:** All UI is constructed with Obsidian's imperative DOM helpers (`createDiv`, `createEl`, `MarkdownRenderer.render`). No virtual DOM, no component framework, no shadow DOM.

**Consequence:** UI code is verbose but fully transparent. Obsidian's own cleanup hooks (`registerDomEvent`, `registerEvent`) work without adaptation. New contributors must learn the imperative style.

---

## ADR-002 — API keys in Obsidian SecretStorage, not data.json

**Status:** Active

**Context:** Early versions stored API keys as plaintext or Electron `safeStorage` ciphertext in `data.json`. `data.json` is synced across devices by Obsidian Sync and iCloud — exposing keys to all sync targets is a security risk.

**Decision:** Keys are stored in Obsidian's `SecretStorage` (device-specific, never synced). `data.json` stores only a *name* (e.g. `"pythia-anthropic"`) that keys into SecretStorage. `SecretStorage.getSecret()` is `await`ed at every call site.

**Consequence:** Keys must be re-entered on each device. This is the correct security posture. The `legacyDecrypt` migration path converts installations that still have the old format, with an `typeof Buffer !== "undefined"` guard so the path is safe on iOS.

---

## ADR-003 — data.json with eviction cap, not per-file storage

**Status:** Partial — cap implemented; per-file is backlog

**Context:** Obsidian's `saveData`/`loadData` API writes a single `data.json`. The full file is rewritten on every save (every 300 ms during streaming). At scale, a large file syncs slowly or not at all.

**Decision (short-term):** Add a `maxConversations` setting (default 200). On every save, evict the oldest non-starred, non-active conversations. The active conversation is always protected even without stars.

**Decision (long-term, pending):** Migrate to one JSON file per conversation keyed by `id`. Only the modified file is written. See engineering-review.md #3.

**Consequence:** The cap keeps `data.json` bounded and reliably synced. Eviction is silent; users who need more history must raise the cap in settings. The active conversation is never lost mid-session.

---

## ADR-004 — Mermaid/PlantUML diagrams: CSS overflow + MutationObserver, not DOM wrapping

**Status:** Active

**Context:** Mermaid's async renderer locates `.block-language-mermaid` elements by DOM position after `MarkdownRenderer.render()` returns. Moving the element into a wrapper div broke rendering (the renderer couldn't find or replace the element).

**Decision:** Never move diagram containers. Apply `overflow-x: auto; width: 100%; min-width: 0` via CSS. Use a `MutationObserver` watching `childList` and `attributes` (`viewBox`, `width`, `height`) to stamp explicit pixel dimensions via `setProperty("important")` once Mermaid inserts the SVG. A sibling `.p-diag-toolbar` inserted *before* the container holds the copy button — it lives outside the scrolling context so it's never hidden by horizontal overflow.

**Consequence:** Wide diagrams (Gantt charts, large flowcharts) scroll horizontally rather than being scaled down. The sibling toolbar is always visible. The MutationObserver has a 10 s safety timeout for parse-error cases where no SVG is ever inserted.

---

## ADR-005 — outputLanguage stored as locale code, not human-readable string

**Status:** Active

**Context:** Initial implementation stored `"English"` / `"German"` as the dropdown option value *and* injected them directly into LLM prompts (`Respond in English.`). Translating the UI label would have silently changed the LLM instruction. Stale values from old data.json files would produce malformed prompts.

**Decision:** Store ISO 639-1 locale codes (`"en"`, `"de"`). A `LANG_LABELS` map in `services/messageUtils.ts` translates codes to the English LLM instruction word. The settings UI display label is sourced from i18n (`t("outputLanguageEnglish")`), fully independent of the stored value. A migration in `loadPluginData()` converts existing `"English"` / `"German"` values.

**Consequence:** Adding a new language requires one line in `LANG_LABELS` and one `addOption()` call. UI translation is safe. Stale values silently degrade to "auto" behaviour (empty instruction).

---

## ADR-006 — normalizeMessages is generic with a caller-supplied predicate

**Status:** Active

**Context:** Anthropic requires the messages array to start with a `"user"` turn. OpenAI allows a `"system"` turn at position 0 but not a leading `"assistant"` turn. The two implementations were copy-pasted with a subtle difference in the while-loop condition.

**Decision:** Extract a single generic `normalizeMessages<T extends {role, content}>(messages, isInvalidFirst)`. The predicate captures the per-provider rule:
- Anthropic: `role => role !== "user"`
- OpenAI: `role => role === "assistant"`

**Consequence:** The behavioural difference is explicit at the call site. One implementation, zero divergence risk. The generic constraint requires explicit type arguments at call sites to prevent TypeScript from widening the role type.

---

## ADR-007 — ConversationStore uses a 300 ms debounced save + flush on unload

**Status:** Active

**Context:** Streaming generates one save per token if naively implemented. Writing `data.json` on every token would cause excessive I/O and iCloud conflicts.

**Decision:** `ConversationStore.save()` schedules a debounced write (300 ms). `flush()` cancels the timer and writes immediately. `PythiaPlugin.onunload()` calls `await conversationStore.flush()` so the tail of the conversation is never lost when Obsidian closes.

**Consequence:** At most one disk write per 300 ms during streaming. On clean shutdown, all data is persisted. On hard crash (power loss), up to 300 ms of the most recent turn may be lost.

---

## ADR-008 — Chapter names reuse for favorites, no API call

**Status:** Active

**Context:** Earlier versions called a dedicated `generateFavoriteName()` API endpoint on every star click, adding latency and token cost.

**Decision:** When the user stars an assistant message, the favourite label is taken from the `chapterName` of the preceding user turn (generated lazily and cheaply via the haiku-tier model during `backfillChapterNames`). If no chapter name exists yet, the first 40 characters of the assistant message are used as a fallback.

**Consequence:** Star click is instant. `generateFavoriteName()` was removed from all four provider files. Chapter names now serve double duty as chapter navigation labels and favourite labels.

---

## ADR-009 — Vitest for pure-function tests, no Obsidian mock

**Status:** Active

**Context:** The plugin's core logic (parsing, normalisation, error classification) is pure TypeScript with no DOM or Obsidian API dependencies. Full integration testing would require a running Obsidian instance, which is impractical in CI.

**Decision:** Use Vitest for unit tests of pure functions only. No attempt to mock the Obsidian API or test DOM construction. Tests live in `tests/` and run with `npm test` in ~200 ms.

**Consequence:** Regressions in pure logic (e.g. `parseTitleAndSummary` regex) are caught immediately on every push. UI behaviour is not tested automatically. The engineering review tracks UI testing as a future backlog item.
