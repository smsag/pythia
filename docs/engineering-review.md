# Engineering Review — Pythia

*Initial review: 2026-05-29 at v1.10.2.*
*Updated: 2026-05-30 — v1.10.2 session fixes.*
*Updated: 2026-05-30 — v1.11.0 batch: #2, #3 (partial), #7, #8, #9, #13, #16 resolved.*
*Updated: 2026-05-30 — #23–#28 batch resolved.*
*Updated: 2026-05-31 — v1.11.1–1.11.3: #17, #18, #21, #6, #14, #15, #19, #20, #29, #30, #33 resolved. #31–#32 remain.*
*Updated: 2026-06-01 — v1.11.4–1.11.5: #29 dead keys, #30 ESLint, #33 estimateTokens all resolved. New suggestions #34–#38 added from v1.11.5 session audit.*
*Updated: 2026-06-14 — #32 BaseProvider resolved.*

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-29 | Initial review at v1.10.2 |
| 2026-05-30 | v1.11.0: #2, #3 partial, #7, #8, #9, #13, #16 resolved |
| 2026-05-30 | #23–#28: autoSaveSummary, IME, autoScroll, navigator leak, stale guards, send-button |
| 2026-05-31 | #17, #18, #21, #6, #14, #15, #19, #20 resolved; #29–#33 added |
| 2026-06-01 | #29 dead i18n keys, #30 ESLint, #33 estimateTokens resolved; new #34–#38 from v1.11.5 session |
| 2026-06-14 | #32 BaseProvider abstract class resolved |

---

## File Inventory (sorted by lines, v1.11.5)

| # | File | Lines | Role |
|---|------|------:|------|
| 1 | `sidebar.ts` | 2 033 | Main view — UI, rendering, streaming, interaction |
| 2 | `styles.css` | 1 224 | All plugin CSS |
| 3 | `docs/design-system.css` | 525 | Design-system reference / prototype |
| 4 | `main.ts` | 855 | Plugin entry, commands, conversation lifecycle, sync watcher |
| 5 | `services/OpenAIProvider.ts` | 340 | OpenAI streaming + utility calls |
| 6 | `settings.ts` | 375 | Settings schema + settings tab UI |
| 7 | `services/AnthropicService.ts` | 278 | Anthropic streaming + utility calls |
| 8 | `tests/messageUtils.test.ts` | 202 | Vitest tests — message utils |
| 9 | `locales/de.ts` | 208 | German i18n strings |
| 10 | `locales/en.ts` | 207 | English i18n strings |
| 11 | `ui/InlineSuggest.ts` | 152 | `#` note picker autocomplete |
| 12 | `services/NoteWriter.ts` | 135 | Vault write operations |
| 13 | `suggest/ConversationSettingsModal.ts` | 133 | Per-conversation settings modal |
| 14 | `services/messageUtils.ts` | 98 | Shared: parseTitleAndSummary, normalizeMessages, token estimate, lang helpers |
| 15 | `services/TemplateLoader.ts` | 87 | Template discovery + parsing |
| 16 | `suggest/ConversationSuggest.ts` | 82 | Fuzzy-search modals |
| 17 | `models/types.ts` | 76 | Shared TypeScript interfaces |
| 18 | `tests/i18n.test.ts` | 75 | Vitest tests — locale parity + dead-key detection |
| 19 | `suggest/InputModal.ts` | 69 | Generic text-input modal |
| 20 | `services/LLMRouter.ts` | 68 | Dispatches calls to the active provider |
| 21 | `services/ToolHandler.ts` | 63 | `create_note` tool definition + execution |
| 22 | `services/ConversationStore.ts` | 58 | In-memory store + debounced persistence |
| 23 | `suggest/ResumeModeModal.ts` | 54 | Resume-mode picker |
| 24 | `services/ContextBuilder.ts` | 50 | Builds system prompt + attaches notes |
| 25 | `tests/apiError.test.ts` | 48 | Vitest tests — API error classification |
| 26 | `tests/utils.test.ts` | 43 | Vitest tests — token estimation helpers |
| 27 | `eslint.config.mjs` | 40 | ESLint flat config |
| 28 | `esbuild.config.mjs` | 47 | Build configuration |
| 29 | `vitest.config.ts` | 24 | Coverage configuration |
| 30 | `services/LLMProvider.ts` | 20 | Provider interface |
| 31 | `utils.ts` | 20 | `todayISO`, `getFilesInFolder` |
| 32 | `i18n.ts` | 16 | i18n lookup helper |

**Source total:** ~7 200 lines (excl. lock file, generated `main.js`, coverage output).
**Test suite:** 48 tests across 4 files — `npm test` (~200 ms), `npm run coverage` with enforced thresholds.
**CI:** lint → build → test on every push to `main` and every PR.

---

## Suggestion Status

| # | Suggestion | Status |
|---|---|---|
| 1 | Incremental DOM rendering in `renderMessages` | Open — Backlog |
| 2 | Batch `backfillChapterNames` | ✅ Serial for-loop |
| 3 | `data.json` unbounded growth | ✅ Partial — cap + eviction; per-file Backlog |
| 4 | Cache context note file reads | Open — Backlog |
| 5 | Inject `NoteWriter` instead of constructing inline | ✅ `ToolHandler` class; `plugin.toolHandler` |
| 6 | Extract `parseTitleAndSummary` to shared util | ✅ `services/messageUtils.ts` |
| 7 | Error handling on persistence failure | ✅ try/catch + Notice + flush-on-unload |
| 8 | Wrap `MarkdownRenderer.render()` in try/catch | ✅ Done |
| 9 | Guard `Buffer` in `legacyDecrypt` | ✅ `typeof Buffer !== "undefined"` |
| 10 | Harden fire-and-forget in fork path | Open — Backlog |
| 11 | Split `sidebar.ts` into sub-components | Open — Backlog |
| 12 | `BaseProvider` abstract class | ✅ `services/BaseProvider.ts` |
| 13 | Auto-abbreviate unknown model names | ✅ Done |
| 14 | Extract `normalizeMessages` to shared util | ✅ `services/messageUtils.ts` |
| 15 | Add Vitest unit tests | ✅ 155 tests across 7 files |
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
| 31 | No persistence round-trip tests | Open — Soon |
| 32 | Provider structural duplication (`BaseProvider`) | ✅ `services/BaseProvider.ts` |
| 33 | `estimateTokens` bytes vs text API | ✅ Renamed + split; moved to `messageUtils.ts`; tested |

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
| 31 | Persistence round-trip tests | Open | High | Medium | Soon |
| 32 | `BaseProvider` abstract class | ✅ Done | Medium | High | — |
| 1 | Incremental DOM rendering in `renderMessages` | Open | High | High | Backlog |
| 11 | Split `sidebar.ts` into sub-components | Open | High | High | Backlog |
| 3 | Per-conversation file storage (long-term) | Open | High | High | Backlog |
| 4 | Cache context note file reads | Open | Low | Medium | Backlog |
| 10 | Harden fire-and-forget in fork path | Open | Low | Medium | Backlog |
