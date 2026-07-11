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
*Updated: 2026-07-09 — bug-fix/reliability/observability/maintainability/performance audit: #51–#55, #57–#72, #75, #76 resolved (broken o4-mini model, cross-conversation streaming race, OpenAI token undercounting, abort-during-tool-call crash, retry gap for 5xx/529, unbounded tool-call loop, conversation resurrection on delete, stuck error bubble, optimizer stale-response race, debugLog observability convention, three silent-catch fixes, six performance quick wins, BaseProvider extraction, duplicate suggest modals merged). #56 (classifyApiError heuristic) deliberately not done — see ADR-030. #73, #74 (note-chunk caching, InlineSuggest candidate cap) added as backlog.*
*Updated: 2026-07-09 — second-round audit (post-1.21.1): #77–#83 resolved (second delete-guard gap via the conversation switcher, resume-mode race with concurrent deletion, eviction crash on malformed `updatedAt`, eviction only protecting one sidebar leaf, silent multi-line frontmatter corruption, deep-link double-decode, summary-generation stale-conversation race). Remaining medium/low findings from this audit and pre-existing architectural backlog (#3, #10, #50, #73, #74) reviewed and explicitly deferred, not silently dropped.*
*Updated: 2026-07-10 — #84 resolved: `cmdForkConversation` now carries `temperature` over from the source conversation, matching `provider`/`model`/`maxTokens`. Also added a settings-modal UI to view/edit a conversation's temperature after creation (not a bug — new capability, not separately numbered).*
*Updated: 2026-07-11 — #85 resolved: `models/knownModels.ts`'s Anthropic entries had gone stale — `claude-opus-4` and `claude-haiku-3-5` had both been retired by Anthropic, and `AnthropicService.fastModel` hardcoded the dead `claude-haiku-3-5` as its fallback utility model (silently broken for any call not passing an explicit model). Swapped to the current catalog: `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`; `defaultAnthropicModel` and `fastModel` updated to match.*
*Updated: 2026-07-11 — #86 resolved: the #85 catalog refresh introduced a live regression — `claude-fable-5`, `claude-opus-4-8`, and `claude-sonnet-5` all reject the `temperature` request parameter outright (400 `invalid_request_error`, "temperature is deprecated for this model"), but `AnthropicService.streamMessage` sent it unconditionally whenever a conversation or global default temperature was configured, breaking every request on 3 of the 4 listed Anthropic models. Added `models/knownModels.ts`'s `supportsTemperature()` (same shape as the existing `isReasoningModel()` guard) and gated the parameter on it; added regression tests in `tests/AnthropicService.test.ts` covering both the send and omit paths.*
*Updated: 2026-07-11 — #87 resolved: #86's backend gating fixed the 400s, but the settings tab and conversation modal still showed the temperature control as fully active even on models that silently ignored it — confusing, since nothing in the UI explained why a set temperature had no effect. Added `Setting.setDisabled()`-based reactive gating (no prior precedent in either file) in both `settings.ts` and `suggest/ConversationSettingsModal.ts`, wired to the existing provider/model dropdown `onChange` handlers, with a "(not supported by the selected model)" description suffix when disabled. Landed alongside a new `effort` parameter (`models/knownModels.ts` → `supportsEffort()`, Anthropic's `output_config.effort` / OpenAI's `reasoning_effort`, global setting + template frontmatter + per-conversation override, same gating treatment) — not a bug fix, a new capability, not separately numbered (same convention as #84's temperature-editing UI). See ADR-040.*
*Updated: 2026-07-11 — Added PDF-as-context support: templates and the existing attach surfaces can now point at a `.pdf` in the vault and it's sent to the model as a native document/file content block (Anthropic `DocumentBlockParam`, OpenAI `ChatCompletionContentPart.File`) rather than read as text — no local extraction or chunking. Dispatch is by extension (`path.toLowerCase().endsWith(".pdf")`) at read time, matching the existing model-capability-check pattern, so no new persisted types were needed. New: `ContextBuilder.buildAttachedPdfs()`, `messageUtils.arrayBufferToBase64()` (Buffer-free for Obsidian mobile), and a hardcoded `MAX_PDF_FILE_SIZE_BYTES` (20 MB) guard that skips oversized PDFs with a Notice instead of sending a request that would 400. `BaseProvider.resolveUserContent()` now splits `attachedNotes` by extension and fetches notes/PDFs in parallel; each provider splices PDF blocks onto the last user message after `normalizeMessages` runs (its same-role merge does string concatenation and would corrupt array content). UI file pickers (`NoteSuggestModal`, `ui/InlineSuggest.ts`, `utils.ts`'s `getFilesInFolder`) widened to include `.pdf`; `suggest/FileSuggest.ts`'s base class deliberately stays markdown-only since it also backs the markdown-only template picker. Not a bug fix — a new capability, not separately numbered (same convention as `effort` in #87). See ADR-041.*

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
| 2026-07-09 | #42–#49 response-quality audit resolved; #50 added as backlog |
| 2026-07-09 | #51–#55, #57–#72, #75, #76 bug-fix/reliability/observability/maintainability/performance audit resolved; #56 deliberately not done; #73, #74 added as backlog |
| 2026-07-09 | #77–#83 second-round audit resolved (post-1.21.1 release); remaining medium/low findings deferred |
| 2026-07-10 | #84 resolved (fork drops temperature override); added per-conversation temperature editing UI |
| 2026-07-11 | #85 resolved (stale/retired Anthropic model IDs — `claude-opus-4`, `claude-haiku-3-5` — replaced with `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`; dead `fastModel` fallback fixed) |
| 2026-07-11 | #86 resolved (live 400s on `claude-fable-5`/`claude-opus-4-8`/`claude-sonnet-5` from unconditionally-sent `temperature`; added `supportsTemperature()` gate + regression tests) |
| 2026-07-11 | #87 resolved (temperature control stayed active in UI even when the backend silently dropped it; added `setDisabled()`-based reactive gating in settings tab + conversation modal); added `effort` parameter (Anthropic `output_config.effort` / OpenAI `reasoning_effort`, global/template/per-conversation override, same gating) — new capability, see ADR-040 |
| 2026-07-11 | Added PDF attachments as context — sent as native document/file content blocks (Anthropic `DocumentBlockParam`, OpenAI `ChatCompletionContentPart.File`), dispatched by extension with no new persisted types; `ContextBuilder.buildAttachedPdfs`, `messageUtils.arrayBufferToBase64`, 20 MB size guard (skip + warn, not truncate); UI file pickers widened to include `.pdf` — new capability, see ADR-041 |

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
| 51 | `o4-mini` selectable but always broken (missing from `NO_SYSTEM_ROLE_MODELS`) | ✅ `models/knownModels.ts` — `isReasoningModel()` single source of truth |
| 52 | Model lists independently duplicated across 4 files | ✅ `KNOWN_MODELS`/`MODEL_ABBREVIATIONS` centralized in `models/knownModels.ts` |
| 53 | OpenAI token usage undercounted across tool-call rounds | ✅ Accumulates across rounds like `AnthropicService.ts` already did |
| 54 | Anthropic cache-hit/cache-write tokens discarded, unobservable | ✅ `TokenUsage.cacheReadTokens`/`cacheCreationTokens` + debug log |
| 55 | Abort during pending tool confirmation crashed with a null-pointer, misreported as network error | ✅ Abort signal captured once per `streamMessage` call |
| 56 | `classifyApiError`'s network fallback can mask a bug as "network error" | Deliberately not done — root cause (#55) removed; see ADR-030 |
| 57 | No retry on 5xx / Anthropic 529 "overloaded" | ✅ New `"server_error"` class, retried like rate limits |
| 58 | No iteration cap on the tool-calling round-trip loop | ✅ `MAX_TOOL_ROUNDS = 25` + `ToolLoopLimitError` |
| 59 | Streaming/abort state is view-global — switching conversations mid-stream could abort the wrong one | ✅ Switch/delete blocked with a Notice while streaming |
| 60 | Failed stream left a permanently stuck `.pythia-streaming` bubble, no console trace | ✅ Always finalized or removed; `console.error` added |
| 61 | Deleting a conversation mid-stream resurrected it via `ConversationStore.save()`'s push-if-missing fallback | ✅ `save()` no-ops for an unknown id instead of resurrecting |
| 62 | Inline prompt-optimizer stale-response race could corrupt a later optimize session's DOM | ✅ Generation counter guards `showResult()` |
| 63 | `debugMode` gave almost no operational visibility beyond the initial request log | ✅ `debugLog()` helper; retry + tool-round trace points added |
| 64 | `CommandHubModal` fire-and-forget command actions swallowed errors silently | ✅ `Promise.resolve(item.action()).catch(...)` + Notice |
| 65 | Chapter-name backfill retried silently and unboundedly on every conversation open | ✅ `console.warn` + in-flight dedup guard |
| 66 | `TemplateLoader.loadTemplate` swallowed all parse errors silently | ✅ `console.warn` with file path + error |
| 67 | `updateSendBtnLabel()` allocated + reversed the full message array every keystroke | ✅ Plain reverse `for` loop |
| 68 | `autoResizeTextarea()` recomputed `getComputedStyle` every keystroke | ✅ Cached, invalidated on `buildUI()` |
| 69 | Attached notes read sequentially on every turn | ✅ `Promise.all` in `ContextBuilder.buildAttachedNotesContent` |
| 70 | Templates read sequentially | ✅ `Promise.all` in `TemplateLoader.loadTemplates` |
| 71 | Empty `templatesFolder` degrades to a whole-vault scan | ✅ Early-return guard |
| 72 | `InlineSuggest`/`noteChunking` re-tokenized the query per candidate | ✅ `scoreRelevanceTokens` — query tokenized once, reused |
| 73 | Note-chunk caching keyed on `(path, mtime)` | Open — Backlog (partial win only; scoring is query-dependent) |
| 74 | `InlineSuggest` candidate cap for very large vaults | Open — Backlog (product decision on result ordering) |
| 75 | Duplicate `FileSuggestModal`/`NoteSuggestModal` implementations | ✅ `NoteSuggestModal` now a one-line subclass |
| 76 | `AnthropicService`/`OpenAIProvider` still duplicated attached-notes + error-handling blocks | ✅ `resolveUserContent()`/`finishOrError()` in `BaseProvider` |
| 77 | Conversation-switcher delete path bypassed the streaming guard | ✅ Same `isStreaming` check added to the picker's delete callback |
| 78 | `cmdResumeConversation` could resurrect a conversation deleted during summary generation | ✅ Existence check before reactivating |
| 79 | Eviction could crash on a malformed/missing `updatedAt`, breaking all future saves | ✅ Defensive sort + moved inside the existing try/catch |
| 80 | Eviction only protected the first sidebar leaf's active conversation | ✅ `evictConversations` now takes `activeIds: string[]` from every leaf |
| 81 | Multi-line YAML frontmatter silently dropped on note merge, reachable via LLM tool output | ✅ `mergeFrontmatterFields` groups keys with their continuation lines |
| 82 | Deep-link `inject` action double-decoded already-decoded text, throwing on bare `%` | ✅ Redundant `decodeURIComponent` removed |
| 83 | Summary generation could force-open a different, currently-viewed conversation's summary panel | ✅ UI side effects guarded by `activeConversation?.id === conv.id` |
| 84 | `cmdForkConversation` copied provider/model/maxTokens from the source but not temperature | ✅ `conv.temperature = source.temperature` added; `ConversationSettingsModal` also gained a temperature field |

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
| 51 | `o4-mini` always broken | ✅ Done | High | Low | — |
| 52 | Model lists centralized | ✅ Done | Medium | Low | — |
| 53 | OpenAI token undercounting | ✅ Done | Medium | Low | — |
| 54 | Cache-token observability | ✅ Done | Low | Low | — |
| 55 | Abort-during-tool-call crash | ✅ Done | High | Low | — |
| 56 | `classifyApiError` heuristic | Not done | Low | — | — |
| 57 | Retry 5xx/529 | ✅ Done | Medium | Low | — |
| 58 | Bounded tool-call loop | ✅ Done | Medium | Low | — |
| 59 | Cross-conversation streaming race | ✅ Done | High | Medium | — |
| 60 | Stuck streaming bubble on error | ✅ Done | Medium | Low | — |
| 61 | Conversation resurrection on delete | ✅ Done | High | Low | — |
| 62 | Optimizer stale-response race | ✅ Done | Medium | Low | — |
| 63 | `debugLog` observability convention | ✅ Done | Medium | Low | — |
| 64 | `CommandHubModal` silent failures | ✅ Done | Low | Low | — |
| 65 | Chapter-name backfill logging + dedup | ✅ Done | Low | Low | — |
| 66 | `TemplateLoader` silent parse errors | ✅ Done | Low | Low | — |
| 67–72 | Performance quick wins (six items) | ✅ Done | Medium | Low | — |
| 73 | Note-chunk caching | Open | Medium | Medium | Backlog |
| 74 | `InlineSuggest` candidate cap | Open | Low | Medium | Backlog |
| 75 | Duplicate suggest modals merged | ✅ Done | Low | Low | — |
| 76 | BaseProvider extraction extended | ✅ Done | Medium | Low | — |
| 77 | Second delete-guard gap (conversation switcher) | ✅ Done | High | Low | — |
| 78 | Resume-mode race with concurrent deletion | ✅ Done | High | Low | — |
| 79 | Eviction crash on malformed data | ✅ Done | High | Low | — |
| 80 | Eviction only protected one sidebar leaf | ✅ Done | High | Low | — |
| 81 | Multi-line frontmatter corruption | ✅ Done | High | Low | — |
| 82 | Deep-link double-decode | ✅ Done | Medium-High | Low | — |
| 83 | Summary-generation stale-conversation race | ✅ Done | Medium-High | Low | — |
| 84 | Fork drops temperature override | ✅ Done | Low | Low | — |

