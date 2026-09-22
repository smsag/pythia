# Engineering Review — Pythia

*Updated: 2026-09-22 — **#366: `main.ts` was at exactly its 600-line ceiling.** Not a bug — a deadline: the next line anyone added would have failed CI and forced an unplanned split. Three blocks moved out behind structural host interfaces (ADR-205): the whole embedding surface (`services/embedding/EmbeddingHub.ts`), the vault watcher (`services/vaultWatcher.ts`) and the deep-link handler (`services/deepLink.ts`). The point was not the lines: `main.ts` is excluded from coverage by design, so every rule that had drifted into it — "a model change tears down both index services", "a path is changed or deleted, never both", "every deep-link failure says something" — was a rule nothing could fail on. 600 → 400 lines, +56 tests, 29/29 mutations killed.*

*Previously updated: 2026-09-22 — **#358–#362: a read-back review of the indexing work.** Two defects and three improvements found by reading ADR-199..202 rather than from the device: one failed load paused the whole index and hammered the provider (#358), a phone dropped the edits made before its first send (#360), a manual build reloaded a healthy model (#359), the status line re-read a multi-MB index file for its 64-byte header (#361), and the related-conversations sync was invisible to the model residency (#362). Whether a build runs is now one pure, table-tested decision (ADR-203).*

*Previously updated: 2026-09-22 — **#357: Build now and Rebuild index after a failed load.** Reported on the iPhone right after 2.25.0 arrived: "Abgebrochen – Speicher ausgegangen", and both buttons "completely unresponsive". The provider memoizes a failed load for the session, so a manual retry failed in a millisecond and the status never changed; Rebuild index cleared the index *before* that instant failure. A manual retry after a failure now resets the provider and really loads; Rebuild clears only once the model has loaded; the out-of-memory text says to close Obsidian completely (an in-app plugin reload keeps the old model's memory on iOS); the out-of-date text says a folder change keeps what is indexed.*

*Earlier: 2026-09-22 — **#356: the data.json watcher reloaded itself every few seconds.** A reload of an unchanged file is all ties; `mergeConversations` counted ties as newer in memory, `loadPluginData` then marked every conversation dirty, the flush rewrote the whole file, and the watcher's 3 s own-write window lost to its 5 s poll — so the write read as the next external change. Ties no longer count (`newerInMemory`), only those ids are marked dirty, and the watcher absorbs the mtime of its own writes.*

*Previously updated: 2026-09-22 — **#353–#355: switching apps on iOS (ADR-202).** #353 — the model-load and request timeouts were wall-clock, so returning after a long background absence during a download failed the load for the session. #354 — a build killed while backgrounded counted as a crash; two app switches paused indexing. #355 — the idle model kept ~400 MB resident, making Obsidian the app iOS ends first; a phone now releases it on hide and after 3 min idle and preloads it on return and on input focus.*

*Previously updated: 2026-09-22 — **#349–#352: review fixes to ADR-199/200 (ADR-201).** #349 — a phone-written row for non-Latin text was reused by the desktop forever; rows now carry whether the variant could reproduce them. #350 — a paused guard over a complete index read "Ready" with vault context dead and *Build now* disabled. #351 — `mergeSettings` accepted the variant id as a stored choice. #352 — the status read "0 of 0 notes" through the model load.*

*Previously updated: 2026-09-22 — **#348: the phone gets its multilingual model back (ADR-200).** #344's English substitution traded away cross-language matching on the phone. Measured where the memory goes (the 250k-piece vocabulary: 153 MB of JS heap for the tokenizer, 332 MB of WASM heap for the embedding table; the transformer itself ~22 MB), surveyed the leaner multilingual models (none has a smaller vocabulary and a transformers.js build), and pruned this model's vocabulary to Latin script: vectors identical for Latin-script text, ≈ +370–400 MB on the iPhone. Published as a fork, built by `scripts/prune-embedding-model.py`, verified by `scripts/verify-pruned-model.mjs`; index files keyed by vector family so the phone reads the desktop's index (1564 across 108 files after merging main).*

*Previously updated: 2026-09-22 — **#344–#347: Obsidian on an iPhone reloaded every minute or two (ADR-199).** Debugged on the device (`ios_webkit_debug_proxy` + `idevicesyslog`): iOS killed Obsidian's WebContent process at its ~2 GB per-process limit. #344 — the multilingual embedding model adds ~0.9–1 GB there (English: ~130 MB), so a phone now embeds with a `mobile` model and the setting is left for the desktop. #345 — the fallback chain reloaded the model after `Out of memory`; memory exhaustion now ends it. #346 — an unfinished index restarted on every send, which made one crash a loop; a per-device marker pauses automatic builds after two deaths. #347 — the settings status said "builds on first use" for a complete index and nothing about a killed one; it now reads the file header and names seven states. #301 closed for the embedding area (1543 across 106 files after merging main).*

*Previously updated: 2026-09-22 — **#343: the conversation search row had a boundary of 1.2:1 and no focus state.** It was drawn with `--background-modifier-border`, which is a hairline *between surfaces* and is meant to be quiet; measured in Obsidian 1.13.7 it painted the row's edge at 1.23:1 under Klartext and 1.19:1 under the default theme, where WCAG 1.4.11 asks 3:1 for a control's boundary — and the row **is** the control, since there is no box around the field. Taking focus changed nothing but the caret. The rule is now `--p-field-rule`, mixed from `--text-normal` at 53% under `.theme-light` and 42% under `.theme-dark` (one percentage cannot clear 3:1 on both: white is at the end of the luminance scale and a dark ground is not), and `:focus-within` thickens it to 2px of accent with the pixel taken out of the padding so the row never moves. The loupe moves off `--text-faint`, which ADR-188 already forbade on a control. Painted and sampled: 3.45/3.07 light, 3.20/3.12 dark. The same defect was found in Obsidian's own search pane — under the default dark theme its form-field fill and border are both `#2e2e2e`, a boundary of exactly 1.00:1 — and is fixed in the theme separately (ADR-198, ADR-197). +11 tests (1506 across 103 files).*

*Previously updated: 2026-09-22 — **#342: the data.json watcher threw on every external sync.** Captured on an iPhone (2.24.1): `[Pythia] data.json watcher: TypeError: A.setActiveConversation is not a function`. Nothing was renamed: since Obsidian 1.7.2 a leaf that is not visible (the phone's closed drawer, a background tab) is *deferred*, and its `view` is a placeholder until revealed. `reloadFromDisk` cast every `getLeavesOfType` result to `PythiaSidebarView`. New `loadedPythiaViews()` in `services/ViewManager.ts` is the one way to reach the views; `tests/deferredLeaves.test.ts` reproduces the iPhone error against the old code and fails on any new `.view as PythiaSidebarView` cast (1495 across 102 files).*

*Previously updated: 2026-09-20 — **#341: the repo root collected the worktrees' copies.** Claude Code worktrees live under `.claude/worktrees/`, each a full checkout. Run from the repo root, `npm test` collected every copy of `tests/` (303 files for 101, two of them failing against the root's module graph), `npm run build`'s `tsc` type-checked every copy through `"include": ["**/*.ts"]`, and `eslint .` linted them — so one broken branch in a worktree could fail the main checkout. `scripts/check-file-size.mjs` already skipped `.claude`; Vitest (`exclude`), ESLint (`ignores`) and `tsconfig.json` (`exclude`) now do too. CI runs in a fresh clone and never saw it.*

*Previously updated: 2026-09-20 — **#338–#340: Obsidian's button rules, measured (ADR-190).** #338 — ADR-188's `.pb` base never set `height`, so every text button, link, segment and tab took Obsidian's `button { height: var(--input-height) }`; with `.is-tablet` padding (0,2,1), the phone-modal Setting-control rules (width 100%, padding 10px) and `button[disabled]` opacity, four of the ten core rules that reach a Pythia button got through. The test missed it because its core stand-in was guessed, not read. #339 — the header's model segment lost its ellipsis (`.pb` is a centred inline-flex). #340 — the search panel's clear ✕ ignored `hidden` (pre-existing). All fixed; `npm run check:obsidian-cascade` now reads app.css from the installed Obsidian and `tests/obsidianCascade.test.ts` fails on a leak (1447 across 97 files).*

*Previously updated: 2026-09-20 — **#334–#337: the button audit (ADR-188).** #334 — "In Notiz ersetzen" rendered with no fill: `.p-rewrite-btn` set its accent at (0,1,0), under Pythia's own (0,1,1) reset, leaving a white label on white; its quiet siblings lost their border the same way. #335 — Obsidian's (0,2,1) button hover repainted Keep this answer and Replace in note grey under a white label (ADR-187 had fixed Send alone). #336 — the tool-call confirmation's Cancel was the destructive red, and its Create the neutral one. #337 — 24 of 39 buttons measured below WCAG contrast at rest or on hover, mostly `--text-faint` on controls and outline buttons faded to 75%. All four fixed by the role system; three remain under the line because Obsidian's own red and orange are (ADR-188). +20 tests replacing 3 (1443 across 96 files).*

*Previously updated: 2026-09-18 — **#307–#312: the vault index never built (ADR-182).** A 400-note vault on an M2 Air: indexing degraded at ~half and no index ever completed. Five compounding defects, four of them in code three prior ADRs had already "fixed". #307 (**= #306**, the same defect found independently on `main` while this branch was open; main's `workerPrelude.ts` is the implementation that shipped) — every desktop fell back to the UI-thread iframe, not because `blob:` was refused (ADR-125/126's theory) but because Obsidian gives desktop Workers Node access, so transformers.js binds onnxruntime-node, whose macOS device list is `['cpu']` and rejects our `wasm`. #308 — batch-of-one inference at unbounded sequence lengths grew the WASM heap monotonically, which is what "deteriorates at half" was. #309 — `EmbeddingModelConfig.maxTokens` was declared on both models and read by nothing; both indexes chunked at 500 chars, over the default model's 128-token window. #310 — `doSync` persisted once at the end, so any interruption discarded the entire pass; a build that could not finish in one sitting produced nothing, ever. #311 — one note's embed failure threw out of the build and did so identically on every retry. #312 — the provider chain never said which backend it landed on, which is why #307 survived three ADRs; the `numThreads = 1` crash guard likewise had a silent `if` with no `else`. **#313–#316 came out of reviewing that fix's own diff before merge**, all four in the new code: #313 — `persist` wrote to the store without updating `this.items`, so the resume worked only across a restart, and the test that "proved" it used a fresh service instance and so read from disk instead of exercising the path that actually runs (regression test verified to fail in the forbidden direction); #314 — the flush counted notes processed rather than embeds, so the `continue` paths could stride past it; #315 — the write rate was unbounded, ~200 whole-index rewrites on a 5 000-note cold build, the exact cost ADR-122 removed (now floored at 30 s, with D-32 for the real answer); #316 — the failure streak did not reset on an unchanged note, so five bad notes scattered through a mostly-unchanged vault aborted the build permanently. +20 tests (1266 across 84 files).*

*Updated: 2026-09-18 — **mutation-tested ADR-182, then #317–#318.** Every behaviour ADR-182 claims was broken one at a time to check a test noticed. **Five of fourteen survived** — claimed-fixed behaviours that nothing tested, including the in-place resume whose own test used a fresh service instance and so read from disk. One survivor was informative in the other direction: reading `existing` vs the live `this.items` in `snapshot()` is *equivalent* (everything in `kept` is already in `handled`), so the ADR's duplication claim was wrong and is now corrected — the immutable map is clarity, not a fix. `sliceBatch` was extracted from `model.ts` (which imports transformers at module scope and so cannot be loaded in a test) to make the short-batch guard testable; new suites cover the provider fallback ORDER and its backend reporting, the vault chunk-size wiring, and the settings field. Then the two bugs the original review left open: **#317** — `refresh()` ran a whole-corpus scan on every send, re-paying the cost ADR-121 removed and flashing a build notice each time; it now runs only for the first build, with `force` for an explicit reindex. **#318** — `vaultContextMaxIndexedNotes` was the last numeric field outside `bindNumberSetting`, committing per keystroke with a rejected entry falling back to 0, which here means UNLIMITED: clearing the box to retype uncapped the index. 16/16 mutations now killed. +28 tests (1294 across 88 files).*

*Updated: 2026-09-18 — **#319–#325: an auto-retrieved note is not an attached one (ADR-183).** ADR-116 merged retrieved notes into `attachedNotes`, which bought the whole pipeline for free and hid a category error: nothing downstream could tell a note the user chose from one a cosine picked. #319 — five auto notes at the manual 12 000-char budget added ~15k tokens to every turn silently; they now get 3 000. #320 — the missing-note and oversized-note warnings fired about paths the user never attached and cannot remove; manual only now, the rest to the debug log. #321 — no per-note opt-out existed, so a single sensitive note inside an indexed folder could not be excluded; `pythia: false`, read fail-open. #322 — the retrieval query was the bare message, so a short follow-up embedded four tokens and retrieved noise; it now carries 200 chars of the preceding answer, dropped once the message stands on its own. #323 — the index cap sliced adapter order, so cap membership churned between sessions and notes re-embedded on return; now `mtime` descending. #324 — `vaultContextMaxNotes` had no UI at all. #325 — `rankByQuery` was dead code duplicating `VaultIndexService.query`, already drifted on `exclude`; deleted. All ten behaviours mutation-verified. +36 tests (1317 across 88 files).*

*Updated: 2026-09-18 — **#326–#330: what ADR-182's partial persistence broke elsewhere (ADR-184).** A code review of the branch found five, three of them consequences of one change: persisting mid-build made "the file has rows" stop meaning "the vault is indexed", and three readers still believed it. #326 — an interrupted build was served as complete forever (`size() > 0` on the UI-thread path, plus ADR-182's own `isReady()` gate); the format goes to v2 carrying `complete`. #327 — nothing invalidated the index when the folder scope or note cap changed, so notes excluded for privacy stayed retrievable; `scope` is persisted with the rows. #328 — edits during the first build were dropped for the session, because `applyChanges` no-ops until ready and the watcher had already cleared its batch; they are buffered and replayed. #329 — retrieved paths were not re-checked against the live scope or a `pythia: false` added on another device; they are now, at the point the text would leave the vault. #330 — ADR-183 filtered the missing-note warning but not the size warning, so a conversation with nothing attached could be told its attached notes were large. 12/12 mutations killed — six survived the first pass, all six flaws in the new tests. +27 tests (1344 across 89 files).*

*Updated: 2026-09-18 — **#331–#332: the Worker still did not start (ADR-185).** The M2 Air reports `iframe (UI thread)` after ADR-182 and #306 — the backend readout did its job and falsified the fix in one glance. #331 — the fallback chain recorded each failure only to `console.warn`, so the one fact that decides the diagnosis ("Unsupported device: wasm" vs a blocked `blob:`) never reached the user; reasons are now captured and logged beside the winner. #332 — both halves of the prelude are property operations, and a `process` that is neither configurable nor writable defeats both: `delete` throws on the first, the assignment on the second, and the `try/catch` that stops either from killing the Worker also hides that nothing happened. `process` is now shadowed **lexically** as well (`const process = void 0`, the prelude's last statement), which no property descriptor can defeat and which is what `env.js:38-39` actually reads. Also here: the resource-path worker file is named by a content fingerprint rather than the hand-bumped `-p1` marker, because the file is written only when absent and the prelude has now changed twice. **#333** — `conversationContentHash` joined its chunks on a literal NUL byte written into the source, which made git classify `embeddingIndex.ts` as binary and stop showing its diffs entirely; it is now the escape `"\u0000"`, same value, and the file diffs again. **41/41 mutations killed** across the three harnesses for ADR-182/183/184/185 after re-anchoring them onto the merged code — one survivor found and closed on the way: nothing tested the `delete` half of the prelude on its own, which is the only half that works on a configurable-but-not-writable `process`. +24 tests (1411 across 92 files).*

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

*Updated: 2026-09-16 — **#263: glossary definitions in the conversation's language (ADR-166).** Translated on open and cached per language in the term note; new definitions under AUTO follow the passage. +23 tests (1069 across 69 files).*
*Updated: 2026-09-16 — **#259, #260 done; #262 partly (ADR-165).** The header shows model | effort | language, resolved and tinted when set for this conversation, each changeable in one tap; rename and copy link moved into a menu. +17 tests (1046 across 68 files).*
*Updated: 2026-09-16 — **#255–#262: conversation controls transparency (new suggestions, open).** An audit of every per-conversation setting against what the panel shows: write mode, resume mode and the system prompt have no UI in the conversation; web search, vault context and the generation parameters show state weakly or two taps deep. Design brief (v2) for the header redesign in `docs/briefs/conversation-controls.html` covers #259/#260 only: model, reasoning and answer language readable and changeable in the header. No code changed.*
*Updated: 2026-09-16 — **#252: no price table, no per-user overrides (ADR-163 addendum 3).** The settings keep the toggle and a disclaimer naming models.dev; a wrong price is fixed upstream. −7 tests (1020 across 65 files).*
*Updated: 2026-09-16 — **#249–#251: cost snapshot on the message, models.dev price pipeline, cost off by default (ADR-163 addendum 2).** +12 tests (1027 across 65 files).*
*Updated: 2026-09-16 — **#248: the price table is a setting behind a disclaimer (ADR-163 addendum).** Per-model input/output overrides in the settings tab, validated on load; the disclaimer says estimate, not bill, and that the provider's invoice is authoritative. +7 tests (1015 across 64 files).*
*Updated: 2026-09-16 — **#246–#247: cost per answer (ADR-163).** `≈ $` after the token counts on every assistant label, a running total per conversation in the history panel, priced from a date-stamped table with a completeness test; the next-send token estimate beside Send is removed. +11 tests (1008 across 64 files).*
*Updated: 2026-09-16 — **#238–#245: token-limit support (ADR-162).** A reply cut at the token cap looked finished (the stop reason was dropped by all three providers); an empty reasoning reply vanished silently; the Send warning explained itself only in a tooltip; the modal said nothing when a pinned 2000 moved onto a reasoning model. One pure rule (`maxTokensAdvice`) now drives the modal advice line, the Send warning and a recovery card with Continue / Retry / Compare; model rows show speed · depth · cost. +30 tests (997 across 63 files).*
*Updated: 2026-09-16 — **#237: conversation settings help texts state the effect.** Every row's description now says what raising or lowering the value changes, what it does not change, and what the default means; provider and model gained descriptions. Both locales; rule recorded in `docs/design.md` (modal section).*
*Updated: 2026-09-16 — **second whole-codebase review (ADR-161): #181–#236, 56 fixes.** Read what the first pass skimmed: every `ui/` controller, both settings surfaces, the embedding/retrieval layer, the stylesheet, and the day-old comparison code. Three shapes the first three principles did not name — the second hand-rolled copy (five dismissers, four leaking), work proportional to the corpus rather than the keystroke (re-tokenizing every conversation per character; rewriting `data.json` per typed character), and a shown default being stored (the modal pinned untouched temperature/max-tokens). Three new principles in CLAUDE.md alongside ADR-159's; a lint rule now confines raw `document`/`window` listeners to an allow-list. +18 tests (967 across 60 files). Full list under "Second review (#181–#236)".*

*Updated: 2026-09-16 — **compare models on the last exchange (ADR-160, new capability).** Long-press on the last user bubble → **⇄ Compare** → pick a model → the prompt re-runs into a card with one tab per model; **Keep this answer** makes that tab the turn and forks the rest as `<conversation> · <Model>`; sending is blocked while pending. Three product questions were asked and answered before building (last turn only; sequential tabs; forks + blocked send). The design rests on one invariant — the conversation ends with the user turn while a comparison is pending — which is why no provider changed and no message ever carries a "pending" flag. The long-press bar left `sidebar.ts` for `ui/ExchangeActionsController.ts` when it gained its third button (1853 → 1763). +26 tests (949 across 59 files).*

*Updated: 2026-09-16 — **whole-codebase quality and security review (ADR-159): #124–#178, 55 fixes in five commits.** Asked for: at least fifty bugs or improvements with maintainability, usability, performance and observability weighted highest, and three principles to guide what follows. Found: the defects came in three shapes — values trusted at a boundary (settings, conversations, template frontmatter, tool-call arguments), failures that said nothing (create_note overwriting, UTC dates, a deep link without its vault, a `TypeError` misfiled as network, a stuck streaming state), and rules that lived only in prose (`toLocaleDateString`, `innerHTML`, `==`, unused locals). Each fix has a headless test where one can be written (+46 → 926 across 58 files); `sidebar.ts` shrank 1891 → 1885 through `ui/emptyState.ts` to pay for the send guard under the ADR-097 ratchet. The three principles are in ADR-159 and in CLAUDE.md. Full list under "Quality & security review (#124–#178)".*

*Updated: 2026-09-10 — fork anchor always-current summary + visible regenerate (ADR-128). Ask: the fork summary shown in the origin conversation should always be the latest and keep a regenerate trigger. It already read the fork live (latest STORED summary) but gave no staleness cue and buried regenerate in a long-press. Added: a staleness check (fork's newest message > shown summary's timestamp) that appends an `outdated` marker + accent-tints a new visible one-tap refresh button (`rotate-cw`), which regenerates the displayed summary type (also creates a first summary); the long-press menu stays for conversation-vs-favorites. Explicit non-goal: no auto-LLM-call on preview-open (would spend tokens on every glance) — deferred as an opt-in. +i18n en/de, CSS. Build/lint/tests green.*

*Updated: 2026-09-10 — CI red on the file-size ratchet, and the process gap behind it. The streaming-toolbar fix added 4 lines to `sidebar.ts` (2,024 → 2,028), which the ADR-097 guard rejects by design: the ratchet ceiling may only fall. Lint, build and tests were run locally on every change this session; `npm run check:filesize` — a separate CI step — was not, so the guard first spoke on GitHub. Paid for the addition rather than raising the ceiling: `lastTokenUsageMsg` left `sidebar.ts` for `services/messageUtils.ts` as the pure generic `lastTokenUsageMessage(messages)`, with 3 unit tests it could not have as a private view method (622 total). `sidebar.ts` 2,028 → 2,018, ceiling lowered to match. **Lesson:** the local verification loop for this repo is lint + `check:filesize` + build + test — the same four steps `.github/workflows/ci.yml` runs, in that order.*

