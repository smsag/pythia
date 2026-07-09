# Engineering Review — Pythia

*Initial review: 2026-05-29 at v1.10.2.*
*Updated: 2026-05-30 — v1.10.2 session fixes.*
*Updated: 2026-05-30 — v1.11.0 batch: #2, #3 (partial), #7, #8, #9, #13, #16 resolved.*
*Updated: 2026-05-30 — #23–#28 batch resolved.*
*Updated: 2026-05-31 — v1.11.1–1.11.3: #17, #18, #21, #6, #14, #15, #19, #20, #29, #30, #33 resolved. #31–#32 remain.*
*Updated: 2026-06-01 — v1.11.4–1.11.5: #29 dead keys, #30 ESLint, #33 estimateTokens all resolved. New suggestions #34–#38 added from v1.11.5 session audit.*
*Updated: 2026-06-14 — #5 NoteWriter injection, #11 sidebar split partial, #12 BaseProvider resolved. New suggestions #39–#41 added from v1.19.2 thorough audit.*
*Updated: 2026-06-14 — #39, #40, #41 all resolved.*
*Updated: 2026-06-14 — #31 persistence round-trip tests added.*
*Updated: 2026-06-14 — #1 incremental DOM rendering implemented.*
*Updated: 2026-06-14 — #4 closed as won't fix; docs updated to v1.19.5.*
*Updated: 2026-07-09 — response-quality audit: #42–#49 added and resolved (resumeMode data-loss bug, retry/backoff, Anthropic prompt caching, temperature, attached-notes token guard, system-prompt grounding, relevance-ranked note suggestions, note chunking). #50 (true semantic/embedding retrieval) added as backlog.*

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-29 | Initial review at v1.10.2 |
| 2026-05-30 | v1.11.0: #2, #3 partial, #7, #8, #9, #13, #16 resolved |
| 2026-05-30 | #23–#28: autoSaveSummary, IME, autoScroll, navigator leak, stale guards, send-button |
| 2026-05-31 | #17, #18, #21, #6, #14, #15, #19, #20 resolved; #29–#33 added |
| 2026-06-01 | #29 dead i18n keys, #30 ESLint, #33 estimateTokens resolved; new #34–#38 from v1.11.5 session |
| 2026-06-14 | #5, #11, #12 resolved; new #39–#41 from v1.19.2 thorough audit |
| 2026-06-14 | #39, #40, #41 resolved |
| 2026-06-14 | #31 persistence tests; `services/persistence.ts` extracted from `main.ts` |
| 2026-06-14 | #1 incremental DOM rendering in `renderMessages` |
| 2026-06-14 | #4 closed won't fix; docs updated to v1.19.5 |

---

## File Inventory (sorted by lines, v1.19.5)

| # | File | Lines | Role |
|---|------|------:|------|
| 1 | `sidebar.ts` | 2 111 | Main view — UI, rendering, streaming, interaction |
| 2 | `styles.css` | 1 456 | All plugin CSS |
| 3 | `main.ts` | 905 | Plugin entry, commands, conversation lifecycle, sync watcher |
| 4 | `settings.ts` | 419 | Settings schema + settings tab UI |
| 5 | `services/OpenAIProvider.ts` | 264 | OpenAI streaming (extends BaseProvider) |
| 6 | `services/AnthropicService.ts` | 197 | Anthropic streaming (extends BaseProvider) |
| 7 | `services/BaseProvider.ts` | 132 | Abstract base: shared fields, lifecycle, all generate* utility methods |
| 8 | `services/ToolHandler.ts` | 118 | Tool definitions + ToolHandler class (injected NoteWriter) |
| 9 | `services/NoteWriter.ts` | 186 | Vault write operations |
| 10 | `services/PromptOptimizerService.ts` | ~170 | Prompt optimizer — `run()` command flow + `optimizeText()` inline review |
| 11 | `ui/OptimizationController.ts` | 171 | Inline optimizer UI state + flow (extracted from sidebar) |
| 12 | `ui/NavigatorController.ts` | 163 | `#` navigator popover (extracted from sidebar) |
| 13 | `ui/InlineSuggest.ts` | 152 | `#` note-path autocomplete in textarea |
| 14 | `services/TemplateLoader.ts` | 95 | Template discovery + frontmatter parsing |
| 15 | `services/messageUtils.ts` | 98 | Shared: parseTitleAndSummary, normalizeMessages, token estimate, lang helpers |
| 16 | `services/LLMRouter.ts` | 72 | Dispatches calls to the active provider |
| 17 | `services/ConversationStore.ts` | 58 | In-memory store + 300 ms debounced persistence |
| 18 | `services/ContextBuilder.ts` | 48 | Builds system prompt + attaches vault notes |
| 19 | `services/persistence.ts` | ~100 | Pure functions: `applySettingsMigrations`, `mergeSettings`, `parseConversations`, `shouldRefuseLoad`, `evictConversations` |
| 20 | `models/types.ts` | 78 | All shared TypeScript interfaces |
| 21 | `models/settings.ts` | ~55 | `PythiaSettings` interface + `DEFAULT_SETTINGS` — no Obsidian dependency; importable in tests |
| 22 | `locales/de.ts` / `locales/en.ts` | ~283 | i18n strings (German / English) |
| 23 | `suggest/` | — | Modal dialogs (picker, delete confirm, settings, etc.) |
| 24 | `tests/` | — | Vitest unit tests (12 files) |