---

## New Suggestions (#51–#76) — bug-fix/reliability/observability/maintainability/performance audit, 2026-07-09

A senior-engineer audit across three areas (services layer; main.ts/sidebar.ts/settings.ts; ui/suggest/models/tests) looking for bugs and opportunities to improve performance, reliability, maintainability, and observability. Full rationale for each decision is in `docs/decisions.md` ADR-028 through ADR-034; summarized here.

### #51/#52 — `o4-mini` always broken; model lists centralized

**Files:** `models/knownModels.ts` (new), `services/OpenAIProvider.ts`, `settings.ts`, `suggest/ConversationSettingsModal.ts`, `sidebar.ts` — **Resolved**

`o4-mini` was selectable in three places but missing from the one list (`NO_SYSTEM_ROLE_MODELS`) that gated request shape — every request against it sent a rejected `system` role, `temperature`, and `max_tokens`. `models/knownModels.ts` is now the single source of truth (`KNOWN_MODELS`, `isReasoningModel()`, `MODEL_ABBREVIATIONS`).

### #53/#54 — OpenAI token undercounting; cache-token observability

**Files:** `services/OpenAIProvider.ts`, `services/AnthropicService.ts`, `models/types.ts` — **Resolved**

OpenAI only reported the last tool-call round's usage, silently dropping earlier rounds' cost. Now accumulates like Anthropic already did. `TokenUsage` gained `cacheReadTokens`/`cacheCreationTokens`, previously discarded entirely, now surfaced via debug log.