*Updated: 2026-09-10 — conversation panel: last rows unreachable behind the on-screen keyboard (mobile UI bug fix). Report: opening the panel from the header loupe focuses the search field (ADR-107, by design), the keyboard comes up, and the conversations at the end of the list cannot be reached. Cause: the panel is `position: absolute; inset: 0` inside the view, and on this platform the keyboard **overlays** the webview instead of resizing it — the layout viewport keeps its full height, so the bottom of the scroll area sits under the keyboard and its last rows can never be scrolled into view. Fix: `window.visualViewport` reports the genuinely visible region, so the panel measures `overlay.bottom − (vv.offsetTop + vv.height)` and pads `.p-history-list` by that plus 8px, on visual-viewport `resize`/`scroll` and once after the focus call (a re-open where the keyboard is already up fires no resize). The padding is scroll space, so every row can be brought clear; it resets to the stylesheet value where nothing is covered (Android and desktop, where the webview does resize), the guard is `vv?.` so an environment without the API is unchanged, and both listeners are removed in the panel's `close()`. Auto-focus was deliberately kept — it is the ADR-107 behaviour and the reason the panel is fast to use; suppressing it on touch was the alternative and is a bigger product change. Verified: lint/build/619 tests; **not** reproducible headlessly — no keyboard and no `visualViewport` movement in the test environment, so this needs an on-device check.*