**Source total:** ~9 000 lines (excl. lock file, generated `main.js`, coverage output).
**Test suite:** 187 tests across 12 files — `npm test` (~500 ms), `npm run coverage` with enforced thresholds.
**CI:** lint → build → test on every push to `main` and every PR.

---

## Suggestion Status

| # | Suggestion | Status |
|---|---|---|
| 1 | Incremental DOM rendering in `renderMessages` | ✅ Skip-if-same + append-only in `renderMessages` |
| 2 | Batch `backfillChapterNames` | ✅ Serial for-loop |
| 3 | `data.json` unbounded growth | ✅ Partial — cap + eviction; per-file Backlog |
| 4 | Cache context note file reads | Won't fix — Obsidian's vault already caches file reads; added overhead exceeds benefit |
| 5 | Inject `NoteWriter` instead of constructing inline | ✅ `ToolHandler` class; `plugin.toolHandler` |
| 6 | Extract `parseTitleAndSummary` to shared util | ✅ `services/messageUtils.ts` |
| 7 | Error handling on persistence failure | ✅ try/catch + Notice + flush-on-unload |
| 8 | Wrap `MarkdownRenderer.render()` in try/catch | ✅ Done |
| 9 | Guard `Buffer` in `legacyDecrypt` | ✅ `typeof Buffer !== "undefined"` |
| 10 | Harden fire-and-forget in fork path | Open — Backlog |
| 11 | Split `sidebar.ts` into sub-components | ✅ Partial — OptimizationController + NavigatorController extracted; remaining DOM coupling makes further splits net-negative |
| 12 | `BaseProvider` abstract class | ✅ `services/BaseProvider.ts` |
| 13 | Auto-abbreviate unknown model names | ✅ Done |
| 14 | Extract `normalizeMessages` to shared util | ✅ `services/messageUtils.ts` |
| 15 | Add Vitest unit tests | ✅ 187 tests across 12 files |
| 16 | Remove dead `generateFavoriteName` | ✅ Done |
| 17 | `maxConversations` eviction drops active conversation | ✅ `activeConversationId` guard |
| 18 | `getSecret()` async safety | ✅ `await` at all three call sites |
| 19 | `color-mix()` Chromium 111 compatibility | ✅ Plain-accent fallback added |
| 20 | Observer accumulation across DOM rebuilds | ✅ `WeakMap<HTMLElement, MutationObserver>` |
| 21 | `outputLanguage` coupled to LLM prompt string | ✅ Locale codes + `LANG_LABELS` map |
| 22 | Abort stream on view close | ✅ Already handled by existing `onClose()` |
| 23 | `autoSaveSummary` never wired | ✅ `onClose()` triggers generation |
| 24 | IME Enter composition bug | ✅ `e.isComposing` guard |
| 25 | `autoScroll` not reset on conversation switch | ✅ Reset in `setActiveConversation` |
| 26 | Navigator outside-click listener leak | ✅ `navigatorOutsideCleanup` field |
| 27 | Stale-state guards on title/chapter callbacks | ✅ ID lookup before write |
| 28 | Send button token label | ✅ Forward estimate `lastIn + lastOut + draft/4`, live update |
| 29 | Dead i18n keys | ✅ 6 keys removed; `tests/i18n.test.ts` added |
| 30 | No ESLint | ✅ `eslint.config.mjs`; `npm run lint` in CI |
| 31 | No persistence round-trip tests | ✅ `services/persistence.ts` + `tests/persistence.test.ts` (32 tests) |
| 32 | Provider structural duplication (`BaseProvider`) | ✅ `services/BaseProvider.ts` |
| 33 | `estimateTokens` bytes vs text API | ✅ Renamed + split; moved to `messageUtils.ts`; tested |
| 39 | Duplicate identical regex in `NoteWriter.prependWithSeparator` | ✅ Collapsed to single `fmRx` |
| 40 | `FRAMEWORK_INSTRUCTIONS[framework]` unsafe key access — appends `"undefined"` for unrecognised frameworks | ✅ Presence check added |
| 41 | `reloadFromDisk()` creates new settings object but doesn't propagate it to any service | ✅ `updateSettings` added to `LLMRouter`, `PromptOptimizerService`; `reloadFromDisk` + `saveSettings` both propagate |
| 42 | `resumeMode: "summary"` destructively wiped `conv.messages` and had no effect on the API request otherwise | ✅ `selectHistoryForSend` gates the request; `conv.messages` no longer cleared |
| 43 | No retry on transient rate-limit/network failures | ✅ `services/retry.ts`; retried only before any token has been emitted for the attempt |
| 44 | No Anthropic prompt caching — system prompt + tools re-billed every turn | ✅ `cache_control: ephemeral` on system + tools; required bumping `@anthropic-ai/sdk` to `^0.40.0` |
| 45 | No sampling/temperature control | ✅ `temperature` in settings/template/conversation, resolved like `maxTokens` |
| 46 | No token-budget guard on attached notes | ✅ `maxAttachedNotesTokens` setting + `Notice` warning |
| 47 | System prompt gave no grounding/no-hallucination instruction for attached notes | ✅ Added to `ContextBuilder.buildSystemPrompt` when notes are attached |
| 48 | `#` note suggestions ranked by filename substring only, no query relevance | ✅ `services/noteRelevance.ts` keyword-overlap tiebreak in `ui/InlineSuggest.ts` |
| 49 | Oversized attached notes inlined whole, no chunking | ✅ `services/noteChunking.ts` — heading-based, relevance-filtered excerpting above 4000 chars |
| 50 | True embedding/vector-similarity note retrieval | Open — Backlog (see below; deliberately out of scope for the #42–#49 batch) |

---

## New Suggestions (#34–#38)

---

### #34 — Diagram overflow was caused by missing `overflow-x: hidden` on `.p-chat`

**File:** `styles.css` — **Resolved in v1.11.5**

The CSS spec coerces `overflow-x` from `visible` to `auto` when `overflow-y` is non-`visible`. `.p-chat { overflow-y: auto }` silently acquired `overflow-x: auto`, allowing wide SVG diagrams to scroll the entire conversation sideways. Additionally, flex items (`.p-msg-ai`, `.p-ai-body`) lacked `min-width: 0`, preventing `width: 100%` from resolving to the panel width.

**Resolution:** `overflow-x: hidden` added to `.p-chat`; `min-width: 0; max-width: 100%` added to both flex ancestors. Diagrams now scroll within their own frame; text stays fixed.

**Lesson:** Any future `overflow-y: auto` on a scroll container must be paired with explicit `overflow-x: hidden` unless horizontal scrolling is intentional.

---

### #35 — Mermaid Gantt charts scaled down due to MutationObserver missing `style` attribute

**File:** `sidebar.ts · fixDiagramSvgSize()` — **Resolved in v1.11.5**

Gantt charts set `svg.style.maxWidth` (not `viewBox` or a `width` HTML attribute) as their natural size. The observer's `attributeFilter` only watched `["viewBox","width","height"]`, so the `style` attribute mutation was never caught — `stamp()` returned false indefinitely and the SVG stayed at `width="100%"`.

**Resolution:** Two-phase observation on the same `MutationObserver` instance. Phase 2 extends the observer to watch the SVG element's own `style` attribute once the SVG is found but unstamped. `stamp()` gains a third fallback: `parseFloat(svg.style.maxWidth)`.

---

### #36 — Cross-device sync required Obsidian restart; conversations not live-updated

**File:** `main.ts` — **Resolved in v1.11.5**

Pythia loaded `data.json` once at startup. When another device wrote a newer version via iCloud, the running instance kept serving stale in-memory state and overwrites the other device's changes on the next save. `vault.on("modify")` does not fire for `.obsidian/` files.

**Resolution:** `watchDataJson()` polls `adapter.stat()` every 5 s. When `mtime` advances and the write wasn't ours (3 s own-write grace window), the plugin reloads from disk and refreshes the sidebar.

**Remaining risk:** 5 s polling interval means up to 5 s lag between a remote write and local refresh. Consider reducing to 2 s or implementing a file-system watcher if the Obsidian API exposes one in a future version.

---

### #37 — iCloud eviction safety guard was in the wrong layer

**File:** `main.ts · persistData()` — **Resolved in v1.11.5**

The guard `if (this.conversations.length === 0 && this.loadedConversationCount > 0)` blocked all saves to an empty list, including the user deliberately deleting the last conversation. The deleted conversation would reappear on the next Obsidian restart.

**Resolution:** Guard moved to `loadPluginData()`. It now fires *before* overwriting `this.conversations` — if the loaded array is empty but in-memory state is non-empty, the load is refused and existing conversations are preserved. `persistData()` is now unconditional.

---

### #38 — `minAppVersion` was set too high, blocking BRAT auto-updates on iOS

**File:** `manifest.json`, `versions.json` — **Resolved in v1.11.4**

`minAppVersion` was `"1.11.4"` across all plugin versions since 1.1.0, while the actual installed Obsidian version was 1.10.6. BRAT's default `allowIncompatiblePlugins: false` caused it to silently skip auto-updates on iOS, leaving iOS on an old version with unfixed sync bugs.

**Resolution:** `minAppVersion` corrected to `"1.4.0"` (the actual minimum Obsidian version required). `allowIncompatiblePlugins` set to `true` in the shared BRAT vault config.

---

## Priority Matrix

| # | Suggestion | Status | Impact | Effort | Priority |
|---|---|---|---|---|---|
| 5 | Inject `NoteWriter` instead of constructing inline | ✅ Done | Low | Low | — |
| 31 | Persistence round-trip tests | ✅ `services/persistence.ts` + `tests/persistence.test.ts` | High | Medium | — |
| 32 | `BaseProvider` abstract class | ✅ Done | Medium | High | — |
| 40 | `FRAMEWORK_INSTRUCTIONS` unsafe key access | ✅ Done | Medium | Low | — |
| 41 | `reloadFromDisk()` doesn't propagate new settings to services | ✅ Done | Medium | Low | — |
| 1 | Incremental DOM rendering in `renderMessages` | ✅ Done | High | Medium | — |
| 11 | Split `sidebar.ts` into sub-components | ✅ Partial / final | High | High | — |
| 3 | Per-conversation file storage (long-term) | Open | High | High | Backlog |
| 39 | Duplicate identical regex in `NoteWriter.prependWithSeparator` | ✅ Done | Low | Low | — |
| 4 | Cache context note file reads | Won't fix | Low | Medium | — |
| 10 | Harden fire-and-forget in fork path | Open | Low | Medium | Backlog |
| 42 | `resumeMode` destructive wipe + dead API-level effect | ✅ Done | High | Low | — |
| 43 | Retry on transient rate-limit/network failures | ✅ Done | Medium | Low | — |
| 44 | Anthropic prompt caching | ✅ Done | High | Medium | — |
| 45 | Sampling/temperature control | ✅ Done | Medium | Low | — |
| 46 | Token-budget guard on attached notes | ✅ Done | Medium | Low | — |
| 47 | System-prompt grounding instruction | ✅ Done | Low | Low | — |
| 48 | Relevance-ranked `#` note suggestions | ✅ Done | Medium | Medium | — |
| 49 | Chunk oversized attached notes | ✅ Done | High | Medium | — |
| 50 | True embedding/vector-similarity retrieval | Open | High | High | Backlog |

---

## New Suggestions (#39–#41)

---

### #39 — Duplicate identical regex variables in `NoteWriter.prependWithSeparator`

**File:** `services/NoteWriter.ts:45-46` — **Resolved**

```typescript
const newFmRx = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
const curFmRx = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
```

Both variables are identical in pattern, flags, and semantics. `curFmRx` is dead — a single `fmRx` constant (or inline literal reuse) is sufficient.

**Resolution:** Collapse to one variable: `const fmRx = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;` and use it for both `content.match()` and `current.match()`.

---

### #40 — `PromptOptimizerService.optimizeText`: unsafe `FRAMEWORK_INSTRUCTIONS` key access

**File:** `services/PromptOptimizerService.ts:90-91` — **Resolved**

```typescript
if (framework !== "none") {
    userMessage += "\n\n" + FRAMEWORK_INSTRUCTIONS[framework];
}
```

`FRAMEWORK_INSTRUCTIONS` is a `Record<string, string>` with three keys (`"CO-STAR"`, `"RACE"`, `"RISEN"`). If `framework` holds any other string — possible from a `data.json` written by an older or newer version of the plugin — `FRAMEWORK_INSTRUCTIONS[framework]` is `undefined` and TypeScript coerces it to the string `"undefined"`. The LLM receives `"…\n\nundefined"` appended to its prompt.

**Resolution:** Add a presence check before appending:
```typescript
const instruction = FRAMEWORK_INSTRUCTIONS[framework];
if (instruction) userMessage += "\n\n" + instruction;
```

---

### #41 — `reloadFromDisk()` creates a new settings object but doesn't propagate it to services

**File:** `main.ts:306-315` + `main.ts:435-438` — **Resolved**

`reloadFromDisk()` calls `loadPluginData()`, which builds a **new** settings object:

```typescript
this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);  // new object every time
```

After this, `this.plugin.settings` points to the new object but every service still holds the old reference they received at construction time or via a prior `updateSettings()` call:

- `templateLoader.settings` — stale
- `noteWriter.settings` — stale
- `promptOptimizerService.settings` — stale (no `updateSettings` method at all)
- `AnthropicService.settings` / `OpenAIProvider.settings` (via BaseProvider) — stale

By contrast, `saveSettings()` calls `templateLoader.updateSettings()` and `noteWriter.updateSettings()` (lines 437-438), but not `promptOptimizerService` or the providers. And neither path is called from `reloadFromDisk()`.

**Practical impact:** If settings differ between devices (different default model, different templates folder, etc.) and a cross-device sync triggers `reloadFromDisk()`, all services continue using the pre-sync settings until Obsidian restarts. The most user-visible case: a model change on one device is silently ignored on another.

**Resolution:** At the end of `reloadFromDisk()`, propagate the new settings to all services:
```typescript
this.llmRouter?.updateSettings(this.settings);
this.templateLoader?.updateSettings(this.settings);
this.noteWriter?.updateSettings(this.settings);
this.promptOptimizerService?.updateSettings(this.settings);
```
`PromptOptimizerService` also needs an `updateSettings(settings: PythiaSettings)` method added.

---

## New Suggestions (#42–#50) — response-quality audit, 2026-07-09

A senior-engineer audit of what actually determines LLM response quality (not UI/CSS): the full prompt-construction and API-call path across `services/ContextBuilder.ts`, `services/AnthropicService.ts`, `services/OpenAIProvider.ts`, `services/BaseProvider.ts`, `services/apiError.ts`, `settings.ts`, and `main.ts`. Full rationale for each is in `docs/decisions.md` ADR-021 through ADR-026; summarized here.

---

### #42 — `resumeMode: "summary"` destructively wiped `conv.messages` and had no other effect

**Files:** `main.ts` (`cmdResumeConversation`), `services/AnthropicService.ts`, `services/OpenAIProvider.ts` — **Resolved**

`resumeMode` was stored and surfaced in Settings ("Summary — lower token cost") but neither provider read it when building the request — full history was always sent regardless. The field's only real effect was destructive: picking "summary" in the resume modal set `conv.messages = []`, permanently deleting the transcript with no backup.

**Resolution:** `selectHistoryForSend(messages, resumeMode)` (`services/messageUtils.ts`) — both providers now actually skip prior history in `"summary"` mode. `cmdResumeConversation` no longer clears `conv.messages`.

---

### #43 — No retry on transient rate-limit/network failures

**Files:** `services/retry.ts` (new), `services/AnthropicService.ts`, `services/OpenAIProvider.ts` — **Resolved**

`services/apiError.ts` classified errors only for a user-facing `Notice`; a momentary 429 or network blip failed the entire turn.

**Resolution:** `isRetryableError` + a two-step backoff schedule, applied only while no tokens have been emitted yet for the current attempt (never risks duplicating partial output).

---

### #44 — No Anthropic prompt caching

**Files:** `services/AnthropicService.ts`, `package.json` — **Resolved**

System prompt and tool definitions are identical every turn of a conversation but were re-sent and re-billed in full each time. Implementing this surfaced that the pinned `@anthropic-ai/sdk` (`^0.28.0`) didn't expose `cache_control` outside its old beta-prompt-caching namespace — resolved (with user confirmation) by bumping to `^0.40.0`, the smallest version with `cache_control` in the main Messages API.

**Resolution:** `system` sent as a `cache_control: ephemeral`-tagged text block; last tool in the tools array tagged the same way.

---

### #45 — No sampling/temperature control

**Files:** `models/settings.ts`, `models/types.ts`, `services/TemplateLoader.ts`, `services/AnthropicService.ts`, `services/OpenAIProvider.ts`, `settings.ts` — **Resolved**

Neither provider exposed any way to tune determinism vs. variety; only `model`/`max_tokens`/`system`/`messages`/`tools` were ever sent.

**Resolution:** Optional `temperature` at settings/template/conversation level, resolved the same way as `maxTokens`. OpenAI's `o1`/`o3` reasoning models (already special-cased as `NO_SYSTEM_ROLE_MODELS`) reject a custom temperature, so it's omitted for those regardless of settings.

---

### #46 — No token-budget guard on attached notes

**Files:** `services/ContextBuilder.ts`, `models/settings.ts`, `settings.ts` — **Resolved**

Attached notes were inlined in full with no size check — a large note could silently bury the user's question with no visible symptom.

**Resolution:** `maxAttachedNotesTokens` setting (default 8000); a `Notice` warns before sending when the estimated token count of attached notes exceeds it. Warns rather than truncates — deliberately sending a large note is sometimes legitimate.

---

### #47 — System prompt gave no grounding instruction for attached notes

**File:** `services/ContextBuilder.ts` (`buildSystemPrompt`) — **Resolved**

Nothing told the model to prefer attached-note content over guessing, or to say when the notes don't answer the question.

**Resolution:** One short standing instruction appended only when `conversation.contextNotes.length > 0`.

---

### #48 — `#` note suggestions ranked by filename substring only

**Files:** `services/noteRelevance.ts` (new), `ui/InlineSuggest.ts` — **Resolved**

Suggestions were filtered by substring match on the typed fragment and otherwise unordered — no signal from what the user was actually writing.

**Resolution:** Keyword-overlap scoring (`scoreRelevance`) against each note's basename + frontmatter title + headings, read via Obsidian's cached `metadataCache` (no per-keystroke disk reads). Filename match still gates/dominates; relevance is the tiebreaker — most useful when the typed fragment is empty or ambiguous.

---

### #49 — Oversized attached notes inlined whole, no chunking

**Files:** `services/noteChunking.ts` (new), `services/ContextBuilder.ts` — **Resolved**

A single large attached note could consume most of the context budget or bury the actual question, with no mitigation.

**Resolution:** Notes over `NOTE_CHUNK_THRESHOLD_CHARS` (4000) are split by markdown heading and filtered to the sections most relevant (by `noteRelevance.scoreRelevance`) to the user's message, restored to original document order, and tagged `excerpt="true"` with a leading note in the inlined text. Notes without headings, or under the threshold, are unaffected.

---

### #50 — True embedding/vector-similarity note retrieval

**Status:** Open — Backlog

Pythia is described as "RAG-powered" but has no real retrieval — #48/#49 are a dependency-free keyword-overlap approximation, not semantic search. A proper implementation (embed all vault notes, persist a vector index, incrementally re-embed on vault changes, cosine-similarity search at query time) is a multi-day feature with product decisions that need explicit user input first: which provider generates embeddings when only an Anthropic key is configured (Anthropic has no embeddings API), where the index is persisted (a new file, given #3's `data.json` size concerns), and the re-embedding cost/trigger policy. Deliberately not attempted speculatively in the #42–#49 batch — scope as its own follow-up once the keyword-overlap heuristic's real-world limits are understood.