### #55/#56 — Abort-during-tool-call crash; `classifyApiError` heuristic

**Files:** `services/AnthropicService.ts`, `services/OpenAIProvider.ts` — **#55 Resolved, #56 Not done**

Both providers re-read `this.abortController.signal` inside the tool-calling loop; aborting during a pending tool confirmation nulled the controller, crashing on the next round trip with a `TypeError` misreported as "Network error." Fixed by capturing the signal once per call. `classifyApiError`'s `TypeError → "network"` fallback was deliberately left alone — the fix removes its only realistic failure mode; a heuristic there would be speculative.

### #57/#58 — Retry gap for 5xx/529; unbounded tool-call loop

**Files:** `services/apiError.ts`, `services/retry.ts`, `services/AnthropicService.ts`, `services/OpenAIProvider.ts`, `models/types.ts` — **Resolved**

5xx (including Anthropic's 529 "overloaded") fell through to a non-retryable class. New `"server_error"` classification is retried like rate limits. Both providers' tool-calling loops are now capped at 25 rounds (`ToolLoopLimitError`), surfaced as a friendly Notice instead of spinning forever.

### #59/#60 — Cross-conversation streaming race; stuck streaming bubble

**Files:** `sidebar.ts` — **Resolved**

Streaming/abort state is view-global; nothing stopped switching to or deleting a different conversation mid-stream, letting "Stop" abort the wrong generation and the completing stream force-scroll whatever conversation was displayed. Switching/deleting is now blocked with a Notice while streaming. A failed stream previously left its bubble stuck mid-render with no console trace — now always finalized or removed, with `console.error` logging the real error.

### #61 — Conversation resurrection on delete-during-stream

**File:** `services/ConversationStore.ts` — **Resolved**

`save()` pushed a not-found conversation back in rather than treating it as deleted — a stream/backfill completing after the user deleted its conversation would silently resurrect it. `save()` now no-ops for an unknown id (verified safe: `main.ts`'s `createConversation()` never relies on this fallback for first-save).

### #62 — Inline prompt-optimizer stale-response race

**File:** `ui/OptimizationController.ts` — **Resolved**

`showResult()`'s only guard was `state !== null` — a cancelled-then-restarted optimize flow could have a stale response land in a newer session's DOM. A generation counter now invalidates stale in-flight calls.

### #63–#66 — Observability convention; three silent-catch fixes

**Files:** `services/messageUtils.ts` (new `debugLog`), `services/AnthropicService.ts`, `services/OpenAIProvider.ts`, `services/TemplateLoader.ts`, `sidebar.ts`, `suggest/CommandHubModal.ts` — **Resolved**

`debugMode` only logged the outgoing request; retry attempts and tool-round outcomes were invisible even with it on. Three catch blocks swallowed errors completely: `TemplateLoader.loadTemplate` (malformed template frontmatter vanished with no signal), `backfillChapterNames` (also gained an in-flight dedup guard), and `CommandHubModal`'s fire-and-forget command actions (also gained a user-visible Notice on failure).

### #67–#72 — Performance quick wins

**Files:** `sidebar.ts`, `services/ContextBuilder.ts`, `services/TemplateLoader.ts`, `ui/InlineSuggest.ts`, `services/noteRelevance.ts`, `services/noteChunking.ts` — **Resolved**

Per-keystroke array allocation in `updateSendBtnLabel()` and `getComputedStyle` recomputation in `autoResizeTextarea()` removed. Attached-note reads and template reads parallelized with `Promise.all`. An empty `templatesFolder` no longer degrades to a whole-vault scan. `scoreRelevanceTokens` lets a caller tokenize the query once and reuse it across every candidate instead of re-tokenizing per candidate.

### #73/#74 — Deferred to backlog

Note-chunk caching keyed on `(path, mtime)` was not implemented — the relevance-scoring step is query-dependent (changes every turn), so a cache only partially helps for the added invalidation complexity. An `InlineSuggest` candidate cap for very large vaults was also deferred — it adds a product decision about result ordering beyond the redundant-tokenization fix already landed in #72.

### #75/#76 — Duplicate suggest modals merged; BaseProvider extraction extended

**Files:** `suggest/FileSuggest.ts`, `suggest/NoteSuggest.ts`, `services/BaseProvider.ts`, `services/AnthropicService.ts`, `services/OpenAIProvider.ts` — **Resolved**

`FileSuggestModal`/`NoteSuggestModal` were byte-identical except copy — merged via an optional constructor parameter. `AnthropicService`/`OpenAIProvider` had two more identical blocks (attached-notes fetch + Notices, abort-vs-error classification) beyond the original `BaseProvider` extraction — this exact duplication is what let #53 and #55's bugs diverge between the two files in the first place. Both landed last, after the bug-fix batches and their regression tests were already green.

---

## New Suggestions (#77–#83) — second-round bug-fix audit, post-1.21.1

A follow-up three-agent audit (main.ts/NoteWriter/persistence/PromptOptimizerService; remaining suggest/ modals + settings validation; a fresh full pass over sidebar.ts) run after the first bug-fix pass (1.21.1) shipped. Full rationale: `docs/decisions.md` ADR-035.

### #77/#78 — Second delete-guard gap; resume-mode race with concurrent deletion

**Files:** `sidebar.ts`, `main.ts` — **Resolved**

The conversation-switcher's delete callback (`ConversationSuggestModal` → `DeleteConversationModal`) had no `isStreaming` check — a second, unguarded path into the exact corruption scenario #59 was fixed for. `cmdResumeConversation` captured a conversation, awaited a multi-second summary generation, then unconditionally reactivated it — if deleted meanwhile, the user ended up in a conversation that could never be saved again. Both now check before proceeding, with a clear Notice on the blocked path.

### #79/#80 — Eviction crash on malformed data; eviction only protected one leaf

**Files:** `services/persistence.ts`, `main.ts` — **Resolved**

`evictConversations`'s sort assumed every conversation had a valid `updatedAt`, throwing on a corrupted record — and since the call sat outside `persistData`'s try/catch, a single bad record silently broke all future saves for the session. Separately, only the first `PYTHIA_VIEW_TYPE` leaf's active conversation was protected — a second open leaf's conversation could be evicted while in use. Fixed with a defensive sort, moving the call inside the try/catch, and widening the protected-id parameter to cover every open leaf.

### #81 — Multi-line frontmatter silently corrupted

**File:** `services/NoteWriter.ts` — **Resolved**

`mergeFrontmatterFields` only ever captured a field's `key:` line, discarding any indented continuation lines (YAML lists, block scalars) — reachable directly by LLM tool output (`prepend_note`/`rewrite_note`), not just manual misuse. Fixed by grouping each key with its continuation lines before deciding whether to merge it in.

### #82 — Deep-link double-decode

**File:** `main.ts` — **Resolved**

The `inject` deep-link action called `decodeURIComponent()` on text Obsidian's protocol handler had already decoded, throwing on any bare `%` (e.g. "50% off") — a common, realistic input, not an edge case. Redundant call removed.

### #83 — Summary-generation stale-conversation race

**File:** `sidebar.ts` — **Resolved**

`onGenerateSummary()`'s UI side effects (header re-render, summary-panel update/auto-open) ran unconditionally after the async summary call resolved, regardless of whether the user had switched to a different conversation in the meantime — forcing that *other* conversation's summary panel open unprompted. Now guarded by `activeConversation?.id === conv.id`, matching the pattern already used in `sendMessage()`.

### Deferred from this round

The audit also found several medium/low findings not fixed this round (by explicit scope choice, not oversight): `DeleteConversationModal`'s fire-and-forget confirm callback, `cmdForkConversation`'s lack of feedback when its source is gone (closely related to backlog #10), the prompt-optimizer's raw internal error-code leak ("Error: no-template"), several other un-awaited async handlers in `main.ts`'s context-menu items, settings numeric-input silent-discard (re-confirmed present, not yet fixed), no range validation on settings loaded from `data.json`, a copy-link button with no error handling, and a handful of smaller maintainability items (dead code, a folder-creation race, duplicate frontmatter parsers, inconsistent error formatting). Pre-existing architectural backlog (#3 per-conversation storage, #10 fork fire-and-forget, #50 embedding retrieval, #73/#74 caching/candidate-cap) remains open, unchanged.

---

### #84 — Fork silently dropped the source conversation's temperature override; temperature now editable per-conversation

**Files:** `main.ts`, `suggest/ConversationSettingsModal.ts` — **Resolved**

A user request to make temperature settable per-template (overriding the global default) turned out to already be fully implemented (ADR-024) — every template-driven conversation-creation path already copies `PythiaTemplate.temperature` onto the new conversation. Investigating it surfaced that `cmdForkConversation` copied `provider`/`model`/`maxTokens` from the source conversation but not `temperature`, so forking silently reverted to the global default, and that there was no UI at all to view/change a conversation's temperature after creation. Both fixed: the fork path now carries `temperature` over, and `ConversationSettingsModal` (opened via the model badge) gained a temperature field that validates on Save with a Notice on invalid input, rather than silently discarding it like the equivalent global-settings field still does (that one remains an open, deferred item).

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