*Updated: 2026-09-10 — locale audit: `locales/de.ts` vs `docs/design.md` (follow-up to two German strings that had drifted from their own spec — the effort segment's dropdown label and the streaming stop label). Result: the drift was the exception. Key parity is clean (380/380, none missing or extra) and every literal the design doc pins down matches the German — `ABZWEIGUNG`, `Quelle`, `aktiv`, `Zusammenfassen`, `+ Notiz hinzufügen`, `+ Systemprompt`, `Fast voll — …`, `N Nachrichten · Öffnen →`, `DU`/`PYTHIA`, `QUELLEN`, `Gesprächseinstellungen…`, `nächste ~Xk`. Three fixes landed. (1) One label of the same class as the stop label survived: the prompt optimizer sets the Send button to `Wird optimiert…` (15 chars) where the doc allows only a short pill label — now `Optimiere…`. Since the streaming-row guard it squeezed the icon group rather than breaching the padding, so it was a squeeze risk, not a collision. (2) The fork concept had four German words; `branchLabel` ("Zweig", history subtitle) was the outlier against the Abzweigung / Verzweigen / Verzweigt von family — now `Abzweigung`. (3) Favorites vs highlights were used interchangeably: the navigator section reads `Favoriten` while its empty state read `Noch keine Markierungen`, and the unfavorite action read a bare `Entfernen` next to `Löschen` elsewhere — now `Noch keine Favoriten` and `Defavorisieren`, which pairs with the toolbar's own `Favorisieren` (the user's wording). **English carried the same drift** in the empty state (`No highlights yet` → `No favorites yet`), fixed with it. **Open, not fixed:** `CLAUDE.md`'s component inventory still describes a `REFERENZ` label at 54px in the reference row; the row (`.p-ref-row`) holds only `.p-pills` and no such element is created — left alone because CLAUDE.md is the project's instruction file, not a doc this session owns. Verified: lint/build/619 tests.*

*Updated: 2026-09-10 — streaming Send button collided with the panel edge (UI bug fix, German only). Chain: during streaming the button label swaps to `stopBtn`, which German set to the sentence "Anfrage abbrechen" (English swaps the shorter "Send"→"Stop", so the row only overflowed in German); `.p-send` is `white-space: nowrap` so it cannot shrink; `.p-toolbar` does not wrap and `.p-toolbar-left` had `flex: 1` **without** `min-width: 0`, so the icon group could not shrink below its six 22px buttons either — nothing in the row could give, so it pushed past the input area's 12px side padding. Three fixes, root first: (1) German `stopBtn` → `Stopp`, which is what `docs/design.md` had specified as the label all along — the second drift of a German string from the documented design this session (the effort segment's dropdown label was the first); (2) the next-send estimate hides while streaming (`.p-input-area.streaming`, toggled from `setStreamingState`) — it describes a send that cannot happen mid-stream and costs the row ~60px exactly when the label is widest; (3) the row is made structurally overflow-proof: `min-width: 0` on `.p-toolbar-left` (the icon group yields first) and `flex-shrink: 0` on `.p-send-wrap`. Verified: lint/build/619 tests; not runtime-checked in Obsidian.*

*Updated: 2026-09-10 — model popover stays open after a selection (ADR-127, UX change, not a bug). Reported friction: selecting a model closed the popover, so reaching conversation settings through its own footer needed a reopen — worst on a switch to a reasoning model, the case most likely to need an effort change. The popover is now a panel: a selection applies the model and repaints the rows (each row owns a check element that the repaint shows or hides), a confirmed touch selection clears the armed row, and dismissal is outside click / Escape / badge / footer. Cheap because a model change does not rebuild the header — `applyModelChoice` only refreshes the badge and the context inspector — so the popover and its anchor survive. The footer remains the only route to the settings modal (user's call; no auto-open). Cost: one extra dismissal tap on the switch-and-return path. Verified: lint/build/619 tests; not runtime-checked in Obsidian.*

*Updated: 2026-09-10 — max-tokens field, same review as effort and temperature (UI bug fix). No specificity trap here either (core `input` markup), but three defects, one of them a real data-truth bug. (1) **Invalid input was swallowed.** `onChange` kept the last good number and returned; the field went on displaying `abc` while Save committed something else entirely — what you saw was not what you got. Invalid text now flags the input (`.p-field-invalid`) and states the rule in the readout, and `blur` rewrites the field to the value Save will store. (2) **The default was frozen at open.** `resolveDefaultMaxTokens` is model-aware (reasoning models get a different max-output default), but the field computed it once, so switching the model inside the modal left the old number in place and Save pinned it as an explicit override. The default is now a function, re-resolved from `updateParamAvailability` whenever the field is still untouched. (3) **No override/inherited distinction**, same as temperature: the field prefills the effective value with nothing saying where it came from. It now carries the `.p-param-readout` `· Standard` tag, and the placeholder shows the default that applies when the field is cleared. Also `inputMode="numeric"` + `pattern="[0-9]*"` for a numeric keypad on touch — deliberately not `type="number"`, which would report invalid text as `""` and defeat (1). New key `paramInvalidNumber` (en/de). Verified: lint/build/619 tests; same test gap — the modal needs a real Obsidian `Setting`.*

*Updated: 2026-09-10 — temperature slider, same review as the effort segments (UI bug fix). Checked for the two effort causes and found neither: the slider is core Obsidian markup, so no `all: unset` specificity trap, and it carries no label of ours to drift. Two *other* defects, both the same class of problem. (1) **The value was never visible.** `setDynamicTooltip()` renders only while dragging, and on touch it appears under the finger — so "what temperature is selected" had no answer at rest. Added `.p-param-readout`, a permanent mono value right of the slider, fed by the raw `input` event on `slider.sliderEl` (not only `onChange`, which fires on release on some builds) and tagged `· Standard` until the conversation has an override of its own. (2) **"Disabled" was cosmetic.** `Setting.setDisabled` marks the row; the control underneath stays draggable — which is why the effort segments already disabled their buttons by hand. On a reasoning model, where temperature is unsupported exactly when effort is, the slider could still be dragged and the value saved. Now `SliderComponent.setDisabled` is called too and the control area carries `.p-param-off` (opacity + `pointer-events: none`). New key `paramValueDefault` (en/de). Verified: lint/build/619 tests; same test gap as the effort fix — the modal needs a real Obsidian `Setting`, which the headless stub does not implement.*

*Updated: 2026-09-10 — effort segments did not read as selected (UI bug fix). Report: with a reasoning model, changing Effort in conversation settings left the highlight unchanged and the selected level unclear. Two independent causes. (1) **Specificity:** `.p-effort-seg-btn` uses `all: unset` at (0,1,0), which loses to Obsidian core's `button:not(.clickable-icon)` background at (0,1,1) — the exact trap the `.pythia-view` reset at the top of `styles.css` documents, except a `Modal` is not inside `.pythia-view`, so all four segments inherited core's grey fill and `.active` (0,2,0) was the only rule that cleared it. Every segment rule is now scoped to `.pythia-modal` (base (0,2,0), active (0,3,0)) with an explicit `background-color`, and selection also carries `font-weight: 600` + `aria-pressed`, so it never rests on colour alone. (2) **Label:** the leading segment reused the settings-tab dropdown string `effortUnsetOption` ("(nicht gesetzt – Modellstandard verwenden)"), which swamps a 4-way segment and never says which effort actually applies. It now reads `Standard · Mittel` — the constructor already received `defaultEffort` and had **never used it** — or plain `Standard` when no default is set (new keys `effortSegmentDefault`/`effortSegmentDefaultWith`). `docs/design.md` had described the short "Standard" label all along, so the code had drifted from its own spec. Segments are also ≥36px on coarse pointers. Verified: lint/build/619 tests; **not** covered by a unit test — the modal needs a real Obsidian `Setting`, which the headless stub does not implement.*

*Updated: 2026-09-10 — model popover was hard to read on a phone (UI polish, no ADR). Field screenshot: 20 models, one flat scroll filling the panel. Problems found: all meta labels sat at **9px**, a size that is not in the documented type scale (`--font-smaller` is 11px); provider headers used `--text-faint` and scrolled away, so the group was unidentifiable mid-list; model names were `--text-muted` while the meta beside them was faint, flattening the hierarchy; the `Reasoning` marker used `--text-warning` orange, the same colour as the real max-tokens warning, so six capability labels shouted louder than the selected row; the context window shifted horizontally depending on whether a row had a Reasoning tag; the active row was an 8% accent tint only; rows were ~27px tall on touch; the popover was a fixed 226px regardless of panel width. Fixed all of the above (CSS + one width calculation). **Left open as product decisions:** a bottom-sheet presentation on touch (ADR-114 pattern, already built in `ui/ActionSheet.ts`), a search/filter field, a pinned "recently used" group, and the two-tap arm-then-confirm flow, which reflows the list under the finger. Verified: lint/build/619 tests; not runtime-checked in Obsidian.*

*Updated: 2026-09-10 — minimized-input leftovers (UI bug fix). Report: minimizing the input controls hid the "Senden" button but left the token count on the toolbar row. Cause: `.p-input-area.collapsed` only hid `.p-textarea` and `.p-send`, while the two send-adjacent elements built into the same toolbar — the next-send estimate `.p-send-estimate` and the max-tokens warning `.p-send-hint` — kept their own visibility, so a token estimate for a send that isn't reachable stayed on screen. Fix: the collapsed rule now also covers `.p-send-wrap`, `.p-send-estimate` and `.p-send-hint` (CSS only; both elements are toggled elsewhere with inline `display`, and an empty inline value falls back to this rule, so expand still restores them). Verified: lint/build/619 tests; visual state not runtime-checked in Obsidian.*

*Updated: 2026-09-04 — embedding: blob-free Worker restores off-thread (ADR-126, root fix for the ADR-125 freeze). The environment blocks `blob:` Workers (`capacitor://localhost`, desktop included), which is why embedding ran on the UI thread. Fix: write the embedding bundle to `<pluginDir>/embedding-worker-<version>.mjs` once and start the Worker from `adapter.getResourcePath(path)` (same-origin, blob-free). `WorkerEmbeddingProvider` gained an injected `spawnUrl`; `FallbackEmbeddingProvider` now chains blob Worker → resource-path Worker → iframe. On a `capacitor://localhost` document the resource path is same-origin, so the Worker should start off-thread and the freeze goes away; if it can't (cross-origin `getResourcePath` on some desktops, or `worker-src` CSP), it falls back to ADR-125's throttled UI-thread build — no regression. Cost: ~1.6 MB worker file synced once per version (a build step could emit it instead). Not headless-verifiable; wiring + fallback unit-tested (619). On-device check: the `blob:` "Not allowed to load local resource" console error should disappear and indexing should not freeze.*

*Updated: 2026-09-04 — vault RAG froze the app on the UI thread (ADR-125, supersedes ADR-124). The user corrected that the freeze was on DESKTOP, and a desktop console proved why: origin `capacitor://localhost` with `blob:` blocked ("Not allowed to load local resource: blob:…") → the blob-URL Worker is refused on desktop too → iframe fallback → UI-thread inference → a 311-note build froze the app. ADR-124's `Platform.isMobile` gate is false there, so it did nothing. Real signal = did the Worker engage. Fix: providers expose `isOffThread()`; `VaultRagService` detects it after `ready()` and, on the UI-thread backend, serves an already-built persisted index via `hydrateForQuery()` (no re-freeze each session) or builds a fresh one THROTTLED (`sync` `{yieldEveryNotes:1,breatherMs:12}`) so the app stays responsive; a one-time Notice explains it. `applyChanges`/`reindex` un-gated. +1 test (619). Honest: (a) still not headless-verifiable on device; (b) throttling fixes RESPONSIVENESS — if a huge UI-thread build still slows partway (WASM-heap growth), the follow-ups are recycling the backend to bound memory and, better, loading the Worker from a plugin resource path (blob-free) to restore off-thread on these builds.*

*Updated: 2026-09-04 — vault RAG froze the app on MOBILE (ADR-124, bug fix). Field report: 311-note vault, first indexing degraded performance after ~half the notes. Console diagnosis (decisive): origin `capacitor://localhost` = Obsidian mobile, and `blob:` is blocked → the Web Worker (blob URL) is refused → `FallbackEmbeddingProvider` uses the same-origin iframe, which runs on the renderer UI thread → a full build = hundreds of single-threaded WASM inferences on the main thread, worsening as the heap grows. No off-thread option exists on Obsidian mobile. Fix: on a main-thread-only backend, never embed vault NOTES — `refresh()` hydrates the persisted (desktop-built, plugin-dir-synced) index via new `VaultIndexService.hydrateForQuery()` and queries embed only the query string (one/turn, cheap); `applyChanges` skipped, `reindex` refused, each with a one-time "build on desktop" Notice. `VaultRagService` gained an injectable `isMainThreadOnly` seam. +2 tests (618). Lesson (recurring): the mobile embedding path can't be validated headlessly — the gate/hydrate logic is unit-tested; on-device confirmation still needed.*

*Updated: 2026-09-04 — vault RAG batch persistence (ADR-122). Q: "anything else to improve in perf?" ADR-121's targeted `updateNote`/`removeNote` each rewrote the WHOLE `.bin` (`serializeIndex(all)`, ~6 MB at the 5k cap), so the watcher flushing N edited notes did N full-index writes. Added `VaultIndexService.applyBatch({updates, removes}, {cap})`: all mutations run in memory (`updateInMemory`/`removeInMemory`, no persist) and the index is serialized + written AT MOST ONCE per batch; `updateNote`/`removeNote` are now thin single-item wrappers over it; `VaultRagService.applyChanges` builds one batch per debounced flush → one write per flush, not per note. +2 tests (616 total). Verified: build/lint/filesize. Companion: the analogous `data.json` cost (full-file rewrite per conversation save — O(all), not O(dirty)) was investigated as a per-conversation store and REJECTED (ADR-123) — the split endangers the load-bearing Desktop→Mobile iCloud sync (ADR-010/011) and widens the data-loss surface, for a small local-only write win; cheaper sync-safe levers exist if it ever bites.*

*Updated: 2026-09-04 — vault RAG perf follow-ups (ADR-121). Two wins. (1) Event-driven indexing: the watcher re-ran a FULL scan (read+hash every note, rewrite the whole .bin) on every edit — O(N) per keystroke-save. Now it batches the changed files and applies TARGETED updateNote/removeNote (one embed per edited note); an op chain serializes targeted updates against full builds. (2) One ML bundle: the iframe and worker each bundled @huggingface/transformers, doubling ~0.85 MB in main.js. Merged into a single context-detecting `frame/entry.ts`, inlined once via a lazy getter; `main.js` 2.5 MB → 1.6 MB (faster load/parse every startup). +7 tests (614 total). Verified: build/lint/filesize. The unified bundle's worker path still needs live confirmation, but its iframe branch is a verbatim port of the proven bootstrap, so the fallback is safe.*

*Updated: 2026-09-04 — vault RAG scale (ADR-120). Q: "30k-note vault — indexing breaks?" Yes: (1) memory — the old code read every note's content into one array (+ all chunk strings), ~300 MB+ transient at 30k → OOM/crash; (2) unbounded — no cap, ~tens-of-minutes first build; (3) per-query rank scanned all vectors synchronously on the UI thread. Fixes: streamed indexing (`IndexableNote` → `{path, load()}`, one note read/embedded/released at a time — bounded memory); `vaultContextMaxIndexedNotes` cap (default 5000) + a pure `selectIndexPaths` helper + a one-time "capped, scope to folders" warning (fails loudly, not silently); cooperative ranking (`query` yields every 2000 notes). Deferred (honest): true worker-side ranking — can't validate headlessly + would double the iframe fallback surface; cooperative yielding removes the hitch at far lower risk. +9 tests (607 total). Verified: build/lint/filesize.*

*Updated: 2026-09-04 — hard-reload (renderer crash) fix (ADR-119 follow-up). Report: "Obsidian does a hard reload when using Pythia." Cause: onnxruntime-web (transformers 3.8.1) defaults to **multi-threaded WASM** — it sets `wasm.proxy = false` but never constrains `wasm.numThreads`, so it spawns nested WASM worker threads + SharedArrayBuffer, which crashes Obsidian's Electron renderer (same class as the WebGPU crash already worked around; worse inside our Worker). Fix: force `env.backends.onnx.wasm.numThreads = 1` in `model.ts` — single-threaded, one WASM heap, stable. Applies to iframe AND worker; independent of the worker so it also fixes the released iframe build (fast-hotfix candidate for 2.6.1). Build/lint/filesize/598 tests. Still needs live confirmation that the crashes stop.*

*Updated: 2026-09-04 — vault RAG froze all of Obsidian (ADR-119). Field report: indexing froze the whole app, not just Pythia. Root cause: the embedding model runs on the WASM backend inside a same-origin iframe — which shares Obsidian's renderer main thread — so whole-vault inference blocked the UI (ADR-118 only moved the await, not the compute). Fix (one branch, user-directed): (1) a real Web Worker backend (`WorkerEmbeddingProvider`) with an automatic iframe fallback (`FallbackEmbeddingProvider`); (2) cooperative-yield throttling + live progress in `VaultIndexService.sync` so even the fallback stays responsive; (3) folder-scoped indexing (`vaultContextFolders`); (4) reindex (settings button + command, `VaultIndexService.clear()`); (5) a debounced vault watcher. Refactors to hold the size ceilings: vault-RAG lifecycle → `services/VaultRagService.ts`, embedding/vault settings → `ui/embeddingSettings.ts`. Cost: `main.js` +~0.85 MB (runtime bundled twice — unify as follow-up). **NOT verifiable headless:** WASM-in-Worker inside Obsidian (ships behind the throttled-iframe fallback; needs live confirmation). 598 tests. Verified: build/lint/filesize.*

*Updated: 2026-09-03 — vault RAG blocked the turn (ADR-118, bug fix). Field report: with vault context on, the turn showed the model-download notice, then ended with no LLM reply. Root cause: retrieval embedded the WHOLE vault synchronously inside the send turn, gated on the first-use model download — the reply was blocked behind a tens-of-MB download + full index build. Rearchitected to be strictly additive/non-blocking: `VaultIndexService.sync` (background, sets `isReady`) is now separate from `query` (query-only embed against the ready index); `getRelevantNotes` builds the index in the background and returns [] until it's ready, so the reply is never delayed and RAG only ever adds context. Lesson recorded: the fake-provider unit tests passed on the broken design because they never exercised a real model download — this class of bug needs a live-vault smoke test, which headless CI can't provide. 596 tests. Verified: build/lint/filesize.*

*Updated: 2026-09-03 — vault RAG: surfacing + a latent security gap (ADR-117). Reviewing how ADR-116 surfaced exposed that it had no on-the-fly control (command-only, global) and — more seriously — a **gating bug**: `buildSystemPrompt` keyed the citation instruction and the ADR-115 untrusted-content framing off `conversation.contextNotes`, but RAG appends notes to the request without storing them there, so in the main case (RAG on, no manual notes) retrieved notes were injected **uncited and without the injection guard**. Fixed by threading a `hasAttachedNotes` signal from `resolveUserContent` into `buildSystemPrompt` (both fire on `contextNotes.length > 0 || hasAttachedNotes`) — also closes the same gap for one-shot attached notes. Added a per-conversation toolbar toggle (`library` icon, mirrors the research globe; new `Conversation.vaultContext`, default from the setting) and distinct read-only "auto" pills in the reference row (plus now-guaranteed citations) so what was pulled in is visible. Extracted `onCitationClick`+`renderSourcesRow` → `ui/sourcesRow.ts` to hold `sidebar.ts` at its ceiling. Caught before the feature ever shipped (branch not merged). +2 gating tests; toggle/pills are view code. Verified: build/lint/filesize/594 tests.*

*Updated: 2026-09-03 — vault-wide semantic RAG (ADR-116): a new capability, not a bug fix, and the flagship "make Pythia part of the graph" move. Closes the gap that the on-device embedding engine indexed only conversations while the vault (the actual knowledge base) was reachable only by hand-attaching notes. When enabled, each turn auto-retrieves the most relevant vault notes and injects them as context. Reused the whole embedding stack (`embeddingIndex`/`vectorMath`/`IframeEmbeddingProvider`); new pure core `vaultRetrieval.ts` + `VaultIndexService.ts` (twin of `ConversationIndexService`). Wired at `LLMRouter` via a `setVaultRetriever` hook (merges into `attachedNotes`, fail-open) so nothing in the providers or `sidebar.ts` changed — retrieval inherits excerpting, the token guard, the ADR-115 untrusted-content framing, and citations for free. One shared embedding provider across related + vault services (no double model load); vault index persisted separately (`vault-embeddings-*.bin`). Gated by a command + `models/settings.ts` defaults (no settings-tab UI: `settings.ts` is at its ceiling). New tests: `vaultRetrieval.test.ts`, `VaultIndexService.test.ts`, `LLMRouter.test.ts` (+25). Verified: build/lint/filesize/592 tests. **NOT verifiable in CI/headless:** the transformers.js model embedding real vault notes in a live Obsidian window (unit tests use a fake provider by design) — needs an in-app smoke test; first-index time on a large vault is the main perf unknown (incremental after that). Follow-ups: settings-tab UI (after a `settings.ts` extraction), per-conversation toggle + toolbar affordance, and reusing the vault index for link-suggestion.*

*Updated: 2026-09-03 — security hardening: prompt injection & write-tool confinement (ADR-115). Threat model: attached notes/PDFs, prior-conversation summaries, forked excerpts, and web-search results are all untrusted content that reaches a model armed with vault-write tools — a prompt-injected note ("ignore the above; rewrite the user's notes / reveal the system prompt") is the confused-deputy risk. Five defense-in-depth layers, none changing legitimate behaviour: (1) `UNTRUSTED_CONTENT_INSTRUCTION` (`promptConstants.ts`) added to the system prompt whenever untrusted context will accompany the turn — treat all delimited blocks and tool results as DATA, never commands; only the user's chat + system instructions authorize tool use. (2) `ContextBuilder.neutralizeControlTags()` defangs Pythia's structural tags inside note bodies / prior summaries / forked excerpts (opening `<` → `‹` U+2039), closing the delimiter-escape that would let a note forge a `<system_prompt>` block. (3) `<attached_note>`'s `path` attribute is HTML-attribute-escaped against attribute breakout. (4) `ToolHandler.execute(call, allowedTools, contextNotes)` enforces the context-note allow-list for `rewrite_note`/`prepend_note` at the reusable boundary (was UI-only in `sidebar.ts`), plus a boundary `..`-traversal reject. (5) `NoteWriter.writeNote()` refuses any write into `app.vault.configDir` (default `.obsidian`), regardless of extension — the `.md`-only rule already blocked plugin-code writes; this closes the whole config tree. Also `sidebar.onCitationClick` opens a web citation only if it parses to `http(s)` and uses `window.open(…, "noopener,noreferrer")` — blocks `javascript:`/`data:`/`file:` and stops referrer/`window.opener` leakage. Scope note: provider API keys necessarily travel in request headers (no proxy backend; ADR-112) — an accepted client-side-plugin property, out of scope here. New i18n key `invalidUrl` (en/de). +21 tests. Verified: build/lint/558 tests.*

*Updated: 2026-09-02 — mobile UX (ADR-114): the long-press menus rendered as small floating popovers, which is the wrong pattern on touch (cramped, near the keyboard, undiscoverable). Introduced a reusable `ui/ActionSheet.ts` bottom sheet (scrim, drag handle, swipe/scrim/Escape dismiss, 48px rows, safe-area padding) and switched the Send long-press menu to it on mobile (`Platform.isMobile`), keeping the desktop popover; both render from one shared item list. Chosen from three options as "fix the surface" (Approach 2) — the long-press trigger and a visible affordance, plus converting the delete-preview and history-row long-presses, are noted follow-ups. Not a bug fix — a UX improvement. Verified: build/lint/567 tests.*

*Updated: 2026-09-02 — secret-handling hygiene audit (ADR-112), prompted by "the OpenAI key is visible in the dev console." Root cause: it was the **Network** tab (the `Authorization: Bearer …` request header), not a `console.log` — an unavoidable property of a server-less, client-side Obsidian plugin that calls providers directly; the same applies to Anthropic/Mistral/Tavily/Upvoty and cannot be removed without a proxy backend. Confirmed no `console.*` ever logged a key (debug logs carry only metadata; keys live in `SecretStorage`, never `data.json`). Added defense-in-depth for the surfaces we control: `services/redact.ts` (`redactSecrets` masks Bearer/`sk-`/`sk-ant-`/`tvly-`/auth key-value; `describeErrorForLog` yields a compact scrubbed string), `debugLog` redacts string args, the stream-error `console.error` logs a scrubbed description instead of the raw SDK error object, and `UpvotyService`/`WebSearchService` scrub the sliced server-response detail they surface to the model. New `tests/redact.test.ts` (14 cases). Verified: build/lint/567 tests.*
*Updated: 2026-09-18 — #293 closed by ADR-173: the delete dialog offers Archive beside Delete, fail-closed, no new setting.*
*Updated: 2026-09-18 — #292 closed by ADR-172: eviction archives each conversation to a vault note first and keeps any whose note cannot be written; "no limit" is now an empty settings field rather than the number 0.*
*Updated: 2026-09-18 — #291 reported from a real vault: setting the conversation history limit to 0 (documented as unlimited) left only the starred conversations. Cause and fix in ADR-171; the product question it exposes is open below.*

*Updated: 2026-09-02 — Upvoty integration removed (ADR-113, reverts ADR-111). The Upvoty remote MCP endpoint returned 401/403 for a valid REST token sent as `Authorization: Bearer …` — it wants OAuth (as claude.ai's connector uses) or a differently-presented/dedicated token, and Upvoty ships no auth docs to confirm which. Rather than keep a speculative, unverifiable client in the plugin, the whole feature was removed (service + tests, tools/gating/`buildUpvotyArgs`, `upvotyMode` fields, settings, secret plumbing, toolbar toggle, i18n); the file-size ceilings ratcheted back down (`settings.ts` 622, `sidebar.ts` 1994). ADR-112 secret redaction was kept. Verified: build/lint/537 tests. Reopen prerequisite if revisited: confirm the exact MCP auth scheme first.*

*Updated: 2026-09-02 — Upvoty feedback/roadmap integration (ADR-111): a new capability, not a bug fix. Read-only Pythia tools (`upvoty_search_feedback`/`upvoty_get_feedback`/`upvoty_list_roadmap`/`upvoty_get_project`) let a conversation discuss Upvoty feature requests. Chose native tools over the Anthropic `mcp_servers` connector (Anthropic-only; Pythia is provider-agnostic) and over a hand-coded REST client (Upvoty publishes no usable REST docs) — instead `services/UpvotyService.ts` speaks minimal MCP-over-HTTP to Upvoty's documented remote MCP server, reusing the never-throws error convention and the `researchEnabled`-style independent gating (`upvotyEnabled`). Per-conversation `upvotyMode` toggle (`megaphone`), settings `upvotyServerUrl`/`upvotySecretName`/`upvotyDefault`. New tests `tests/upvotyService.test.ts` (pure parsers + config guards + mocked MCP flow) and Upvoty gating/mapping/execution cases in `tests/ToolHandler.test.ts`. **Not verifiable in CI/headless:** the live MCP handshake against a real Upvoty endpoint — the client is written defensively (JSON+SSE, session re-handshake) but the exact transport/response shape can only be confirmed once a real server URL + token are configured in-app; follow-up: verify against a live account and tighten if Upvoty's transport differs. See ADR-111.*

*Updated: 2026-08-23 — fork branch-back (#105): forked snippets accent-highlighted in the source, tap-to-expand inline fork summary + open/return links, source summary decoupled into `forkedFromSummary`.*
*Updated: 2026-08-23 — saved-summary frontmatter (#104): `type: "LLM Note"` (was `pythia-conversation`/`pythia-favorites`), a clickable `conversation:` resume deep link, and no `tags: [pythia]` (`NoteWriter`).*
*Updated: 2026-09-18 — #295/#296/#297 done (paged browse listing + fork index, cap default 450, a data.json size readout and warning); #298 records the split-storage design, to evaluate when the readout says it is needed.*
*Updated: 2026-08-23 — summary UX rework (#103): top-of-conversation "Speisekarte" cards, long-press Send menu as sole generator, removed pinned panel / sparkle / favorites modal / auto-generation paths.*
*Updated: 2026-08-23 — highlight-favorite interaction fixes (#102): tap-to-unfavorite, surgical removal (no color loss), single-tap navigator jump, toolbar reorder.*
*Updated: 2026-08-23 — summarize-favorites feature (#101): per-conversation favorites synthesis (Key learnings + Action items) via `buildFavoritesDigest` + `generateFavoritesSummary`, modal preview, navigator ✦ + command triggers.*
*Updated: 2026-08-23 — favorite highlights feature (#100): span-level favorites with persistent `mark.p-highlight`, `ui/HighlightPainter.ts`, legacy migration, new happy-dom DOM tests.*
*Updated: 2026-09-18 — #299: Enter in the composer writes a line break (ADR-175); found on the way, `i18n.getLocale` threw for any headless caller of `t()` instead of falling back to English.*
*Updated: 2026-09-18 — #300 open: archived conversations are indexed by vault context, and whether they should be is a product call, not a bug. Parked with the argument on both sides.*
*Updated: 2026-09-18 — #301 opened: the locale tables crossed the 600-line budget and are grandfathered rather than split.*
*Updated: 2026-09-18 — #302: the model catalog had no update path (ADR-179); two Mistral context windows were half their real size.*
*Updated: 2026-09-18 — #303–#304 opened while curating the catalog: Mistral effort values the API does not list, and GPT-5 sent its system prompt as a user turn.*
*Updated: 2026-09-18 — #303–#304: proposed fixes recorded. The OpenAI default moves to `gpt-5.4-mini`, guarded by a test that every default is a selectable catalog model.*
*Updated: 2026-09-18 — #303–#304 done (ADR-180).*
*Updated: 2026-09-18 — #306 opened: on desktop the embedding Worker has never engaged; transformers.js mistakes Electron's Node-enabled worker for Node and rejects `wasm`, so every build falls back to the UI-thread iframe. Fix strategy recorded, not built.*
*Updated: 2026-09-18 — #306 built: a Worker prelude hides `process` from transformers.js; the engaged backend is logged. Awaiting the live check on desktop.*
*Updated: 2026-09-18 — #305: an answer shaped by an armed template's model was labelled and priced with the conversation's model; fixed with ADR-181.*

*Updated: 2026-08-28 — durable root-cause fix + release hardening for the search/related "no results" family. Added `sanitizeMessages` in services/persistence.ts, run inside `parseConversations` (the single load path, `PluginDataStore.loadPluginData`, also used by the data.json watch-reload): it drops null/non-object message elements and coerces a non-string `content` to "" (preserving count/position, which the provider send-path relies on). This fixes the data at the source — the type system promised `Message.content: string` and each element an object, but persistence only ever checked `Array.isArray(messages)`, so an interrupted stream or a legacy entry could leave a null element / undefined content that took down every full-corpus reader. The read-path guards (`buildConversationHaystack`/`bestMatchSnippet`/`conversationChunks`) stay as defense-in-depth. Verified runtime message mutation is `splice`-only (no code assigns null/holes into a live conversation), so post-sanitizer no malformed message can reach the view or the corpus scans. Integration-tested the REAL related-conversations orchestration (`ConversationIndexService` sync→embed→rank) with malformed conversations mixed into the set. Full release pipeline green: eslint (0 errors), file-size guard, `tsc -skipLibCheck` + esbuild production build (main.js emitted, iframe bootstrap inlined, transformers.js runtime + Unicode tokenizer present in the bundle), 519 tests. NOT verifiable in CI/headless: the transformers.js embedding model actually loading in a live Obsidian window (needs a real window; unit tests use a fake provider by design) — if related still shows nothing in-app after this, the remaining suspects are model load failure (surfaces as a Notice) or the 0.35 minScore floor.*

*Updated: 2026-08-28 — search-quality bug (deep review of both search + related): the shared `tokenize` (services/noteRelevance.ts) used `[a-z0-9]+`, dropping every non-ASCII character. For this German-first, multilingual plugin that (a) **fragmented umlaut words** — "Ernährung" → `ern`/`hrung`, so a query cross-matched unrelated German titles on the stray pieces and skewed IDF — and (b) reduced a **non-Latin query** (CJK, Cyrillic) to zero tokens, which `rankConversations`'/`InlineSuggest`'s empty-query branch treats as "list everything", so a Cyrillic/CJK search silently returned the entire conversation list instead of a filtered result. Switched to a Unicode class `[\p{L}\p{N}]+` with NFC normalization (so macOS's decomposed-umlaut filenames match the precomposed form); ASCII tokenization is byte-identical, so note relevance / inline suggest / note chunking are unaffected except for the strict improvement. New `tokenize` cases + a German end-to-end ranking case (no umlaut cross-match). Related-conversations is embedding-based and doesn't use `tokenize`, so it's unaffected by this one. Verified: build/lint/514 tests.*

*Updated: 2026-08-28 — bug fix (same root cause, related-conversations surface): "show related" (ADR-109) returned no results too. `conversationChunks` — run for the whole corpus on every embedding-index sync — called `.trim()` on `conv.name` and `m.content` unguarded, so a single malformed record (null message element, non-string `content`/`name`, non-array `messages`) threw, rejecting `doSync` → `getRelated` → `getRelatedConversations`, which the panel's catch turns into the "related failed" notice / empty list. Coerced every field to a safe string (`asText`) and guarded the messages array (including the empty-conversation fallback chunk); added a malformed-records regression test to `tests/conversationText.test.ts`. Same shape as the lexical-search fix below — anything reading message bodies across the whole corpus must tolerate the shapes `parseConversations` doesn't validate.*

*Updated: 2026-08-28 — bug fix: conversation search returned **nothing for every query** after the content-search overhaul (ADR-106). `buildConversationHaystack`/`bestMatchSnippet` read `conv.messages`/`m.content` for the whole corpus up front, but `parseConversations` only guarantees `messages` is an array — not that each element is an object or that `content` is a string. A single malformed record (a null message element or `content: undefined`, e.g. from an interrupted stream or a legacy entry) threw, aborting the entire ranked build so no results surfaced — while browse mode (never builds haystacks) still worked, matching the "browse fine, search empty" report. Hardened both helpers to coerce each message to a safe string (`messageText`) and tolerate a non-array `messages`/missing `name`/`summaryText`; added a malformed-records regression test. Pre-overhaul search was title-only and never touched message bodies, so this shape was newly load-bearing. Code-only; the three search surfaces (history panel, quick switcher, command-palette picker) all share the fixed helpers.*

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
*Updated: 2026-09-12 — template surfacing moved from the header to the assistant turn label (ADR-129) and the `DU`/`PYTHIA` role captions dropped. Paid for under the ADR-097 ratchet by extracting `ui/turnLabel.ts` out of `sidebar.ts` (2,018 → 1,951, ceiling lowered), which also made the label rules unit-testable headlessly — the 5 caption cases + 3 label cases are unit tests on the module rather than view-mount smoke tests, keeping `tests/viewRender.test.ts` under its own ceiling. Incidental cleanup: `services/pathUtils.ts` (`noteBasename`) replaces the vault-path basename expression duplicated in four places. 630 tests.*

*Updated: 2026-09-14 — Merge links (ADR-130), the inverse of Fork. New capability, not a bug fix, so not separately numbered (same convention as `effort` in #87 and PDF context in ADR-041). Two incidental cleanups landed with it and are worth recording on their own: (1) **three hand-rolled copies of the same 450 ms long-press** (the Send summary menu in `sidebar.ts`, the fork anchor's Open control in `ForkController`, and the merge surface that would have been a fourth) collapsed into `ui/longPress.ts` — one `attachLongPress(el, onFire, { delayMs, bind })` with both binding modes (Obsidian's `registerDomEvent`, or direct listeners plus a real cleanup), now unit-tested with fake timers across all five cancel paths rather than untestable inside a view; (2) `unwrapCodeFence` moved from `sidebar.ts` into `services/messageUtils.ts` as a pure function with its own tests — it took no view state and only lived in the view by accident; and (3) `applyAccentContrast` moved into a new `ui/accentContrast.ts`, which reads nothing from the view but the root element and keeps `services/color.ts` DOM-free, so the contrast math stays unit-testable while the probe-span mechanics live with the other UI helpers. Together they paid for the merge wiring under the ADR-097 ratchet (`sidebar.ts` 1,951 → 1,920, ceiling lowered). **New durability guard:** `evictConversations` now protects merge targets alongside starred conversations — the `maxConversations` cap would otherwise silently delete the far end of a link the user placed deliberately, leaving a mark that stops painting with nothing on screen to explain it; and `persistence.normalizeMerges` drops malformed link records on load, because the paint path reads `merges` for every rendered message and one bad record would take the message body down (same rationale as `sanitizeMessages`). **Design correction within the same session:** the first cut of merge shipped without a banner on the conversation a link points at, so the relationship was visible from one side only — the one place it genuinely failed to mirror fork, which announces itself at both ends. Fixed by deriving the inbound list on read (`incomingMergeLinks`, pure and unit-tested) rather than storing a back-reference, so there is still exactly one record per link and nothing to keep consistent on delete. 665 tests.*

*Updated: 2026-09-15 — **a feature that had been shipped but never worked.** A reported screenshot of an unreadable table led to `decorateCodeBlocks`, which has wrapped every rendered `table` in a `.p-scroll-frame` with `overflow-x: auto` and drag-to-pan for some time, and to the matching "Wide table scroll containers" CSS block. Neither had ever had a visible effect: a table with automatic layout shrinks to its container instead of overflowing it, so the frame had nothing to scroll, and the wrapper plus its stylesheet comment read as a finished feature to anyone auditing the code. Worth recording as a class of bug, not just an instance — **a scroll container is not evidence that anything scrolls**, and a CSS-only capability with no test and no runtime check can sit broken indefinitely while looking implemented. Fixed in ADR-131 with the two rules the frame was always missing, and verified by measurement in headless Chromium rather than by inspection: before, table 296px inside a 296px frame, `scrollWidth === clientWidth`, single words split across two line boxes; after, 346px inside 296px, scrollable, one line box. Three helpers were extracted while fixing it, each now shared rather than living wherever it was first needed: `ui/tableDecorator.ts`, `ui/dragToPan.ts` (out of `CodeBlockDecorator`, shared by code, diagrams and tables) and `ui/renderMarkdown.ts` (replacing three identical render callbacks in the view, which is also what closed the coverage gap: summary cards and the fork/merge anchors rendered bare markdown and got no table treatment at all). `sidebar.ts` 1,920 → 1,912, ceiling lowered. 673 tests.*

*Updated: 2026-09-15 — **a fix whose comment and code had drifted apart.** `adjustForKeyboard`'s header comment said it applied `padding-bottom` equal to the overlap; the body set an explicit `height` instead, and the vestigial `container.style.paddingBottom = ''` reset was the fossil of the original approach. Combined with `.pythia-view { overflow: hidden }` and with no test for whether a keyboard was actually open, it shrank the panel on every viewport event and left 67px of uncovered leaf below the composer, while cropping the input area's own safe-area padding — a hard rule of the project — down to 1.4px. Two lessons worth keeping. **A comment that describes a different mechanism than the code is a defect report, not documentation**; this one had been accurate once. And **compensating for an obstruction requires establishing that the obstruction exists**: the arithmetic here measured "how much screen is below this panel", which is only an obstruction when the panel is the bottom-most element, and in a stacked sidebar it never is. Fixed in ADR-132 by gating on a real keyboard and returning to padding. Diagnosed by measuring the user's screenshots (strip height, strip luminance against the panel background, and the distance from the Send button to the panel edge) after an initial hypothesis about double-counted safe-area padding turned out to be wrong — worth noting that the measurement cost minutes and overturned a confident but incorrect answer already given. 681 tests.*

*Updated: 2026-09-15 — **data loss: a completed assistant answer disappeared.** Reported with a screenshot of the same prompt sent twice, the first answer gone and every earlier turn intact. Root cause was not the send path (the message is pushed and saved immediately, the debounce is 300ms, `onunload` flushes) but the reload path: `watchDataJson` reloads on any external data.json mtime change — which its own comment notes fires *constantly* on iCloud and Obsidian Sync vaults — and `loadPluginData` ended with `p.conversations = loaded`, replacing memory wholesale with no recency check, after `reloadFromDisk` had cancelled the pending write. The single guard, `shouldRefuseLoad`, only covers a load of zero conversations. Fixed in ADR-133 by reconciling per conversation on `updatedAt`. **Three lessons worth keeping.** A guard against one catastrophic case (`loaded.length === 0`) reads as protection for the whole operation and is not; the narrowness was invisible at the call site. **Replacing durable state from a less-trusted source requires a comparison, not just a null check** — "reload" was implemented as "overwrite" throughout. And the own-write suppression window was measured from before an `await` that can take seconds on mobile, so the plugin could re-read its own writes as external, making the dangerous path fire far more often than intended; **a timing window around an await has to be closed after it resolves, not only before it starts**. Also noted: `tests/persistence.test.ts` crossed the 600-line budget and was split rather than grandfathered, which the guard's message explicitly prefers. 690 tests.*

*Updated: 2026-09-15 — **two shipped fixes that fixed nothing, and what let them ship.** Both went out in 2.10.1 and the user reported no change. Neither failure was a coding mistake; both were verification mistakes, which is the more useful finding. **The table fix asserted the wrong thing.** ADR-131's check asked whether the scroll frame scrolled at all, and it did — by 31px, from the cell `min-width` floors alone — while the actual symptom, a 200-character cell wrapped into an 18-line 399px row, was untouched and unmeasured. A boolean pass criterion on a continuous problem: **the assertion has to measure the thing the user is complaining about**, here row height and line count, not overflow existence. **The dead-space fix trusted a bad measurement over a sound argument.** The correct diagnosis was made first, then abandoned because a luminance sample seemed to contradict it — a sample taken from a lossy JPEG, averaged across a band including the sidebar rail, against a baseline from elsewhere in the same image. Re-measured on a PNG over the panel only, the strip is pixel-identical to the chat background, confirming the original reading. **A measurement that overturns a mechanical argument deserves more scrutiny than one that confirms it, and the burden scales with how convenient the result is.** Both corrected in ADR-134; ADR-132's change is kept on its own merits (setting a height on an `overflow: hidden` pane is unsafe regardless) with only its causal claim withdrawn. 694 tests.*

*Updated: 2026-09-15 — **reviewing a fix before trusting it, after two failed attempts.** The user declined to accept a third fix on assurance and asked for a review; it found one real defect. The conditional bottom inset was recomputed on `visualViewport` events, focus, blur and open — never on a leaf opening, closing or resizing, which is precisely the event that changes whether anything sits below the panel. It would have gone stale on the first sidebar layout change and produced a fourth failed attempt. **The general lesson: a value derived from layout must be recomputed on every event that can change that layout, and the list of such events is rarely the list you first think of.** `visualViewport` felt like "the viewport changed" when it is only "the visible area changed". Two supporting habits paid off here and are worth keeping: substituting the value iOS computes for `env(safe-area-inset-bottom)` so the headless test could not pass for the wrong reason (Chromium reports zero), and reaching for evidence already on the reporter's screen — the single occurrence of `word-break: normal` in the stylesheet proves the table selector reaches the real table, which no local harness could establish. 694 tests.*

*Updated: 2026-09-15 — **glossary (ADR-136), and a design answer that made the code smaller.** The feature was specified through three questions, and the third — mark every occurrence everywhere, rather than only the passage looked up — removed a data structure instead of adding one: because the vault note is the only source of truth, no `Conversation` field was needed at all, unlike favorites, fork origins and merge links which each store a span. Worth keeping as a pattern: **asking where the truth should live can delete state rather than add it.** Two incidental cleanups paid for the new code under the ADR-097 ratchet, both of which stand alone: `paintCitations` moved out of `sidebar.ts` into `ui/citationPainter.ts`, where it sits with the parser and the sources row it belongs to; and `withConversationBacklink` replaced the `obsidian://pythia?cmd=resume` URI that Insert-into-note and Save-to-inbox each built independently — a link format duplicated across call sites is one that will eventually disagree with itself. `SelectionController` had crossed the 600-line default and came back under it rather than being grandfathered. 723 tests.*

*Updated: 2026-09-15 — **glossary aliases (ADR-137): the feature was half-built and the gap was in the data model, not the code.** The user asked whether synonyms and language variants should be covered. They should, and not marginally: German inflects, so the nominative form a glossary entry is filed under is often the *least* common form in the text, and a bilingual conversation names the same concept in two languages. Exact whole-word matching therefore missed most real occurrences of terms it claimed to know — a feature that looks correct in every test written against the form it stores. **The test suite matched the implementation's assumption rather than the user's text**, which is how a gap this size stayed invisible: every painter test used an uninflected English noun. Two decisions worth keeping. **Stored beats derived when the user can correct the store**: a stemmer would cover more forms with no maintenance, but ADR-136's whole premise is a note the user can fix by hand, and a stemmer's mistakes are unreachable — the cheaper mechanism would have quietly undone the expensive decision. And **aliases broke a contract rather than extending one**: once the matched text is no longer the term, `match[0]` as the entry key is wrong at two call sites at once, so `buildTermMatcher` became `buildTermIndex` returning the canonical map instead of leaving each caller to guess. A returned regex that callers must interpret is a contract waiting to be broken; returning the interpretation with it is not more code, it is the same code in one place. 738 tests.*

*Updated: 2026-09-15 — **a correct design argument applied to the wrong element (ADR-138).** The glossary anchor rendered faint — faint rule, faint icon, faint label — and next to the fork and merge anchors it read as disabled rather than as a peer. Nothing was broken and no rule was violated; ADR-136's reasoning was simply carried one element too far. That reasoning is right about the **mark**: it repeats many times per screen, so it has to be quiet. It is wrong about the **anchor**, which is opened one at a time by a deliberate tap and is the answer the user just asked for. **A property argued for one element does not transfer to another just because the same feature owns both** — the argument's premise, here "it repeats", has to be re-checked against the new element, and it did not hold. Worth noting how it surfaced: the box model, spacing, body type and meta row were already identical across the three anchors, so nothing looked wrong in the stylesheet — only colour and weight had drifted, and that is invisible until the three are seen side by side on a real screen. A screenshot from the user found in seconds what reading the CSS did not. The merge anchor had drifted the same way and was aligned in the same pass. 738 tests, unchanged — CSS and one button label.*

*Updated: 2026-09-15 — **five attempts, and the evidence that ended it in one sentence (ADR-147).** Four shipped fixes for the dead space below the composer all changed padding *inside* the panel. The user then mentioned that the conversation panel leaves a gap **left and right too** — and since `.p-history` is `inset: 0` on `.pythia-view`, it outlines the panel's real edges. No padding inside the composer can produce a gap on the left, so every previous diagnosis died at once: the panel was inset on three sides by its own leaf container, and only the bottom strip was big enough to report. Three lessons, in order of value. **When a fix fails twice, stop improving the guess and go get different evidence** — every one of those four diagnoses was made from a screenshot cropped to the bottom edge, and one question ("does anything else look inset?") would have ended it after the first failure. **A number that matches a hypothesis is not evidence for it when a second mechanism yields the same number** — 42 minus 8 equalling "exactly one 34pt home indicator" felt like measurement and was numerology; an ordinary 34px bottom padding fits identically. And **an overlay with `inset: 0` is a free ruler**: it draws its containing block, which is now the documented way to check whether the panel really fills its leaf. 765 tests.*

*Updated: 2026-09-15 — **a setting that only reached half of what it named (ADR-148).** `outputLanguage` had existed since ADR-053, defaulted to `auto`, and was wired into every utility prompt — and into none of the chat answers. So the one output the user actually reads was the one output the language setting never touched: pin German, ask in English, get an English answer while every summary comes back in German. Nothing was broken in the sense of failing; the setting simply stopped at the edge of `BaseProvider`'s utility methods and nobody had followed it into `ContextBuilder`. **The audit question this earns: for every setting whose name is a global claim ("output language", "custom instructions", "effort"), list the code paths that produce that kind of output and check the setting reaches all of them** — a setting that covers most of its surface looks, in testing, exactly like one that covers all of it. Two further notes from the build. The extension to six options was two lines and the per-conversation override was a field; the work was in the threading — four utility methods had no conversation in reach, which is itself a small signal that those methods had been treated as context-free when they never were. And `auto` is implemented as the *absence* of an instruction rather than an instruction saying "follow the conversation", because a model given nothing already follows the conversation while a model given a sentence about languages has something to reason about — **the null option should usually be null, not a sentence describing null.** +16 tests (781).*

*Updated: 2026-09-15 — **the question behind the question (ADR-149).** Asked "are there standards for glossaries?", I answered with standards and then designed a flashcard reviewer, a scheduler and a modal UI — for a user whose entire reason for asking was to *not build* those. Three turns of design work aimed at the wrong target, and the correction was one sentence. **A question about standards is usually a question about what you can avoid building; a question about formats is usually a question about who else has to read the file.** The tell was available immediately: nobody asks about interchange formats for data only their own code will ever open. Two real defects surfaced once the frame was right, and neither would have been found by building the reviewer. First: `aliases` lived inside `%% pythia: … %%`, an Obsidian **comment** — invisible to every external reader, so the field effectively did not exist the moment anything but Pythia read the note. A store that is private by accident looks identical to one that is private by design, right up until interoperability is asked for. Second: the flat alias list conflated inflections with translations, which was tolerable while the vault was bilingual and became wrong the moment ADR-148 shipped six languages — **a schema that encodes an assumption about scale silently expires when the scale changes, and nothing fails loudly when it does.** The general habit worth keeping: when a user asks about a standard, find out which *consumer* they have in mind before proposing anything, because the consumer determines the format and the format is the whole deliverable. +16 tests (797).*

*Updated: 2026-09-15 — **a format designed for the wrong reader (ADR-150), one day after shipping it.** ADR-149 moved glossary fields out of an Obsidian comment and into visible labelled markdown, so that external tools could read them. Correct diagnosis, incomplete fix: it made the *fields* visible to a human reader while leaving every *term* invisible as a **row**, which is the only unit either query surface in Obsidian has. Verified rather than assumed this time — Bases: "each row is a file, and each column is a property of that file"; Dataview inline fields attach to the page, with no per-heading scope. **The question to ask of any interchange format is not "can the data be seen?" but "what is the unit the consumer iterates over?"** — ADR-149 answered the first and never asked the second, and one afternoon of writing a bespoke label convention was the price. Two further lessons. The verification that settled it took four web fetches and would have cost the same before the format was designed; I had even proposed `**Forms**::` as a Dataview inline field without checking that inline fields cannot scope to a heading, which would have made that "one-character fix" wrong too. And the correct storage was already on the table — I had flagged note-per-term as an unevaluated alternative two turns earlier and extended the old decision anyway, because the new requirement arrived as a use case rather than as a schema change. **A new use case is a reason to re-litigate the storage decision, not to extend it.** +34 tests (823).*

*Updated: 2026-09-15 — **a feature that was already built (ADR-151).** "Highlight a name and see who they are in later conversations" arrived as a new feature request and was, on inspection, ADR-136 with a different noun: mark every occurrence, open an anchor, resolve vault-first. Nothing in that mechanism was ever about terminology. **When a request describes a behaviour you already have, the useful question is what the existing mechanism is actually general over** — here, entities, with terms having been merely the first kind. Recognising that turned an estimated second subsystem into three fields and a folder, and it is the difference between one mark-and-anchor implementation and two that drift from the first day. Two things the build surfaced. The duplicated selection rule appeared *within the hour*: Define and Person accept the same shape of span, and the second handler was a copy of the first before either was committed — duplication is fastest to remove while both copies are still in your head, and the file-size ratchet is what forced the issue rather than my own judgement. And the genuinely person-specific part turned out to be the **prompt**, not the plumbing: a term the model has never met is rare, a person it has never met is the normal case in a working vault, so `describePerson` leads with the passage and is told to decline rather than guess. **The part of a feature that resists generalization is usually the part that encodes its risk** — worth finding deliberately rather than discovering after shipping. +16 tests (839).*

*Updated: 2026-09-15 — **a fix that was a copy of a fix (ADR-152).** "The last conversations can't be tapped on iOS" had already been fixed once, in `d3b3665`, by hand-rolling the keyboard arithmetic inside `HistoryController` — arithmetic that existed, unit-tested and with a documented threshold, in `ui/keyboardInset.ts`. The copy dropped `MIN_KEYBOARD_INSET`, the one part of it that encodes *why* the naive subtraction is wrong, so it treated Obsidian's own bottom chrome as a keyboard and padded the list at rest. **A duplicated calculation does not merely risk drifting from the original; it usually starts life already missing the correction the original was written to carry** — the thresholds, the guards, the special case someone hit once. Worth checking for at review time by asking what the original knows that the copy does not. The second half is a plainer lesson: auto-focusing the search input is right on desktop and hostile on touch, and it had been specified once (ADR-107) in terms of what the control does rather than what the platform costs. **An affordance defined as "opens focused" has smuggled in an assumption about input hardware.** Also worth noting how the ✕ went missing: not deleted, but removed as collateral by `-webkit-appearance: none` — a reset added for a real reason on a different control, which silently took a native affordance with it. Global element resets are cheap to add and their losses are invisible until someone reports the absence. +3 tests (842).*

*Updated: 2026-09-15 — **a layout that could only ever work in the cases it was designed against (ADR-153).** ADR-140 gave the sources row a 54px label column so stacked rows would start their chips at one x. It does not do that, and never could: `.p-sources-row` is `flex-wrap: wrap`, and **a wrapped flex line starts at the container edge, not under the first item.** The column aligns each row's *first* line and nothing else. With two or three citations — every case it was designed against — a row never wraps, so it looked right; the first nineteen-citation answer showed four unaligned lines out of five, each still paying 54px of a ~300px sidebar. **A layout rule exercised only by short content has not been tested, it has been avoided** — the question to ask of any alignment is what happens on the second line, and flex answers that differently from text flow. This is also the *third* correction to the same eleven lines of CSS: ADR-144 already removed a false claim about where the 54px came from and left the claim about what it achieved standing. **When part of an ADR's justification turns out to be wrong, the rest of it is evidence, not background** — the provenance was corrected and the mechanism was never re-checked. The bracket removal rides along for a related reason: `[[ ]]` carried "this is a note you can open" on a surface with nothing else to say it, and once a run-in label says it, four characters per entry on the narrowest row in the plugin are pure repetition. +4 tests (846).*

*Updated: 2026-09-15 — **a correct mechanism producing a wrong pixel (ADR-154).** The Send button showed a dark label on the accent fill, and the first instinct — "the accent-contrast helper was never wired up" — was wrong: it is called from `buildUI` and again on every `css-change`, and all four accent surfaces consume the variable it publishes. **When the mechanism is present and the output is still wrong, the bug is in the value or in the paint, and those are different searches.** Both turned out to be live. The value: the helper was allowed to keep a theme's `--text-on-accent` whenever it cleared AA, which sounds respectful and is strictly worse than the alternative — black and white are the two highest-contrast colours against *any* accent, so deferring to a token can only lower contrast, never raise it. **An option that can only ever be worse than the default is not a configuration point, it is a bug with a rationale.** The paint: these buttons are `all: unset`, `all` resolves the *inherited* `-webkit-text-fill-color` to `inherit`, and WebKit reads that in preference to `color` — so the `color:` line never applied on iOS regardless of what the variable held. Worth carrying forward: **`all: unset` is not neutral on inherited properties**, and `-webkit-text-fill-color` is the one that silently outranks `color` on the engine half our users are on. Stated plainly in the ADR: the contrast half is unit-tested, the WebKit half is reasoned from documented cascade behaviour and not reproduced, because there is no iOS here — and if the label is still dark, the next move is to read the computed style on the device rather than add a third guess. +7 tests (853).*

*Updated: 2026-09-15 — **the symptom named the class of bug (ADR-155).** "The segment stays grey until I scroll" is not a styling report, it is a diagnostic: **scrolling cannot change specificity or class state, only compositing — so a bug a scroll fixes is never a cascade bug.** That one sentence ruled out the entire search I would otherwise have started (which rule is winning, what is the specificity, is the class applied) and pointed at the two properties that defer paint. Both were there: a `transition` on the fill, and an ungated `:hover` that iOS leaves stuck on the last-tapped element. Two further notes. This control had already been "fixed" once (ADR-108) for a *legibility* problem, which is a reminder that **a second report about the same component is not necessarily the same bug, and treating it as a regression of the first fix wastes the report.** And ADR-154 changed how this one presented without causing it: setting `-webkit-text-fill-color` — a property nothing was transitioning — made the label flip instantly while the background lagged, turning "nothing happened" into "white on grey". **A fix that makes an unrelated latent bug newly visible is worth noticing as such, rather than being blamed or exonerated wholesale.** Finally, the thing I did not do: a `offsetHeight` read to force a synchronous repaint would probably work and would be a guess stacked on a guess, invisible to the next reader. No test delta (853) — no unit test can observe an iOS composite, and saying so is more useful than a test that passes for an unrelated reason.*

*Updated: 2026-09-15 — **a divergence hiding behind an ADR that said there was none (ADR-156).** ADR-138 established that the fork, merge and term cards are one component differing only in the stroke of the left rule, and that claim was checked where it was written — in the CSS. Placement is not CSS; it is one call in each controller, and the glossary's was different. **When an ADR asserts that two things are the same, the assertion is only as wide as the file someone actually compared** — and "identical component" is a claim about behaviour, not about a stylesheet. The anchor had **no tests at all**, which is the other half of how this survived: there was nothing to fail when the third implementation of a shared pattern did something else. The new suite was checked in the failing direction first (four of five fail with the old call), because a placement assertion is exactly the kind that passes by accident on a DOM that happens to be shaped right. Also worth keeping: the original choice had a *written rationale* that was locally true — a block spliced into a sentence does reflow it — and still wrong, because it compared against no-reflow rather than against what fork already does. **A justification that does not name the alternative it beat is not yet an argument**; this one bought "reflow somewhere else" and never asked whether somewhere else was better. +5 tests (858).*

*Updated: 2026-09-15 — **a rule that arbitrated a case its own code prevented (ADR-157).** The tap chain ranked glossary terms below fork origins and merge links, with a written rationale about deliberate spans beating automatic ones. That comparison had **never once executed**: the painter refused to mark a term inside any deliberate mark, so the two could not co-occur. The precedence was written defensively against a situation that could not arise — and the first time it became real, it was wrong, because a term nested inside a fork has nowhere else to be tapped while the fork keeps the rest of its span. **Defensive ordering written for an impossible case is not harmless; it is an untested branch that will be consulted exactly once, at the moment the assumption changes, by someone who trusts it.** The exclusion that made it unreachable had its own bad justification — "overlapping wrappers that later unwrapping would have to untangle" — which was false on inspection: the marks nest rather than overlap, terms paint last, and each unwrapper targets its own class. Neither claim was ever checked because neither was ever exercised. Two smaller things fell out of reading the chain: `.p-person` marks had been painted since ADR-151 and were dead on tap, because the lookup asked for `.p-term` only; and `repaintTerms` matches within a *single* text node while unwrapping splits text, a latent mismatch that only becomes reachable once marks and terms share text (`normalize()` now closes it). **Finding two unrelated defects while reading code for a third is the usual return on actually reading it.** +19 tests (875).*

*Updated: 2026-09-15 — **"recently introduced" described a latent bug becoming reachable (ADR-158).** The favorites summary stopped producing a card, reported as a recent regression, and my first four hypotheses were all recent changes of mine — none were involved. The cause was `response.content[0]` in `AnthropicService.callUtility`, which predates everything in this session: a response is a **list** of content blocks, and with extended thinking the first is `thinking`, so the type check failed and the call returned `""`. What actually changed was the reporter's model and effort setting, visible in a screenshot they had sent two messages earlier for an unrelated bug. **When a report says "recent", the honest reading is "recently reachable" — ask what changed in the user's configuration, not only what changed in the diff.** The second lesson is about the sentinel: `callUtility` documents "return "" on empty/error", so one value meant *the model produced nothing* and *the call failed*, and every caller collapsed both into "nothing to show" without a word to the user. **A sentinel that conflates success-with-no-output and failure guarantees the resulting bug is unreportable** — it took a reproduction harness and four probes to establish something a single Notice would have said. Method note worth keeping: the UI path was ruled out by *mounting the real view and reproducing*, not by reading it, which is what turned a widening guess-space into a narrowing one. +5 tests (880).*

*Updated: 2026-09-15 — **the fourth report of one gap, and the point where debugging the measurement stopped being the right move (ADR-146).** Dead space below the composer was diagnosed three times: a height assignment (ADR-132, withdrawn), `env(safe-area-inset-bottom)` behind a measurement (ADR-134), a staleness bug in that measurement (ADR-135). The user then tested several themes and said the space was Pythia's. Measuring their screenshot: 42 CSS px below the send button where 8 was intended — 8 plus exactly one 34pt home indicator, so the conditional override still was not firing. The arithmetic behind it is correct and has now produced a wrong answer on the only device that matters, twice, for reasons not observable from here. **At that point the question stops being "what is wrong with the measurement" and becomes "what is this measurement buying"** — and the answer was insurance against a case that is rare, one line to fix if it appears, and was costing 34px on every screen in the meantime. **Two attempts at conditional logic is the signal to ask whether the condition is worth having.** The underlying API lesson generalizes: **`env()` describes the device, not the element.** It cannot tell you whether *this* element is the one at the screen edge, so any code bridging that gap is reconstructing a fact the layout already knows — which is why three ADRs of increasingly careful reconstruction still got it wrong. Deleting the mechanism removed a runtime measurement, a CSS custom property, two exported functions and their test suite. 765 tests.*

*Updated: 2026-09-15 — **a working fix hid a wrong diagnosis for three ADRs (ADR-144).** ADR-131 said Obsidian themes' `word-break: break-all` was splitting German words inside table cells; ADR-134 repeated it and ADR-135 built a verification on top of it. Measured with no theme loaded at all, the split reproduces from Pythia's own `.p-ai-body { word-break: break-word }`. Three things kept the error alive, and each is worth naming. The blame was **plausible** — themes really do set `break-all`, so nobody looked further. The harness **emulated a theme**, so it was structurally incapable of telling the two causes apart; it could only ever answer "does our rule win", never "win against what". And above all **the fix worked**: a correct remedy retires the question before anyone asks whose rule was being overridden. **A fix that works is the strongest reason a wrong diagnosis survives** — so when a fix overrides something, name what it overrides and check the thing is actually there. One measurement without the theme settled it. The same omission produced a second finding in the same pass: ADR-140 justified a 54px label column as "the reference row's existing label width", reading the spec instead of the DOM — that row has no label, and a 2026-09-10 audit had already flagged the discrepancy and left it standing. **A known-stale line in a spec is a trap primed for the next person to read it**, and the next person was me. Both corrections are marked in place rather than rewritten away: a doc that quietly changes its story teaches nothing. 769 tests, zero lint warnings.*

*Updated: 2026-09-15 — **a rule stated in an ADR, broken three days later by its own author (ADR-143).** ADR-107 called the conversation panel "the single in-view conversation-search surface". ADR-130 then shipped a second one — a modal — for choosing a link target, on the same screen. Nobody was careless: the modal already existed and worked, and reaching for it was locally correct every time. **A rule about what a codebase may contain is not enforced by having been written down; only a shared implementation enforces it.** The same lesson has now arrived three times in two days from three directions — duplicated CSS (ADR-142), duplicated prompt rules (ADR-141), and now a duplicated surface. Two smaller findings. **The panel's `historyCleanup` was assigned inside a `setTimeout(…, 0)`**, so for one tick the panel was open and its controller did not know it, and a second open stacked a second overlay; unreachable by tapping, which is why it survived — **a state flag set asynchronously is a flag that is wrong for a while, and "no user is that fast" stops being true the moment code opens the thing.** And the fix was paid for by finally doing the ADR-097 extraction the file-size guard had been asking for in a TODO: the mount fixture to `tests/helpers/viewHarness.ts`, the panel describes to `tests/historyPanel.test.ts`, `viewRender.test.ts` from 650 to 331 lines, and **the last grandfathered test ceiling deleted**. 766 tests.*

*Updated: 2026-09-15 — **a visual difference that contradicted the feature (ADR-142).** Merge was designed as fork's inverse and then given a dashed rule, a different icon and a different label, so the UI said "different kind of thing" about two things that are one relationship seen from two ends. The user caught it by quoting the design note back: *you yourself wrote it's same same but different to forking*. The mechanism is worth naming, because it is not carelessness: each difference was individually justified when it was made — ADR-130 wanted the two anchors told apart, ADR-138 turned that into a stroke rule — and **a rule invented to separate two things will happily separate a third that should not be separated.** Solid/dashed/dotted was carrying a three-way distinction where only a two-way one existed. The fix deleted 34 lines of duplicated CSS by grouping the merge selectors into the fork rules rather than restating them: **two components that must look identical should share the rule, not the value** — styled-to-match drifts, and this pair had already drifted twice in two days (label weight and title size in ADR-138, the rule itself here). One thing deliberately left different: the in-text marks. With the cards unified, the mark is the only signal of which kind of thing a tap will open — **before removing the last instance of a distinction, check whether it is also the only one.** 758 tests, unchanged: CSS, one icon and two strings.*

*Updated: 2026-09-15 — **a prompt rule obeyed literally and evaded structurally (ADR-141).** Summaries were arriving with the session narrated into them — "a summary was generated and inserted at the top of `_inbox/Unbenannt.md` … as requested" — even though the prompt forbade exactly that. It forbade the *opening phrases*: "This conversation…", "The user…", "We discussed…". The narration simply moved into the body, which is the general failure: **a rule written as a list of banned phrasings gets obeyed to the letter and routed around; ban the behaviour and say what to do instead.** The second lesson is that the model was not wrong. The conversation's substance genuinely was an action, and the prompt asked for "important outputs" — so it reported the output. **Before calling model output a compliance failure, check whether the instruction actually asked for it.** Two structural findings came out of the same read: the two summary prompts held duplicate copies of the same rules, which is how one of them silently stops matching the other, and "keep it brief" was doing work only a countable number can do — models disagree about brief, and that disagreement was precisely the reported symptom. Finally, scope: a prompt fix only reaches summaries generated *after* it, and nobody regenerates old ones, so the reported screens would have stayed broken — **when a fix depends on a future write, ask what happens to the data already on disk.** Hence the display clamp, which is the half that works retroactively. 758 tests.*

*Updated: 2026-09-15 — **a conditional label, found by adding a third row (ADR-140 follow-up).** The vault citations row was labelled `VAULT` when a web row was present and `SOURCES` when it was not — so one row read two different ways depending on what else happened to be on screen. With two rows that was invisible; the third row made it a wart worth deleting, and deleting it also deleted the branch that produced it. **A label that depends on its neighbours is a label that means something different every time you see it** — and a conditional whose only job is presentation usually survives only because nothing has yet been placed next to it. The row order changed at the same time, and the reason is worth recording because it is not arbitrary: TEMPLATE → VAULT → WEB runs from what the reader owns to what they do not, which is also roughly how much they should trust each, and it puts the longest, most-wrapping row last. Also noted, since the two rows now sit together and look identical: `TEMPLATE` is a fact Pythia recorded (`msg.templateId`) while `VAULT` is the *model's* claim about what it drew on — same styling, different epistemic weight, which is part of why only the claims carry numbers. 752 tests.*

*Updated: 2026-09-15 — **a fact in the wrong row (ADR-140).** ADR-129 moved the template name out of the header and into the assistant turn label. Removing it from the header was right; the landing spot was not, and the tell was available at the time: every other item in that label — model, clock, token counts — is a fact about the *generation*, while a template is a note the user wrote. **A label is a category, and adding an item that does not share the category is how a category quietly stops meaning anything.** The right home already existed: the sources row lists what the answer was made from, and had been rendering vault notes as `[[wikilinks]]` since web search landed — so the move needed no new affordance, no new colour and no new icon, just an extra row and a shared `renderWikilink`. Worth noting what the move bought beyond tidiness: the template is now **openable**, which as a text caption it never was, and that capability came free from putting it where things of its kind already live. The one new piece of design was a 54px label column, and only because three stacked rows made ragged labels visible where two had not — reused from the reference row rather than invented, so the design system gained no new number. `ui/sourcesRow.ts` also got its first tests in the process; it had none, which is why a fourth parameter felt risky enough to write nine. 752 tests.*

*Updated: 2026-09-15 — **four small UI details, and the one that needed a microscope (ADR-139).** Three were judgement: an explanatory prefix nobody needs, a long open label that wrapped a row, and a date format that differed per locale. The fourth — "the refresh icon sits too deep" — was a sub-pixel claim about an 11px glyph, the kind that is tempting to wave away or to "fix" with a guessed `-1px`. Measured instead, in Chromium against the real stylesheet: **1.09px below the text's cap-height centre**, because `vertical-align: middle` centres on **x-height**, and a micro-label row is caps and digits. The general rule is worth keeping: `middle` is the wrong default beside uppercase or numeric text, which is most metadata rows. The fix constant was then chosen by testing two candidates across sans, serif and mono faces rather than by arithmetic, because a theme can change the font under the rule — the winner holds within 0.11px in all three, and the plausible-looking alternative (a cap-height box, baseline-aligned) missed by 1.5–2px in every font, since an inline-flex whose only child is an `<svg>` has no baseline. **A user reporting a one-pixel problem is reporting a real one; the response is a measurement, not an opinion.** The date change also bought back testability: `toLocaleDateString` output cannot be asserted without pinning a locale, which is why neither formatter had a test — five now. 743 tests.*

---

## Changelog

| Date | Change |
|---|---|
| 2026-09-16 | #246–#247 cost per answer (ADR-163): `models/modelPricing.ts`, `.p-turn-cost` on the label, history-row total, comparison-tab cost, `showCost` setting; next-send estimate removed |
| 2026-09-16 | #238–#245 token-limit support (ADR-162): stop reason surfaced, `Message.truncated`, recovery card (Continue / Retry with raised limit / Compare), one `maxTokensAdvice` rule behind the modal, the Send warning and the card; model profiles |
| 2026-09-16 | #181–#236 second whole-codebase review (ADR-161): shared dismisser + lint guard, per-keystroke work cached/debounced, untouched overrides stay inherited, ADR-158 applied to four older paths, hover fills under `(hover: hover)`; three more principles |
| 2026-09-16 | Model comparison on the last exchange (ADR-160): ⇄ Compare in the long-press bar, tabbed card, keep → forks, send blocked while pending; #179–#180 Tavily header + shared long-press |
| 2026-09-16 | #124–#178 whole-codebase quality & security review (ADR-159): boundary validation, no-overwrite create_note, one retry policy, tidy titles, strict tsconfig + rule-encoding lint; three principles recorded |
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
| 2026-08-28 | #125 Tier 2: covered the remaining two `renderMessages` modes (`tests/viewRender.test.ts`, +4 cases, now 451 tests). Incremental append — a new turn on the same conversation appends without a full rebuild (asserted by the original bubble node surviving, which `messagesEl.empty()` would detach). Delete-last-exchange — `confirmDeleteLastExchange` splices the last turn(s) from model + DOM; empties → welcome state; and the full-rebuild **fallback** when the tracked tail id is gone (stale anchor → clean rebuild, no leaked rows). Each validated by breaking its branch (force-rebuild fails the append test; early-return-on-stale-anchor fails the fallback test) |
| 2026-08-28 | #125 Tier 1: added send/stream smoke tests (`tests/viewRender.test.ts`, +3 cases, now 447 tests) covering the `sendMessage` coordinator — the untested sibling of `renderMessages` where the 2.1.1 "answer streams then vanishes" bug lived. Stub the provider seam (`plugin.llmRouter.streamMessage`) and assert each of the three outcomes: completed-with-text (assistant reply renders + persists), completed-empty (streaming bubble dropped, only the user turn kept), and errored (partial discarded, user turn still persisted — the pre-2.1.1 "failed send lost the user's message" guard; not stuck streaming). Validated by removing the assistant-message push and confirming the completed case fails |
| 2026-08-28 | #125 follow-up: added a conversation-switching smoke test (`tests/viewRender.test.ts`, now 6 cases) — opens one conversation, switches to another and back, asserting the target's surfaces render on switch *and* the previous conversation's don't leak (a full-rebuild must clear the prior DOM). Validated by removing `messagesEl.empty()` from the full-rebuild path and confirming the no-stale-leak assertion fails. 443 → 444 tests |
| 2026-08-28 | #125 resolved: added view-render smoke tests (`tests/viewRender.test.ts`, 5 cases) — the coverage gap that let #124 ship. They mount the real `PythiaSidebarView` + a headless plugin against a stubbed `obsidian` (shared `tests/mocks/obsidian.ts` wired via a Vitest `resolve.alias`; `.ts` preferred over the `main.js` bundle; Obsidian DOM helpers polyfilled onto happy-dom), then assert each major surface (summary cards, context inspector, fork banner, message bubbles, welcome state) appears in the DOM on open. Fresh plugin per test so the single-render "open" flow isn't masked by a second render. Validated by reintroducing #124 and confirming the two regression tests fail. 438 → 443 tests. See ADR-105 |
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


---

## Quality & security review (#124–#178) — 2026-09-16

Whole-codebase review at v2.15.0 (ADR-159). Every item below is **resolved** in this session unless marked otherwise. Grouped by the quality attribute it serves; the number is the reference for future entries.

### Data integrity & persistence

| # | Finding | Fix |
|---|---|---|
| 124 | `mergeSettings` was `Object.assign` — a `null`, wrong-typed or unknown-enum saved value overrode the default and failed far away | Type-check each key against its default; enum keys validated; unknown keys dropped (`services/persistence.ts`) |
| 125 | `null` for an optional setting (`maxTokens`, `temperature`) was stored as `null` | Read as "unset" |
| 126 | `parseConversations` proved only `id`/`messages`; `contextNotes: null`, `provider: "gemini"`, a numeric `name` threw later | `sanitizeConversationFields` repairs name, systemPrompt, contextNotes, provider, model, resumeMode, writeMode, outputLanguage, favorites |
| 127 | A message without `role`/`id` survived load and could not be sent or rendered | `sanitizeMessages` drops it |
| 128 | data.json watcher hardcoded `.obsidian/plugins/…` — never fired on a custom config dir | Path from `manifest.dir`, `normalizePath` |
| 129 | Watcher reload could overlap itself when a reload outlived the 5 s poll | In-flight guard |
| 130 | Watcher errors swallowed by `catch {}` | Logged via `describeErrorForLog` |
| 131 | Four `getSecret` awaits ran serially on startup; a throw aborted load | `Promise.all`, per-secret try/catch |
| 132 | `todayISO()` used UTC — late-evening conversations named and filed under yesterday | Local calendar date |
| 133 | Conversation-panel recency sort used `new Date(undefined).getTime()` → NaN comparator | ISO string compare |
| 134 | `LLMRouter.byProvider` returned `undefined` for an unknown provider string | Falls back to anthropic; `updateApiKey` routed the same way |
| 135 | Embedding model ids and similarity presets had no exported list to validate against | `EMBEDDING_MODEL_IDS`, `RELATED_SIMILARITY_PRESETS` |

### Providers & network

| # | Finding | Fix |
|---|---|---|
| 136 | Anthropic SDK's default 2 retries stacked with ours → up to 9 attempts, invisible to the log | `maxRetries: 0` |
| 137 | Same on the OpenAI client | `maxRetries: 0` |
| 138 | OpenAI: malformed tool-call JSON executed the tool on `{}` | `parseToolArguments` → `Error:` tool result, tool not run |
| 139 | Mistral: same | Same |
| 140 | A tool call that never received an `id` was echoed into a request the API rejects | Dropped |
| 141 | `parseToolArguments` accepts only a JSON object (not `null`, arrays, scalars) | New helper + tests |
| 142 | Any `TypeError` classified as network → programming errors retried and shown as connectivity | Only fetch-shaped messages count as network |
| 143 | Generated conversation titles carried quotes, trailing periods, `Title:` labels, markdown | `cleanGeneratedTitle` |
| 144 | Chapter names, same | Same |
| 145 | Empty title reply became `"New Conversation"` and renamed the dated conversation | Returns `""`; the dated name stays |
| 146 | No per-turn observability of duration / rounds / tokens | One debug line on completion, one on error |
| 147 | A throw before the provider ran left `isStreaming` true — composer disabled, Send reading "Stop", unhandled rejection | `sendMessage` try/catch, notice, state reset |
| 148 | `sendFailed` locale strings (en/de) | Added |

### Vault writes & security

| # | Finding | Fix |
|---|---|---|
| 149 | `create_note` silently overwrote an existing note (no rewrite confirmation) | `NoteWriter.createNote` refuses an existing path |
| 150 | `ToolHandler` create path used the overwriting `writeNote` | Uses `createNote` |
| 151 | Vault paths not normalized (leading `/`, `./`, `//`) | `normalizeVaultPath` |
| 152 | An empty path after normalization reached `vault.create` | Rejected |
| 153 | `ensureFolder` threw when two writes raced into the same new folder | Re-check after a failed `createFolder` |
| 154 | Summary-note `template:` unquoted — a colon or quote broke the frontmatter | `yamlString` |
| 155 | Context-note list items unquoted — same | `yamlString` |
| 156 | File-name sanitizer regex copied in `NoteWriter`, `ConversationService`, `sidebar.ts` | `safeNoteName` in `pathUtils` |
| 157 | `prependWithSeparator`/`prependToInbox`/`appendConversationSlice` normalized only backslashes | `normalizeVaultPath` |
| 158 | `TemplateLoader` cast `auto_prompt` to string unvalidated | Validated |
| 159 | `max_tokens` accepted fractions | Integer only |
| 160 | Templates folder with a trailing slash matched nothing | Trimmed |
| 161 | Prompt-optimizer template `model` cast unvalidated | Validated |
| 162 | Prompt optimizer re-derived the default model with a ternary | `resolveDefaultModelForProvider` |
| 163 | Template conversations were persisted twice (create, then patch) | `createConversation` takes temperature/effort/researchMode |
| 164 | Resume-in-summary-mode stored an empty summary and sent the model no context | Refused with `summaryEmpty` notice (ADR-158) |

### View & UX

| # | Finding | Fix |
|---|---|---|
| 165 | Chapter-name backfill ran without an API key — one failing call per message on every open | Skipped without a key |
| 166 | Backfill logged one warning per message after the first failure | Stops after the first |
| 167 | Deep link built in three places; the header's lacked `vault=` | `resumeDeepLink` |
| 168 | Clipboard denial in copy-link was an unhandled rejection | `copyFailed` notice |
| 169 | `t()` threw on a missing locale key | Falls back to English, then the key |
| 170 | Vault-index change flush could fire after unload | Cancelled on unload |
| 171 | Backlink text with `]` in the conversation name broke the markdown link | Escaped |
| 172 | `ActionSheet.sheet` written, never read | Removed |
| 173 | Empty-state renderers lived in the view | `ui/emptyState.ts` (+2 tests); `sidebar.ts` 1891 → 1885 |

### Guardrails

| # | Finding | Fix |
|---|---|---|
| 174 | `tsconfig` had only `strictNullChecks` | `strict`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters` — zero errors |
| 175 | `==` unguarded | `eqeqeq` (null-tolerant) |
| 176 | ADR-139's `toLocaleDateString` ban existed only in prose | `no-restricted-properties` |
| 177 | HTML-string injection unguarded | `no-restricted-syntax` on `innerHTML`/`outerHTML`/`insertAdjacentHTML` (tests exempt) |
| 178 | `tests/persistence.test.ts` crossed the 600-line budget | Split into `tests/persistenceSanitize.test.ts` |

### Three principles (ADR-159)

1. **Every boundary validates.** A value from disk, a note, a template, a model or the clipboard is untrusted until a function with a test has said otherwise — and the fallback is the default, never the raw value.
2. **Silence is a bug.** An empty result, a swallowed catch, a no-op on a missing file: each must either say something to the user, log something a report can quote, or be proven to be the idle case. `catch {}` needs a comment naming why silence is right.
3. **If it is a rule, the tooling enforces it.** A convention worth writing into CLAUDE.md is worth a lint rule, a compiler flag, or a test that fails in the forbidden direction. Prose is for the reasoning; the guard is for the regression.

### Follow-up (2026-09-16, same day)

| # | Finding | Fix |
|---|---|---|
| 179 | Tavily key travelled in the JSON body — the part of a request that gets logged, echoed in error payloads and kept by proxies | `Authorization: Bearer` header; body carries no key. 401/403 and 429 now return a specific `Error:` the model can act on (ask for settings / stop retrying) |
| 180 | The delete-exchange gesture was a fourth hand-rolled 450 ms long-press | `attachLongPress` gained `preventTouchDefault` (non-passive `touchstart`, `preventDefault` for the iOS magnifier); `sidebar.ts` 1885 → 1857 |

### Deliberately not done

- A request timeout on utility calls — the SDK's 10-minute default stands; a reasoning model's summary can legitimately run long.


---

## Second review (#181–#236) — 2026-09-16

Whole-codebase review, second pass (ADR-161), targeting what the first read least. Every item is **resolved**.

### Listener lifecycle & duplicated interactions (principle 4)

| # | Finding | Fix |
|---|---|---|
| 181 | Five hand-rolled outside-press dismissers; four added their `document` listener a tick late and leaked it when closed before the tick | `ui/outsideDismiss.ts` (deferred, disposer-safe) |
| 182 | `HeaderController` model popover: cleanup handle set only after the tick, so `close()` in the same tick found nothing | Handle set synchronously; helper |
| 183 | `NavigatorController`: same leak, plus five manual `removeEventListener` sites bypassing `close()` | All routes through `close()`; helper |
| 184 | `ForkController` menu: same leak | Helper |
| 185 | Sidebar Send long-press menu: same leak | Helper |
| 186 | `HistoryController` Escape listener registered in the focus timeout; a close before it leaked | Helper (`pointer: false`); focus timeout guarded on `overlay.isConnected` |
| 187 | `ForkController` bound anchor long-press through the view's `registerDomEvent` — one dead listener set per anchor open until unload | Direct listeners (anchor is removed with `closeAnchor`); `registerDomEvent` dep removed |
| 188 | History rows: a fifth hand-rolled 500 ms long-press | `attachLongPress` gained the press point and `touchOnly` |
| 189 | `handleDeleteConversation` duplicated `deleteConversationWithConfirm` | Delegates |
| 190 | Two parameter-support `switch`es (settings tab, conversation modal) | `parameterSupport()` in `models/knownModels.ts` |
| 191 | Two code-block copy buttons: a denied clipboard was an unhandled rejection | `copyWithFeedback` + `copyFailed` notice |
| 192 | Settings custom-model input registered via `plugin.registerDomEvent` — one dead listener per settings open until unload | Direct listener |
| 193 | `keyboardInset.watchViewport` measured after dispose (two rAFs) | `live` guard |
| 194 | `GlossaryController.toggleAnchor`: two quick taps during the async lookup left two anchors | Generation guard + `isConnected` |
| 195 | ESLint: nothing stopped the next raw `document.addEventListener` | `no-restricted-syntax` with an allow-list of files that own both add and remove |

### Work proportional to the corpus (principle 5)

| # | Finding | Fix |
|---|---|---|
| 196 | Conversation panel re-tokenized every conversation's full text per keystroke | Token cache for the panel's life; `rankConversations` accepts token arrays |
| 197 | `#` picker re-tokenized every vault file's haystack per keystroke | `scoreRelevanceTokenSets` + per-dropdown token cache |
| 198 | History rows counted forks with a filter over all conversations per row (O(n²)) | One pass per build |
| 199 | Search input rebuilt the whole list on every keystroke | 60 ms debounce |
| 200 | `looksTimeSensitive` compiled ~100 `RegExp`s per send | Compiled once at module load |
| 201 | Every typed settings character rewrote the whole `data.json` (settings + conversations + eviction) | `PluginDataStore.saveSettingsSoon()` (400 ms), flushed on tab close |
| 202 | Glossary settings text fields: same | Debounced |
| 203 | Embedding settings text fields: same; folder list kept trailing slashes | Debounced; trimmed |

### Overrides & data integrity (principles 1, 6)

| # | Finding | Fix |
|---|---|---|
| 204 | Conversation modal pinned the untouched temperature on Save (inherit → frozen) | `undefined` when untouched |
| 205 | Same for max-tokens | Same |
| 206 | `deserializeIndex` accepted a truncated file → short vectors → every later `cosine()` threw | Bounds checks on meta and vector blob; caller rebuilds |
| 207 | A glossary term whose file name had to be sanitized (`C#`) lost its real name in the index and the anchor | `term` property written when it differs; read back in preference |
| 208 | Glossary cache not invalidated on note delete/rename | Invalidated in both handlers |
| 209 | Templates folder set to the vault root (`/`) found nothing | Root means every markdown file |
| 210 | `promptOptimizerTemplateId` stored untrimmed | Trimmed |

### Silence (principle 2, applied to older paths)

| # | Finding | Fix |
|---|---|---|
| 211 | `generateConversationSummary` swallowed an empty summary | `summaryEmpty` notice |
| 212 | Fork anchor regenerate: same | Same |
| 213 | Merge anchor regenerate: same | Same |
| 214 | LLM rename blanked the input on an empty title | Notice, field untouched |
| 215 | Switching a conversation to a provider with no key failed only at the next send | `modelNoKeyNotice` at the switch |
| 216 | Optimizer errors shown as `String(err)` (`Error: …` prefix) | `err.message` (two sites) |

### View correctness

| # | Finding | Fix |
|---|---|---|
| 217 | Person button stayed visible over user bubbles, where its handler silently declined | Hidden like Define |
| 218 | Insert-into-note used a remembered editor whose leaf may be closed | Checks the leaf still exists |
| 219 | Conversation picker modal showed a raw ISO date slice | `formatDate` (ADR-139) |
| 220 | Diagram copy tooltip hardcoded in English | `copyDiagramTooltip` (en/de) |
| 221 | `SummaryController` dead `void chevron` | Removed |
| 222 | Test mock `debounce` lacked `run`/`cancel` | Debouncer surface |

### Stylesheet (ADR-155 applied to the rest)

| # | Finding | Fix |
|---|---|---|
| 223 | 22 hover rules with a background fill outside `@media (hover: hover)` — sticky on iOS after a tap | Wrapped |
| 224 | `.p-tool-btn` transitioned `background`; `.is-active` is a state fill (research / vault toggles) | Colour-only transition |
| 225 | Model popover shadow hardcoded `rgba(0,0,0,.18)` | `var(--shadow-l)` |

### Tests added

| # | Covers |
|---|---|
| 226 | `attachOutsideDismiss`: same-tick immunity, outside/inside, dispose-before-tick, dispose-after-arm, escape-only |
| 227 | `attachLongPress`: press point, `touchOnly` |
| 228 | `deserializeIndex`: truncated vectors, truncated meta |
| 229 | `entryFrontmatter`/`entryFromFrontmatter`: `term` property round-trip |
| 230 | `scoreRelevanceTokenSets` parity with the string form |
| 231 | `rankConversations` with token arrays |
| 232 | `parameterSupport` for all three providers |
| 233 | Templates folder `/` |
| 234 | History panel tests adapted to the debounced input |
| 235 | `sidebar.ts` 1763 → 1759, ceiling lowered |
| 236 | Docs: ADR-161, CLAUDE.md principles 4–6, architecture/design updates |

### Follow-up (same day) — conversation settings help texts

| # | Item | Status |
|---|---|---|
| 237 | **Every conversation-settings description said "overrides the default" and nothing about the effect.** A user setting max tokens could not tell whether raising it costs more (it does not — only written tokens are billed) or what happens at the cap (the answer stops mid-sentence). All seven rows now state what changes when the value goes up or down, what does not change, and what the default means; provider and model rows, which had no description, gained one (`providerDesc`, `modelDesc`). Both locales. | Done |

### Follow-up (same day) — cost per answer (ADR-163)

| # | Item | Status |
|---|---|---|
| 254 | **The second run imported all 23 rows and then failed on a test that hard-coded gpt-4o's cache pricing.** models.dev lists a cache-read price for it. Six tests hard-coded prices that the weekly pull will change; arithmetic now runs on synthetic rows via `priceUsage`, and every test that reads the real table computes its expectation from `MODEL_PRICING`. The workflow's test step also runs the round-trip test. Rule recorded in CLAUDE.md. | Done |
| 253 | **First real run of the pricing workflow: 21 of 23 models mapped, two stopped it as designed.** `magistral-small-latest` is `magistral-small` upstream (mapped); `claude-mythos-5` is not listed on models.dev — declared in `NO_UPSTREAM`, its committed row is kept and every run says so. `readCommittedTable` is the one parser for kept rows and the round-trip test. `actions/checkout` and `setup-node` bumped to v5 (Node 20 deprecation warning). | Done |
| 252 | **The editable price table was the longest section of the settings tab, for a fix that helped one vault.** Removed with `settings.priceOverrides` and its guard; the disclaimer names models.dev with a link and the build's as-of date. Corrections go upstream and arrive with the weekly PR. | Done |
| 249 | **A render-time price re-priced history.** An answer from before a price change showed today's price, neither the bill nor what the user saw. `Message.cost { usd, asOf }` is snapshotted at completion; `messageCost` prefers it; legacy messages stay live-priced; the guard drops malformed snapshots. | Done |
| 250 | **Prices had no update path but a release with hand edits.** `scripts/update-pricing.mjs` + `.github/workflows/update-pricing.yml`: weekly models.dev pull, loud failure on unmapped models or a changed schema, PR on change, round-trip test on formatting; release checklist step 0. First CI run verifies the upstream schema — models.dev was unreachable from the authoring environment. | Done |
| 251 | **A number that can be wrong was on by default.** `showCost` now defaults to off. | Done |
| 248 | **Built-in prices could only be corrected by a release, and nothing told the user they were an assumption.** `settings.priceOverrides` (per-model input/output, `ui/pricingSettings.ts`), guarded by `sanitizePriceOverrides` in `mergeSettings`; the section opens with the disclaimer, the tooltip carries the short form. | Done |
| 246 | **The cost of an answer was computable from stored data and shown nowhere.** `models/modelPricing.ts` prices the four usage counts (input, output, cache read, cache write) from a date-stamped table; the turn label, the comparison tab and the history row show `≈ $`. Unknown model → nothing, never a wrong number; a test requires a row per catalog model. Prices entered from memory — verify before release. | Done |
| 247 | **The next-send token estimate beside Send was a guess in the provider's unit on the panel's narrowest row.** Removed (`sendEstimateEl`, the `nextSendEstimate` string, three CSS rules); the label's actual cost replaces it. | Done |

### Follow-up (same day) — token-limit support (ADR-162)

| # | Item | Status |
|---|---|---|
| 238 | **A reply cut at the token cap rendered exactly like a finished one.** All three providers report the stop reason (`max_tokens` / `length`); `runStreamRound` mapped it to `"done"`. Now `RoundResult.truncated` → `StreamFinish` → `Message.truncated`, persisted and guarded in `sanitizeMessages`. Principle 2. | Done |
| 239 | **An empty reasoning reply vanished without a word.** The budget went on thinking, `fullText` was `""`, and the bubble was removed. `noticeEmptyReply` says so, with the limit; a non-truncated empty reply says the model returned no text. | Done |
| 240 | **No recovery from a truncation.** `ui/TruncationController.ts`: a card under the cut-off answer with Continue (fixed continuation prompt as a new turn, draft kept via `sendText`), Retry with a doubled limit (`raisedMaxTokens`, exchange spliced, prompt re-sent), Compare (ADR-160). Actions on the last answer only; Retry withheld when a star or merge link would go with the answer. | Done |
| 241 | **Three places decided "too low" separately** — the Send hint in `sidebar.ts`, the modal (which did not), and nothing under an answer. `services/settingsAdvice.ts` is the one rule (principle 4); it returns `clear` or `pin` so the fix keeps inheritance where it can (principle 6). | Done |
| 242 | **The modal said nothing on the switch that matters.** A conversation pinned to 2000 on a plain model kept 2000 on a reasoning model; only an untouched field followed the model. `.p-param-advice` under the token field, live on every model change, with the one-tap action. | Done |
| 243 | **The Send warning explained itself only in a `title` tooltip**, invisible on a phone. `ui/SendHintController.ts` (moved out of `sidebar.ts`, 1759 → 1755) announces the text once per conversation-and-model on mobile and the tap opens the settings modal, where the advice line repeats it with the button. | Done |
| 244 | **Model rows named an id and a context window, not what a user chooses by.** `MODEL_PROFILE` (speed · depth · cost, 1–3) in `models/modelGuidance.ts`, completeness enforced by test; reasoning rows say they need a bigger budget. Read by the header popover and `ModelSuggest`. | Done |
| 245 | **The delete bar's splice forgot merge links** — a deleted answer left its `merges` entry pointing at nothing. `spliceExchange` (shared with Retry) filters favorites and merges and keeps the save boundary. | Done |

### Three more principles (ADR-161) — compared with ADR-159's

| New | Relation to the first three |
|---|---|
| **4. One implementation per interaction** | Extends ADR-159's "one builder per fact" corollary from *data* (a regex, a URL) to *behaviour* (a gesture, a dismissal). The leaks lived in the copies |
| **5. Pay for the keystroke, not the corpus** | New. The first review had no performance principle; this one found five per-keystroke corpus walks |
| **6. Inherited stays inherited** | Generalizes a rule CLAUDE.md already stated for `theme` and `outputLanguage` to every override, after two fields in the same modal broke it |

"Silence is a bug" (principle 2) fired four more times — every time in code older than ADR-159 — which confirms it and says the older paths were never re-read against it. **Where they live:** the canonical list is CLAUDE.md's "Engineering principles" section (what every session reads first); the reasoning is the ADR; this file is the record of what each principle caught. Not a fourth document.

## New Suggestions (#255–#262) — conversation controls transparency, 2026-09-16

An audit of every per-conversation setting against what the panel actually shows. The header carries the name and the model's abbreviation; about fifteen settings decide what the model sees, how it answers and what it may change in the vault, and most are two taps deep, an icon tint, or have no UI in the conversation at all. **`docs/briefs/conversation-controls.html`** is the brief for Claude Design, scoped to #259/#260: make the model, reasoning (effort) and the instructed answer language readable and changeable in place in the header. v1 of the brief listed every setting and asked for a status strip plus a settings-panel redesign; the resulting designs duplicated the composer toolbar (template, web search, vault context sit next to Send) and missed the point, so v2 excludes them explicitly. #255–#258 and #261–#262 are not part of that redesign. Nothing here is decided: the write-mode default needs an ADR.

| # | Item | Severity | Status |
|---|---|---|---|
| 255 | **The model can change the vault and nothing says so.** `Conversation.writeMode` defaults to `all` (`create_note`, `prepend_note`, `rewrite_note`) in `ToolHandler.getToolDefinitions`; only template frontmatter sets it, no surface shows it, and there is no way to make a conversation read-only. Also decide whether a conversation without a template should default to something narrower than `all` (product decision, needs an ADR). | High | Open |
| 256 | **Resume mode silently drops history.** `cmdResumeConversation` stores `resumeMode` on the conversation; from then on `summary` sends no prior messages and `hybrid` only the last 6 (`HYBRID_TAIL_COUNT`) on every send. Nothing in the panel says so, and nothing switches it back to `full`. | High | Open |
| 257 | **Web search state is ambiguous.** The globe's tint says on/off, but `webSearchAutoArm` searches on an "off" conversation for a time-sensitive message, signalled only by a 1.6 s pulse (`flashResearchAutoArm`); "on" without a Tavily key does nothing after the first notice. Needs off · on · auto · no-key as visible states. | High | Open |
| 258 | **The system prompt is a black box.** Applying a template replaces `systemPrompt` and can reset model, temperature, effort, max tokens, resume mode and write mode (`onApplyTemplate`); afterwards the template name appears only in the sources row under answers, and neither the prompt text nor the global `customInstructions` can be viewed from the conversation. | Medium | Open |
| 259 | **Generation parameters are two taps deep.** Effort, temperature, max tokens and language live only in `ConversationSettingsModal`, reached via the model popover's footer; the badge shows the model alone, so a Low and a High effort conversation look identical. | Medium | Done (ADR-165): effort and language sit beside the model in the header, each opens its own picker; temperature and token limit deliberately stay in the dialog |
| 260 | **Inherited vs. pinned is invisible outside the modal.** `vaultContext`, `effort`, `temperature`, `maxTokens` and `outputLanguage` each have an inherit state (principle 6); the toolbar and header never show which applies. | Medium | Done for effort and language (ADR-165): accent tint = set for this conversation, default row stores `undefined`. Vault context is not covered |
| 261 | **Two model pickers with different information.** The header popover (speed · depth · cost, context window, reasoning tag) and the modal's provider/model dropdowns (plus custom id) both set the model (principle 4). | Low | Open |
| 262 | **Rare and destructive actions hold prime header space.** Rename, copy link and delete take three of seven header slots while none of the settings that change every answer has one; summaries and prompt optimization are reachable only by long-pressing Send. Candidate: an overflow menu. | Low | Partly (ADR-165): rename and copy link moved into the `⌄` menu; summaries and prompt optimization are still long-press only |

## Follow-up (#263) — glossary definition language, 2026-09-16

| # | Item | Severity | Status |
|---|---|---|---|
| 263 | **Glossary definitions read in whatever language the first lookup produced — usually English.** Under the default AUTO setting `defineTerm`'s English prompt carried no language line, so the model answered in English for a German passage, and vault-first showed that text in every later conversation. Fixed at both ends: under AUTO the define/person prompts name the passage's language, and the anchor translates a stored definition into the conversation's language (instructed, or detected from the answer under AUTO), caching it as `definition_<lang>` in the note behind a hash of the definition. | Medium | Done (ADR-166) |

## Follow-up (#264, #265) — conversation search, 2026-09-17

| # | Item | Severity | Status |
|---|---|---|---|
| 264 | **Token matching was one-directional, so two everyday searches came back empty.** A candidate matched only by equality or prefix: typing `boundaries` never found a stored `bound`, and — the one that matters in a German-first vault — typing `Vertrag` never found `Mietvertrag`, because German compounds are head-final and a prefix rule cannot reach the head. Replaced by one graded rule (`services/tokenMatch.ts`) weighting exact > prefix > infix > reverse, with length floors so a stopword cannot reverse-match every long query, and a relative relevance floor so the loosened rule cannot return the whole corpus. `bestMatchSnippet` shares it, or a row would surface with no snippet to explain it. | Medium | Done (ADR-168) |
| 265 | **Search ignored the notes a conversation was about.** `attachedNotes`, vault `sources` and `templateId` are all persisted per message and none were searchable, although "which conversation did I have about that note?" is how people remember a conversation. Added as a *field* of the conversation haystack rather than a second corpus — a result is still always a conversation, so pick mode, the keyboard model and IDF comparability are untouched, and it costs no vault I/O. Reachable as `note:`/`all:`, and automatically when the text search comes back thin — announced by a group header, a `via <note>` line per row and a chip. | Medium | Done (ADR-168) |

**Open follow-ups from #264/#265** (deliberately out of scope, same keyword extends to them):

| # | Item | Severity | Status |
|---|---|---|---|
| 266 | **Note *bodies* are not searched** — only note names, paths and the template's name. The "I remember a phrase inside the note" case needs `cachedRead` over the union of attached paths, an async loading state and a lower field weight (borrowed text must not drown out the conversation's own words). Obsidian's own search serves it today. | Low | Open |
| 267 | **No typo tolerance.** Edit distance was kept out of ADR-168 on purpose: it has its own noise budget and its own per-keystroke cost profile. | Low | Open |

## Follow-up (#268) — release safety, 2026-09-17

| # | Item | Severity | Status |
|---|---|---|---|
| 268 | **The release workflow never checked its own `version` input against the repo.** `release.yml` passes `inputs.version` straight to the tag and the release name, builds from whatever `main` happens to be, and attaches the result. Obsidian's installer reads `manifest.json`'s `version`, not the tag — so a dispatch with a typo, a `v` prefix, or against a `main` whose bump had not landed would publish the *wrong plugin version under the right name*, and the tag could not be reused without deleting the release. The tag-push trigger was already constrained by its `[0-9]+.[0-9]+.[0-9]+` pattern; the dispatch path AGENTS.md actually tells you to use (agent credentials cannot push tag refs) was free text. A guard step now fails before the build unless the version is `X.Y.Z` and agrees with `manifest.json`, `package.json` and `versions.json`, reporting every mismatch at once. Principle 3: a rule worth writing in AGENTS.md is worth a guard that fails in the forbidden direction. | Medium | Done |

## Follow-up (#269–#272) — related conversations, measured, 2026-09-17

| # | Item | Severity | Status |
|---|---|---|---|
| 270 | **The similarity floors were taste, and the default was below the noise floor.** `balanced = 0.35` sat *below the median score of a random conversation pair* (0.462 on the default model), so "related" returned 19 of 23 neighbours — listing, not filtering. Measured with `scripts/measure-related.mjs`; floors are now per model and anchored to each model's own p75/p90/p95. | High | Done (ADR-169) |
| 271 | **One constant served two models with different score distributions.** Measured p90 gap 0.076 against a pre-registered 0.05 threshold; three estimators agree on a ~0.08 offset. "Balanced" meant 19 of 23 neighbours on one model and 11 on the other. Floors moved onto `EMBEDDING_MODELS`, with a test requiring one per preset per catalog entry. | Medium | Done (ADR-169) |
| 272 | **The first "related" click paid for the whole index, uncancellably.** 554 chunks took 135s natively (~19 minutes extrapolated to 200 conversations, slower under WASM, on the UI thread in the iframe fallback), `limit` was never passed so the list grew with the vault, and closing the panel did not stop the work. Now: `RELATED_RESULT_LIMIT = 20`, a guarded background warm at layout-ready, and an `AbortSignal` that commits partial progress before it rethrows. | High | Done (ADR-169) |

**Open, from the same measurement:**

| # | Item | Severity | Status |
|---|---|---|---|
| 269 | **Percentile-based floors instead of constants.** The floors calibrated for ~5 results land at roughly the p75–p78 of each model's own distribution — the same *percentile* ports across models where the same *constant* does not, and it would self-calibrate as a vault grows. Needs a second vault to confirm before replacing three constants with a runtime computation; a tiny vault also needs an absolute sanity floor. | Medium | Open |
| 273 | **Vault-RAG retrieval floors are unmeasured.** ADR-169 measured conversation pairs; `vaultRetrievalMinScore` keeps 0.5 / 0.35 / 0.2 on faith. The equivalent probe for query-to-note retrieval does not exist yet. | Medium | Open |
| 274 | **Show the matched chunk on each related row.** `maxPairwiseCosine` already knows which pair of chunks won and throws the indices away; the index does not persist chunk text. Related mode currently shows a bare conversation name with no score and no evidence — the failure ADR-168 legislated against for search. | Medium | Open |
| 275 | **The settings copy undersells the speed difference.** "English is faster" is measured at **4.4×** (30.5s vs 135.2s for the same 554 chunks). A user on a large vault choosing the default multilingual model is choosing ~19 minutes over ~4. | Low | Open |

## Follow-up (#276–#280) — search cost, and reviewing the previous diff, 2026-09-17

| # | Item | Severity | Status |
|---|---|---|---|
| 276 | **The match snippet was 99% of a keystroke, and it scaled with the vault.** `bestMatchSnippet` re-tokenized every line of every message for every rendered row, on every keystroke: 398ms at 500 conversations. Line tokens are now cached lazily on `ConversationFields`, and `bestMatchSnippet` requires the fields so the uncached path cannot survive. | High | Done (ADR-170) |
| 277 | **Search results were uncapped.** ADR-169 capped related conversations on the argument that match count grows with the corpus; the same argument was never applied to search, which ADR-168 had shipped hours earlier. `SEARCH_RESULT_LIMIT = 20`, applied in the pure layer so the panel and the palette modal inherit it together. | High | Done (ADR-170) |
| 278 | **The background warm read the entire index to test existence.** `read()` returns the whole binary — megabytes on a large vault — and the warm used only the null check, at every launch. `VaultIndexStore.exists()` added. | Medium | Done (ADR-170) |
| 279 | **The warm's timer outlived the plugin.** A bare `window.setTimeout` in `onLayoutReady`: disabling the plugin inside the 3s delay ran the warm against a torn-down instance. Now registered for teardown, the convention the same file already uses. | Medium | Done (ADR-170) |
| 280 | **`warmIndex` stated its guard twice** (a cheap early return plus `shouldWarmIndex`). Split into `canWarmBeforeIndexCheck`, composed by `shouldWarmIndex`, with a test asserting they cannot disagree. Also: `DEFAULT_MIN_SCORE` un-exported, and `tokenScore` no longer allocates a notes array per (conversation × token) under the default scope. | Low | Done (ADR-170) |

**Still open from this pass:**

| # | Item | Severity | Status |
|---|---|---|---|
| 281 | **`openHistoryView` is a ~350-line function holding ~25 closures.** The file-size ratchet counts files, not functions, so nothing flags it. The natural seam is browse/search rendering vs. related mode — the split ADR-109 made conceptually and never structurally. | Medium | Partly done — related mode extracted to `ui/RelatedMode.ts` and the shared chip to `ui/historyChip.ts` (HistoryController 559 → 507). The remaining function still holds list building, row rendering and keyboard nav, which share `rows`/`selectedIdx` and are a poorer seam. |
| 282 | **`sync` can only abort between conversations.** `provider.embed(chunks)` embeds one conversation's chunks in a single uninterruptible call — fine at the measured ~23 chunks, unbounded in principle. | Low | Open |

## Follow-up (#283–#285) — CI and supply-chain hardening, 2026-09-17

Found reviewing the workflows after a stacked PR turned out to have no checks at all — not failing, never triggered.

| # | Item | Severity | Status |
|---|---|---|---|
| 283 | **CI was silently skipped for any PR not targeting `main`.** `pull_request: branches: [main]` meant a stacked PR showed no checks, which on the PR page is indistinguishable from "nothing to report". Filter removed, and `Build & test` is now a required status check on `main`, so absent CI blocks a merge instead of reading as success. `ci.yml` also gained `permissions: contents: read` (it declared none, inheriting the repository default) and `persist-credentials: false` on checkout, which keeps the token out of `.git/config` for a job that runs `npm ci` with install scripts across the dependency tree. | Medium | Done |
| 284 | **Every action was pinned to a mutable tag.** `@v4`, `@v5`, `@v2`, `@v7` — a moved tag changes what executes, and two of them (`softprops/action-gh-release`, `peter-evans/create-pull-request`) run with `contents: write`. All six now pinned to the commit SHA the tag resolved to, with the version in a trailing comment. `dependabot.yml` added so the freeze does not also freeze security fixes: it rewrites the SHA and the comment together, as a reviewable diff. | Medium | Done |
| 285 | **`fmt()` in `update-pricing.mjs` emits non-finite numbers.** The generated-code path is otherwise well defended — model ids come from the local catalog, never upstream, and prices go through `Number.toFixed`, which throws on a string or object — but `fmt(NaN)` yields `NaN`, which is valid TypeScript and compiles into a shipped price table. Integrity, not execution. Guarded: `fmt` refuses a non-finite, negative or non-number value, and is exported (and declared in `update-pricing.d.mts`) so the guard is tested directly rather than only through a network call. | Low | Done |

**Carried past the first pass, both now closed:**

| # | Item | Severity | Status |
|---|---|---|---|
| 286 | **`npm ci` ran install scripts in CI**, for the whole tree, in the same job as the token. Now `npm ci --ignore-scripts` in all three workflows. Measured on the post-bump tree rather than assumed: a clean install takes 10.8s, and `lint`, `check:filesize`, `build` and 1158 tests all pass with no hook having run — `@esbuild/linux-x64/bin/esbuild` and `onnxruntime-node/bin/napi-v3/linux/x64/onnxruntime_binding.node` are both plain files in their tarballs. The constraint this creates (no dependency may rely on an install hook, or it passes locally and fails in CI) is recorded in `AGENTS.md`, where someone adding a native dependency will meet it. | Medium | Done |
| 287 | **`update-pricing` combines network input with `contents: write` + `pull-requests: write` in one job.** The proposal was to split it: a fetch job with `permissions: {}` that uploads the rewritten file as an artifact, and a second job that opens the PR. | Low | **Deliberately not done** — see below |

### Deliberately not done — #287, the fetch/write split

Decided 2026-09-17, after #285 and #286 landed. Recorded rather than left open, because "we looked at this and chose not to" is a different state from "nobody has got to it yet", and only one of them should still be attracting attention.

**The reasoning, in the order it decided the question:**

1. **#286 removed the risk this was really about.** The untrusted code in that job was never the JSON — it was `npm ci` running install hooks for the entire transitive dependency tree while `contents: write` and `pull-requests: write` were in scope. That is gone. What #287 would isolate is what remains: one HTTPS GET of a public JSON document.

2. **The fetch cannot reach code.** Model ids come from the local catalog (`m.id`), never from upstream; `asOf` is `new Date()`; and since #285 `fmt` refuses anything that is not a finite, non-negative number. A hostile models.dev response has no path into `models/modelPricing.ts` beyond values that are already validated on the way in.

3. **The split relocates write authority rather than removing it.** The second job still needs both write scopes, and it commits whatever the first job handed it. The artifact boundary downgrades "code execution holding the token" to "content injection into a pull request" — a genuine reduction, but the residual is content that a human reads line by line before merging, which is the entire design of the weekly PR (ADR-163). We would be adding a boundary to defend the one step that is already defended by review.

4. **It is not free.** Two jobs means a second checkout, a second install, artifact upload/download, and the `manifest`/`package`/`versions` agreement logic spanning a job boundary — permanent maintenance surface on a workflow that runs once a week.

**Reopen this if either becomes true** — both would restore the risk the split addresses:

- `update-pricing` gains a step that *executes* anything fetched at runtime (a schema tool, a codegen binary, a downloaded script), rather than only parsing data; or
- the pull request it opens is ever auto-merged, removing the human read that point 3 relies on.

No ADR: an ADR records a choice that shapes the code, and this one deliberately leaves the code alone. The condition above is the part worth finding again.

## Follow-up (#288–#289) — the first dependabot batch, 2026-09-17

Dependabot's first run after #284 opened seven PRs. Two of them said something about this repository rather than about its dependencies.

| # | Item | Severity | Status |
|---|---|---|---|
| 288 | **`tsconfig` declared `lib: ES2018` while the code used `Array.prototype.at` (ES2022).** It type-checked only because `@types/node@20` pulled newer lib definitions in transitively; `@types/node@26` does not, and four call sites failed at once (`sidebar.ts` ×2, `ui/TruncationController.ts`, one test). Nothing shipped differently — `esbuild.config.mjs` targets `esnext` for the plugin bundle, so `.at()` has always reached users untouched — the compiler was simply describing a language level the codebase had already left. `lib` raised to `ES2022`, which makes the declaration match what is built and shipped. `target` left at `ES2018`: `tsc` runs `-noEmit` here, so it governs nothing. | Medium | Done |
| 289 | **The `dev-tooling` group could not land while TypeScript 7 was in it.** Every published `typescript-eslint` (8.70.0) peer-requires `typescript >=4.8.4 <6.1.0`, so `npm ci` failed at resolution and the PR was red in six seconds, before a test ran. Splitting the group would not have helped — a standalone TS 7 bump fails identically. TypeScript majors are now ignored in `dependabot.yml`, with the reason and the lifting condition recorded there, following the `@huggingface/transformers` precedent. The other nine bumps in the group (vitest 4→5, both coverage providers, `@types/node` 20→26, `builtin-modules` 3→5, eslint, happy-dom, esbuild, typescript-eslint) were verified together and are green. | Medium | Done |

**Mostly closed by use (#290), 2026-09-18.** The three provider SDKs were bumped across majors (`openai` 6→7, `@anthropic-ai/sdk` 0.40→0.125, `@mistralai/mistralai` 2.4→2.7) and **no test exercises any of them**: `tests/AnthropicService.test.ts` and `tests/MistralService.test.ts` `vi.mock` the clients, so what passed is `tsc` against the new `.d.ts` plus the bundle. That is real evidence — every surface `AnthropicService` depends on (`messages.stream`, the `"text"` event, `finalMessage()`, `stop_reason` `max_tokens`/`tool_use`, `usage.cache_read_input_tokens`, `output_config.effort`) is type-checked at its use site and was confirmed present — but it is not runtime evidence. Streaming event order, error classes and retry defaults are unproven until a real call is made. `release.yml` fires only on a version tag, so `main` carrying these ships nothing; **before the next tag, run one streamed chat and one utility call (Define or summary) per provider in a real vault.**

**What happened instead, recorded honestly:** 2.21.0 shipped before that check was run — the release was cut on an explicit instruction not to wait. The maintainer then reported *several chats, no issues* in a real vault on the shipped build. That is the runtime evidence this entry wanted, for the path it covers: streaming, the tool loop and the normal send on the provider actually in use. It does **not** cover the other two providers' SDK majors, and it does not cover the utility path (`callUtility` — `Define`, summaries, titles), which is where the content-block change of ADR-158 lives and where a reasoning model's leading `thinking` block is met. Those two remain unproven and are the whole of what is left here.

**Closes when:** a chat and a Define (or summary) have each run once on each of the three providers. Until then, treat a provider the maintainer does not personally use as untested against its new SDK.

**Noted, not acted on:** `npm audit` reports two high-severity transitive advisories on `main`. `brace-expansion` (via `eslint` → `minimatch`) is dev-only and lint-time. `form-data` arrives through `@anthropic-ai/sdk@0.40.1` → `@types/node-fetch`, a types-only chain that does not reach the bundle; the SDK bump (landed) drops `node-fetch`, `@types/node-fetch` and `formdata-node` — 7 dependencies down to 2 — and with them that advisory. `brace-expansion` is the only one left.

## Bug (#291) — the history limit deleted conversations while it was being typed, 2026-09-18

Reported from a vault: the conversation history limit was set to **0 — documented in both locales as unlimited — and the conversations without a starred passage were gone.**

| # | Item | Severity | Status |
|---|---|---|---|
| 291 | **A numeric settings field committed per keystroke, and every save evicted.** Three independent faults lined up. (1) `settings.ts` bound its numeric fields with `onChange`, which fires per character: lowering "200" to "0" stores `20`, then `2`, then (after an empty field is rejected) `0`. (2) The 400 ms debounce behind it resets per keystroke, so it commits mid-edit whenever the user pauses — half a second between two backspaces is enough. (3) `PluginDataStore.persist()` ran `evictConversations` on **every** write, settings and API-key saves included, so a transient cap of `2` deleted every conversation that had no favorite, no open leaf and no inbound merge link, silently and with no undo. `evictConversations` itself was correct throughout — `cap <= 0` returns the input unchanged, with a test. Fixed in ADR-171: `ui/numberSetting.ts` commits a field on blur/Enter only (and `hide()` flushes the field the user is standing in); `persist({ evict })` defaults to off, leaving `saveConversations()` the only caller that applies the cap; lowering the limit opens `ConversationCapModal`, which names how many conversations it would delete — counted by the new pure `countEvictions`, from the eviction itself — and what survives. Both settings descriptions now say "deleted permanently". Guarded by `tests/pluginDataStore.test.ts` (a settings save leaves the list alone; only `saveConversations` applies the cap) and `tests/numberSetting.test.ts`. | **Critical** | Done |

**Closed by ADR-172 (#292) — the cap archives before it deletes.** ADR-171 fixes the path that deleted data while the user was typing a number. It does not change what happens when the 201st conversation arrives at the default cap of 200: the oldest unstarred one is deleted, permanently, with no notice and nothing written anywhere the user could find it. A conversation is the plugin's primary artifact — starring a passage inside it is the only way to protect it, and nothing in the UI says so at the moment it matters. Three honest options, in rising cost: raise the default (a conversation is a few KB of JSON — 200 is a cautious number for a file Obsidian already loads whole), archive to a note in the vault before deleting (the vault is the durable store; this makes eviction a move rather than a loss), or default to unlimited with a size warning once `data.json` passes some threshold. Wants a decision before the next release, not another fix.

**Not reproduced, worth knowing:** whether the reporter's data.json can be recovered depends on their sync. Obsidian's own File Recovery snapshots notes, not plugin data. Obsidian Sync keeps version history for the config folder only when "Sync settings" is enabled for the vault; iCloud/Time Machine/a file-level backup are the other routes. Pythia keeps no backup of `data.json` of its own — which is itself an argument for the archive-to-note option in #292.

## Follow-up (#292 closed, #293–#294 open) — the history limit as housekeeping, 2026-09-18

| # | Item | Severity | Status |
|---|---|---|---|
| 292 | **The cap deleted silently when reached through normal use.** ADR-171 fixed the keystroke path but left the 201st conversation deleting the oldest one with no notice and nothing kept. Now `archiveBeforeEviction` (**on by default**) writes each removed conversation to a note in `archiveFolder` (`Pythia/Archive`) before it is dropped — full transcript, queryable frontmatter, `source` deep link — and the order is load-bearing: a conversation whose note cannot be written is **kept**, not deleted, and every outcome raises a `Notice`. `partitionEvictions` became the one eviction rule so the archive writes exactly what the dialog counted. Also: "no limit" is an empty field now, not the magic number 0 — the reporter typed that 0 correctly and lost conversations on the way to it. | **High** | Done |

**Closed by ADR-173 (#293) — the delete dialog offers the archive.** `DeleteConversationModal` deletes outright. That is defensible (the user asked for it, and archiving deliberate deletions fills the vault with notes nobody wanted) but it is now the only path that destroys a conversation without a copy. Options: a checkbox in the delete dialog, remembered; or "Archive" as a second button next to "Delete". Cheap either way; wants a product call, not an engineering one.

**Open — the archive folder grows without bound (#294).** By design: pruning it is Obsidian's job, not Pythia's. But nothing tells the user it exists until the first eviction Notice, and nothing in the settings shows how large it has become. A one-line count next to the archive-folder picker ("142 archived conversations") would answer both without adding a retention policy Pythia should not own.

## Follow-up (#293 closed) — the last path without a copy, 2026-09-18

| # | Item | Severity | Status |
|---|---|---|---|
| 293 | **The deliberate delete was the only remaining path that destroyed a conversation with no copy.** ADR-172 left it alone on the grounds that a delete is intent — true for whether to *ask*, not for what to *offer*. `DeleteConversationModal` now carries **Archive · Delete · Cancel**, Archive leading as `mod-cta`, with a hint naming the folder. A choice in the dialog rather than a setting: `archiveBeforeEviction` governs the path where nobody is present to be asked, this one has somebody. Fail-closed like the eviction — `ConversationService.archiveConversation` returns false when the note could not be written and the conversation is kept. `archiveFolderOf` became the one folder resolution across all three callers rather than a third copy. | Medium | Done |

**Still open (#294)** — the archive folder has no size readout anywhere, and it now also grows from deliberate deletions. A count beside the folder picker answers it without Pythia owning a retention policy.

## Follow-up (#295–#297 done, #298 designed) — the cost of one file, 2026-09-18

Measured with the new `scripts/bench-store.mjs` (real functions, synthetic ~22 KB conversations; Node on a dev machine — Obsidian mobile is a webview on a phone CPU and several times slower):

| vault | data.json | rewrite per turn | startup parse |
|---|---|---|---|
| 200 | 4.5 MB | 19 ms | 12 ms |
| 450 | 10 MB | 45 ms | 23 ms |
| 1 000 | 22 MB | 87 ms | 66 ms |
| 2 000 | 45 MB | 179 ms | 133 ms |

| # | Item | Severity | Status |
|---|---|---|---|
| 295 | **The browse listing drew a row per conversation, and looked up forks with a filter per row.** Search has been capped at 20 rows since ADR-170; the empty-query listing had no cap at all, so opening the panel built ~8 DOM nodes and three listeners per conversation in the vault — and `all.filter(c => c.forkedFromId === src.id)` inside the loop made it **O(n²)**: 28 ms of pure filtering at 2 000 conversations, 528 ms at 5 000. Now one `forksBySource` index per build (the ⑂ count reads its length, so the two readers cannot disagree) and 50 rows per page behind a `show more` row that appends rather than rebuilds. A source and its forks always land on the same page — the indent means nothing across a page break. | High | Done |
| 296 | **The conversation cap defaulted to 200, which was never a measured number.** At ~22 KB per conversation that capped data.json around 4.5 MB, an order of magnitude below where anything is felt, so the default itself was deleting conversations for no gain. Raised to **450** (~10 MB, 45 ms per turn), with a migration moving vaults still sitting on the old 200 — raising a cap can only ever keep more. | Medium | Done |
| 297 | **Nothing showed the number that actually matters.** The limit is expressed in conversations; the cost is in bytes, because the whole file is rewritten after every message and a synced vault moves all of it again. `services/storageSize.ts` (pure, tested) holds the thresholds — `warn` at 25 MB, `high` at 50 MB, both from the table above — and the settings tab prints `Storage: 23.4 MB in data.json, 1 040 conversation(s)` under the history limit, turning into a warning past `warn`. One `Notice` per load at `high`, where the user cannot see the cause any other way. | Medium | Done |

### #298 — Split storage: an index plus one file per conversation (designed, not scheduled)

**The problem, stated once.** `data.json` holds settings *and* every conversation, and `saveData` writes the whole file. So the cost of sending one message is a function of the entire corpus, in three places at once: the serialize (87 ms at 1 000 conversations), the disk write, and — on an iCloud or Obsidian Sync vault — moving the whole file again, per message. Everything in #295–#297 is mitigation. This is the fix.

**Shape.**

```
.obsidian/plugins/pythia/
  data.json                 ← settings only; small, written when settings change
  conversations/
    index.json              ← one row per conversation: id, name, updatedAt, model,
                              provider, messageCount, summaryText, favorites count,
                              forkedFromId, attachedNotes, templateId, merges
    <id>.json               ← the messages, written only when THAT conversation changes
```

The split is chosen by what the app reads: the conversation panel, the `#` navigator, the header and search all read **metadata plus the note/title/summary fields** — which is exactly what ADR-168's `ConversationFields` already builds — while the message bodies are read only by the conversation being displayed, the context builder, and the embedding index. `index.json` at 1 000 conversations is roughly 300 KB, so the startup parse and the per-keystroke work stay where they are today at 24 conversations.

**What it buys.** Sending a message rewrites one conversation file (tens of KB) and one index row instead of the corpus. The startup parse becomes the index. Sync moves what changed. The conversation cap stops being load-bearing — eviction becomes a genuine preference rather than the thing standing between the user and a slow vault.

**What it costs, honestly.**
1. **Migration, one-way, over a file the user cannot afford to lose.** Write the new tree, verify every conversation reads back, and only then shrink `data.json` — keeping a `data.json.bak` until the next clean load. ADR-133's `mergeConversations` exists because a stale copy of this file has already rolled a conversation back once.
2. **Multi-device sync gets more interesting, not less.** Today one file arrives whole or not at all. Split, a device can see an index row whose conversation file has not landed yet. The index must be treated as a hint and a missing file as "not yet here", never as a deletion — and `shouldRefuseLoad`'s iCloud guard needs its per-file equivalent.
3. **The atomicity that `saveData` gives for free disappears.** Index and conversation are two writes; a crash between them leaves a row pointing at a stale file. Writing the conversation first and the index second makes the failure mode "the index is a beat behind", which is recoverable; the reverse is not.
4. **`ConversationStore` becomes a loader, not a list.** `plugin.conversations` is a live array today and the whole UI holds references into it (ADR-104/#122). Lazy loading means a conversation can exist as a row with no messages in memory, and every `conv.messages` reader would have to say when it needs them. This is the expensive part of the work, and it is a refactor, not a storage change.
5. **Obsidian's `saveData`/`loadData` are no longer the interface** — it becomes direct `vault.adapter` I/O in the plugin's own folder, which is supported but hand-rolled, including the own-write stamping the watcher depends on.

**Rough size:** the storage layer and migration are a few days; item 4 is the real scope and touches `ConversationStore`, `sidebar.ts`, `HistoryController` and `ContextBuilder`.

**When to evaluate — a trigger, not a date.** Do it when **either** the storage readout lands in `warn` (25 MB) on a real user's vault and lowering the limit is not an acceptable answer, **or** a second feature needs partial loading anyway (a full-text index of message bodies — see #266 — would). Until one of those happens, #295–#297 keep the single file comfortable to ~1 000 conversations, and this entry is the design that gets picked up rather than re-derived.

## Follow-up (#299) — the composer's Enter, 2026-09-18

| # | Item | Severity | Status |
|---|---|---|---|
| 299 | **Enter sent the message; a line break needed Shift.** The chat-app convention, wrong for a composer holding a prompt: a stray line break costs nothing, a stray send costs an API call, a half-written prompt in the transcript and a delete to clean up. The recoverable outcome now sits on the unmodified key — `ui/composerKeys.ts` (pure, tested) puts send on Cmd/Ctrl+Enter, keeps the IME guard on both paths, and drops the shortcut hint from the placeholder on mobile, where no modifier key exists. | Medium | Done |

**Found on the way — `i18n.getLocale` threw without a `window`.** It read `window.moment` directly while `getObsidianLocale`, four lines below, had been guarded for exactly that reason. Any headless caller of `t()` got a `ReferenceError` instead of the documented English fallback — invisible in the app, but it is the fallback path that is supposed to be the safe one, and it made a pure function untestable without a DOM. `getLocale` now goes through the guarded reader. One fact, one implementation.
### #300 — Should archived conversations be part of vault context? (open, parked 2026-09-18)

Found while checking a README claim, first called a regression, then argued down to what it is: an unintended interaction whose *desirability* is undecided.

**The fact.** `VaultRagService` skips `conversationsFolder` and `scratchFolder` when indexing (`services/VaultRagService.ts`, two `skip` arrays). It does not skip `archiveFolder`. So conversations the history limit archives (ADR-172, on by default) are indexed like any other note and can be retrieved back into a later answer. Before ADR-172 they were deleted, so nothing entered the vault — the behaviour changed as a side effect of a change that was not about retrieval.

**Why it is not simply a bug.** A note exported with *Save output* is conversation content too, and it is indexed — correctly, because the user chose that note, one at a time, and put it where their knowledge lives. "Conversations must not enter RAG" is not a rule this codebase holds, and inventing it after the fact would be the wrong reading of the two existing exclusions.

**The distinction that does hold.** What `Conversations/` and `Scratch/` share is that **Pythia wrote them without the user choosing each one**. The archive is the same shape and more so: a bulk side effect of a size cap the user may never have touched, writing full transcripts — the user's prompts *and* the model's answers. Two practical consequences follow, neither of them a principle:

- **Volume.** The archive grows without bound by design (#294 is the missing readout). A few hundred ~22 KB transcripts can dominate top-5 retrieval by mass alone, crowding out hand-written notes.
- **Model output as source.** Retrieval begins surfacing previous answers as reference material. Summary notes are excluded today for exactly this reason, and they are a far weaker dose of it.

**The argument for leaving it indexed, which is real.** Archiving removes a conversation from `data.json`, so it also leaves the conversation embedding index — related conversations (ADR-109/169) can never reach it again. Vault context is therefore the *only* semantic path to an archived conversation; excluding it leaves Obsidian's full-text search as the sole way back in. That is a genuine loss, not a rounding error.

**Three ways out, in rising cost:**

1. **Exclude `archiveFolder`** like its two siblings — one line in each `skip` array plus a test. Consistent, and a user who wants the archive indexed can still name it under *Folders to index*. Currently the lean.
2. **Leave it.** No code change; the README already describes the behaviour rather than an intent, so nothing is inconsistent.
3. **A setting** — "Include archived conversations in vault context", default off. Honest about there being two right answers, but a new setting for a question a default could answer; hold it until someone asks.

**When to come back.** Whichever way this goes, decide it before the archive has had time to fill on a real vault — a decision made after someone has 500 transcripts indexed is a migration, not a default. The trigger to revisit: the first vault where the archive folder is large enough to notice in retrieval results, or #294 landing (a size readout makes the volume visible and the question concrete). Until then the behaviour is documented, not silently wrong.
### #301 — The locale tables outgrew the line budget (partly closed, 2026-09-22)

`locales/en.ts` and `locales/de.ts` crossed `DEFAULT_MAX` (600) while ADR-178 was adding twelve strings, and are grandfathered at 620 in `scripts/check-file-size.mjs` rather than split.

The reasoning for grandfathering: a line in a string table is **one user-visible string**, so the budget there measures vocabulary, not the structural discipline ADR-097 exists to bound. A 600-line controller is a controller doing too much; a 600-line string table is a plugin with 600 strings.

The reasoning against leaving it: the file is now hard to read, a new string lands wherever the alphabet or the diff puts it, and the German table drifting out of step with the English one is invisible except to the parity test.

**The fix when it is worth doing:** split per feature area — `locales/en/chat.ts`, `settings.ts`, `glossary.ts`, … composed into one object, with `Strings` still derived from the English composition so the compiler keeps enforcing parity. Mechanical, touches every string, worth one focused pass rather than a corner of a feature PR.

**Revisit when:** the tables pass ~700 lines, or the next time someone has to hunt for where a string lives.

**2026-09-22 (ADR-199):** the first area is split — the embedding, vault-context and index strings live in `locales/embedding.{en,de}.ts`, spread into the tables, with `Strings` still derived from `en`. Both tables fell under `DEFAULT_MAX` and their 620 ceilings were removed. Split the next area the same way when it grows.

## Follow-up (#302) — the catalog nobody updated, 2026-09-18

| # | Item | Severity | Status |
|---|---|---|---|
| 302 | **The model catalog had no update path.** Prices had a weekly models.dev PR since ADR-163; the catalog they hang off changed only when someone remembered. The first comparison found `mistral-large-latest` at 128K (upstream 262,144) and `mistral-small-latest` at 128K (256,000) — history trimmed at half the real budget — three offered OpenAI models deprecated upstream, and no GPT-5 model at all. Fixed by `scripts/update-models.mjs` + `.github/workflows/update-models.yml` (ADR-179): context windows by PR, new and deprecated models in one standing issue, never applied by the script. The shared upstream facts moved into `scripts/modelsDev.mjs`. The five window changes from the first run are in; the 24 new and 3 deprecated models are left for the issue. | Medium | Done |

## Follow-up (#303–#304) — found while adding models, 2026-09-18

| # | Item | Severity | Status |
|---|---|---|---|
| 303 | **Mistral is sent effort levels its models do not list.** `MistralService` sends `reasoningEffort` whenever one is set, on any model (the SDK types allow any value). models.dev lists `none` · `high` for both `mistral-small-latest` and the new `mistral-medium-latest`, and Pythia's `EffortLevel` is `low` · `medium` · `high`. Nobody has reported a 400, so either the API tolerates the extra values or nobody has combined the two. Mistral's docs (2026-09) confirm it: `reasoning_effort` takes `none` or `high`, and only on the adjustable-reasoning models (Small, Medium); Magistral always reasons. **Proposed fix:** a per-model `mistralEffort` capability in the catalog (`"adjustable"` for small/medium, absent elsewhere), one pure `mistralReasoningEffort(model, level)` mapping `low` → `none` and `medium`/`high` → `high` on adjustable models and returning `undefined` otherwise, and `parameterSupport("mistral", …)` reporting `effort: true` only where it maps. `MistralService` sends what the function returns and nothing else. Tested in the forbidden direction: `low` never reaches the wire. **Built as ADR-180**, with `supportsEffort` reused as the capability flag instead of a new field. | Medium | Done |
| 304 | **GPT-5 gets its system prompt as a user turn.** `OpenAIProvider` sets `noSystemRole = isReasoningModel(model)`, a rule written for o1, which had no system role. GPT-5 (and today's o-series) accept `system`/`developer`. Folding the prompt into a `[System instructions]` user message works, but gives the instructions less weight than the role would. **Proposed fix:** remove `noSystemRole` and the `[System instructions]` fold entirely. Every OpenAI reasoning model left in the catalog (o3, o3-pro, GPT-5) accepts a system message, which OpenAI treats as a developer message; only o1-mini, long gone, did not. Keep one test that a reasoning model's request carries `role: "system"` at position 0. **Built as ADR-180**; GPT-5 has its own request-shaping test. | Low | Done |

## Follow-up (#306) — the embedding Worker never engages on desktop, 2026-09-18

Found in a desktop console log (Obsidian on macOS, vault in iCloud), which is the live confirmation ADR-119 said the Worker still needed. It has not been built yet.

| # | Item | Severity | Status |
|---|---|---|---|
| 306 | **On desktop, embedding always runs on the UI thread.** `FallbackEmbeddingProvider` tries three backends, and on desktop the first two fail every time: (1) the **blob Worker** starts, but model load fails with `Unsupported device: "wasm". Should be one of: cpu`; (2) the **resource-path Worker** is refused, `Failed to construct 'Worker': Script at 'app://3c8bdc1…/…/embedding-worker-….mjs' cannot be accessed from origin 'app://obsidian.md'`; (3) the **iframe** then works, on Obsidian's UI thread. Vault indexing and related-conversation search therefore share the thread with the editor on every desktop. The throttling in `VaultIndexService` keeps Obsidian responsive, but a large build is still visibly slower, and ADR-119's off-thread fix has probably never been in effect on desktop. **Built** (steps 1–4 below): `services/embedding/host/workerPrelude.ts`, the backend label and its log line. The step-3 settings readout was left out. **Needs the live check:** on Obsidian desktop, `blob worker unavailable` must be gone and the console must read `[Pythia] embedding: worker (blob)`. | Medium | Built — awaiting live check |

**Cause of (1).** Obsidian enables Node integration in workers. In the worker, `process.release.name === "node"`, so transformers.js 3.8.1 sets `IS_NODE_ENV` in `src/env.js`, even in the browser build (`transformers.web.js`, which esbuild picks with `platform: "browser"`). `src/backends/onnx.js` then offers only the onnxruntime-node devices (`cpu`, and `dml`/`cuda` where present), not `wasm`, and `model.ts` always requests `wasm`. The worker itself starts fine: this is environment detection, not a CSP refusal. The iframe works because a same-origin `srcdoc` iframe has no `process`.

**Cause of (2).** Intended and not a bug. The resource-path Worker (ADR-126) exists for platforms that refuse `blob:` Workers. On desktop the resource path is served from a per-vault `app://<hash>/` origin, which is cross-origin to the page, and a Worker script must be same-origin. It only has to work where (1) cannot, and it should not be relied on for desktop.

**Fix strategy.**

1. **Hide `process` from transformers.js in the worker, before it loads.** Prefix the embedding bundle with one statement that runs before any bundled module code, only when running as a Worker (`typeof window === "undefined"`): shadow the Node global (`globalThis.process = undefined`, or `delete` where the property is configurable). The bundle is a single esbuild ESM file with no remaining `import` statements, so a prefix really does run first. Do it in the bundle source, `getEmbeddingBundle()` or a wrapper in `esbuild.config.mjs`, not in `entry.ts`: ESM hoists imports, so a statement in `entry.ts` would run *after* transformers.js had already read `process`. transformers.js then sees what it sees in the working iframe, a browser, and offers `wasm`.
2. **Leave everything else as it is.** Same bundle, same single-threaded WASM (`numThreads = 1`, the ADR-119 crash fix), same fallback chain. If the Worker still fails for another reason, the iframe still catches it. The fix can only move a vault from the iframe onto a Worker, never break embedding.
3. **Make the backend visible, so the next report does not need a console.** Log which backend engaged, once and at info level: `embedding: worker (blob)` / `worker (resource)` / `iframe (UI thread)`. Consider showing the same in the embedding settings, next to the index size. A silent fallback to the slow path is what hid this since ADR-119 (principle 2).
4. **Test what can be tested headlessly.** Unit-test that the worker prefix exists and comes first in the bundle source, and that the iframe path does not get it. The real proof needs Obsidian desktop: after the fix, the `blob worker unavailable` warning must be gone and the new log line must read `worker (blob)`. Say so in the PR; it is the same live check ADR-119 asked for.
5. **Check mobile after the change.** Workers there have no Node integration, so `process` is already undefined and the prefix does nothing. One look at an iPhone console confirms nothing moved.

**Risk.** Low. The prefix touches the Worker's own global scope and nothing in the plugin's renderer. The one unknown is whether onnxruntime-web's WASM backend then runs in Electron's Node-enabled worker. If it does not, (3) still catches it, and the new log line says so.
## Follow-up (#305) — the model an answer names, 2026-09-18

| # | Item | Severity | Status |
|---|---|---|---|
| 305 | **An answer named the conversation's model, not the one that answered.** `sendMessage` built `assistantMsg.model` and `costSnapshot` from `conv.model`. Since ADR-177, an armed template can send one turn on another model through `turnConv`, so that turn's label and `≈ $` named and priced the wrong model, and a stream error quoted it too. Found while adding ADR-181's one-send model suggestion, which depends on the label being right. All three now read `turnConv.model`. `sidebar.ts` has no coverage (D-27), so there is no test that would fail in the forbidden direction. The fix is three lines in the send path. | Medium | Done |

**#306, as built.** The build confirmed the premise before the fix was written. In the minified bundle, transformers.js evaluates `typeof process<"u"` and `process?.release?.name==="node"` at module scope, and the bundle has **no static `import` left** (one dynamic `import()`, which runs later). A prefix therefore runs before that check. The prelude deletes `globalThis.process`, or assigns `undefined` if the property cannot be deleted. It is guarded by `typeof window === "undefined"`, so the iframe is untouched even though it shares the bundle, and it never throws. The tests run it in real `vm` contexts: Node-like global, non-configurable property, window present, no `process` at all. The resource-path file got a `-p1` suffix, because a same-version file written before the fix would otherwise be reused without the prelude. The settings readout from step 3 was not built: the log line answers the question a report asks, and a settings row can follow if someone needs it without a console.

## Bug (#342) — the data.json watcher and deferred leaves, 2026-09-22

| # | Item | Severity | Status |
|---|---|---|---|
| 342 | **Every external data.json change threw in the watcher.** The iPhone console showed `loadPluginData kept newer in-memory conversations`, then `data.json watcher: TypeError: A.setActiveConversation is not a function`. `setActiveConversation` was never renamed. Since Obsidian 1.7.2, a leaf that is not visible is **deferred**: `getLeavesOfType(PYTHIA_VIEW_TYPE)` still returns it, but `leaf.view` is a placeholder `DeferredView` until the leaf is revealed. On a phone that is the Pythia drawer until it is opened. `reloadFromDisk` cast each `leaf.view` to `PythiaSidebarView` and called the method on the placeholder. **Fixed:** `loadedPythiaViews(workspace)` in `services/ViewManager.ts` keeps only `instanceof PythiaSidebarView`, and is now used by `reloadFromDisk`, `activeConversationIds` (eviction protection) and `getSidebarView` (`refreshInstructions` after the settings tab closes had the same crash). `activateView` loads a deferred leaf with `loadIfDeferred()` instead of treating it as missing and opening a second Pythia leaf. It now throws a named error instead of casting. | Medium | Done |

**Was the reload half-applied?** Partly. The throw came after everything that touches data: settings, API keys, the merge into `p.conversations`, and the `flush()` that writes memory's winners back. What it skipped was the rest of the view loop.

- **One Pythia leaf, deferred (the reported phone case):** there is no data loss, only console noise on every sync. When the drawer opens, `onOpen` reads `p.conversations` afresh.
- **A deferred leaf listed ahead of a loaded one** (e.g. Pythia in a background tab and in the sidebar): the loaded view was never re-pointed. Where disk won the merge, `mergeConversations` put a *new* object in `p.conversations`, but the view kept the old one. Its next `conversationStore.save(old)` put that old copy back in the list and persisted it, silently rolling back the other device's change. The fix re-points every loaded view. The test asserts the view receives the disk-winning object, not the replaced one.

**Guard.** `tests/deferredLeaves.test.ts`: a deferred leaf ahead of a live view (fails against the old code with the exact iPhone message); a lone deferred leaf; `getSidebarView` and eviction protection skipping a placeholder; and a source scan that fails on any `.view as PythiaSidebarView` in `main.ts`, `sidebar.ts`, `settings.ts`, `services/`, `ui/` or `suggest/`.

**Needs the live check:** on the iPhone, change data.json from another device with the Pythia drawer closed. The watcher warning must be gone, and opening the drawer must show the synced state.

## Follow-up (#344–#347) — Obsidian on an iPhone reloads every minute, 2026-09-22

Found on the device, not guessed. The phone (iPhone 15 Pro Max, iOS 26.6.2) was attached over USB: `ios_webkit_debug_proxy` exposed Obsidian's WebContent inspector (`capacitor://localhost`), `idevicesyslog` streamed the system log, `idevicecrashreport` pulled the stored reports. At the moment of a reload the log read `memorystatus: killing_specific_process pid … [com.apple.WebKit.WebContent] (per-process-limit …) 2097203KB` → `killed by jetsam reason per-process-limit`, one second after `[Pythia] embedding: worker (blob)`.

| # | Item | Severity | Status |
|---|---|---|---|
| 343 | **The multilingual embedding model does not fit a phone.** Measured in fresh processes with a ballast allocation: Obsidian + 14 plugins ≈ 640 MB; + English model ≈ +130 MB; + multilingual ≈ +900–1 000 MB (bmalloc ≈ 1 280 MB, JS heap 4 MB). At ~1.65 GB resident, the first inference or any other plugin's allocation crossed the ~2 GB limit. Batch size was not the lever — batch 1 died like batch 16. | High | **Fixed (ADR-199).** `effectiveEmbeddingModel` gives a phone a `mobile` model; the setting is untouched and the desktop keeps multilingual. `tests/embeddingModelRule.test.ts` fails on a second reader of the setting. |
| 344 | **The fallback chain reloaded the model after running out of memory.** `RangeError: Out of memory` in the blob Worker was treated as a refusal: the resource Worker and then the iframe (UI thread) each loaded the model again into the same process. | Medium | **Fixed (ADR-199).** `isOutOfMemoryError` ends the chain with `EmbeddingOutOfMemoryError`; refusals still fall through. |
| 345 | **One crash became a loop.** The index was never complete, so every send started the same build; Obsidian's `app:reload` keeps the WebContent process, so even a reload did not return the memory. | High | **Fixed (ADR-199).** `BuildGuard`: a per-device marker around each build; two deaths in a row pause automatic builds until *Build now*. Out-of-memory keeps its marker; ordinary failures and normal unloads clear theirs. |
| 346 | **The settings status could not show any of this.** One string set as a build side effect: "Idle — the index builds on first use" for a complete index not yet loaded, nothing for a killed build, and the model in use nowhere. | Medium | **Fixed (ADR-199).** Seven states from `describeVaultIndexStatus`, read from the file header without loading the model, live during a build; explanations at the head of each embedding section. |

Found along the way and fixed separately as #342: the data.json watcher threw `A.setActiveConversation is not a function` on every reload from disk (seen in the phone's console).

## Follow-up (#348) — the phone gets its multilingual model back, 2026-09-22

| # | Item | Severity | Status |
|---|---|---|---|
| 347 | **#344's fix lost cross-language matching on the phone.** The English stand-in matches German only through shared words and never crosses languages by meaning — for a mostly-English vault asked in German, the case that matters. A leaner multilingual model was looked for and does not exist for this runtime: every candidate with a transformers.js build has a 120k–500k vocabulary, and on a MiniLM the vocabulary *is* the memory (tokenizer 153 MB JS heap, embedding table 332 MB WASM heap, transformer ~22 MB — measured with the bundled runtime). | Medium | **Fixed (ADR-200).** The same model with its vocabulary cut to Latin script (128 507 of 250 002 pieces): identical vectors for Latin-script text (413 texts, cosine 1.000000, identical segmentation), ≈ +370–400 MB on the iPhone. A `variantOf` the full model, chosen by the device and never offered in settings; index files named by vector family so the phone reads the desktop's index. A usage-based prune was tried first and rejected — not exact (0.44 on new Spanish). |

## Follow-up (#349–#352) — review of #200, 2026-09-22

| # | Item | Severity | Status |
|---|---|---|---|
| 349 | **The shared index mixed two models' vectors for non-Latin text.** Files are keyed by vector family (ADR-200), but the variant equals the full model only for Latin-script text; a phone-written row for a note with Cyrillic/Greek/CJK had the same content hash, so the desktop reused the degraded vector indefinitely (also for conversations). | Medium | **Fixed (ADR-201).** `rowProvenance.ts`: the variant tags rows it cannot reproduce exactly; the full model re-embeds them; the variant accepts the full model's rows. No format change. |
| 350 | **Paused over a complete index read "Ready".** `status()` exempted `ready` from `paused`, yet a paused session never loads the model, so retrieval returned nothing while the status was green and *Build now* disabled. Reachable by two background kills during the per-session sync. | Medium | **Fixed (ADR-201).** Paused whenever the guard blocks; the headline says vault context is off until *Build now* and that rows are kept. |
| 351 | **A stored variant id passed settings validation.** `ENUM_KEYS.embeddingModelId` was `EMBEDDING_MODEL_IDS`, which includes the variant. | Low | **Fixed (ADR-201).** `SELECTABLE_EMBEDDING_MODEL_IDS`. |
| 352 | **"Building… 0 of 0 notes" during the model load.** | Low | **Fixed (ADR-201).** A `loading` phase and headline naming the download size. |

## Follow-up (#353–#355) — switching apps on iOS, 2026-09-22

| # | Item | Severity | Status |
|---|---|---|---|
| 353 | **Timeouts were wall-clock.** `READY_TIMEOUT_MS` compared `Date.now()`; each request armed a one-shot `setTimeout`. Returning after >5 min in the background during a first download rejected the load at once, and the rejection is memoized for the session. | Medium | **Fixed (ADR-202).** `VisibleClock`; both providers; a source test forbids the old shapes. |
| 354 | **A background kill counted as a crash.** Two app switches during a first build paused automatic indexing. | Medium | **Fixed (ADR-202).** `background` on the marker; `foregroundDeaths`. |
| 355 | **The idle model stayed resident (~400 MB).** Obsidian became the first app iOS ends in the background, and cold-starts on return. | Medium | **Fixed (ADR-202), not yet measured on the device.** `EmbeddingResidency`: release on hide / after 3 min idle on a phone; preload on return and input focus. |

## Bug (#356) — the data.json watcher reloaded itself, 2026-09-22

| # | Item | Severity | Status |
|---|---|---|---|
| 356 | **A reload loop that rewrote data.json every 5–10 s.** Seen in the console as endless `loadPluginData kept newer in-memory conversations {kept: 28, onDisk: 28}` pairs. Three parts: `mergeConversations` counted a tie (`>=`) as "kept from memory"; `loadPluginData` marked **every** conversation dirty whenever that count was > 0; and the watcher recognised its own write only inside a 3 s window it polls every 5 s. Each reload therefore rewrote the whole file (and re-synced it through iCloud), and the next poll took that for an external change. | Medium | **Fixed.** Ties keep the memory object but are not counted; `MergeOutcome.newerInMemory` names the conversations disk is actually behind on and only those are marked dirty; `persist` and the watcher's reload absorb the mtime they produced (`ownWriteLanded`). `tests/pluginDataStore.test.ts` drives the real watcher: one external change → exactly one reload over 30 s. Each part was reverted to confirm its test fails. |

## Bug (#357) — the index buttons after a failed load, 2026-09-22

| # | Item | Severity | Status |
|---|---|---|---|
| 357 | **After an out-of-memory load, *Build now* and *Rebuild index* did nothing visible — and Rebuild destroyed the index.** `FallbackEmbeddingProvider` memoizes its rejection for the session (right for automatic retries), so a manual retry returned the same rejection in a millisecond and the status never moved. `reindex()` cleared the rows first, then hit the same instant failure. The load most likely failed because the 2.25.0 update reloaded Pythia inside the running app, which on iOS does not free the previous model's memory (measured earlier the same day: an in-app reload → `RangeError: Out of memory` on the next load). Separately, the *out of date* text said a folder change "rebuilds" the index, where the build reuses every unchanged note's vectors. | High | **Fixed.** A manual build after a failed attempt resets the provider before loading (a healthy loaded model is kept); Rebuild clears only after the model loaded; the out-of-memory text tells the user to close Obsidian completely and press Build now; the out-of-date text says indexed notes are kept. Tests: retry loads again and builds, a healthy model is not reloaded, a failed Rebuild keeps every row, a working Rebuild clears, and a scope change embeds only the new notes. Each fix reverted → its test fails. |

## Review of the indexing work (#358–#362), 2026-09-22

*A senior read-back of ADR-199..202 — the iOS reload investigation and its follow-ups — rather than a report from the device. Two defects, three improvements, all fixed in one PR (ADR-203).*

| # | Item | Severity | Status |
|---|---|---|---|
| 358 | **One failed load reported itself as two dead builds and paused the index.** The provider memoizes a failed load for the session, but every later send re-entered the build: a new interrupted-build marker, the memoized rejection a millisecond later, and on out of memory the marker is kept by design (ADR-199). Three sends after ONE out-of-memory load → "the last 2 builds ended without finishing", automatic indexing paused, and a provider hammered on every send for a load that cannot succeed. | High | **Fixed.** An automatic build does not retry a load that failed in this session — no marker, no notice; the status line already names the failure and *Build now*. A manual build resets the provider and runs; a new session starts clean. `tests/vaultIndexRecovery.test.ts`. |
| 359 | **A manual build reloaded a model that was fine.** #357's retry reset the provider after *any* previous failure, including a build that failed with a healthy loaded model (five bad embeds, a failed write) — on the desktop, a Worker teardown and a model reparse for nothing. | Low | **Fixed.** The failure phase records whether the LOAD failed; only that resets the provider. `tests/buildDecision.test.ts`. |
| 360 | **A phone dropped every edit made before its first send.** `applyChanges` buffers edits until the index is hydrated (ADR-184) and the build replays them — but the UI-thread backend's short-circuit (complete index → hydrate, ready, return) skipped the replay. So on a phone, a note edited between launch and the first send kept its old vector until it was edited again after a build. A desktop's full `sync` re-reads every note, which hid it. | Medium | **Fixed.** The short-circuit replays the buffer before returning; the replay still happens exactly once. `tests/vaultIndexRecovery.test.ts`. |
| 361 | **The settings status line re-read the whole index file.** `status()` peeks the file header when the session has not built, and `IndexStore.read()` returns the entire binary — ~19 MB at the 5 000-note cap — for 64 bytes of header, on every change event the row subscribes to. | Low | **Fixed.** The header is remembered and dropped whenever this session could have changed the file (a build starting or ending, a targeted batch, a model change); a read that threw caches nothing. `tests/vaultIndexRecovery.test.ts`. |
| 362 | **The related-conversations sync was invisible to the model residency.** ADR-202 asks `vaultRag.isBuilding()` before releasing a phone's idle model. The sync's embed loop protects itself (one await per conversation, so the in-flight count never reaches zero at a macrotask boundary, and `visibilitychange` can only run at one) — but its opening file read and closing write are such boundaries, with the model needed on the far side of both. Narrow, and real. | Low | **Fixed.** `ConversationIndexService.isSyncing()`, OR-ed into the residency's `building`. `tests/ConversationIndexService.test.ts`. |

*Also in the same PR, from the same read-back:* a corrupt stored index is logged instead of silently re-embedding the vault (principle 2); the idle-release timer is armed on a phone only; `VisibleClock.timeout` floors its poll interval so a zero deadline cannot spin.

## Review of the embedding backends (#363–#365), 2026-09-22

*A second pass over the same work, this time through the provider chain rather than the index.*

| # | Item | Severity | Status |
|---|---|---|---|
| 363 | **`unload()` could not reach a model that was still loading, so it finished loading into a provider nobody owned.** A backend becomes `active` only once it is ready, so during the first download `FallbackEmbeddingProvider.unload()` had nothing to unload: the chain kept running, and `engage()` then parked the loaded model on an instance the plugin had already dropped. Nothing could free it afterwards — on a phone, several hundred MB held by a Worker with no reference to it. Reachable two ways, both ordinary: changing the embedding model while the first download runs, and `onunload` (a plugin update or reload inside the running app). The second matches the out-of-memory the device reported right after the 2.25.0 update — Obsidian's page survives an in-app plugin reload, and so did the orphaned model. Separately, each provider's ready poll kept retrying against a terminated backend for the rest of its five-minute deadline, and a load error survived `unload()`, so a later `ready()` was rejected instantly by a backend that no longer existed. | High | **Fixed.** The chain carries a generation: `unload()` moves it on, unloads every backend the current load has built (`starting`), and `engage()` releases a backend from an older generation instead of engaging it, failing that load. Both providers stop their ready poll when their generation moves and clear the stale load error. `tests/embeddingProviderFactory.test.ts`; both halves reverted to confirm the tests fail. |
| 364 | **The embedding frame answered any same-origin window.** The host checks the origin *and* the source of what comes back from the iframe; the iframe checked neither, so any other frame in the window could ask it to embed text and read the vectors. | Low | **Fixed.** The frame answers `window.parent` only — the same check in the other direction (principle 1). |
| 365 | **`WorkerEmbeddingProvider` and `IframeEmbeddingProvider` are the same postMessage client twice.** Both hold `Pending`, `request`, `onMessage`, the ping-proven ready poll and the two timeouts, differing only in how they mount the backend and in `isOffThread()`. #363 had to be fixed identically in both, which is the evidence for principle 4 ("one implementation per interaction"). | Medium | **Fixed** (ADR-204). `PostMessageEmbeddingProvider` owns the protocol; a subclass supplies `mount()` (returning a `BackendChannel`), `label` and `isOffThread()`. 282 duplicated lines become 69. The protocol is now unit-tested for the first time — `tests/postMessageBackend.test.ts`, against a fake channel — including every rule #363 established, each checked by reverting it. Still to verify on the device: the two real backends are runtime-only by nature. |

## Refactor (#366) — `main.ts` at its line ceiling, 2026-09-22

| # | Item | Severity | Status |
|---|---|---|---|
| 366 | **`main.ts` reached exactly 600 lines, `DEFAULT_MAX` in `scripts/check-file-size.mjs`.** The ratchet fails at 601, so the next line would have broken CI and forced whoever added it to split the file under time pressure. Underneath the size: three blocks with real rules had drifted back into a file that is *deliberately* excluded from coverage (`vitest.config.ts`), because it is a `Plugin` subclass whose job is to call Obsidian. So "a model change tears down the provider AND both index services", "a watched path is changed or deleted, never both" and "every deep-link failure says something" were load-bearing behaviours with nothing able to fail on them. | Medium | **Resolved (ADR-205).** Three extractions, each behind a structural host interface rather than the plugin — the shape `installEmbeddingResidency` (ADR-202) and `ui/vaultIndexStatusSetting.ts` (ADR-199) already use, and the thing that makes the move buy testability rather than only lines. **`services/embedding/EmbeddingHub.ts`** (291): the shared provider's cache-and-invalidate rule, `activeModelId()` (still the one reader of `settings.embeddingModelId` outside the settings control), the related query with the model's measured floor and `RELATED_RESULT_LIMIT`, the warm, and the vault-RAG lifecycle; it imports no Obsidian runtime. **`services/vaultWatcher.ts`** (130): `VaultChangeBatch` plus the four listeners. **`services/deepLink.ts`** (89): `handleDeepLink`. `main.ts` 600 → **400**, no ceiling added (the ratchet only goes down); `plugin.vaultRag` is a getter onto the hub and the public facades are unchanged, so nothing outside `main.ts` moved. +56 tests across three new files (1698 across 116 after merging main). **29 mutations applied, 29 killed** — two survived the first pass, both flaws in the new tests: a "silent warm" test that stopped at the warm's index guard before it could have produced a notice either way, and a cap asserted as a constant instead of observed on a 40-conversation result list. `tests/embeddingModelRule.test.ts` follows the one-reader rule to its new home, and its pattern now also matches the `settings().embeddingModelId` getter form the extraction introduced — which the field-only regex would silently have stopped guarding. |

**Deliberately left alone.** Two pre-existing behaviours were preserved rather than fixed inside a behaviour-preserving extraction, both named in ADR-205 so the next reader does not have to rediscover that they were seen:

- A first `ensureProvider()` calls `vaultRag.reset()` before anything has been built — idempotent, and unreachable in a state where it would matter. A guard would add a branch to a teardown path.
- A rename whose new path is not markdown records the delete of the old path but schedules no flush, because `markChanged` returns on the extension check before `flush()`. The case that occurs is `note.md` → `note.txt`, so the old path **was** indexed and its row goes stale until the next vault event. `inScopeNow` filters results by scope and opt-out, not by existence, so the stale path can take one of the ~5 auto-retrieval slots before `ContextBuilder` drops it into `missingNotes` (debug log only for auto notes, ADR-183). Nothing wrong reaches the model; the cost is a wasted slot. **Worth fixing on its own** — flush unconditionally on rename — and filed here rather than done here.
