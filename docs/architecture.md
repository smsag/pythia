# Pythia — Architecture

*Last updated: 2026-08-27 — structural-decomposition roadmap PR6 (ADR-103 / #120): extracted the header chrome (header row, inline rename, model badge/popover, copy-link) into `ui/HeaderController.ts` (`mount()` builds it; `getConvNameEl`/`getChipEl` expose the elements History/ContextInspector need; cross-controller reach via deps). `sidebar.ts` 2,339 → 1,992 lines (**under 2,000; −47% from the 3,735 start**), ratchet lowered; dead `getLang`/`goodForModel`/`ConversationSettingsModal`/`MODEL_CATALOG`/`ModelInfo` imports dropped. Behaviour-preserving; 434 tests green.*

*Previously, 2026-08-27 — structural-decomposition roadmap PR5 (ADR-103 / #120): extracted the text-selection toolbar + span-favorites (incl. fork-from-selection) into `ui/SelectionController.ts` (`mount()` builds the toolbar + wires listeners; owns all HighlightPainter usage; Nav/Fork cross-links via deps). `sidebar.ts` 2,773 → 2,339 lines (−37% from the 3,735 start), ratchet lowered; the whole HighlightPainter import + dead `Favorite` type dropped from the view. Behaviour-preserving; 434 tests green.*

*Previously, 2026-08-27 — structural-decomposition roadmap PR4 (ADR-103 / #120): extracted the fork-origin banner + painted marks + inline anchor/menu into `ui/ForkController.ts` (`Deps`-driven; markdown + `registerDomEvent` passed as callbacks; favorites-summary reuse via SummaryController). Fork-creation from a selection (`onForkConversation`) stays in the view. `sidebar.ts` 3,057 → 2,773 lines, ratchet lowered; dead `repaintForkOrigins`/`formatSummaryTimestamp`/`debugLog` imports dropped. Behaviour-preserving; 434 tests green.*

*Previously, 2026-08-27 — structural-decomposition roadmap PR3 (ADR-103 / #120): extracted the context-budget bar + inspector card into `ui/ContextInspectorController.ts` (`Deps`-driven, constructed once so `inspectorOpen` persists across rebuilds). `sidebar.ts` 3,219 → 3,057 lines, ratchet lowered to match; dead `buildSystemPrompt`/`getContextWindow` imports dropped. Behaviour-preserving; 434 tests still green.*

*Previously, 2026-08-27 — structural-decomposition roadmap PR2 (ADR-103 / #120): extracted the summary cards + summary-generation flows into `ui/SummaryController.ts` (`Deps`-driven; owns the auto-collapse observer, renders markdown via a view callback). `sidebar.ts` 3,403 → 3,219 lines, ratchet ceiling lowered to match; `formatSummaryTimestamp` moved to `services/messageUtils.ts` (shared with the fork anchor meta line). `main.ts`'s `summarizeFavorites` call keeps a thin view facade. Behaviour-preserving; 434 tests still green.*

*Previously, 2026-08-27 — structural-decomposition roadmap PR1 (ADR-103 / #120): extracted the quick switcher, history overlay, and delete-with-confirm into `ui/HistoryController.ts` (`Deps`-driven, follows `NavigatorController`); `sidebar.ts` 3,735 → 3,403 lines, ratchet ceiling lowered to match. `abbreviateModel` moved from `sidebar.ts` to `models/knownModels.ts` (next to `MODEL_ABBREVIATIONS`) so both the view and the controller share it. Behaviour-preserving; 434 tests still green.*

*Previously, 2026-08-27 — structural-decomposition roadmap PR0 (ADR-103): a file-size ratchet guard (`scripts/check-file-size.mjs`, wired into CI ahead of the build — 600-line default, grandfathered ceilings for `sidebar.ts`/`main.ts`) and a first tested seam of the `sendMessage` extraction (`services/sendPolicy.ts` — `shouldGenerateTitle`/`shouldGenerateChapterName` — with `tests/sendPolicy.test.ts`). Roadmap #120–#123 in engineering-review.md.*

*Previously, 2026-08-27 — senior-engineer bug audit: `sendMessage` persists the user turn up front and discards partial replies on error/empty (ADR-087); `evictConversations` keeps survivors in insertion order so "most recent = last element" holds (ADR-088); web-search citations dedupe by domain and a shared `WEB_CITATION_INSTRUCTION` (`services/promptConstants.ts`) unifies the three web-citation instruction sites (ADR-089); `LLMRouter` utility calls route through a `byProvider()` legacy-provider fallback; persistent `sidebar.ts` view-chrome listeners moved to `registerDomEvent`.*

*Previously, 2026-08-27 — favorites and fork origins are painted as custom elements (`<pythia-favorite>` / `<pythia-fork>`) instead of `<mark>` so the fork's accent tint isn't overridden by theme `mark` rules; `paintRange` (`ui/HighlightPainter.ts`) gained a `tagName` param and all queries are class-based (ADR-086).*

*Previously, 2026-08-27 — new pure module `services/color.ts` (`parseRgb`/`relativeLuminance`/`contrastRatio`/`betterOnAccent`) backs `sidebar.ts`'s `applyAccentContrast()`, which sets the runtime `--p-on-accent` label color for solid accent fills and re-runs on Obsidian's `css-change`. `sidebar.ts` also gained day-anchored turn labels (`isFirstMessageOfDay`/`formatTurnDate`) and a summary-generation date on the fork anchor meta line. See ADR-080, ADR-081, ADR-082.*

*Previously, 2026-08-24 — a fork now injects the exact branched-from passage into the model context as a `<forked_from_excerpt>` anchor (after the source summary), so its opening question stays tied to the specific point rather than drifting to the generic topic (`ContextBuilder`, `FORKED_EXCERPT_INSTRUCTION`/`FORKED_EXCERPT_TAG`). See ADR-079.*

*Previously, 2026-08-24 — "Pythia Final" redesign (ADR-066…076). New pure module `services/citations.ts` (`parseCitations`/`stripCitationMarkers`/`eachCitationSegment`) parses model-emitted `⟦cite:note:…⟧`/`⟦cite:web:…⟧` markers into a numbered source list; the note/web cite-marker contract lives in `GROUNDING_INSTRUCTION` (`promptConstants.ts`) and the `<recent_context>` block (`ContextBuilder.ts`), and `NoteWriter.appendConversationSlice` strips markers from saved notes. `models/types.ts` `Message` gained `model?` (turn labels) and `sources?: MessageSource[]` (citations) — both additive/backfill-safe. `services/messageUtils.ts` gained pure `formatClockTime`. `sidebar.ts` added turn labels (`renderTurnLabel`), the header context-budget bar (`updateContextBar`, reads `getContextWindow`), the context inspector (`fillContextInspector`), citation painting + sources row (`paintCitations`/`renderSourcesRow`/`onCitationClick`), the anchored model popover (`openModelPopover`), the quick switcher (`openQuickSwitcher`) and in-panel history (`openHistoryView`) overlays (all torn down on view close/rebuild), plus `renderWelcome`, `fmtWindow`, `formatConvDate`, `deleteConversationWithConfirm`. `ui/CodeBlockDecorator.ts` gained a frameless code header row; `ui/NavigatorController.ts` renders the forks section as a branch tree. `.p-pill` retired for `.p-wikilink`. See ADR-066 through ADR-076.*

*Previously, 2026-08-24 — web search "research mode" (`services/WebSearchService.ts`): a client-executed `web_search` tool exposed through the existing agentic loop. `ToolHandler.getToolDefinitions`/`allowedToolNames` gained a `researchEnabled` param (gates `web_search` independently of `writeMode` — read-only, available even when `writeMode` is `"none"`) and `execute` routes `web_search` to the injected `WebSearchService` (Tavily via Obsidian `requestUrl`, results returned as an "Error:"-on-failure string like the note tools). `ContextBuilder.buildSystemPrompt` injects a `<recent_context>` date/grounding block when `conversation.researchMode` is on; new `RECENT_CONTEXT_TAG` in `promptConstants.ts`. All three providers pass `conversation.researchMode` into `getToolDefinitions`. `sidebar.ts` added a `globe` toolbar toggle (`toggleResearchMode`/`updateResearchButton`) and a non-confirming "Searching…" chip branch in `onToolCall`. New settings `searchSecretName`/`webSearchDefault`/`webSearchMaxResults`; `Conversation`/`PythiaTemplate` gained `researchMode` (template `research_mode` frontmatter). See ADR-062.*

*Previously, 2026-08-24 — `buildSystemPrompt` (`services/ContextBuilder.ts`) now prepends `PRIOR_SUMMARY_INSTRUCTION` (`services/promptConstants.ts`) to the `<previous_conversation_summary>` block, so forks (`forkedFromSummary`) and resume-summary conversations (`summaryText`) treat the carried summary as governing context rather than ignorable background. See ADR-060.*

*Previously, 2026-08-24 — the inline fork anchor's "Open fork" button gained a long-press summary menu (`sidebar.ts` `attachForkLongPress`/`openForkMenu`/`generateForkSummary`, `.p-fork-menu` reusing `.p-send-menu`): "Summarize conversation" (always) and "Summarize favorites" (only when the fork carries favorites) generate `fork.summaryText`/`fork.favoritesSummary` in place; `buildForkAnchor(anchor, fork, preferType?)` re-renders showing the type just generated. Replaces ADR-058's standalone "Summarize fork" button. See ADR-059.*

*Previously, 2026-08-23 — fork "branch-back": the source conversation paints each forked snippet as an accent `mark.p-fork-origin` (`ui/HighlightPainter.ts` `repaintForkOrigins`/`rangeForForkOrigin`, `paintRange` gained class/attr params); tapping it opens an inline `.p-fork-anchor` showing the fork's own summary (favorites → conversation → on-demand "Summarize fork") + "Open fork" (`sidebar.ts` `onMessageClick`/`toggleForkAnchor`/`buildForkAnchor`/`revealForkOrigin`). The fork now carries the source summary in `forkedFromSummary` (context via `ContextBuilder`, `summaryText ?? forkedFromSummary`) instead of overwriting its own `summaryText`; `forkedFromOccurrenceIndex` records the snippet occurrence. The fork banner link returns to and expands the origin anchor. See ADR-058.*

*Previously, 2026-08-23 — summaries reworked into top-of-conversation cards (`sidebar.ts` `renderSummaryCards`/`buildSummaryCard`/`revealSummaryCard`, IntersectionObserver auto-collapse): both summaries render as collapsible cards prepended to `.p-chat`. Generation is button-only via a long-press on Send (`attachSendLongPress`/`openSummaryMenu`, a custom `.p-send-menu` popover above the button) — `onGenerateSummary`→`generateConversationSummary`, favorites via `summarizeFavorites`. Removed: the pinned summary panel + `updateSummaryBar`/`toggleSummaryPanel`/`refreshSummaryBar`, the toolbar sparkle, `FavoritesSummaryModal`, the `autoSaveSummary` setting and `main.ts` `generateAndInjectSummary` note-injection. Nav Favorites label links to the favorites card (`goToFavoritesSummary`). See ADR-057.*

*Previously, 2026-08-23 — highlight-favorite interaction fixes (`sidebar.ts`, `ui/NavigatorController.ts`, `ui/HighlightPainter.ts`): tap-to-unfavorite (`onMessageClick` + `rangeForHighlight`, favorite button relabels via `setFavButtonMode`/`tappedFavId`); surgical removal (`removeHighlightById`) replaces clear-all-repaint so removing one highlight can't drop others; navigator jump deferred to `requestAnimationFrame` after popover close and expands a collapsed bubble first (`scrollToFavorite`/`expandBubbleIfCollapsed`). See ADR-056.*

*Previously, 2026-08-23 — summarize favorites: `buildFavoritesDigest(conversation)` (`services/messageUtils.ts`) turns a conversation's favorites into an LLM input (each highlight paired with its preceding user question, ordered by message position, legacy favorites fall back to full message content). `BaseProvider.generateFavoritesSummary` (routed via `LLMRouter`/`LLMProvider`) produces a Key-learnings + Action-items synthesis; `suggest/FavoritesSummaryModal.ts` renders it with Copy / Save-to-note / Regenerate; `NoteWriter.saveFavoritesSummaryNote` is the note sink; result cached on `Conversation.favoritesSummary`. Triggered from a ✦ action in the navigator Favorites header (`ui/NavigatorController.ts`) and the `Pythia: Summarize favorites` command (`main.ts`). See ADR-055.*

*Previously, 2026-08-23 — favorite highlights: the `Favorite` model (`models/types.ts`) is now a span (`id`, `text`, `occurrenceIndex`) instead of a whole-message reference; new `ui/HighlightPainter.ts` re-finds and paints favorited text spans (`findRange`/`paintRange`/`repaintBody`) after every markdown render since source offsets do not survive re-rendering. `sidebar.ts` replaced the per-message star with a "Favorite" selection-toolbar action (`onFavoriteSelection`, `repaintFavorites`, `scrollToFavorite`); `NavigatorController` "Favorites" section lists highlights and deletes them. `services/persistence.ts` gained `normalizeFavorites` (assigns ids to and preserves legacy favorites on load). See ADR-054.*

*Previously, 2026-08-17 — LLM response quality audit: enriched default system prompt and grounding instruction (`promptConstants.ts`), notes moved from user message to system prompt (`BaseProvider.ts`), hybrid resume mode (`messageUtils.ts`, `types.ts`, `settings.ts`, `ResumeModeModal.ts`), context window budget trimming (`messageUtils.ts`, all providers, `models/knownModels.ts` gained `contextWindow` field + `getContextWindow()`), paragraph-level fallback chunking and raised threshold to 12K (`noteChunking.ts`), always-include-first-chunk, CJK-aware token estimation, default effort "high". See ADR-053.*

*Previously, 2026-08-17 — 22-finding codebase audit: `ConversationStore.ts` API changed (`clearDirty` → `snapshotDirty`/`clearDirtySnapshot`, added `cancelPendingPersist`); `ToolHandler.ts` gained writeMode enforcement (`allowedToolNames` static method, `execute` accepts `allowedTools` set); `models/knownModels.ts` removed dead `supportsMistralEffort`; `i18n.ts` rewritten for lazy locale detection; ~120 lines of dead CSS removed from `styles.css`, `:focus-visible` added; `main.ts` fork now copies `contextNotes`/`resumeMode`/`outputFolder`/`writeMode`. See ADR-052.*

*Previously, 2026-08-17 — Engineering review implementation: `models/knownModels.ts` unified 5 parallel data structures into a single `MODEL_CATALOG: ModelInfo[]` array with derived exports. `BaseProvider` made `assistantLabel` and `resolveModel` concrete with default implementations, added `providerType` field. `sidebar.ts` split `buildUI()` into `buildHeader()`/`buildChatArea()`/`buildInputArea()`, extracted `DeleteFileModal` to `suggest/`, extracted code-block decoration to `ui/CodeBlockDecorator.ts`. `main.ts` changed `createConversation()` from 8 positional params to options object, added `createConversationFromTemplate()` helper, deleted dead `cmdCopyConversationLink()`, fixed URI "template" handler. `TemplateLoader.ts` fixed prefix-match bug. `ConversationStore.ts` removed dead `hasDirty()`. Removed boilerplate `resolveModel`/`assistantLabel` overrides from providers.*

*Previously, 2026-08-17 — Model catalog refresh: added `claude-opus-5`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6` (Anthropic); `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `o3-pro` (OpenAI); `magistral-small-latest` (Mistral) to `KNOWN_MODELS`, `MODEL_ABBREVIATIONS`, and the appropriate temperature/effort/reasoning gating sets.*

*Previously, 2026-08-17 — Streaming/tool-loop extracted into BaseProvider template method (`prepareStream`/`runStreamRound`/`handleToolCalls`); `streamMessage` is now a concrete one-liner in BaseProvider that delegates to `runStreamLoop`, eliminating ~600 lines of near-identical code across three providers. ConversationStore gained dirty-flag persistence tracking (`dirtyIds` set + `hasDirty`/`clearDirty`/`markDirty`) — `schedulePersist` skips the write when nothing has actually changed. Sidebar performance: `selectionchange` debounced at 150 ms, token-estimate update debounced at 250 ms, `autoResizeTextarea` wrapped in `requestAnimationFrame`. ESLint config upgraded to typed linting (`projectService: true`) and `no-floating-promises: error` (with `ignoreVoid: true`), catching 8 existing violations fixed with `void` operators. See engineering-review.md for the full list of changes.*

*Previously, 2026-07-17 — Mistral added as a third LLM provider (`services/MistralService.ts`, extends `BaseProvider`), reaching full streaming/tool-calling/temperature/effort/maxTokens parity with Anthropic and OpenAI. `Provider` widened to `"anthropic" | "openai" | "mistral"`; every hardcoded two-way `provider === "x" ? ... : ...` ternary in the codebase (`main.ts`'s default-model resolution and API-key-presence check, `settings.ts`'s and `ConversationSettingsModal.ts`'s temperature/effort gating) was converted to an exhaustive `switch` with a `never`-typed default case, so a future fourth provider fails to compile at each site instead of silently falling through. `LLMRouter`'s constructor gained a third `mistral` parameter; its `Object.values()`-based loops needed no change. `models/knownModels.ts` gained `KNOWN_MODELS.mistral`, `MISTRAL_REASONING_MODELS`/`isMistralReasoningModel()` (Magistral line, mirrors `isReasoningModel()`), `supportsMistralEffort()` (always `true` — confirmed via SDK type inspection that `reasoningEffort` has no per-model restriction, unlike OpenAI's `reasoning_effort`), and `resolveDefaultModelForProvider()` (replaces the old inline ternary). `services/retry.ts`/`services/apiError.ts` — shared across all three providers — gained two fixes surfaced by Mistral's different SDK error conventions: `ABORT_ERROR_NAMES` now includes `"RequestAbortedError"` (Mistral's abort-error name, vs. `"AbortError"` for the other two), and `classifyApiError` now reads `.statusCode` (Mistral) in addition to `.status` (Anthropic/OpenAI). PDF attachments and vision/image input remain out of scope for Mistral this pass. See ADR-045.*

*Previously, 2026-07-17 — `maxTokens` brought to the same three-level override layering (`conversation.maxTokens ?? settings.maxTokens ?? resolveDefaultMaxTokens(model)`) and UI treatment `temperature`/`effort` already had: new global setting (`settings.ts`, Behaviour section) and per-conversation field (`ConversationSettingsModal.ts`, constructor gained `defaultMaxTokens?`), both text inputs since a token count fits neither a slider nor a dropdown. `DEFAULT_MAX_TOKENS` raised from 4096 to 8192; new `DEFAULT_MAX_TOKENS_REASONING = 16384` for OpenAI reasoning models via the existing `isReasoningModel()` check (reasoning tokens share the same budget as visible output, so a low cap risks a silently truncated reply). Deliberately no `setDisabled()` gating for `maxTokens` — every model accepts some form of output cap, only the request field name varies. See ADR-044. Also, note-chunk/`#`-suggestion relevance scoring (`services/noteRelevance.ts`) is now IDF-weighted instead of flat keyword-overlap counting: a shared-by-everyone token like "user" barely moves a candidate's score, while a token unique to one candidate dominates it. Fixes a real bug where a long, multi-section reference doc got excerpted down to the wrong section because several unrelated sections shared enough generic vocabulary with the query to out-rank the one section holding the actual distinctive term. The single-haystack `scoreRelevance`/`scoreRelevanceTokens` functions were replaced (not kept alongside) by batch equivalents (`scoreRelevanceWeighted`/`scoreRelevanceTokensWeighted`) since IDF requires the full candidate set up front to compute document frequency; both consumers (`noteChunking.ts`, `ui/InlineSuggest.ts`) migrated to the batch form. See ADR-043. Also, fork now awaits and carries the source conversation's summary over as context before opening (`cmdForkConversation` resolves `summaryText` synchronously, `generateSummary()` behind a loading Notice when uncached, no more fire-and-forget post-hoc update); the forked conversation's input box is no longer pre-filled with the text that triggered the fork; removed the now-dead `PythiaSidebarView.renderForkBanner()` wrapper (the private `renderForkBannerEl()` already renders on the fork's first paint via the normal message-rebuild path). See ADR-042. Also added PDF attachments as native document/file content blocks (Anthropic `DocumentBlockParam`, OpenAI `ChatCompletionContentPart.File`), dispatched by extension with no new persisted types; new `ContextBuilder.buildAttachedPdfs`, `messageUtils.arrayBufferToBase64` (Buffer-free for mobile), and a hardcoded 20 MB size guard (`MAX_PDF_FILE_SIZE_BYTES`) that skips oversized PDFs with a Notice rather than sending and failing mid-stream; `BaseProvider.resolveUserContent` now splits attachments by extension and each provider splices PDF blocks onto the last user message post-`normalizeMessages`; UI file pickers (`NoteSuggestModal`, `ui/InlineSuggest.ts`, `utils.ts`'s `getFilesInFolder`) widened to include `.pdf`, `suggest/FileSuggest.ts`'s base class deliberately left markdown-only. See ADR-041. Also added `effort` as a first-class parameter (global setting, template frontmatter, per-conversation override) alongside `temperature`, mapped to Anthropic's `output_config.effort` and OpenAI's `reasoning_effort`; both the global settings tab and the conversation settings modal now reactively disable (`Setting.setDisabled()`) the temperature/effort controls when the selected provider+model doesn't support them, closing the gap where the backend silently dropped unsupported values but the UI still showed the control as active. See ADR-040. Also fixed live 400s from the model catalog refresh: `claude-fable-5`/`claude-opus-4-8`/`claude-sonnet-5` reject the `temperature` parameter outright, but `AnthropicService.streamMessage` was still sending it whenever a conversation or global default temperature was set. Added `models/knownModels.ts`'s `supportsTemperature()` (mirrors the existing `isReasoningModel()` pattern) and gated `temperature` on it; refreshed the Anthropic model catalog in `models/knownModels.ts` (retired `claude-opus-4`/`claude-haiku-3-5` IDs swapped for `claude-opus-4-8`/`claude-haiku-4-5`, `claude-sonnet-4-6` bumped to `claude-sonnet-5`; `AnthropicService.fastModel` and `defaultAnthropicModel` updated to match); second-round bug-fix pass: second delete-guard gap closed, resume-mode/eviction/frontmatter/deep-link races fixed, eviction now protects every open sidebar leaf; bug-fix/reliability/observability/maintainability/performance pass: `models/knownModels.ts` (reasoning-model + model-list centralization), additive token/cache accounting, abort-signal capture, retry/tool-loop bounds, single-active-stream enforcement, `debugLog` convention, BaseProvider extraction extended; prompt-tag/marker centralization (`services/promptConstants.ts`); response-quality pass: resumeMode fix, retry/backoff, Anthropic prompt caching, temperature, attached-notes token guard + chunking, relevance-ranked note suggestions.*

---

## What Pythia is

An Obsidian sidebar plugin providing a streaming LLM chat interface tightly integrated with the vault. Conversations are first-class vault objects — stored, resumable, forkable, and cross-device via Obsidian Sync or iCloud. Supports Anthropic, OpenAI, and Mistral providers.

---

## File inventory

| File | Lines | Role |
|---|---:|---|
| `sidebar.ts` | 2 028 | `PythiaSidebarView` — UI, rendering, streaming, interaction; `buildUI()` split into `buildHeader()`/`buildChatArea()`/`buildInputArea()` |
| `styles.css` | 1 456 | All plugin CSS (no framework, no CSS-in-JS) |
| `main.ts` | 908 | Plugin entry, commands, conversation lifecycle, data.json watcher; `createConversation()` takes options object; `createConversationFromTemplate()` helper |
| `settings.ts` | 460 | Settings schema, defaults, settings tab UI (incl. temperature/effort reactive availability gating) |
| `utils.ts` | 20 | Root-level pure helpers: `getFilesInFolder` (md + pdf), `todayISO` |
| `services/OpenAIProvider.ts` | 304 | OpenAI streaming (extends BaseProvider); implements `prepareStream`/`runStreamRound`/`handleToolCalls` for the template method loop; retry, temperature/`reasoning_effort`, PDF file-block splice, resumeMode gating |
| `services/AnthropicService.ts` | 250 | Anthropic streaming (extends BaseProvider); implements `prepareStream`/`runStreamRound`/`handleToolCalls`; retry, prompt caching, temperature/`output_config.effort`, PDF document-block splice, resumeMode gating |
| `services/MistralService.ts` | 295 | Mistral streaming (extends BaseProvider); implements `prepareStream`/`runStreamRound`/`handleToolCalls`; uses `MistralCore` + tree-shakeable standalone `chatComplete`/`chatStream` functions, temperature/`reasoningEffort`, resumeMode gating; PDFs unsupported (warns via Notice) |
| `services/BaseProvider.ts` | 314 | Abstract base: shared fields, lifecycle, concrete `assistantLabel` (default "Assistant") + `resolveModel` (delegates to `resolveDefaultModelForProvider` via `providerType`), `resolveUserContent`/`finishOrError` helpers, `runStreamLoop` template method (abort, retry, tool-round loop with `MAX_TOOL_ROUNDS`, token accumulation, debug logging), exported `RoundResult` interface, all generate* utility methods |
| `services/ToolHandler.ts` | 165 | Tool definitions (`create_note`/`rewrite_note`/`prepend_note` + read-only `web_search`) + `ToolHandler` class (injected NoteWriter + optional WebSearchService); `researchEnabled` gates `web_search` independently of `writeMode` |
| `services/WebSearchService.ts` | 145 | Client-executed web search for research mode: queries Tavily via Obsidian `requestUrl`, formats results with source URLs, never throws (returns an "Error:" string on failure) |
| `services/webSearchHeuristics.ts` | 64 | Pure `looksTimeSensitive(text, currentYear)` — whole-word recency cues + year ≥ now; auto-arms `web_search` for a send when the research globe is off (ADR-099) |
| `services/NoteWriter.ts` | 200 | Vault write operations; frontmatter merge preserves multi-line field values |
| `services/TemplateLoader.ts` | 110 | Template discovery + frontmatter parsing (incl. `temperature`, `effort`); parallelized reads, empty-folder guard; prefix-match uses `folder + "/"` to prevent false matches on similarly-named folders |
| `services/messageUtils.ts` | 185 | Shared: `parseTitleAndSummary`, `normalizeMessages`, `selectHistoryForSend` (incl. hybrid mode), `trimHistoryToBudget`, `debugLog`, token estimation (CJK-weighted), lang helpers, `arrayBufferToBase64` (Buffer-free, mobile-safe) |
| `services/LLMRouter.ts` | 77 | Dispatches calls to the active provider |
| `services/ContextBuilder.ts` | 147 | Builds system prompt (always-on no-solicitation guard + optional global `<custom_instructions>` from settings + grounding instruction + `<recent_context>` date block when `researchMode` is on), attaches + chunks vault notes (parallelized reads), estimates tokens; `buildAttachedPdfs` reads PDFs as base64 for native document/file blocks |
| `services/promptConstants.ts` | 66 | Shared literal constants: XML-ish prompt tags (incl. `RECENT_CONTEXT_TAG`), `TITLE`/`SUMMARY` markers, `DEFAULT_MAX_TOKENS`/`DEFAULT_MAX_TOKENS_REASONING` + `resolveDefaultMaxTokens()`, `MAX_PDF_FILE_SIZE_BYTES`, `DEFAULT_SYSTEM_PROMPT`, `GROUNDING_INSTRUCTION` |
| `services/noteChunking.ts` | 95 | Heading-based chunking with paragraph-level fallback + relevance-filtered excerpting (always includes first chunk) for notes over 12K chars |
| `services/noteRelevance.ts` | 49 | IDF-weighted keyword-overlap scoring (`scoreRelevanceWeighted` + pre-tokenized, batch `scoreRelevanceTokensWeighted`) shared by note chunking and `#` suggestion ranking |
| `services/retry.ts` | 17 | Retry/backoff predicate + schedule for transient failures, incl. 5xx/529; exports `ABORT_ERROR_NAMES` |
| `services/ConversationStore.ts` | 76 | In-memory store + 300 ms debounced persistence; dirty-flag tracking (`dirtyIds` set + `markDirty`/`clearDirty`) skips no-op writes; `save()` no-ops for a deleted conversation instead of resurrecting it |
| `services/PromptOptimizerService.ts` | 211 | `run()` command flow + `optimizeText()` (inline review) |
| `services/persistence.ts` | 135 | Pure functions extracted from `main.ts`: `applySettingsMigrations`, `mergeSettings`, `parseConversations`, `shouldRefuseLoad`, `evictConversations` (protects every open leaf's active conversation, tolerates malformed `updatedAt`, and returns survivors in their original insertion order so "most recent = last element" holds — ADR-088) |
| `services/apiError.ts` | 37 | HTTP error classification, incl. `server_error` (5xx/529) |
| `services/sendPolicy.ts` | 30 | Pure post-turn trigger predicates lifted from `sidebar.ts`'s `sendMessage` (`shouldGenerateTitle`, `shouldGenerateChapterName`) — a tested seam ahead of the `SendController` extraction (ADR-103) |
| `services/color.ts` | 50 | Pure accent-contrast helpers: `parseRgb`, `relativeLuminance`, `contrastRatio`, `betterOnAccent` — pick the higher-contrast on-accent token for the user's accent (consumed by `sidebar.ts`'s `applyAccentContrast`, ADR-082) |
| `services/LLMProvider.ts` | 23 | Provider interface |
| `models/knownModels.ts` | 120 | `MODEL_CATALOG: ModelInfo[]` — single unified array of all known models with per-model flags (`noTemperature`, `supportsEffort`, `isReasoning`, `isMistralReasoning`, `hidden`) and `contextWindow`; all derived exports (`KNOWN_MODELS`, `MODEL_ABBREVIATIONS`, `isReasoningModel()`, `supportsTemperature()`, `supportsEffort()`, `getContextWindow()`, etc.) computed from it; `resolveDefaultModelForProvider()` |
| `models/modelGuidance.ts` | 50 | `MODEL_GOOD_FOR` — plain-language "good for" example line per model id (`{ en, de }`), shown in the picker (ADR-102); `goodForModel(id, lang)`; every catalog model must have an entry (test-enforced) |
| `models/settings.ts` | 63 | `PythiaSettings` interface + `DEFAULT_SETTINGS` — no Obsidian dependency; importable in tests |
| `ui/OptimizationController.ts` | 182 | Inline prompt optimizer UI state + flow (extracted from sidebar); generation-counter guard against stale responses |
| `ui/NavigatorController.ts` | 163 | `#` navigator popover logic (extracted from sidebar) |
| `ui/HistoryController.ts` | 363 | Quick switcher (title dropdown), full-panel history overlay, and delete-with-confirm — extracted from sidebar (ADR-103 / #120). `Deps`-driven; owns its own popover teardown, closed by the view on rebuild/unload |
| `ui/SummaryController.ts` | 236 | Summary "Speisekarte" cards (render/build/open/reveal/save) and the LLM summary-generation flows (`generateConversationSummary`/`summarizeFavorites`/`runFavoritesSummary`) — extracted from sidebar (ADR-103 / #120). `Deps`-driven; owns the auto-collapse `IntersectionObserver` (disposed by the view). The view creates the cards container (for DOM position) and renders markdown via a callback; the Send menu + context-inspector button call into it |
| `ui/ContextInspectorController.ts` | 234 | Context-budget bar + header percent chip (`updateContextBar`) and the expandable inspector card (`refresh`/`reveal`) — extracted from sidebar (ADR-103 / #120). `Deps`-driven; **constructed once per view** (not per buildUI) so its `inspectorOpen` state survives a rebuild, reading DOM handles through getters. The view creates the bar/chip/wrap elements (for DOM position) |
| `ui/HeaderController.ts` | 425 | Header chrome — the header row (history · name · rename · link · delete · [ctx chip] · model · new), inline rename flow, model badge + anchored model popover, and copy-deep-link — extracted from sidebar (ADR-103 / #120). `mount()` builds the header; `renderHeader`/`updateModelBadge` refresh it; `getConvNameEl`/`getChipEl` expose the two elements History/ContextInspector consume; History/ContextInspector/send-hint reached via deps |
| `ui/SelectionController.ts` | 490 | Text-selection toolbar (Copy/Favorite/Branch/Insert/Inbox) + span-favorites — build/remove/repaint/scroll highlights, the tap-a-highlight interaction, and fork-from-selection (`onForkConversation`) — extracted from sidebar (ADR-103 / #120). `mount()` builds the toolbar and wires the selection listeners via a passed `registerDomEvent`; owns all HighlightPainter usage. The view calls public `repaintFavorites` (render), `scrollToFavorite`/`removeFavorite` (Navigator); a fork-origin tap routes into ForkController via a dep |
| `ui/ForkController.ts` | 342 | Fork-origin display — the "branched from…" banner, the painted origin marks (`repaintForkOrigins` over HighlightPainter), and the inline anchor those marks open (fork summary + Open-fork control + long-press (re)generate menu) — extracted from sidebar (ADR-103 / #120). `Deps`-driven; markdown via a view callback, long-press listeners via a passed `registerDomEvent`, favorites-summary reuse via SummaryController. Creating a fork from a selection (`onForkConversation`) stays in the view (Selection cluster) |
| `ui/InlineSuggest.ts` | 368 | `#` note-path autocomplete in textarea (md + pdf); relevance-ranked via `noteRelevance`, query tokenized once per keystroke; folders drill in place (ArrowRight / swipe-left / › → browse; ArrowLeft / swipe-right / back row → up; Enter still attaches whole folder) — ADR-097 |
| `ui/CodeBlockDecorator.ts` | 220 | Code block decoration extracted from sidebar: `decorateCodeBlocks`, `stampSvgSize` (was `fixDiagramSvgSize`), `wrapInScrollFrame`, `attachDragToPan` |
| `ui/HighlightPainter.ts` | — | Favorite/fork highlight DOM helpers: `findRange` (re-find stored text across text nodes), `computeOccurrenceIndex`, `paintRange` (wrap a range in a `<pythia-favorite>`/`<pythia-fork>` custom element via the `tagName` param — not `<mark>`, ADR-086 — splitting across element boundaries), `clearHighlights`, `removeHighlightById` (surgical single-favorite unwrap), `rangeForHighlight`/`rangeForForkOrigin`, `repaintBody`/`repaintForkOrigins`, `flashHighlight` |
| `suggest/` | — | Modal dialogs (picker, delete confirm, settings, etc.); `NoteSuggestModal` overrides `getItems()` to include PDFs, `FileSuggestModal` stays markdown-only (also used by the template picker); `DeleteFileModal` extracted from sidebar |
| `models/types.ts` | 102 | All shared TypeScript interfaces, incl. `ToolLoopLimitError`, `EffortLevel` |
| `locales/en.ts` / `locales/de.ts` | ~300 each | i18n strings (English / German) |
| `tests/` | — | Vitest unit tests (417 tests across 24 files, ~1 s) |
| `eslint.config.mjs` | 46 | ESLint flat config (typescript-eslint); typed linting via `projectService`, `no-floating-promises: error` |
| `vitest.config.ts` | 24 | Coverage configuration |
| `scripts/check-file-size.mjs` | — | File-size ratchet guard (ADR-103): 600-line default for every `.ts`, grandfathered ceilings for `sidebar.ts`/`main.ts` that may only be lowered; run via `npm run check:filesize` |
| `.github/workflows/ci.yml` | — | CI: lint → file-size budget → build → test on push/PR |

---

## Component relationships

```
PythiaPlugin (main.ts)
├── ConversationStore          — persists conversations[] via Obsidian's saveData()
├── watchDataJson()            — polls adapter.stat() every 5 s for cross-device sync
├── LLMRouter                  — routes to AnthropicService, OpenAIProvider, or MistralService
│   ├── AnthropicService       — Anthropic SDK streaming; extends BaseProvider
│   ├── OpenAIProvider         — OpenAI SDK streaming; extends BaseProvider
│   └── MistralService         — Mistral SDK streaming (standalone-function API); extends BaseProvider
│       BaseProvider           — template method pattern: runStreamLoop drives the
│       │                        streaming/tool-calling loop (abort, retry, tool rounds,
│       │                        token accumulation, MAX_TOOL_ROUNDS cap); providers
│       │                        implement prepareStream/runStreamRound/handleToolCalls
│       │                      — shared: abort, updateSettings/Key, generate* utilities
│       (all providers share messageUtils for parsing, normalisation, lang helpers,
│        retry.ts for transient-failure backoff, and ContextBuilder for prompt assembly)
├── ContextBuilder             — system prompt + attached-note inlining/chunking
│   └── noteChunking / noteRelevance — heading-based excerpting for oversized notes
├── TemplateLoader             — discovers pythia_template notes in vault
├── NoteWriter                 — writes/updates vault notes
├── ToolHandler                — wraps NoteWriter + WebSearchService; executes tool calls from the LLM
├── WebSearchService           — client-executed Tavily search for research mode (Obsidian requestUrl)
└── PythiaSidebarView (sidebar.ts)
    ├── OptimizationController — inline prompt optimizer state + flow
    ├── NavigatorController    — # navigator popover
    ├── InlineSuggest          — textarea autocomplete
    ├── CodeBlockDecorator     — code-block/diagram decoration (decorateCodeBlocks, stampSvgSize)
    ├── HighlightPainter       — favorite-highlight re-find + paint (findRange, repaintBody)
    └── suggest/*.ts           — Modal dialogs (opened on demand, incl. DeleteFileModal)
```

---

## Data model (`models/types.ts`)

```
Conversation
  id, name, createdAt, updatedAt
  provider ("anthropic" | "openai" | "mistral"), model, maxTokens?, temperature?, effort? ("low"|"medium"|"high")
  systemPrompt, contextNotes[]   ← permanent per-conv note attachments; sent with every message
  writeMode ("create" | "update" | "rewrite" | "none")
  resumeMode ("full" | "summary" | "hybrid")
                                    ← "summary" excludes prior messages entirely (relies on
                                      summaryText in system prompt); "hybrid" sends summary +
                                      last 6 messages; "full" sends everything. History itself
                                      is preserved in conv.messages for UI/scrollback
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
  defaultProvider, defaultAnthropicModel, defaultOpenAIModel, defaultMistralModel
  maxMessagesPerSession, maxConversations   ← eviction cap (default 200)
  outputLanguage ("auto" | "en" | "de")    ← locale code, not display label
  templatesFolder, conversationsFolder, scratchFolder, inboxNote
  autoSaveSummary, defaultResumeMode
  injectActiveNoteOnTemplate, debugMode
  maxTokens?                                ← global max-output-tokens default; undefined = resolveDefaultMaxTokens(model)
  temperature?                              ← global sampling-temperature default (0–1); undefined = API default
  effort?                                   ← global reasoning/output-effort default ("low"|"medium"|"high"); undefined = API default
  maxAttachedNotesTokens                    ← warn above this estimated token count (default 8000); 0 = no warning
  anthropicSecretName, openaiSecretName, mistralSecretName  ← keys into Obsidian SecretStorage

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
              — appends a grounding instruction when contextNotes.length > 0
              — the XML-ish tag names (`system_prompt`, `previous_conversation_summary`,
                `attached_note` and its `path`/`excerpt` attributes) are defined once in
                `services/promptConstants.ts` and reused by `ToolHandler.ts`'s tool-call
                descriptions, which reference `attached_note` by name in prose read by the LLM
          → BaseProvider.resolveUserContent() splits conv.contextNotes by
              extension (path.toLowerCase().endsWith(".pdf")) and fetches both
              kinds in parallel:
              → ContextBuilder.buildAttachedNotesContent(notePaths, newMessage)
                  — attached notes are read in parallel (Promise.all), then notes over
                    NOTE_CHUNK_THRESHOLD_CHARS (12K) are split by heading
                    (noteChunking.chunkByHeadings) with a paragraph-level fallback
                    (chunkByParagraphs) for heading-less notes, and filtered to the
                    sections most relevant to `newMessage` (noteRelevance.
                    scoreRelevanceTokensWeighted — IDF-weighted, query tokenized once
                    and reused across every chunk); the first chunk is always kept for
                    framing context; result is tagged excerpt="true"
                  — if the resulting estimated token count exceeds
                    settings.maxAttachedNotesTokens, a Notice warns before sending
              → ContextBuilder.buildAttachedPdfs(pdfPaths)
                  — each PDF is read whole via vault.readBinary (parallelized),
                    size-checked against MAX_PDF_FILE_SIZE_BYTES (20 MB raw) before
                    reading — oversized PDFs are skipped with a Notice, not sent —
                    and base64-encoded (messageUtils.arrayBufferToBase64, Buffer-free
                    for Obsidian mobile); sent whole, uncondensed — no local text
                    extraction or chunking, the model's own PDF understanding
                    handles that
          → selectHistoryForSend(conv.messages, conv.resumeMode)
              — "summary" mode sends no prior messages at all (relies on
                summaryText already in the system prompt); "hybrid" sends
                the last 6 messages (summary in system prompt covers earlier
                context); "full" sends everything
          → trimHistoryToBudget(selected, contextWindow, maxTokens, systemTokens)
              — trims oldest messages from front if estimated tokens exceed
                the available context window budget (contextWindow - output -
                system prompt); uses CJK-weighted token estimation
          → after loopMessages is built (post-normalizeMessages, whose same-role
              merge does string concatenation and would corrupt array content),
              any pdfAttachments are spliced onto the last user message as native
              content blocks — Anthropic: DocumentBlockParam (base64 + title);
              OpenAI: ChatCompletionContentPart.File (data-URL-prefixed file_data)
              — each provider file does its own splice; see ADR-041
          → Provider SDK streaming call
              — Anthropic: system prompt + tool defs carry cache_control: ephemeral
                (cached after turn 1); temperature/output_config.effort included
                when resolved and supported by the model
              — transient rate-limit/network/server-error (5xx/529) failures before
                any token is emitted are retried with backoff (services/retry.ts),
                up to 2 attempts
              — tool-calling round trips are capped at MAX_TOOL_ROUNDS (25); exceeding
                it throws ToolLoopLimitError, surfaced as a friendly Notice
              — the abort signal is captured once at the top of the call, so an
                abort while a tool confirmation is pending (BaseProvider.abort()
                nulls the controller) still resolves as a clean cancellation
                instead of crashing on a null .signal read
              → onToken() appends text to streaming bubble
              → onComplete() → finalize() (only if the conversation is still the
                    one displayed — defense-in-depth against a torn-down view)
                  → MarkdownRenderer.render() (try/catch)
                  → decorateCodeBlocks() (ui/CodeBlockDecorator.ts)
                      → code blocks: .p-code-frame wrapper + copy button
                      → diagrams ([class*='block-language-']): in-container copy button,
                              stampSvgSize() — MutationObserver + ResizeObserver
                  → conversationStore.save() (debounced 300 ms; no-ops if the
                        conversation was deleted while the stream was in flight)
                  → generateConversationTitle() fire-and-forget (guarded by ID)
                  → generateChapterName() fire-and-forget (guarded by ID)
              → onError() → console.error (always) + Notice; the streaming bubble
                    is always resolved — finalized with whatever partial text
                    arrived, or removed if none — never left stuck mid-render

Switching to a different conversation or deleting the active one is blocked with
a Notice while isStreaming is true — streaming/abort state is per-view and
per-provider (LLMRouter.abort() sweeps every provider), not per-conversation, so
letting a switch/delete through mid-stream could abort or lose the wrong
conversation's generation. See ADR-032.
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

### Tool call (web search / research mode)

Gated on `conversation.researchMode` (toolbar `globe` toggle, default from `webSearchDefault`). When on, each provider's `prepareStream` includes `web_search` in its tools via `getToolDefinitions(folder, writeMode, researchMode)`, and `ContextBuilder.buildSystemPrompt` prepends a `<recent_context>` block (current date + "prefer web_search for time-sensitive questions, cite URLs").

**Auto-arm (ADR-099):** when the globe is *off*, `sendMessage` runs `looksTimeSensitive(text, currentYear)` (`services/webSearchHeuristics.ts` — whole-word recency cues + a year ≥ now) and, if it matches and a Tavily key is set (`webSearchAutoArm` on), passes an armed shallow clone `{ ...conv, researchMode: true }` to `streamMessage` for that single turn — so `web_search` is offered and the `<recent_context>` block injected without ever persisting `researchMode` (the original `conv` is what sidebar's callbacks save). The globe pulses (`.is-auto-armed`) to show it fired. The same effective flag feeds the two `allowedToolNames` gates.

```
LLM requests web_search during streamMessage
  → onToolCall(call) [sidebar.ts]
      → read-only: NO confirm prompt; show live "Searching: <query>" chip
      → plugin.toolHandler.execute(call, allowed incl. web_search)
          → ToolHandler routes web_search (before path/content validation)
            → WebSearchService.search(query) → Tavily via requestUrl
            → formatted results string (answer + sources w/ URLs), or "Error:" string
      → chip updated to done or error; result returned to LLM
  → BaseProvider feeds the string back as a tool result → follow-up round → cited answer
```

### Attaching notes to a conversation

All note-attachment paths write to `conv.contextNotes` (persisted) and render in the reference row. Attachments are plain vault-path strings with no type-level distinction between markdown notes and PDFs — dispatch happens by extension at read time (`path.toLowerCase().endsWith(".pdf")`), matching the same pattern used for model-capability checks like `isReasoningModel()`. A template can declare a PDF path in `context_notes` frontmatter with no changes needed in `TemplateLoader.ts`.

| Entry point | Code path | PDF-aware? |
|---|---|---|
| File-menu "Chat about this note" | `attachNoteToInput()` → `conv.contextNotes` | md only (file-menu action is markdown-file-scoped) |
| 📎 toolbar button | `onAttachNote()` → `NoteSuggestModal` → `conv.contextNotes` | yes |
| Inline `#` suggest | `ui/InlineSuggest.ts` callback → `conv.contextNotes` | yes |
| Reference row `+` button | `NoteSuggestModal` callback → `conv.contextNotes` | yes |
| Folder attach | `utils.ts`'s `getFilesInFolder()` → `conv.contextNotes` | yes |
| Template `context_notes` frontmatter | `TemplateLoader.ts` (unfiltered path string) | yes |

`conv.contextNotes` is passed as `attachedNotes` to `streamMessage` on every send, so the LLM always has access to all attached notes and PDFs (see "Sending a message" above for how each kind is resolved and, for PDFs, sent as a native document/file content block instead of inlined text). `suggest/FileSuggest.ts`'s base `FileSuggestModal` deliberately stays markdown-only — it also backs the prompt-optimizer template picker in `settings.ts`, which must never surface a PDF.

The inline `#` suggestion dropdown (`ui/InlineSuggest.ts`) ranks candidate notes by an IDF-weighted keyword-overlap score (`services/noteRelevance.ts`'s `scoreRelevanceTokensWeighted`) between the message being composed and each note's basename, frontmatter title, and headings (read from Obsidian's cached `metadataCache` — no per-keystroke disk reads). A filename match on the typed `#fragment` still dominates and gates the result set; the relevance score is the tiebreaker, which matters most when the fragment is empty or matches several notes equally. For a PDF candidate, `noteHaystack()` has no headings to parse and falls back to the basename alone — the filename-substring match still ranks it correctly. Scoring is batched — the full candidate set's haystacks are gathered before scoring, since IDF weighting needs each token's document frequency across the whole batch, not just one haystack at a time (see ADR-043).

### Conversation rename

Two paths share the same inline-edit UI in the header:

**Manual rename** — a pencil button (`.p-rename-btn`) sits after the title, visible whenever a conversation is active. Clicking it hides the title element and shows a text `<input>` (`.p-rename-input`) pre-filled with the current name and a sparkle button (`.p-rename-llm-btn`). Enter or blur confirms and saves; Escape cancels. Confirmation writes `conv.name` and calls `conversationStore.save`.

**LLM-generated name** — clicking the sparkle button while in rename mode calls `LLMRouter.generateConversationTitle` with the first user and first assistant message content of the conversation (empty strings if none exist). On success the new name is saved and rename mode exits immediately. On failure a `Notice` is shown and the input remains open for manual editing.

The rename flow lives entirely in `sidebar.ts` (`enterRenameMode`, `exitRenameMode`, `onRenameLLM`). No new modal is needed.

### Forking a conversation

Triggered by selecting text in an assistant message bubble and invoking the fork action (`sidebar.ts` → `plugin.cmdForkConversation(sourceConvId, selectedText, sourceMessageId)`). The fork is a new, message-less `Conversation` — it copies the source's `systemPrompt`/`provider`/`model`/`maxTokens`/`temperature`/`effort` but starts with empty `messages`/`contextNotes`.

```
cmdForkConversation(sourceConvId, selectedText, forkedFromMessageId?) [main.ts]
  → resolve summary BEFORE creating the fork, so it's part of the fork's
    context from the moment it opens (not delivered asynchronously after):
      — source.summaryText already cached → reuse it directly, no LLM call
      — source has messages but no cached summary → await LLMRouter.generateSummary(source)
          behind a Notice(t("generatingSummary"), 0) loading indicator;
          cache the result on source (future forks/resumeMode:"summary" reuse it for free)
      — source has no messages → no summary, nothing to carry
  → createConversation({ name, systemPrompt, templateId, provider, model, maxTokens, ... })
  → conv.forkedFromId / forkedFromMessageId / forkedFromSelection set
      (forkedFromSelection feeds the fork banner's selection excerpt
      [sidebar.ts renderForkBannerEl] AND is injected into the model context
      as a <forked_from_excerpt> anchor [ContextBuilder, ADR-079]; it does NOT
      pre-fill the new conversation's input box)
  → conv.summaryText/summaryUpdatedAt set from the resolved summary, if any
      — ContextBuilder.buildSystemPrompt() picks this up automatically on
        every future send (a <previous_conversation_summary> tag), independent
        of resumeMode; no extra wiring needed
  → view.setActiveConversation(conv)
      — this alone triggers a full message rebuild, which renders the fork
        banner (conv.forkedFromId set) and the summary bar (conv.summaryText
        set) correctly on first paint — no separate post-hoc refresh call
```

See ADR-042 for why summary resolution is awaited synchronously rather than fired in the background, and why the input box is deliberately left empty. See ADR-079 for why the forked passage is also injected into the model context (as `<forked_from_excerpt>`, after the summary) so a fork's opening question stays anchored on the specific point, not just the broad topic.

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
  → dirtyIds.add(conv.id)     ← markDirty(id)
  → schedulePersist()  ← 300 ms debounce; skips the write if dirtyIds is empty
                          clearDirty() called by main.ts after successful persistData()

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
3. `decorateCodeBlocks()` (`ui/CodeBlockDecorator.ts`) captures source from `code.innerText` before Mermaid renders, adds in-container copy button
4. `stampSvgSize()` (was `fixDiagramSvgSize()`) arms a `MutationObserver` (two-phase: childList + SVG style/attribute) and a `ResizeObserver` fallback to stamp natural pixel dimensions once the renderer inserts/sizes the SVG. Covers Mermaid v10, Vega, and any plugin using `[class*='block-language-']`
5. CSS: `[class*='block-language-'] { overflow-x: auto; width: 100% }` — any diagram renderer scrolls within its frame; `.p-chat { overflow-x: clip }` prevents whole-conversation horizontal scroll

---

## Provider abstraction

All three providers extend `BaseProvider` (which implements `LLMProvider`). `LLMRouter` dispatches by `conversation.provider`; its constructor takes `anthropic`/`openai`/`mistral` instances and stores them in a `Record<Provider, LLMProvider>`, so its `updateSettings`/`abort` loops (both `Object.values()`-based) needed no change to support the third provider.

`BaseProvider` holds: shared fields (`app`, `settings`, `apiKey`, `abortController`, `providerType`), concrete lifecycle methods (`abort`, `updateSettings`, `updateApiKey`), concrete default implementations for `assistantLabel` (returns `"Assistant"`) and `resolveModel(override?)` (delegates to `resolveDefaultModelForProvider(this.providerType, this.settings)`), the `runStreamLoop` template method that drives the entire streaming/tool-calling loop (abort controller setup, `resolveUserContent`, tool-round while loop capped at `MAX_TOOL_ROUNDS = 25` with `ToolLoopLimitError`, token accumulation, debug logging, error routing via `finishOrError`, cleanup in `finally`), two helpers used by that loop (`resolveUserContent` — splits `attachedNotes` into note/PDF paths by extension, fetches both in parallel (`ContextBuilder.buildAttachedNotesContent`/`buildAttachedPdfs`), surfaces missing/oversized-note and missing/oversized-PDF `Notice`s, builds the system prompt, and returns `pdfAttachments` alongside `userContent`/`systemPrompt` for each provider to splice in its own wire format; `finishOrError` — routes a caught error to `onComplete` on user abort or `onError` otherwise, reusing `retry.ts`'s `ABORT_ERROR_NAMES`), and all six generate* utility methods (`generateSummary`, `generateSummaryWithTitle`, `generateChapterName`, `generateConversationTitle`, `summarizeNotes`, `optimizePrompt`). The exported `RoundResult` interface normalises each streaming round's outcome (action, token counts, cache stats, usage presence) across providers.

Each provider implements (abstract members):
- `resetClient()` — nulls the cached SDK client on credential/settings change
- `fastModel` — cheap model for utility calls (`claude-haiku-4-5` / `gpt-4o-mini`)
- `callUtility(model, userMessage, maxTokens, systemMessage?)` — single-turn non-streaming call
- `prepareStream(...)` — called once before the loop starts; builds loop messages, resolves tools/model/temperature/effort, stores state on `this` for use in `runStreamRound`
- `runStreamRound(signal, onToken, textLenBefore)` — runs one streaming round (SDK stream creation, chunk consumption, retry-before-first-token); returns a normalised `RoundResult`
- `handleToolCalls(onToolCall)` — extracts tool-use blocks from the last round's response, calls `onToolCall` for each, appends tool results to the loop messages

Providers may override the concrete defaults:
- `assistantLabel` — only `AnthropicService` overrides (returns `"Claude"`); OpenAI and Mistral inherit the default `"Assistant"`
- `resolveModel(override?)` — inherited from BaseProvider; providers no longer need to override unless they have custom resolution logic

`OpenAIProvider` additionally uses `models/knownModels.ts`'s `isReasoningModel()` to decide, per model: whether the system prompt is injected as a leading `user` message vs. a real `system` role, whether a custom `temperature` is sent, and whether the request uses `max_tokens` or `max_completion_tokens` (the o-series reasoning models reject the first two and require the last). Symmetrically, `AnthropicService` uses `models/knownModels.ts`'s `supportsTemperature()` to decide whether `temperature` is sent at all — Claude Fable 5/Mythos 5 and the Opus 4.7+/Sonnet 5 generation return a 400 if `temperature` is present in the request regardless of its value, so `streamMessage` resolves `temperature` from `conversation.temperature ?? settings.temperature` and then drops it to `undefined` for those model IDs before building the request. `MistralService` sends `temperature` unconditionally when resolved — direct SDK type inspection found no per-model deny-list equivalent to Anthropic's, and Mistral's chat API accepts a native `system`-role message on every model (confirmed via the SDK's `SystemMessage` type), so unlike `OpenAIProvider` it needs no leading-user-message workaround for any model.

`effort` (`"low"|"medium"|"high"`, capped below the full Anthropic range — see ADR-040) follows the mirror-image gating shape: `AnthropicService` uses `supportsEffort()` (an allow-list, `ANTHROPIC_EFFORT_MODELS`, unlike `ANTHROPIC_NO_TEMPERATURE_MODELS`'s deny-list) to decide whether to send `output_config.effort`; `OpenAIProvider` reuses the existing `isReasoningModel()` gate to decide whether to send `reasoning_effort` — the same o-series models that reject `temperature` are the only ones that accept `reasoning_effort`, so the two parameters are naturally mutually exclusive per model. `output_config` isn't in the installed `@anthropic-ai/sdk`'s TypeScript types (`0.40.1`), so `AnthropicService` declares a local `AnthropicStreamParams` type (`Anthropic.MessageStreamParams & { output_config?: {...} }`) and builds the request as a separately-typed `const` rather than an inline object literal, avoiding TypeScript's excess-property check without a cast or an SDK bump. `MistralService` sends `reasoningEffort` unconditionally too, via an always-`true` `supportsMistralEffort()` — the installed SDK's `ReasoningEffort` type carries no per-model restriction, unlike OpenAI's genuinely o-series-only `reasoning_effort`.

`MistralService` (`services/MistralService.ts`) differs from the other two providers in one structural way: it uses the SDK's `MistralCore` class plus standalone `chatComplete`/`chatStream` functions (`@mistralai/mistralai/funcs/*.js`, resolved via `unwrapAsync` from the SDK's `Result<T,E>` monad) rather than a single client instance with `.chat.stream()`/`.chat.complete()` methods — the SDK's own `FUNCTIONS.md` documents this "tree-shakeable standalone functions" surface as the intended API for bundle-size-conscious runtimes. `isMistralReasoningModel()` gates the Magistral line into the larger `DEFAULT_MAX_TOKENS_REASONING` default the same way `isReasoningModel()` gates OpenAI's o-series. PDF attachments are not implemented for Mistral this pass — `MistralService.streamMessage` shows a `Notice` (`mistralPdfUnsupported`) rather than silently dropping the attachment when one is present. See ADR-045.

The `TITLE:`/`SUMMARY:` markers used by `generateSummaryWithTitle` and parsed by `messageUtils.parseTitleAndSummary` are defined once in `services/promptConstants.ts` (`TITLE_MARKER`, `SUMMARY_MARKER`) so the two can't drift apart. Max-output-tokens resolves as `conversation.maxTokens ?? settings.maxTokens ?? resolveDefaultMaxTokens(model)` in both providers — the same three-level override layering `temperature`/`effort` use. `resolveDefaultMaxTokens()` (`promptConstants.ts`) picks `DEFAULT_MAX_TOKENS` (8192) or, for OpenAI reasoning models (`isReasoningModel()`), the larger `DEFAULT_MAX_TOKENS_REASONING` (16384) — reasoning models spend tokens from this same budget on internal reasoning before producing visible output, so a low cap risks a truncated or empty reply. Unlike temperature/effort, `maxTokens` has no `Setting.setDisabled()` gating anywhere in the UI: every model accepts some form of output-token cap (only the request field *name* varies, via `isReasoningModel()`), so there's no "unsupported" state to gate against.

Shared logic in `services/messageUtils.ts`:
- `parseTitleAndSummary` — parses `TITLE: / SUMMARY:` structured response
- `normalizeMessages<T>(messages, isInvalidFirst)` — coalesces same-role messages
- `selectHistoryForSend(messages, resumeMode)` — returns `[]` in `"summary"` mode, last 6 messages in `"hybrid"` mode, `messages` unchanged in `"full"` mode
- `trimHistoryToBudget(history, contextWindow, outputBudget, systemPromptTokens)` — trims oldest messages from front when estimated tokens exceed the available context window budget
- `estimateTokensFromBytes(bytes)` / `estimateTokensFromText(text)` — token count helpers
- `LANG_LABELS`, `langInstruction`, `langSuffix` — output language helpers
- `debugLog(settings, ...args)` — verbose diagnostic trace gated on `settings.debugMode`; used for retry attempts and tool-round outcomes. Genuine errors (as opposed to opt-in diagnostics) use un-gated `console.warn`/`console.error` instead, so they're visible without enabling debug mode first.

Shared logic in `services/retry.ts`:
- `isRetryableError(error)` — true for rate-limit, network, and server-error (5xx/Anthropic 529) classes, never user aborts
- `RETRY_BACKOFF_MS` — two backoff delays; applied only while no tokens have been emitted yet for the current attempt, so a retry never duplicates partial output
- `ABORT_ERROR_NAMES` — the set of error names treated as a user-initiated cancellation, reused by `BaseProvider.finishOrError`; includes Mistral's own `"RequestAbortedError"` name alongside Anthropic/OpenAI's shared `"AbortError"` (see ADR-045)

`services/apiError.ts`'s `classifyApiError` reads either `.status` (Anthropic/OpenAI) or `.statusCode` (Mistral) off a caught error to determine its HTTP status — the two SDKs use different property names for the same concept, confirmed by direct inspection of Mistral's `MistralError` type (see ADR-045).

Token/cache usage accounting is additive across every round of the tool-calling loop, accumulated centrally in `BaseProvider.runStreamLoop` (`totalInputTokens`/`totalOutputTokens`, plus `cacheReadTokens`/`cacheCreationTokens` for Anthropic) — each provider's `runStreamRound` returns a `RoundResult` with that round's delta; the loop sums and reports the total across the whole turn, never just the last round.

Anthropic-specific: system prompt and tool definitions are sent with `cache_control: { type: "ephemeral" }` (system as the last block, tools on the last tool in the array) so the identical, stable parts of the request are cached across turns of a conversation. OpenAI has no equivalent code path — its API caches eligible prompts automatically server-side.

---

## Infrastructure

- **CI:** `.github/workflows/ci.yml` — lint (`npm run lint`) → file-size budget (`npm run check:filesize`) → type-check + build (`npm run build`) → test (`npm test`). Triggers on push to `main`, PRs, and manual dispatch.
- **ESLint:** `eslint.config.mjs` with `tseslint.configs.recommended`, typed linting (`projectService: true`). `no-console: warn`, `no-explicit-any: off`, `no-floating-promises: error` (with `ignoreVoid: true`). 0 errors, ~8 intentional warnings.
- **Testing:** Vitest, 300 unit tests across 18 files, ~2 s. Coverage thresholds: statements/lines ≥ 90 %, branches ≥ 80 %, functions ≥ 95 %.
- **Branch protection:** CI must pass before merge. Force-pushes blocked. Merged branches auto-deleted.
- **`minAppVersion`:** `"1.4.0"` — reflects the actual minimum Obsidian version where all used APIs are available.
- **`@anthropic-ai/sdk`:** pinned at `^0.40.0` (bumped from `^0.28.0`) — the minimum version whose main (non-beta) Messages API types support `cache_control`, needed for prompt caching. See ADR for the caching decision.
- **`@mistralai/mistralai`:** added for the Mistral provider; requires `@opentelemetry/api` as a real (not just optional) dependency — the SDK unconditionally wires an OpenTelemetry tracing hook into every client instance at construction time (both the full `Mistral` class and the leaner `MistralCore`), so esbuild cannot resolve the bundle without it even though telemetry itself is never used. Bundled `main.js` grew from ~340KB to ~680KB as a result — see ADR-045 for the full investigation and the accepted-tradeoff framing.
