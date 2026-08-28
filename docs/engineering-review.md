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
*Updated: 2026-08-24 — web search "research mode": closes the standing training-cutoff/recency gap (models could not reach anything after their cutoff). A client-executed `web_search` tool (`services/WebSearchService.ts`, Tavily via Obsidian `requestUrl`) runs through the existing agentic loop, so one `ToolDefinition` in `ToolHandler.getToolDefinitions` lights up all three providers; gated by a per-conversation `researchMode` toggle (independent of `writeMode`) with a `<recent_context>` date/grounding block injected by `ContextBuilder`. Never-throws error convention reused for search failures. New settings `searchSecretName`/`webSearchDefault`/`webSearchMaxResults`; new tests `tests/webSearch.test.ts` + `web_search` gating/execution cases in `tests/ToolHandler.test.ts` and a recency-block case in `tests/ContextBuilder.test.ts`. Not a bug fix — a new capability, not separately numbered (same convention as recent entries). See ADR-062.*

*Updated: 2026-08-23 — fork branch-back (#105): forked snippets accent-highlighted in the source, tap-to-expand inline fork summary + open/return links, source summary decoupled into `forkedFromSummary`.*
*Updated: 2026-08-23 — saved-summary frontmatter (#104): `type: "LLM Note"` (was `pythia-conversation`/`pythia-favorites`), a clickable `conversation:` resume deep link, and no `tags: [pythia]` (`NoteWriter`).*
*Updated: 2026-08-23 — summary UX rework (#103): top-of-conversation "Speisekarte" cards, long-press Send menu as sole generator, removed pinned panel / sparkle / favorites modal / auto-generation paths.*
*Updated: 2026-08-23 — highlight-favorite interaction fixes (#102): tap-to-unfavorite, surgical removal (no color loss), single-tap navigator jump, toolbar reorder.*
*Updated: 2026-08-23 — summarize-favorites feature (#101): per-conversation favorites synthesis (Key learnings + Action items) via `buildFavoritesDigest` + `generateFavoritesSummary`, modal preview, navigator ✦ + command triggers.*
*Updated: 2026-08-23 — favorite highlights feature (#100): span-level favorites with persistent `mark.p-highlight`, `ui/HighlightPainter.ts`, legacy migration, new happy-dom DOM tests.*

*Updated: 2026-08-28 — decomposition roadmap **complete**: #122 landed (ADR-104). Added `appContainer.ts` composition root — an async `AppContainer.create()` factory builds every service in dependency order after `loadPluginData`, and the plugin delegates via getters so no call site changed. Inverted `ConversationStore` ownership: it now owns `_conversations`; `plugin.conversations` is a `get`/`set` accessor (bidirectional coupling gone). `main.ts` 348 → 340; new `appContainer.ts` (75). Verified by tsc/lint/build/434 tests; plugin lifecycle not runtime-tested here — smoke-test recommended. All of #120–#122 done; #123's guard shipped in PR0 (per-controller UI tests remain the standing follow-up).*

*Updated: 2026-08-28 — decomposition roadmap #120 closed + #121 landed. **#120 (sidebar)**: complete at PR6 — the render loop (`renderMessages`/`appendMessageBubble`/`createStreamingBubble`) and send loop (`sendMessage`) intentionally stay in the view as the ADR-103 "thin coordinator" core (they create per-render containers and share render state; extracting them trades unverifiable render-ordering risk for little gain — PR7/PR8 consciously skipped). `sidebar.ts` 3,735 → 1,992 (−47%). **#121 (main.ts)**: split into `SecretStore`/`PluginDataStore`/`ConversationService`/`ViewManager` with thin plugin facades preserving the public API; `main.ts` 951 → 348 (under the 600 default). Verified by tsc/lint/build/434 tests; plugin-lifecycle paths not runtime-tested here — smoke-test recommended. No new ADR (routine extraction under ADR-103).*

*Updated: 2026-08-27 — decomposition roadmap PR6 (#120): extracted the header chrome (header row, inline rename, model badge/popover, copy-link) from `sidebar.ts` into `ui/HeaderController.ts` — `mount()` builds it; `getConvNameEl`/`getChipEl` expose the elements History/ContextInspector need; cross-controller reach via lazy deps. Dropped 5 now-dead imports. Behaviour-preserving — `sidebar.ts` 2,339 → 1,992 lines (under 2,000; −47% from 3,735 start), ratchet lowered; 434 tests green. No new ADR.*

*Updated: 2026-08-27 — decomposition roadmap PR5 (#120): extracted the text-selection toolbar + span-favorites (build/remove/repaint/scroll, tap-a-highlight, copy/insert/inbox, fork-from-selection) from `sidebar.ts` into `ui/SelectionController.ts` — a `mount()` builds the toolbar and wires listeners via a passed `registerDomEvent`; the controller owns all HighlightPainter usage, so the whole HighlightPainter import + dead `Favorite` type left the view. Nav/Fork/Transcript cross-links via deps. Behaviour-preserving — `sidebar.ts` 2,773 → 2,339 lines (−37% from 3,735 start), ratchet lowered; 434 tests green. No new ADR.*

*Updated: 2026-08-27 — decomposition roadmap PR4 (#120): extracted the fork-origin banner, painted origin marks, and inline anchor/menu from `sidebar.ts` into `ui/ForkController.ts` (`Deps`-driven; `registerDomEvent`/markdown passed as callbacks; favorites-summary via SummaryController). Fork-creation from a selection stays in the view (moves with the Selection cluster). Dropped dead `repaintForkOrigins`/`formatSummaryTimestamp`/`debugLog` imports. Behaviour-preserving — `sidebar.ts` 3,057 → 2,773 lines, ratchet lowered; 434 tests green. No new ADR (routine extraction under ADR-103).*

*Updated: 2026-08-27 — decomposition roadmap PR3 (#120): extracted the context-budget bar + inspector card from `sidebar.ts` into `ui/ContextInspectorController.ts` (`Deps`-driven; constructed once so `inspectorOpen` persists across rebuilds; `lastTokenUsageMsg`/`scrollToTop`/`renderReferencePills` passed as callbacks, `onSummarize` calls into SummaryController). Dropped now-dead `buildSystemPrompt`/`getContextWindow` imports. Behaviour-preserving — `sidebar.ts` 3,219 → 3,057 lines, ratchet lowered to match; 434 tests still green. No new ADR (routine extraction under ADR-103).*

*Updated: 2026-08-27 — decomposition roadmap PR2 (#120): extracted the summary "Speisekarte" cards and the LLM summary-generation flows from `sidebar.ts` into `ui/SummaryController.ts` (`Deps`-driven; owns the auto-collapse observer, renders markdown via a view callback, keeps a `summarizeFavorites` view facade for `main.ts`). `formatSummaryTimestamp` relocated to `services/messageUtils.ts`. Behaviour-preserving — `sidebar.ts` 3,403 → 3,219 lines, ratchet lowered to match; 434 tests still green. No new ADR (routine extraction under ADR-103).*

*Updated: 2026-08-27 — decomposition roadmap PR1 (#120): extracted the quick switcher, history overlay, and delete-with-confirm from `sidebar.ts` into `ui/HistoryController.ts` (`Deps`-driven, mirrors `NavigatorController`); the view closes it on rebuild/unload. `abbreviateModel` relocated to `models/knownModels.ts` so the view and controller share it. Behaviour-preserving mechanical move — `sidebar.ts` 3,735 → 3,403 lines, ratchet ceiling lowered to match; 434 tests still green. No new ADR (routine extraction under ADR-103).*

*Updated: 2026-08-27 — structural decomposition roadmap (#120–#123) added, and PR0 landed. Comparing Pythia against the obsidian-similarity plugin surfaced one real gap: the `services/` layer is cleanly factored, but `sidebar.ts` (3,735 lines, ~105 methods) and `main.ts` (951 lines) are god-objects with nothing preventing regrowth. PR0 establishes the guardrail — a file-size ratchet (`scripts/check-file-size.mjs`, 600-line default + grandfathered monolith ceilings, wired into CI ahead of the build) — and the first tested seam of the riskiest target: `services/sendPolicy.ts` lifts `sendMessage`'s two pure post-turn trigger predicates behind `tests/sendPolicy.test.ts` (8 cases). #120–#123 (the controller-extraction sequence, the `main.ts` split, the `AppContainer` + `ConversationStore` ownership inversion, and the lock-in) remain open. See ADR-103. (Numbering note: this batch was drafted as #119–#122 / ADR-097 before merging `main`, which had meanwhile claimed #119 and ADR-097 for other work; renumbered on merge.)*

*Updated: 2026-08-27 — a fork summarized from its **source-side anchor** now gets retitled too. `generateForkSummary` used `generateSummary` (text only), so it set `fork.summaryText` but never `fork.name` — a fork summarized from the origin kept its generic "Fork of X" name, while one summarized from inside the fork (`generateConversationSummary` → `generateSummaryWithTitle`) got a real title. Switched `generateForkSummary` to `generateSummaryWithTitle` and it now sets `fork.name = title` + renames the saved note, mirroring the in-fork path; the anchor rebuild reflects the new title immediately. (Also confirmed for the maintainer: manual rename still exists — it moved from the title text to the header pencil icon; clicking the title now opens the quick switcher.) Follow-up: the header pencil proved easy to miss ("I cannot see a pencil"), so rename is now **also** reachable from the quick switcher — each row has a hover ✎ (mirroring the ✕ delete) that opens an `InputModal` prefilled with the conversation name and renames any conversation in place, not just the active one. This puts rename where users already look (the title dropdown).*

*Updated: 2026-08-27 — model-picker guidance (ADR-102): users struggle to choose a model, so each popover row now shows a plain-language "good for" example line (e.g. "Long chapters, in-depth comparisons" / "Quick facts, short rewrites") instead of capability jargon. Revealed on hover (desktop) or by a first tap that arms the row + shows a "Tap again to select" hint (touch two-tap confirm). Curated for every catalog model in `models/modelGuidance.ts` (en/de, keyed by id, out of the `t()` table to avoid the dynamic-key dead-key problem; new `getLang()` helper); a test enforces presence/parity/no-stale-ids for all models. **#119 (backlog) — task-first model picker:** a top row of task chips in the model popover ("Quick question · Deep analysis · Long document · Coding · Creative"), each mapping to the right model for the active provider, so the choice is reframed from "which model" (jargon) to "what am I doing" (obvious). Deferred: needs a maintained task→model policy per provider and introduces a second selection paradigm next to the model list (power users may find it patronizing, and a wrong mapping actively misleads). Revisit if the audience skews non-technical or the "good for" labels prove insufficient.*

*Updated: 2026-08-27 — spacing polish: an AI answer that opens with a heading left a large gap under the turn-label meta line (the heading's default `margin-block-start` stacked on the `.p-msg-ai` flex gap). Collapsed the first block's top margin (`.p-ai-body > :first-child`, `.p-summary-card-md > :first-child`), mirroring the existing `.p-fork-anchor-body` rule. CSS-only.*

*Updated: 2026-08-27 — custom instructions (ADR-101): added a global free-text `customInstructions` setting appended to every chat system prompt inside a `<custom_instructions>` block (after the conversation's system prompt, before the no-solicitation guard). Threaded through `buildSystemPrompt(conversation, customInstructions)` at both call sites (send + context-inspector estimate). The chosen "cheap 80%" slice of the editable-rules idea — app-contract instructions (citation markers, tool descriptions) stay hard-coded and unexposed; the full per-rule registry is deferred. Settings textarea + en/de i18n; new ContextBuilder tests.*

*Updated: 2026-08-27 — response hygiene (ADR-100): suppressed the assistant's boilerplate closing offer ("Would you like me to save this as a note, or continue with the next section?") that capable models appended to every long answer. It's emergent (KB framing + visible note tools), not in the prompt text, and shows under custom prompts too — so a new `NO_SOLICITATION_INSTRUCTION` is always appended in `buildSystemPrompt`, exempting genuine clarifying questions. `ContextBuilder` exact-output tests updated + a guard-present test added.*

*Updated: 2026-08-27 — web search reliability (ADR-099): root-caused "search doesn't fire when expected" to the tool being gated entirely on the per-conversation research globe (default off) — globe off ⇒ no `web_search` tool at all ⇒ the model answers from memory silently. Fix (maintainer chose auto-arm): a pure heuristic `looksTimeSensitive` (`services/webSearchHeuristics.ts`, 8 tests) auto-arms `web_search` for a single send when the message reads time-sensitive and a Tavily key is set, via an armed shallow clone passed to `streamMessage` (never persisted — the globe stays off); the globe pulses to show it fired. Strengthened the tool/nudge wording to a search-first default in all modes. New `webSearchAutoArm` setting (default on).*

*Updated: 2026-08-27 — header rework + "+" jump fix (ADR-098): reordered the header to history · name (grows) · rename · link · delete · model · new; the name group is the sole `flex:1` region so the "+" is always the last child and holds its position as controls show/hide. Fixed the reported "+" jump between the main view and the all-conversations overlay — root cause was the unstyled `.pythia-template-label` sitting as the header's last flex child (rendering after "+" when a template was active), plus a left-padding mismatch between `.p-header` and `.p-history-head`. The caption is now `position:absolute` (out of flow) and the two header frames share identical padding. Empty state trimmed to history · name · + (`deleteConvBtn` became a stored field so `renderHeader` gates it). Docs: CLAUDE.md + design.md header inventories updated.*

*Updated: 2026-08-27 — feature: the `#`-mention note picker (`ui/InlineSuggest.ts`) can now **drill into folders in place** (ADR-097). A matched folder is opened with ArrowRight / swipe-left / a trailing › chevron, showing its subfolders + notes behind a back row and an explicit "Attach all (N)" row; ArrowLeft / swipe-right / the back row steps up. Enter/tap on a folder still attaches the whole folder, so it's non-breaking. Reworked the flat `items` array into a typed `Entry` union with pure `buildGlobalEntries`/`buildFolderEntries` builders and a `folderStack`; the fragment is cleared on each level change so typing filters within the current level. Three i18n keys added to en+de.*

*Updated: 2026-08-27 — bug: the `#`-mention note picker (`ui/InlineSuggest.ts`) didn't scroll when arrow-key navigation moved the selection past the visible rows. The dropdown is a fixed `max-height: 220px; overflow-y: auto` container holding up to 8 matches, but `move()` → `render()` only re-tagged the active row's class; it never brought that row into the scroll viewport, so the highlighted selection disappeared below the fold. Fix: after rebuilding rows, `render()` now adjusts the dropdown's own `scrollTop` to keep the active row visible (direct scrollTop math rather than `scrollIntoView`, which hunts for the wrong scroll ancestor and could jog the whole panel). Not unit-tested — depends on layout metrics (`offsetTop`/`clientHeight`) the DOM stub doesn't compute.*

*Updated: 2026-08-27 — real bug: forking a passage left the SOURCE conversation with no blue fork-origin highlight, no tap-to-open inline summary anchor, and a "Forked from" link that only reached the conversation (not the branched span) — all because `repaintForkOrigins`/`findRange` couldn't re-find the branched text. Root cause: `onForkConversation` stored the UNTRIMMED `sel.toString()` (favorites store `.trim()`), and `Selection.toString()` can carry a block-boundary newline / edge whitespace absent from the concatenated text-node data, so `indexOf` returns −1 and the `<pythia-fork>` mark never paints. Latent since ≤2.0.4 (`HighlightPainter.ts` byte-identical 2.0.4→2.0.7). Two fixes: (1) trim at storage (`onForkConversation`) AND at search (`repaintForkOrigins`); (2) — the one that explains the reported single-word "SSIH" case — an **occurrence-index fallback**: a fork of a short word that repeats in the message records a non-zero index (favorites were unique phrases → index 0 → they painted), and if that index is stale at paint time `findRange` returns null and nothing paints; `repaintForkOrigins` now does `findRange(text, occ) ?? findRange(text, 0)`. Added a `debugMode` diagnostic in `sidebar.repaintForkOrigins` (logs stored text/index + whether the mark landed). Regression tests for both cases in `tests/HighlightPainter.test.ts`. Known limits (traceable via the log): multi-block interior newlines, and a selection that captured adjacent citation-chip text. ADR-096.*

*Updated: 2026-08-27 — iCloud/Sync notification spam fixed: `watchDataJson` polls `data.json` mtime every 5s and calls `reloadFromDisk`, which always showed a "reload complete" toast — on an iCloud/Obsidian-Sync vault the file is rewritten in the background constantly, so the toast fired on a loop. Split manual vs automatic: `reloadFromDisk({ notify = true })` — the command-hub reload keeps the toast, the watcher-driven reload passes `notify: false`. Data still refreshes; it just no longer announces every background sync. A thorough inline comment at the watcher call site explains the workaround. (Idea #1 of the iCloud-staleness options; content-signature dedup + passive indicator remain as follow-ups.)*
*Updated: 2026-08-27 — optimizer output cleaned to the bare prompt (ADR-094): the model was returning the rewrite wrapped in "Sure! Here's…", surrounding `---` rules, and a closing sentence, which — since ADR-093 drops the result into the input box — landed as noise. Added a shared `OUTPUT_ONLY_INSTRUCTION` appended to the optimizer request (user-message slot, so it survives reasoning-model utility calls) and a pure, unit-tested `cleanOptimizedOutput()` that unwraps code fences, drops a leading preamble line, and strips leading/trailing rules. New obsidian-free module `services/promptOptimizerText.ts` + `tests/promptOptimizer.test.ts` (9 cases).*

*Updated: 2026-08-27 — prompt optimizer reworked to an in-place textarea rewrite (ADR-093): `OptimizationController.start()` optimizes the current input with the settings framework and replaces it via `execCommand("insertText")` (⌘Z / iOS shake revert), no preview/result bubbles, no auto-send. Removed the in-message UI, its deps, the `.p-msg-optimize-*`/`.p-optimize-*` CSS, and 4 dead i18n keys; Send button doubles as the "Optimizing…" cue. Android has no native undo (documented gap).*

*Updated: 2026-08-27 — real bug: the accent-filled "Senden" label stayed unreadable on pale/mid accents despite ADR-082, because that fix only picked the better of the theme's two on-accent tokens — when BOTH read poorly, the less-bad one is still low-contrast. Added a pure black/white fallback: `--p-on-accent` keeps a theme token only when it clears WCAG AA (4.5) on the accent, else forces pure `#000`/`#fff`. Extracted to a tested `readableOnAccent()` (`services/color.ts`), replacing `betterOnAccent()`; new `tests/color.test.ts` cases incl. the both-tokens-poor case (ADR-092).*

*Updated: 2026-08-27 — prompt optimizer relocated from the input toolbar (wand icon) to a third "Optimize prompt" item in the Send long-press menu (`sparkles`, greyed when input empty or no optimizer template) — ADR-091. `OptimizationController.optimizeBtnEl` made optional/guarded; removed the toolbar button, the `optimizeBtnTooltip` i18n string, and the dead `.p-optimize-btn`/`pythia-wand-pulse` CSS; added `menuOptimizePrompt` (en/de).*

*Updated: 2026-08-27 — UI-quirk pass: **(a)** favorite/fork highlights restyled to smsag.de's highlighter-marker look (ADR-090; `styles.css`). **(b)** summary "Speisekarte" cards were crowding the first message bubble — added `.p-summary-cards { margin-bottom: var(--s4) }` for a ~28px section break. **(c)** selection-toolbar bug: Favorite/Fork still appeared over a selected user prompt because the `.p-msg-user` guard tested `range.commonAncestorContainer`, which bubbles up to `.p-chat` when a drag overshoots the bubble — replaced with an endpoint check requiring `anchorNode` and `focusNode` to resolve to the same `.p-msg-ai` (ADR-085 refinement; `sidebar.ts handleSelectionChange`).*

*Updated: 2026-08-27 — senior-engineer bug audit, #111–#118 resolved. **#111 (data loss on failed/empty send):** `sendMessage()` never persisted the user turn until a reply completed, so an errored or empty response dropped the user's own message and the rendered partial reply desynced from saved history — now the user turn is saved up front and partials are discarded (ADR-087; `getPartial()` removed). **#112 (eviction reorder):** `evictConversations()` re-sorted survivors by `updatedAt`, silently making `conversations[length-1]` (used as "most recent" by `onOpen`/delete) resolve to the oldest after an eviction — now survivors keep insertion order (ADR-088; regression tests). **#113 (legacy-provider crash):** `LLMRouter.generateChapterName`/`generateConversationTitle`/`summarizeNotes`/`optimizePrompt` indexed `providers[provider]` directly, throwing for pre-`provider` conversations — routed through a `byProvider()` fallback (mirrors `get()`). **#114 (duplicate web sources) + #115 (contradictory web-citation instructions):** web sources deduped by domain not URL, and the `web_search` tool description / `<recent_context>` / tool-result header unified on a shared `WEB_CITATION_INSTRUCTION` (ADR-089; new `webDomain()` helper + test). **#116 (stale save slice):** `onSaveResponse` computed its slice before the save dialog opened, missing replies that streamed in and advancing the saved-count past them — slice + boundary recomputed inside the callback. **#117 (parallel tool-call collision):** OpenAI/Mistral streaming keyed tool-call fragments on `index ?? 0`, collapsing parallel calls into slot 0 if a provider omits `index` — added an id-aware fallback. **#118 (hard-rule #10):** converted the persistent view-chrome listeners in `sidebar.ts` from raw `addEventListener` to `registerDomEvent` (short-lived/manually-managed and per-render listeners intentionally left). All 398 tests pass; build + lint clean.*
*Updated: 2026-07-09 — bug-fix/reliability/observability/maintainability/performance audit: #51–#55, #57–#72, #75, #76 resolved (broken o4-mini model, cross-conversation streaming race, OpenAI token undercounting, abort-during-tool-call crash, retry gap for 5xx/529, unbounded tool-call loop, conversation resurrection on delete, stuck error bubble, optimizer stale-response race, debugLog observability convention, three silent-catch fixes, six performance quick wins, BaseProvider extraction, duplicate suggest modals merged). #56 (classifyApiError heuristic) deliberately not done — see ADR-030. #73, #74 (note-chunk caching, InlineSuggest candidate cap) added as backlog.*
*Updated: 2026-07-09 — second-round audit (post-1.21.1): #77–#83 resolved (second delete-guard gap via the conversation switcher, resume-mode race with concurrent deletion, eviction crash on malformed `updatedAt`, eviction only protecting one sidebar leaf, silent multi-line frontmatter corruption, deep-link double-decode, summary-generation stale-conversation race). Remaining medium/low findings from this audit and pre-existing architectural backlog (#3, #10, #50, #73, #74) reviewed and explicitly deferred, not silently dropped.*
*Updated: 2026-07-10 — #84 resolved: `cmdForkConversation` now carries `temperature` over from the source conversation, matching `provider`/`model`/`maxTokens`. Also added a settings-modal UI to view/edit a conversation's temperature after creation (not a bug — new capability, not separately numbered).*
*Updated: 2026-07-11 — #85 resolved: `models/knownModels.ts`'s Anthropic entries had gone stale — `claude-opus-4` and `claude-haiku-3-5` had both been retired by Anthropic, and `AnthropicService.fastModel` hardcoded the dead `claude-haiku-3-5` as its fallback utility model (silently broken for any call not passing an explicit model). Swapped to the current catalog: `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`; `defaultAnthropicModel` and `fastModel` updated to match.*
*Updated: 2026-07-11 — #86 resolved: the #85 catalog refresh introduced a live regression — `claude-fable-5`, `claude-opus-4-8`, and `claude-sonnet-5` all reject the `temperature` request parameter outright (400 `invalid_request_error`, "temperature is deprecated for this model"), but `AnthropicService.streamMessage` sent it unconditionally whenever a conversation or global default temperature was configured, breaking every request on 3 of the 4 listed Anthropic models. Added `models/knownModels.ts`'s `supportsTemperature()` (same shape as the existing `isReasoningModel()` guard) and gated the parameter on it; added regression tests in `tests/AnthropicService.test.ts` covering both the send and omit paths.*
*Updated: 2026-07-11 — #87 resolved: #86's backend gating fixed the 400s, but the settings tab and conversation modal still showed the temperature control as fully active even on models that silently ignored it — confusing, since nothing in the UI explained why a set temperature had no effect. Added `Setting.setDisabled()`-based reactive gating (no prior precedent in either file) in both `settings.ts` and `suggest/ConversationSettingsModal.ts`, wired to the existing provider/model dropdown `onChange` handlers, with a "(not supported by the selected model)" description suffix when disabled. Landed alongside a new `effort` parameter (`models/knownModels.ts` → `supportsEffort()`, Anthropic's `output_config.effort` / OpenAI's `reasoning_effort`, global setting + template frontmatter + per-conversation override, same gating treatment) — not a bug fix, a new capability, not separately numbered (same convention as #84's temperature-editing UI). See ADR-040.*
*Updated: 2026-07-11 — Fork now resolves the source conversation's summary before opening the new conversation (awaited, not fire-and-forget) and assigns it onto the fork itself, so the new conversation genuinely has the source's summary as context via the existing `<previous_conversation_summary>` mechanism in `ContextBuilder.buildSystemPrompt()` — previously the async summary was cached only on the source and never reached the fork. Also removed `view.prefillInput(selectedText)` from `cmdForkConversation`, so the forked conversation's input box starts empty (the selection still shows in the fork banner via `forkedFromSelection`). Deleted the now-unused `PythiaSidebarView.renderForkBanner()` wrapper. Not a bug fix — a new capability/UX correction, not separately numbered (same convention as recent entries). See ADR-042.*
*Updated: 2026-07-17 — Fixed a real, reproducible bug: attaching a long (34KB), multi-section reference doc and asking for one specific framework's syntax could return a *different* framework's syntax instead. Root cause: `services/noteRelevance.ts`'s `scoreRelevanceTokens()` gave +1 point per shared keyword with zero weighting for how common that word was — many sections shared generic vocabulary ("user," "solution," "outcome"), so a section built from that shared vocabulary could out-score (or tie and win a tie-break by document position against) the one section holding the actual distinctive term the user asked about. Replaced with a smoothed IDF-weighted scorer (`scoreRelevanceWeighted`/`scoreRelevanceTokensWeighted`) — a token shared by every candidate barely moves the score, a token unique to one or a few candidates dominates it. Still fully dependency-free, no embeddings, no vector store, no new I/O — a refinement of ADR-026's direction, not a reversal. Verified directly against the real document that surfaced the bug (the correct section is now retained, the wrong one excluded) plus a generic regression test reproducing the failure shape. Partially addresses #50 (full embeddings remains open if this proves insufficient). See ADR-043.*
*Updated: 2026-07-17 — `maxTokens` was the only generation parameter with no UI exposure at all — the only way to set it was `max_tokens:` in a template's frontmatter; every other conversation was silently stuck at the hardcoded `DEFAULT_MAX_TOKENS = 4096`. Brought to the same three-level override layering and UI treatment `temperature`/`effort` already had (new `PythiaSettings.maxTokens`, new fields in `settings.ts` and `ConversationSettingsModal.ts`). Also raised the default itself: `DEFAULT_MAX_TOKENS` 4096 → 8192, plus a new `DEFAULT_MAX_TOKENS_REASONING = 16384` for OpenAI reasoning models via the existing `isReasoningModel()` check — reasoning tokens spend from the same budget as visible output, so a low cap risked a silently truncated or empty reply on exactly the models most likely to need a large one. Not a bug fix — a new capability/default-tuning pass, not separately numbered (same convention as recent entries). See ADR-044.*
*Updated: 2026-07-17 — Added Mistral as a third LLM provider with full streaming/tool-calling/temperature/effort/maxTokens parity (`services/MistralService.ts`, extends `BaseProvider`; `Provider` widened to include `"mistral"`). Pre-implementation audit found a real bug class: several call sites resolved provider behavior via a two-way `provider === "x" ? A : B` ternary that TypeScript does not flag when a third union member is added — converted to exhaustive `switch`es with `never`-typed default cases at every site found (`main.ts`'s default-model resolution and API-key check, `settings.ts`'s and `ConversationSettingsModal.ts`'s temperature/effort gating). Direct SDK type inspection (not docs) found Mistral's `reasoningEffort` has no per-model restriction and native `system`-role support on every model, so both were wired in fully rather than deferred as originally planned. Surfaced two bonus fixes to provider-shared code: `services/retry.ts`'s `ABORT_ERROR_NAMES` didn't recognize Mistral's `"RequestAbortedError"` abort-error name (would have misreported a clean Stop-click as a real error), and `services/apiError.ts`'s `classifyApiError` only read `.status` (Mistral uses `.statusCode`, misclassifying real API errors as network failures). Also root-caused an esbuild failure — the SDK unconditionally pulls in `@opentelemetry/api` via an internal hook-registration chain regardless of which client API is used — fixed by installing it as a real dependency; bundle size roughly doubled (340KB → 680KB) as a result, an accepted, documented tradeoff. PDF attachments and vision input remain out of scope for Mistral, deferred as follow-ups. Not a bug fix — a new capability, not separately numbered (same convention as recent entries). See ADR-045.*
*Updated: 2026-08-17 — Maintainability/performance pass: extracted the streaming/tool-calling loop into a BaseProvider template method (`runStreamLoop` + three abstract hooks: `prepareStream`/`runStreamRound`/`handleToolCalls`), eliminating ~600 lines of near-identical code across three providers (#88). ConversationStore gained dirty-flag persistence tracking — `schedulePersist` skips the write when nothing has actually changed (#89). Sidebar performance: `selectionchange` debounced at 150 ms, token-estimate update debounced at 250 ms, `autoResizeTextarea` wrapped in `requestAnimationFrame` (#90). ESLint config upgraded to typed linting (`projectService: true`) and `no-floating-promises: error` (with `ignoreVoid: true`), catching and fixing 8 existing violations (#91). #10 (fire-and-forget hardening) partially addressed by #91.
*Updated: 2026-08-17 — 22-finding codebase audit: AbortController race, ConversationStore snapshot-based dirty clearing, writeMode enforcement, dead code/CSS removal, focus-visible accessibility, i18n lazy init, TemplateLoader validation. See ADR-052.*
*Updated: 2026-08-17 — LLM response quality audit: #99 resolved (10-finding implementation — enriched default system prompt + grounding instruction, notes moved to system prompt, hybrid resume mode, context window budget trimming, paragraph-level fallback chunking, raised threshold to 12K, always-include-first-chunk, CJK-aware token estimation, default effort "high"). See ADR-053.*
*Updated: 2026-08-17 — Engineering review implementation: #92 unified model catalog (5 parallel data structures into `MODEL_CATALOG`), #93 BaseProvider concrete defaults (`assistantLabel`/`resolveModel`), #94 `buildUI` decomposition + `DeleteFileModal`/`CodeBlockDecorator` extraction, #95 `createConversation` options object + `createConversationFromTemplate` helper, #96 TemplateLoader prefix-match bug fix, #97 dead code removal (`hasDirty()`, `cmdCopyConversationLink()`, redundant provider overrides), #98 vitest coverage config updated. All resolved. See ADR-048 through ADR-051.*
*Updated: 2026-07-17 — Code-block/blockquote design-system fix, from user-reported screenshots. Two separate causes: `.p-code-frame`'s background used an undocumented `var(--code-background)` token instead of the `var(--background-secondary)` formula the app's other "framed content box" components (`.pythia-tool-call`, `.p-msg-optimize-result`) already use — unified. Blockquotes had **zero** custom Pythia CSS at all (confirmed via grep) — a purple-tinted, italic Obsidian default was what the user actually saw; added deliberate styling (neutral `--background-modifier-border` bar, not accent; no italic; `--text-muted`). Also added, per explicit user request: a persistent top-left code-type icon (Lucide `code-2`, always visible, not hover-gated like the copy button), an explicit `14px` icon-glyph size so the copy/copy-confirmed icons no longer render at inconsistent sizes, and a copy-confirmed color change from `--color-green` to `--color-accent` (green is used elsewhere for persistent semantic states, not momentary click feedback). Also fixed a dead `var(--scrollbar-thumb-bg, ...)` reference (never defined anywhere, always silently fell through to its fallback) and corrected `CLAUDE.md`/`docs/design.md` references to `docs/pythia-v3.html`/`docs/design-system.css` — neither file exists in the repo or its git history, despite being cited as mandatory pre-work reading. Not a bug fix in the tracked-suggestion sense — a design-system-fidelity pass, not separately numbered (same convention as recent entries). See ADR-046.*
*Updated: 2026-07-17 — Fixed a real, reported bug: a template using `claude-opus-4-8` with `effort: high` and a PDF attached failed with "Network error. Check your internet connection." despite the user having working internet. Root cause, confirmed by reading the installed `@anthropic-ai/sdk` directly: the SDK collapses any status-less error into the same shape, including a mid-stream SSE `error` event (e.g. a capacity/overload condition reported after the stream already started) and its own internal exceptions re-wrapped without a status — neither is the user's connectivity, but `classifyApiError`'s existing `status === undefined → "network"` fallback (left alone by ADR-030, which only reviewed the narrower `TypeError` branch) bucketed both the same as a real fetch/DNS failure, and `sidebar.ts` then discarded the real, already-available diagnostic message in favor of a hardcoded, in this case false, claim. New `buildStreamErrorMessage()` (`services/apiError.ts`, now unit-tested) surfaces the real message instead — retry behavior is unchanged (network/server_error were already retried identically). See ADR-047.*

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
| 2026-07-11 | Fork now awaits the source conversation's summary and carries it onto the new conversation as context before opening (previously generated asynchronously and only cached on the source, never attached to the fork); removed the resulting pre-fill of the fork's input box with the triggering selection; dead `renderForkBanner()` wrapper removed — new capability/UX fix, see ADR-042 |
| 2026-07-17 | Fixed real bug: a long, multi-section reference doc excerpted to the wrong section when attached as context (flat keyword overlap let generic-vocabulary sections outrank the one section holding the actual distinctive term). Replaced `scoreRelevance`/`scoreRelevanceTokens` with IDF-weighted batch equivalents in `services/noteRelevance.ts`; migrated both consumers (`noteChunking.ts`, `ui/InlineSuggest.ts`). Partially addresses #50 — see ADR-043 |
| 2026-07-17 | `maxTokens` brought to override-layering/UI parity with `temperature`/`effort` (new `PythiaSettings.maxTokens`, new fields in `settings.ts`/`ConversationSettingsModal.ts`); `DEFAULT_MAX_TOKENS` raised 4096 → 8192, new `DEFAULT_MAX_TOKENS_REASONING = 16384` for OpenAI reasoning models — new capability/default-tuning pass, see ADR-044 |
| 2026-07-17 | Added Mistral as a third LLM provider (`services/MistralService.ts`) with full streaming/tool-calling/temperature/effort/maxTokens parity; audited and closed a two-way-provider-ternary bug class across `main.ts`/`settings.ts`/`ConversationSettingsModal.ts`; fixed two provider-shared bugs surfaced by Mistral's different SDK error conventions (`retry.ts`'s abort-name set, `apiError.ts`'s status-property read); bundle size ~340KB → ~680KB from the required `@opentelemetry/api` dependency — new capability, see ADR-045 |
| 2026-07-17 | Code-block/blockquote design-system fix from user-reported screenshots: `.p-code-frame` background unified to `var(--background-secondary)` (matching the `.pythia-tool-call`/`.p-msg-optimize-result` framed-box convention); new blockquote styling (previously zero custom CSS — pure Obsidian default); new persistent top-left code-type icon; explicit `14px` copy/copy-confirmed icon sizing; copy-confirmed color changed from green to accent; dead `--scrollbar-thumb-bg` reference removed; stale `pythia-v3.html`/`design-system.css` doc references corrected — see ADR-046 |
| 2026-07-17 | Fixed real bug: a status-less Anthropic SDK error (mid-stream SSE `error` event, e.g. a capacity/overload condition, or an internal exception re-wrap) was shown to users as a false "Network error. Check your internet connection." — the real diagnostic message was discarded by `sidebar.ts`'s error handler. New `buildStreamErrorMessage()` (`services/apiError.ts`, now unit-tested via `tests/apiError.test.ts`) surfaces the real message instead; classification and retry behavior unchanged. See ADR-047 |
| 2026-08-17 | #88 resolved: streaming/tool-calling loop extracted into BaseProvider template method (`runStreamLoop` + `prepareStream`/`runStreamRound`/`handleToolCalls`), eliminating ~600 lines of near-identical code across three providers |
| 2026-08-17 | #89 resolved: ConversationStore gained dirty-flag persistence tracking (`dirtyIds` set + `hasDirty`/`clearDirty`/`markDirty`) — `schedulePersist` skips the write when nothing changed |
| 2026-08-17 | #90 resolved: sidebar performance — `selectionchange` debounced at 150 ms, token-estimate update debounced at 250 ms, `autoResizeTextarea` wrapped in `requestAnimationFrame` |
| 2026-08-17 | #91 resolved: ESLint upgraded to typed linting (`projectService: true`) + `no-floating-promises: error` (`ignoreVoid: true`); 8 existing violations fixed with `void` operators. #10 partially addressed |
| 2026-08-17 | #99 resolved: LLM response quality audit — 10-finding implementation: enriched default system prompt + grounding instruction (`promptConstants.ts`), notes moved to system prompt (`BaseProvider.ts`), hybrid resume mode (`messageUtils.ts`, `types.ts`, `settings.ts`, `ResumeModeModal.ts`), context window budget trimming (`messageUtils.ts`, all providers, `knownModels.ts`), paragraph-level fallback chunking + raised threshold to 12K + always-include-first-chunk (`noteChunking.ts`), CJK-aware token estimation (`messageUtils.ts`), default effort "high" (`settings.ts`). See ADR-053 |
| 2026-08-17 | #92 resolved: `models/knownModels.ts` unified 5 parallel data structures (`KNOWN_MODELS`, `MODEL_ABBREVIATIONS`, `REASONING_MODELS`, temperature deny-list, effort allow-list) into single `MODEL_CATALOG: ModelInfo[]`; dead `o1`/`o1-mini` entries removed. See ADR-048 |
| 2026-08-17 | #93 resolved: `BaseProvider` made `assistantLabel` and `resolveModel` concrete with defaults; removed redundant overrides from OpenAI/Mistral (`assistantLabel`) and all three providers (`resolveModel`). Added `providerType` field. See ADR-049 |
| 2026-08-17 | #94 resolved: `sidebar.ts`'s `buildUI()` split into `buildHeader()`/`buildChatArea()`/`buildInputArea()`; `DeleteFileModal` extracted to `suggest/DeleteFileModal.ts`; code-block decoration (4 methods) extracted to `ui/CodeBlockDecorator.ts`; `scrollToTop()` helper replaced 3 duplicates. See ADR-050 |
| 2026-08-17 | #95 resolved: `createConversation()` changed from 8 positional params to options object; `createConversationFromTemplate()` and `resolveTemplateContext()` helpers added; dead `cmdCopyConversationLink()` deleted; URI "template" handler fixed (was missing `outputFolder`/`writeMode`). See ADR-051 |
| 2026-08-17 | #96 resolved: `TemplateLoader.ts` prefix-match fixed (`f.path.startsWith(folder)` to `f.path.startsWith(folder + "/")`) — prevented `"templates-archive/"` from matching when folder is `"templates"` |
| 2026-08-17 | #97 resolved: dead code removed — `ConversationStore.hasDirty()`, `main.ts`'s `cmdCopyConversationLink()`, redundant `resolveModel`/`assistantLabel` overrides |
| 2026-08-17 | #98 resolved: 5 missing files added to `vitest.config.ts` coverage include |
| 2026-08-17 | 22-finding codebase audit resolved: AbortController race in BaseProvider, ConversationStore snapshot-based dirty clearing (`clearDirty` → `snapshotDirty`/`clearDirtySnapshot`), writeMode enforcement at tool execution boundary, NavigatorController toggle listener leak, fork field preservation (`contextNotes`, `resumeMode`, `outputFolder`, `writeMode`), TemplateLoader frontmatter validation, i18n lazy locale init, reloadFromDisk now cancels pending persist + resets router API keys + renders empty state, dead code removed (`supportsMistralEffort`, `getActiveConversationId`, `getLastAssistantMessage`, ~120 lines dead CSS, redundant nested `if`), focus-visible accessibility, safe-area CSS fix. See ADR-052 |
| 2026-08-28 | **Release 2.1.1** — `BaseProvider.finishOrError` now preserves a streamed reply on a *post-stream* error: if the model already emitted visible text and then the stream errors (e.g. a transient Anthropic overload), the partial is kept as the assistant turn via `onComplete` + a non-destructive Notice, instead of being discarded via `onError` (`streamingRow.remove()`). Only an error with *no* streamed text still routes to the destructive path. New `tests/BaseProvider.test.ts` (4 cases) + `streamInterruptedPartialKept` i18n (en/de). Fixes a pre-existing fragility surfaced during 2.1.0 testing (a visible Opus 4.8 answer vanishing on a flaky moment); not a decomposition regression — the provider/stream path was byte-identical across the refactor |
| 2026-08-28 | **Release 2.1.0** — structural decomposition (ADR-103/ADR-104): `sidebar.ts` god-object split into 6 `ui/*Controller.ts` controllers (3,735 → 1,992 lines, −47%; render/send loop kept in the view as the coordinator core — #120); `main.ts` split into `services/{SecretStore,PluginDataStore,ConversationService,ViewManager}.ts` with thin plugin facades (951 → ~340 — #121); `appContainer.ts` composition root + `ConversationStore` ownership inversion (#122). Behaviour-preserving; a CI file-size ratchet (`scripts/check-file-size.mjs`) guards regrowth (#123). Verified by tsc/lint/build/434 tests; plugin-lifecycle paths not runtime-tested — smoke-test recommended |
| 2026-08-28 | **Release 2.1.2** — #124 fixed: decomposition regression (2.1.0). The summary "Speisekarte" cards and the context-inspector card stopped rendering on conversation open/switch. PR2/PR3 moved `renderSummaryCards()` and `contextInspector.refresh()` out of `renderMessages`' full-rebuild path (where they run immediately after the `p-summary-cards` / `p-inspector-wrap` containers are created) into `buildUI`, where they were dead no-ops — `buildUI` runs *before* those containers exist, and `refresh()`/`renderSummaryCards()` early-return when the wrap element isn't mounted. Restored both calls to their post-create positions in `renderMessages`; removed the two no-op calls from `buildUI`. Net 0 lines. Regression confirmed against pre-decomposition `renderMessages` (commit 1cab70d, which had `fillContextInspector()`/`renderSummaryCards()` in the same positions) and empirically via a happy-dom harness asserting both surfaces render on open. Verified by tsc/lint/build/438 tests. See #124 |

---

## File Inventory (sorted by lines, v1.19.5)

| # | File | Lines | Role |
|---|------|------:|------|
| 1 | `sidebar.ts` | 2 028 | Main view — UI, rendering, streaming, interaction; `buildUI` split into `buildHeader`/`buildChatArea`/`buildInputArea` |
| 2 | `styles.css` | 1 456 | All plugin CSS |
| 3 | `main.ts` | 908 | Plugin entry, commands, conversation lifecycle, sync watcher; `createConversation` options object |
| 4 | `settings.ts` | 419 | Settings schema + settings tab UI |
| 5 | `services/OpenAIProvider.ts` | 304 | OpenAI streaming (extends BaseProvider); `prepareStream`/`runStreamRound`/`handleToolCalls` |
| 6 | `services/AnthropicService.ts` | 250 | Anthropic streaming (extends BaseProvider); `prepareStream`/`runStreamRound`/`handleToolCalls` |
| 7 | `services/BaseProvider.ts` | 314 | Abstract base: `runStreamLoop` template method, shared fields, lifecycle, concrete `assistantLabel`/`resolveModel` defaults, generate* utilities |
| 8 | `services/ToolHandler.ts` | 118 | Tool definitions + ToolHandler class (injected NoteWriter) |
| 9 | `services/NoteWriter.ts` | 186 | Vault write operations |
| 10 | `services/PromptOptimizerService.ts` | ~170 | Prompt optimizer — `run()` command flow + `optimizeText()` inline review |
| 11 | `ui/OptimizationController.ts` | 171 | Inline optimizer UI state + flow (extracted from sidebar) |
| 12 | `ui/NavigatorController.ts` | 163 | `#` navigator popover (extracted from sidebar) |
| 13 | `ui/InlineSuggest.ts` | 152 | `#` note-path autocomplete in textarea |
| 14 | `services/TemplateLoader.ts` | 95 | Template discovery + frontmatter parsing |
| 15 | `services/messageUtils.ts` | 98 | Shared: parseTitleAndSummary, normalizeMessages, token estimate, lang helpers |
| 16 | `services/LLMRouter.ts` | 72 | Dispatches calls to the active provider |
| 17 | `services/ConversationStore.ts` | 76 | In-memory store + 300 ms debounced persistence + dirty-flag tracking (`markDirty`/`clearDirty`) |
| 18 | `services/ContextBuilder.ts` | 48 | Builds system prompt + attaches vault notes |
| 19 | `services/persistence.ts` | ~100 | Pure functions: `applySettingsMigrations`, `mergeSettings`, `parseConversations`, `shouldRefuseLoad`, `evictConversations` |
| 20 | `models/types.ts` | 78 | All shared TypeScript interfaces |
| 21 | `models/settings.ts` | ~55 | `PythiaSettings` interface + `DEFAULT_SETTINGS` — no Obsidian dependency; importable in tests |
| 22 | `locales/de.ts` / `locales/en.ts` | ~283 | i18n strings (German / English) |
| 23 | `suggest/` | — | Modal dialogs (picker, delete confirm, settings, etc.) |
| — | `ui/CodeBlockDecorator.ts` | 220 | Code-block/diagram decoration (extracted from sidebar): `decorateCodeBlocks`, `stampSvgSize`, `wrapInScrollFrame`, `attachDragToPan` |
| — | `suggest/DeleteFileModal.ts` | 30 | Delete-file confirmation modal (extracted from sidebar) |
| — | `models/knownModels.ts` | 103 | `MODEL_CATALOG: ModelInfo[]` — unified model array with derived exports |
| 24 | `tests/` | — | Vitest unit tests (18 files) |

**Source total:** ~9 000 lines (excl. lock file, generated `main.js`, coverage output).
**Test suite:** 300 tests across 18 files — `npm test` (~2 s), `npm run coverage` with enforced thresholds.
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
| 10 | Harden fire-and-forget in fork path | ✅ Partial — `no-floating-promises` lint rule catches bare floating promises at compile time; remaining fork-specific hardening is Backlog |
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
| 49 | Oversized attached notes inlined whole, no chunking | ✅ `services/noteChunking.ts` — heading-based (with paragraph fallback), relevance-filtered excerpting above 12000 chars |
| 50 | True embedding/vector-similarity note retrieval | Partially addressed — IDF-weighted scoring (below) is a cheaper interim fix for a real excerpting bug; full embeddings remains Open — Backlog if this proves insufficient |
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
| 10 | Harden fire-and-forget in fork path | ✅ Partial — `no-floating-promises` lint | Low | Medium | Backlog (remaining) |
| 42 | `resumeMode` destructive wipe + dead API-level effect | ✅ Done | High | Low | — |
| 43 | Retry on transient rate-limit/network failures | ✅ Done | Medium | Low | — |
| 44 | Anthropic prompt caching | ✅ Done | High | Medium | — |
| 45 | Sampling/temperature control | ✅ Done | Medium | Low | — |
| 46 | Token-budget guard on attached notes | ✅ Done | Medium | Low | — |
| 47 | System-prompt grounding instruction | ✅ Done | Low | Low | — |
| 48 | Relevance-ranked `#` note suggestions | ✅ Done | Medium | Medium | — |
| 49 | Chunk oversized attached notes | ✅ Done | High | Medium | — |
| 50 | True embedding/vector-similarity retrieval | Partial — IDF weighting | High | High | Backlog (full embeddings) |
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
| 88 | Streaming/tool-loop duplicated across three providers (~600 lines) | ✅ Done — BaseProvider template method | High | High | — |
| 89 | ConversationStore persists on every debounce even when nothing changed | ✅ Done — dirty-flag tracking | Medium | Low | — |
| 90 | Sidebar hot-path DOM handlers fire too often (selectionchange, token estimate, textarea resize) | ✅ Done — debounced/rAF | Medium | Low | — |
| 91 | Bare floating promises swallow errors silently; no compile-time guard | ✅ Done — `no-floating-promises: error` + 8 violations fixed | High | Low | — |
| 92 | 5 parallel model data structures in `knownModels.ts` — adding a model requires touching up to 5 lists | ✅ Done — unified `MODEL_CATALOG: ModelInfo[]` | High | Medium | — |
| 93 | `assistantLabel`/`resolveModel` identically overridden in every provider (boilerplate) | ✅ Done — concrete defaults in BaseProvider | Low | Low | — |
| 94 | `buildUI()` is a 380-line monolith; `DeleteFileModal` inline in sidebar; code-block decoration coupled to sidebar | ✅ Done — split into 3 builders + 2 extracted files | Medium | Medium | — |
| 95 | `createConversation` takes 8 positional params; template-handling duplicated; URI handler missing fields | ✅ Done — options object + `createConversationFromTemplate()` | Medium | Medium | — |
| 96 | `TemplateLoader` prefix-match: `"templates"` matches `"templates-archive/"` | ✅ Done — `folder + "/"` guard | Medium | Low | — |
| 97 | Dead code: `hasDirty()`, `cmdCopyConversationLink()`, redundant provider overrides | ✅ Done — removed | Low | Low | — |
| 98 | 5 files missing from vitest coverage include | ✅ Done — added to `vitest.config.ts` | Low | Low | — |
| 99 | LLM response quality audit — 10 findings (shallow prompts, missing budget trimming, heading-only chunking, etc.) | ✅ Done — see ADR-053 | High | Medium | — |

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

---

## New Suggestions (#88–#91) — maintainability/performance audit, 2026-08-17

A senior-engineer audit targeting maintainability and performance, focused on three areas: structural duplication in the streaming/tool-calling loop across providers, redundant persistence writes in ConversationStore, and DOM event handler frequency in the sidebar. Also upgraded ESLint to catch a class of silent failures at compile time.

### #88 — Streaming/tool-calling loop duplicated across three providers

**Files:** `services/BaseProvider.ts`, `services/AnthropicService.ts`, `services/OpenAIProvider.ts`, `services/MistralService.ts` — **Resolved**

All three providers independently implemented the same streaming loop: abort controller setup, tool-round iteration with `MAX_TOOL_ROUNDS` cap, token accumulation, debug logging, and error routing — ~200 lines each, nearly identical in structure, differing only in SDK-specific stream creation/consumption and tool-result formatting.

**Resolution:** Extracted the loop into `BaseProvider.runStreamLoop()` as a template method pattern. `streamMessage` is now a concrete one-liner that delegates to `runStreamLoop`. Providers implement three abstract hooks: `prepareStream` (build messages, resolve tools/model/temperature/effort), `runStreamRound` (create SDK stream, consume chunks, return normalised `RoundResult`), and `handleToolCalls` (extract tool-use blocks, call `onToolCall`, append results). The exported `RoundResult` interface normalises each round's outcome across providers. Net change: ~600 lines of duplicated code eliminated; any future loop change (e.g. new retry strategy, new accounting field) only needs to be made once.

### #89 — ConversationStore persists on every debounce tick even when nothing changed

**File:** `services/ConversationStore.ts` — **Resolved**

`schedulePersist()` unconditionally called the plugin's `persistData()` on every 300 ms debounce tick, even when no conversation had actually been modified since the last write — a redundant JSON serialization + disk write.

**Resolution:** Added a `dirtyIds: Set<string>` field. `save()` adds the conversation's ID to `dirtyIds` before scheduling. `delete()` removes from `dirtyIds`. The `schedulePersist` callback checks `if (this.dirtyIds.size === 0) return` to skip no-op writes. `main.ts`'s `persistData()` calls `conversationStore.clearDirty()` after a successful write; `createConversation()` calls `markDirty(id)` to ensure new conversations are persisted.

### #90 — Sidebar hot-path DOM handlers fire too often

**File:** `sidebar.ts` — **Resolved**

Three event handlers fired more often than their downstream work justified:
1. `selectionchange` — fires on every caret movement; the handler (`handleSelectionChange`) only needs to update the fork-action visibility
2. `input` on the textarea — `updateSendBtnLabel()` runs a token estimate on every keystroke
3. `autoResizeTextarea()` — triggers a forced layout reflow (read `scrollHeight`, write `style.height`) synchronously on every input event

**Resolution:** (1) `selectionchange` handler debounced at 150 ms. (2) Token-estimate update (`updateSendBtnLabel`) debounced at 250 ms; `autoResizeTextarea` and `inlineSuggest.handleInput` still fire immediately since they're user-facing. (3) `autoResizeTextarea` wrapped in `requestAnimationFrame` to batch the forced reflow with the browser's next paint, avoiding layout thrashing when multiple input events fire in the same frame.

### #91 — Bare floating promises swallow errors silently; no compile-time guard

**Files:** `eslint.config.mjs`, `sidebar.ts`, `main.ts` — **Resolved**

Eight bare floating promises across `sidebar.ts` and `main.ts` — async calls whose rejections were silently swallowed because no `.catch()` or `await` captured them. Without a lint rule, new instances would keep appearing.

**Resolution:** Enabled `@typescript-eslint/no-floating-promises: ["error", { ignoreVoid: true }]` in `eslint.config.mjs`, requiring typed linting (`projectService: true`, `tsconfigRootDir: import.meta.dirname`). Fixed the 8 existing violations by prefixing intentional fire-and-forget calls with `void` (e.g. `void this.sendMessage()`, `void workspace.revealLeaf(leaf)`). This partially addresses #10 (fire-and-forget hardening in the fork path) — bare floating promises are now a compile-time error everywhere, not just in the fork path.

---

## New Suggestions (#92–#98) — engineering review implementation, 2026-08-17

A focused implementation session resolving structural findings from the engineering review: model-catalog unification, BaseProvider simplification, sidebar decomposition, `createConversation` API cleanup, a TemplateLoader prefix-match bug, dead code removal, and coverage config. Full rationale in `docs/decisions.md` ADR-048 through ADR-051.

### #92 — 5 parallel model data structures in `knownModels.ts`

**File:** `models/knownModels.ts` — **Resolved**

Adding a model required updating up to 5 independent data structures (`KNOWN_MODELS`, `MODEL_ABBREVIATIONS`, `REASONING_MODELS`, `ANTHROPIC_NO_TEMPERATURE_MODELS`, `ANTHROPIC_EFFORT_MODELS`) with no compiler signal if one was missed — the exact bug class behind #51 and #86.

**Resolution:** Unified into `MODEL_CATALOG: ModelInfo[]`. Each entry carries `id`, `provider`, `abbreviation`, and boolean flags (`noTemperature`, `supportsEffort`, `isReasoning`, `isMistralReasoning`, `hidden`). All existing exports computed from the catalog. Dead `o1`/`o1-mini` entries removed.

### #93 — `assistantLabel`/`resolveModel` boilerplate across providers

**Files:** `services/BaseProvider.ts`, `services/AnthropicService.ts`, `services/OpenAIProvider.ts`, `services/MistralService.ts` — **Resolved**

Three providers identically implemented `resolveModel()` (one-liner delegating to `resolveDefaultModelForProvider()`), and two of three returned `"Assistant"` from `assistantLabel`.

**Resolution:** Both made concrete in `BaseProvider` with default implementations. `providerType: Provider` field added to the constructor. Only `AnthropicService` overrides `assistantLabel` (returns `"Claude"`). Redundant `resolveModel` overrides removed from all three providers.

### #94 — `buildUI()` monolith; inline modal; coupled code-block decoration

**Files:** `sidebar.ts`, `suggest/DeleteFileModal.ts` (new), `ui/CodeBlockDecorator.ts` (new) — **Resolved**

`buildUI()` was ~380 lines of sequential DOM construction. `DeleteFileModal` was defined inline in `sidebar.ts` (violating the project rule that all modals go in `suggest/`). Code-block decoration (4 methods) was tightly coupled to the view despite having no view-state dependencies.

**Resolution:** `buildUI()` split into `buildHeader()`, `buildChatArea()`, `buildInputArea()`. `DeleteFileModal` extracted to `suggest/DeleteFileModal.ts`. Code-block decoration extracted to `ui/CodeBlockDecorator.ts` with 4 exported functions (`decorateCodeBlocks`, `stampSvgSize` (renamed from `fixDiagramSvgSize`), `wrapInScrollFrame`, `attachDragToPan`). `scrollToTop()` helper replaced 3 duplicate blocks.

### #95 — `createConversation` positional parameters; duplicated template handling

**Files:** `main.ts`, `services/PromptOptimizerService.ts` — **Resolved**

`createConversation()` took 8 positional parameters with `undefined` gaps at most call sites. Template-to-conversation mapping was duplicated. The URI "template" handler was missing `outputFolder` and `writeMode`.

**Resolution:** Changed to options object. Added `createConversationFromTemplate()` helper (DRY template handling). Added `resolveTemplateContext()` private helper. Deleted dead `cmdCopyConversationLink()`. URI handler bug fixed as a consequence of using the shared helper.

### #96 — TemplateLoader prefix-match bug

**File:** `services/TemplateLoader.ts` — **Resolved**

`f.path.startsWith(folder)` matched `"templates-archive/"` when the configured folder was `"templates"`.

**Resolution:** Changed to `f.path.startsWith(folder + "/")`. Regression test added in `tests/TemplateLoader.test.ts`.

### #97 — Dead code across multiple files

**Files:** `services/ConversationStore.ts`, `main.ts`, provider files — **Resolved**

`ConversationStore.hasDirty()` was unused. `cmdCopyConversationLink()` was dead. Provider `resolveModel`/`assistantLabel` overrides were now redundant after #93.

**Resolution:** All removed.

### #98 — 5 files missing from vitest coverage include

**File:** `vitest.config.ts` — **Resolved**

Coverage thresholds could be met without covering 5 source files because they weren't listed in the `include` array.

**Resolution:** Added the missing files. Test suite now 300 tests across 18 files.

---

## New Suggestion (#99) — LLM response quality audit, 2026-08-17

A structured audit of LLM response quality identified 10 areas where the plugin's defaults, prompt engineering, and context management produced shallower-than-necessary responses. All 10 implemented in a single pass.

### #99 — LLM response quality: 10-finding implementation

**Files:** `services/promptConstants.ts`, `services/ContextBuilder.ts`, `services/BaseProvider.ts`, `services/messageUtils.ts`, `services/noteChunking.ts`, `models/knownModels.ts`, `models/types.ts`, `models/settings.ts`, `settings.ts`, `suggest/ResumeModeModal.ts`, `services/TemplateLoader.ts`, `services/AnthropicService.ts`, `services/OpenAIProvider.ts`, `services/MistralService.ts`, `locales/en.ts`, `locales/de.ts`, `main.ts` — **Resolved**

Ten findings:
1. Empty default system prompt → `DEFAULT_SYSTEM_PROMPT` with explicit depth instructions
2. Passive one-line grounding instruction → structured `GROUNDING_INSTRUCTION` (synthesize, cite, analyze, flag gaps)
3. Notes buried in user message → moved to system prompt for stable reference
4. No hybrid resume mode → `"hybrid"` sends summary + last 6 messages
5. No context window budget enforcement → `trimHistoryToBudget()` + per-model `contextWindow` values in `knownModels.ts`
6. Heading-only chunking → paragraph-level fallback for heading-less notes
7. Chunk threshold too low (4K) → raised to 12K
8. No first-chunk inclusion → always keep first chunk for framing context
9. Flat ÷4 token estimation → CJK-weighted heuristic (ASCII ÷4, non-ASCII ÷1.5)
10. No default effort → `DEFAULT_SETTINGS.effort = "high"`

See ADR-053.

---

## New Feature (#100) — favorites become highlighted text spans, 2026-08-23

Favorites were whole-message references toggled by a per-message ☆ star. This feature replaces them with span-level highlight favorites: the user selects text, favorites it from the selection toolbar, the span stays visibly highlighted, and the navigator lists it by its first words and jumps to the exact start.

### #100 — Highlight-favorites

**Files:** `models/types.ts`, `ui/HighlightPainter.ts` (new), `sidebar.ts`, `ui/NavigatorController.ts`, `services/persistence.ts`, `styles.css`, `locales/en.ts`, `locales/de.ts`, `tests/HighlightPainter.test.ts` (new), `tests/persistence.test.ts` — **Resolved**

- `Favorite` model extended with `text`/`occurrenceIndex`/`id`/`createdAt`; span text (not offsets) is stored because the markdown body is re-rendered.
- `ui/HighlightPainter.ts` re-finds and paints highlights (`findRange`, `paintRange` splitting across element boundaries, `repaintBody`, `flashHighlight`), re-applied after every render.
- Per-message star removed; "Favorite" action added to the selection toolbar; overlapping selection toggles a favorite off.
- Navigator "Starred" → "Favorites": lists by first words, hover ✕ to delete, jumps to the span (`scrollToFavorite`).
- Legacy favorites migrated by `normalizeFavorites` (assigns ids, preserves them, jumps to message top).
- Tests: 17 `HighlightPainter` cases (happy-dom) + 5 migration cases. New `happy-dom` dev dependency for DOM-based UI tests.

**Backlog note:** `sidebar.ts` remains excluded from vitest coverage (per #98's rationale) — the new highlight logic that lives there (`onFavoriteSelection`, `scrollToFavorite`) is exercised only indirectly via the extracted, tested `HighlightPainter` helpers.

---

## New Feature (#101) — summarize a conversation's favorites, 2026-08-23

Turns a conversation's favorites (the user's hand-picked insights) into a synthesis that increases retention and yields actionable outcomes.

### #101 — Summarize favorites

**Files:** `models/types.ts`, `services/messageUtils.ts`, `services/BaseProvider.ts`, `services/LLMProvider.ts`, `services/LLMRouter.ts`, `services/NoteWriter.ts`, `suggest/FavoritesSummaryModal.ts` (new), `ui/NavigatorController.ts`, `sidebar.ts`, `main.ts`, `locales/en.ts`, `locales/de.ts`, `tests/messageUtils.test.ts`, `styles.css` — **Resolved**

- `buildFavoritesDigest(conversation)` (pure, unit-tested): pairs each favorite with its preceding user question, ordered by message position; `fav.text` for spans, full content for legacy favorites; `""` when empty.
- `generateFavoritesSummary` on `BaseProvider` (routed via `LLMRouter`/`LLMProvider`): conversation model, 1536 max tokens, fixed `## Key learnings` + `## Action items` (checkbox) format.
- `FavoritesSummaryModal`: rendered Markdown + Copy / Save-to-note / Regenerate; result cached on `Conversation.favoritesSummary`.
- Triggers: ✦ in the navigator Favorites header + `Pythia: Summarize favorites` command (also in the command hub).
- Note sink: `NoteWriter.saveFavoritesSummaryNote` (mirrors `saveSummaryNote`).
- Tests: 6 `buildFavoritesDigest` cases (order, span-vs-legacy, context inclusion, missing-message skip, empty → "").

---

## Bug fixes (#102) — highlight-favorite interactions, 2026-08-23

Three issues reported against the 1.27.0 highlight-favorites UX.

### #102 — Tap-to-unfavorite, color stability, single-tap jump

**Files:** `sidebar.ts`, `ui/HighlightPainter.ts`, `ui/NavigatorController.ts`, `locales/en.ts`, `locales/de.ts`, `tests/HighlightPainter.test.ts` — **Resolved**

- **Couldn't unfavorite by tapping:** tap inside a highlight now selects its span (`onMessageClick` + `rangeForHighlight`) and shows the toolbar with the button relabeled **Unfavorite** (`setFavButtonMode`/`tappedFavId`). Drag always adds (overlaps allowed); the old drag-anchored-in-mark auto-remove was removed.
- **Highlight color removed:** removal is surgical (`removeHighlightById` unwraps only the target's marks) instead of clear-all-then-repaint, so other highlights are never dropped; `repaintFavorites` clears the last stale mark.
- **Two-tap jump:** navigator closes the popover then defers `scrollToFavorite` to `requestAnimationFrame`, which expands a collapsed bubble (`expandBubbleIfCollapsed`) before measuring.
- **Toolbar reordered:** Copy · Favorite/Unfavorite · Branch · Insert · Inbox.
- Tests: 6 new `removeHighlightById` / `rangeForHighlight` cases (happy-dom).

---

## Feature rework (#103) — summaries as top-of-conversation cards, 2026-08-23

Both summaries are now surfaced identically as collapsible cards at the top of the conversation, generated from one place.

### #103 — Summary "Speisekarte" cards + long-press Send menu

**Files:** `sidebar.ts`, `ui/NavigatorController.ts`, `main.ts`, `models/settings.ts`, `settings.ts`, `suggest/FavoritesSummaryModal.ts` (**deleted**), `styles.css`, `locales/en.ts`, `locales/de.ts` — **Resolved**

- Long-press Send → Obsidian `Menu` (Summarize Conversation / Summarize Favorites; latter disabled with no favorites); sole generation entry point.
- `renderSummaryCards`/`buildSummaryCard`/`revealSummaryCard` render collapsible `.p-summary-card`s prepended to `.p-chat`; `IntersectionObserver` auto-collapses on scroll-out; expanded body has Copy + Save-to-note.
- Removed the pinned summary panel + sparkle/refresh icons, the `FavoritesSummaryModal`, the `autoSaveSummary` setting + on-close generation, and `main.ts`'s note-injection auto-summary.
- Nav Favorites label links to the favorites card (greyed when none); per-highlight jumps unchanged.
- Resume-summary/fork still populate `summaryText` (may surface a card) — accepted.
- No new pure helpers; existing 333 tests still pass.

---

## Change (#104) — saved-summary note frontmatter, 2026-08-23

### #104 — LLM Note type + resume link, no pythia tag

**Files:** `services/NoteWriter.ts`, `tests/NoteWriter.test.ts` — **Resolved**

When a user saves a summary (conversation or favorites) from a summary card, the written note's frontmatter now:
- uses `type: "LLM Note"` (was `pythia-conversation` / `pythia-favorites`),
- carries a clickable `source:` deep link (`obsidian://pythia?vault=…&cmd=resume&id=<id>`, via new `resumeUri` helper — same URI pattern as `appendConversationSlice`) that reopens Pythia with the conversation active,
- no longer writes `tags: [pythia]`.

Tests updated for `saveSummaryNote` and a new `saveFavoritesSummaryNote` case.

---

## New Feature (#105) — fork branch-back, 2026-08-23

Closes the fork↔source loop so users don't lose track of side-explorations.

### #105 — Fork summaries anchored at their origin snippet

**Files:** `models/types.ts`, `main.ts`, `services/ContextBuilder.ts`, `ui/HighlightPainter.ts`, `sidebar.ts`, `styles.css`, `locales/en.ts`, `locales/de.ts`, tests — **Resolved**

- Source paints each forked snippet as `mark.p-fork-origin` (accent) via `repaintForkOrigins`; `paintRange` generalized with class/attr params.
- Tapping expands an inline `.p-fork-anchor` (fork's favorites → conversation summary → on-demand "Summarize fork") + "Open fork"; fork wins over favorites; one open at a time.
- Fork banner link returns to + expands the origin anchor (`revealForkOrigin`).
- `forkedFromOccurrenceIndex` captured at fork time; source summary moved to `forkedFromSummary` (context via `ContextBuilder`, `summaryText ?? forkedFromSummary`), decoupled from the fork's own summary.
- Tests: painter class/attr + `repaintForkOrigins`/`rangeForForkOrigin` (happy-dom); `ContextBuilder` fallback/precedence. 341 total pass.

### #106 — Fork anchor generate-summary menu

**Files:** `sidebar.ts`, `styles.css`, `locales/en.ts`, `locales/de.ts` — **Resolved**

- Long-press on the anchor's "Open fork" button opens a menu (`.p-fork-menu`, reusing `.p-send-menu`) mirroring the Send-button long-press; short press still opens the fork (`suppressNextForkOpen`).
- Items: "Summarize conversation" (always; disabled when the fork has no messages) and "Summarize favorites" (offered only when the fork carries favorites — hidden, not disabled).
- `buildForkAnchor(anchor, fork, preferType?)` re-renders showing the summary type just generated; otherwise favorites-preferred (ADR-058 precedence).
- Standalone "Summarize fork" button removed (single generate/regenerate control); `summarizeForkBtn` i18n key removed. 341 tests still pass.

### #107 — Previous-conversation summary ignored by the model

**Files:** `services/promptConstants.ts`, `services/ContextBuilder.ts`, `tests/ContextBuilder.test.ts` — **Resolved**

- **Symptom:** a fork of a topic-scoped conversation (e.g. "technological revolutions") answered follow-ups in the generic sense ("all revolutions of Germany" → cultural/political), ignoring the source context.
- **Root cause:** the `<previous_conversation_summary>` block was injected with no instruction (attached notes get `GROUNDING_INSTRUCTION`; the summary got nothing), so the model treated it as background. The summary *was* reaching the model — a framing gap, not a plumbing gap.
- **Fix:** added `PRIOR_SUMMARY_INSTRUCTION`, prepended to the block in `buildSystemPrompt`; the model now treats the summary as governing context (stay within its topic/scope unless the user changes subject). Applies to both forks and resume-summary conversations.
- Tests: framing instruction present with a summary / absent without one; exact-join assertion updated. 343 total pass.

### #108 — Summary prompts wrote meta-narration unsuited to inline display

**Files:** `services/BaseProvider.ts` — **Resolved**

- **Symptom:** summaries shown inline (summary cards, fork anchor) opened with "This conversation is…" / "We discussed…", which reads as a description of a chat rather than standalone content.
- **Root cause:** the summary-generation prompts predate inline display — framed as "summarize this conversation for future reference" and banned only a "Summary of…" heading, not the meta opener.
- **Fix (ADR-061):** content-first prompts. Conversation summary leads with the subject matter and bans the meta openers explicitly; favorites summary states each bullet as a direct fact and may omit an empty `## Action items` section. Prompt-only; existing summaries unchanged until regenerated.

### #109 — Low max-tokens silently truncates replies on reasoning models

**Files:** `sidebar.ts`, `styles.css`, `locales/en.ts`, `locales/de.ts` — **Resolved**

- **Symptom:** after switching a conversation onto a reasoning model, replies could come back truncated or empty when a small per-conversation `maxTokens` was set — the reasoning budget is spent before visible output, and the model-appropriate default only applies when `maxTokens` is unset.
- **Fix (ADR-063):** a warning icon (`.p-send-hint`) appears beside the Send button when the model is a reasoning model and the effective max-tokens is below `DEFAULT_MAX_TOKENS_REASONING`; tooltip explains the risk, click opens the settings modal. Refreshed via `updateSendHint()` from `updateModelBadge()`. UI-only + one i18n key.

### #110 — Obsidian core CSS overrode plugin marks (yellow forks) and controls (grey buttons)

**Files:** `styles.css` — **Resolved**

- **Symptom:** (a) the fork-origin highlight rendered yellow no matter what color we set; (b) on desktop only, every plugin button and input had a grey background.
- **Root cause (shared):** Obsidian's own selectors out-specify the plugin's. `mark.p-fork-origin` (0,1,1) only tied `.markdown-rendered mark` (0,1,1), which loads later and won (favorites masked it — same `--text-highlight-bg` token). Desktop `app.css` styles `button:not(.clickable-icon)` / `input` / `textarea` grey at (0,1,1), beating the plugin's (0,1,0) `all: unset` component rules; mobile lacks that rule.
- **Fix (ADR-065):** scope the mark rules as `.pythia-view mark.…` (0,2,1); extend the reset to `button/input/textarea` with `background-color: transparent` (0,1,1, loaded after core), and restore the send button's accent fill at (0,2,0). CSS-only. Documented the general rule: view chrome must be scoped under `.pythia-view` to out-rank Obsidian core.

---

## New Suggestions (#120–#123) — structural decomposition roadmap, 2026-08-27

Prompted by a side-by-side comparison with the obsidian-similarity plugin. Pythia leads on process (PR CI, breadth of tests, docs/ADRs, the `BaseProvider`/`LLMRouter` provider abstraction) but trails on one dimension: **uniform structural discipline**. `sidebar.ts` (3,735 lines, ~105 methods) and `main.ts` (951 lines) are god-objects, and nothing stopped them re-growing. This roadmap closes that gap the way the repo already closed it in the `services/` layer and in `NavigatorController`/`OptimizationController`: extract cohesive clusters into `Deps`-driven controllers, one behaviour-preserving PR at a time, with a CI guardrail so the monoliths can only shrink. Full rationale and the rejected alternatives are in ADR-103. (Drafted as #119–#122 pre-merge; renumbered to #120–#123 after `main` claimed #119 for the deferred task-first model picker.)

### #120 — Decompose `sidebar.ts` into `Deps`-driven controllers

**Files:** `sidebar.ts`, new `ui/*Controller.ts` — **Complete (PR0 seam + PR1–PR6 controllers landed; `sidebar.ts` 3,735 → 1,992, −47%)**

**Closed at PR6.** The render loop (`renderMessages`/`appendMessageBubble`/`createStreamingBubble`) and the send loop (`sendMessage`) deliberately stay in the view: they are the coordination *between* the extracted controllers (they create the per-render `inspectorEl`/`summaryCardsEl` containers, drive the incremental-vs-full render decision, and share mutable state like `lastRenderedMsgId`), i.e. exactly the "thin coordinator" ADR-103 describes. Extracting them further would trade real render-ordering risk (unverifiable without an Obsidian runtime) for little gain, so PR7 (TranscriptRenderer) and PR8 (Composer/Send) were consciously **not** done. The view is now a coordinator: lifecycle (`onOpen`/`onClose`/`buildUI`), `setActiveConversation`, the render/send loop, and controller wiring.

**PR6 (HeaderController):** extracted the header chrome — the header row (`buildHeader`→`mount`), `renderHeader`, the model badge + anchored model popover (`updateModelBadge`/`openModelPopover`/`applyModelChoice`/`onModelBadgeClick`/`fmtWindow`), the inline rename flow (`enterRenameMode`/`exitRename`/`onRenameLLM`), and the copy-deep-link action — into `ui/HeaderController.ts`. The header creates two elements other controllers consume, so the controller exposes `getConvNameEl()` (HistoryController's outside-click) and `getChipEl()` (ContextInspectorController's percent chip); History/ContextInspector/send-hint are reached through deps (all lazy, so mutual references across construction order are fine). The still-in-view `updateSendHint`/`updateResearchButton`/`toggleResearchMode` (Composer) stay; `updateModelBadge` calls `updateSendHint` via a dep. Dead `getLang`/`goodForModel`/`ConversationSettingsModal`/`MODEL_CATALOG`/`ModelInfo` imports dropped from `sidebar.ts`. Behaviour-preserving: `sidebar.ts` 2,339 → 1,992 lines (**now under 2,000; −47% from the original 3,735**), ratchet ceiling lowered to 1,992; build + 434 tests green.

**PR5 (SelectionController):** extracted the largest cluster — the floating text-selection toolbar (Copy/Favorite/Branch/Insert/Inbox) and span-favorites (`onFavoriteSelection`/`removeFavorite`/`repaintFavorites`/`scrollToFavorite`/`favoriteLabel`), the selection-change + tap-a-highlight handlers (`handleSelectionChange`/`setFavButtonMode`/`onMessageClick`), the copy/insert/inbox actions, and fork-from-selection (`onForkConversation`) — into `ui/SelectionController.ts`. A `mount(container)` method builds the toolbar and wires the selection listeners (via a passed `registerDomEvent`, since the controller isn't a `Component`); the controller now owns **all** HighlightPainter usage, so the entire `HighlightPainter` import and the now-unused `Favorite` type were dropped from `sidebar.ts`. Cross-links stay as deps: `NavigatorController`'s `scrollToFavorite`/`removeFavorite` and the render-path `repaintFavorites` call public methods; a fork-origin tap routes into `ForkController.toggleForkAnchor`; `expandBubbleIfCollapsed` (Transcript) and `getLastMarkdownView` are passed in. Behaviour-preserving: `sidebar.ts` 2,773 → 2,339 lines (−37% from the original 3,735), ratchet ceiling lowered to 2,339; build + 434 tests green.

**PR4 (ForkController):** extracted the fork-origin *display* — the "branched from…" banner (`renderForkBanner`), the painted origin marks (`repaintForkOrigins` over HighlightPainter), and the inline anchor those marks open (`toggleForkAnchor`/`buildForkAnchor`/`attachForkLongPress`/`openForkMenu`/`generateForkSummary`/`revealForkOrigin`) — into `ui/ForkController.ts`. Because the controller isn't an Obsidian `Component`, the view's `registerDomEvent` is passed as a dep (keeping long-press listener auto-cleanup); markdown rendering goes through a callback; the fork's favorites-summary reuses `SummaryController.runFavoritesSummary` via a dep. `toggleForkAnchor` is public because the still-in-view `onMessageClick` (Selection cluster) taps into it. **Creating a fork from a selection (`onForkConversation`) deliberately stays in the view** — it operates on the selection toolbar and moves with the Selection cluster (PR5). Dead `repaintForkOrigins`/`formatSummaryTimestamp`/`debugLog` imports dropped from `sidebar.ts`. Behaviour-preserving: `sidebar.ts` 3,057 → 2,773 lines, ratchet lowered to 2,773; build + 434 tests green.

**PR3 (ContextInspectorController):** extracted the context-budget bar + header percent chip (`updateContextBar`) and the expandable inspector card (`fillContextInspector`→`refresh`, `revealContextInspector`→`reveal`, `fmtTok`) into `ui/ContextInspectorController.ts`. Notably **constructed once per view** rather than per buildUI, so its `inspectorOpen` state survives a rebuild — it reads the bar/chip/wrap DOM handles through getters, so a long-lived controller still sees the current elements. `lastTokenUsageMsg`, `scrollToTop`, and `renderReferencePills` stay in the view (shared with other clusters) and are passed as callbacks; the budget-tight "Zusammenfassen" action calls back through an `onSummarize` dep into the SummaryController. Dead `buildSystemPrompt`/`getContextWindow` imports dropped from `sidebar.ts`. Behaviour-preserving: `sidebar.ts` 3,219 → 3,057 lines, ratchet ceiling lowered to 3,057; build + 434 tests green.

**PR2 (SummaryController):** extracted the second cluster — the top-of-conversation summary "Speisekarte" cards (`renderSummaryCards`/`buildSummaryCard`/`setSummaryCardOpen`/`revealSummaryCard`/`onSaveSummaryToNote`/`goToFavoritesSummary`) and the LLM summary-generation flows (`generateConversationSummary`/`summarizeFavorites`/`runFavoritesSummary`) — into `ui/SummaryController.ts`. The view still creates the cards container (so it keeps its DOM position between the fork banner and the messages) and passes it via `getCardsEl`; the controller owns the auto-collapse `IntersectionObserver` (disposed by the view on teardown) and renders markdown through a `renderMarkdown` callback so it stays free of the `Component` concern. Callers rewired: the Send long-press menu, the context-inspector "summarize" button, the `NavigatorController.goToFavoritesSummary` dep, and the fork anchor's favorites-summary reuse (`runFavoritesSummary` is public for it). `main.ts`'s `view.summarizeFavorites()` keeps a thin view facade. `formatSummaryTimestamp` moved from `sidebar.ts` to `services/messageUtils.ts` (shared with the still-in-view fork anchor meta line). Behaviour-preserving: `sidebar.ts` 3,403 → 3,219 lines, ratchet ceiling lowered to 3,219; build + 434 tests green.

**PR1 (HistoryController):** extracted the first cluster — the quick switcher (title dropdown), the full-panel history overlay, and the shared delete-with-confirm flow — into `ui/HistoryController.ts` (`openQuickSwitcher`, `openHistoryView`, `handleDeleteConversation`, plus private `deleteConversationWithConfirm`/`formatConvDate`/`historyBucket` and the two popover-teardown fields). Follows the `NavigatorController` pattern (a `Deps` interface with the plugin, `getContainer`/`getConvNameEl` view handles, and `getConversation`/`isStreaming`/`setActiveConversation`/`renderHeader` callbacks); the view closes it on rebuild/unload via `historyController.close()`. `abbreviateModel` (needed by both the view and the controller) moved from `sidebar.ts` to `models/knownModels.ts` next to `MODEL_ABBREVIATIONS`. Behaviour-preserving: `sidebar.ts` 3,735 → 3,403 lines, ratchet ceiling lowered to 3,403; build + 434 existing tests green. The full plan and remaining clusters:

`PythiaSidebarView` mixes header/model/rename chrome, summary cards + context inspector, fork anchors/menus, selection + favorites, message rendering + delete-last-exchange, the input composer, quick-switcher/history, and the 270-line `sendMessage` send/stream orchestration. Extract in risk-ascending order into controllers following the existing `NavigatorController` pattern (a `Deps` interface carrying the plugin, the specific DOM elements, and callbacks into the view), leaving thin delegating facades for methods `main.ts` calls (`attachNoteToInput`, `prefillInput`, `triggerAutoPrompt`, `scrollToMessage`, `summarizeFavorites`, `handleDeleteConversation`, `onCopyConversationLink`, `getActiveConversation`) so `main.ts` is untouched per PR. Planned clusters: ~~HistoryController~~ (landed, PR1) → ~~SummaryController~~ (landed, PR2) → ~~ContextInspector~~ (landed, PR3) → ~~ForkController~~ (landed, PR4) → ~~SelectionController~~ (landed, PR5) → ~~HeaderController~~ (landed, PR6). TranscriptRenderer + Composer/SendController (the render/send loop) intentionally kept in the view as the coordinator core — see the closure note above. After this, the view is a thin coordinator (lifecycle + `setActiveConversation` + wiring). **PR0** lifted the first tested seam of the `sendMessage` target: `services/sendPolicy.ts` (`shouldGenerateTitle`, `shouldGenerateChapterName`) with `tests/sendPolicy.test.ts`.

### #121 — Decompose `main.ts` (god-plugin) into focused services

**Files:** `main.ts`, new `services/{SecretStore,PluginDataStore,ConversationService,ViewManager}.ts` — **Resolved**

Extracted the four services: `SecretStore` (`setApiKey`/`setOpenAIKey`/`setMistralKey`/`setSearchKey`/`hasApiKeyFor`); `PluginDataStore` (`loadPluginData`/`saveSettings`/`saveConversations`/`persist`/`watchDataJson`/`reloadFromDisk` + the `saveDataRecordTime` own-write stamp and the `legacyDecrypt` migration helper — the I/O shell around the already-pure `services/persistence.ts`); `ConversationService` (`createConversation`/`createConversationFromTemplate`/`resolveTemplateContext`/`renameConversationFile` + all `cmd*` handlers); and `ViewManager` (`initLeaf`/`activateView`/`getSidebarView`). Each takes the plugin and reads its fields; `onload` constructs `PluginDataStore` first (so `loadPluginData` populates `settings`/`conversations`/keys before the provider services read them), then the rest, preserving the original construction order. The plugin keeps **thin one-line facades** for the public API that settings.ts, the sidebar controllers, `ConversationStore`, `PromptOptimizerService`, and the tests call (`setApiKey*`, `saveSettings`/`saveConversations`, `createConversation*`, `renameConversationFile`, `cmdNewConversation`/`cmdForkConversation`, `activateView`, `hasApiKeyFor`); internal-only methods are called via the service in `onload`. **`main.ts` 951 → 348 lines** (under the 600 default — dropped from the ratchet). Verified by tsc + lint + build + 434 tests; **not runtime-tested in Obsidian** (no runtime available here) — a smoke-test on load is recommended.

### #122 — `AppContainer` composition root; invert `ConversationStore` ownership

**Files:** new `appContainer.ts`, `main.ts`, `services/ConversationStore.ts`, `tests/ConversationStore.test.ts` — **Resolved (ADR-104)**

Added `appContainer.ts` as the single composition root. Because `loadPluginData()` must run before the provider services are constructed (they read the decrypted keys), the root is an **async factory** `AppContainer.create(plugin)` — it builds `PluginDataStore` → loads → the providers/router/loaders/stores/services in the original order, exposing them as `readonly` fields. The plugin keeps `plugin.llmRouter` / `plugin.pluginDataStore` / … working via **getters** delegating to `this.container`, so none of the many `this.plugin.X` call sites across the controllers changed (zero ripple). `onload` shrinks to `new ConversationStore(this)` + `this.container = await AppContainer.create(this)` + register view/commands/events. **Ownership inverted:** `ConversationStore` now holds `private _conversations` and is the sole owner (`getAll()` live array, `setAll()` replaces it); `plugin.conversations` is a `get`/`set` accessor delegating to it — the bidirectional coupling is gone. `ConversationStore` stays a **direct** plugin field (not container-built) so it exists before `loadPluginData` writes to it. Tests updated to seed via `store.getAll()`. Extends #11 and #94. Verified by tsc + lint + build + 434 tests; **plugin lifecycle not runtime-tested here** — smoke-test recommended. See ADR-104.

### #123 — File-size ratchet guard + per-controller unit tests

**Files:** `scripts/check-file-size.mjs`, `.github/workflows/ci.yml`, `package.json`, `tests/*` — **Resolved (guard); ongoing (tests)**

**Resolution (guard):** added `scripts/check-file-size.mjs` — a 600-line default budget for every `.ts`, with explicit grandfathered ceilings for `sidebar.ts` (3,735) and `main.ts` (951) that act as a ratchet (each #120/#121 extraction must lower the matching number, never raise it). Wired into CI as a `Check file-size budget` step ahead of the build, and exposed as `npm run check:filesize`. A new file over the default, or a grandfathered file grown past its ceiling, fails CI. **Ongoing:** each extracted controller (#120) becomes unit-testable in isolation for the first time — capture that as its cluster lands, bringing the UI surface toward the coverage the `services/` layer already has.
