# Pythia — Architectural Decision Records

*Last updated: 2026-09-18 — ADR-178 (rewriting a passage of a note from the conversation: the user captures the range, the model proposes, and the write is a separate step that verifies the passage is still there).*

*Previously: 2026-09-18 — ADR-177 (a template applied to a running conversation is a one-shot: it shapes the next answer through a snapshot layer and is then spent, instead of overwriting nine conversation fields permanently). ADR-175 and ADR-176 are in flight on their own branches.*

*Previously: 2026-09-18 — ADR-174 (the limit is measured in bytes, and the list is paged: the cap's default was never measured — 450 now, with a data.json size readout and a warning past 25 MB — and the browse listing draws 50 rows with the forks indexed once instead of a filter per row).*

*Previously: 2026-09-18 — ADR-173 (the delete dialog offers the archive: Archive · Delete · Cancel, a choice at the one moment anyone knows whether this conversation mattered, fail-closed like the automatic archive).*

*Previously: 2026-09-18 — ADR-172 (the limit archives before it deletes, and "no limit" is an empty box: eviction now writes each conversation to a vault note first and keeps any whose note fails, and the magic 0 leaves the settings field).*

*Previously: 2026-09-18 — ADR-171 (a number being typed is not a setting, and lowering the conversation cap is a deletion: per-keystroke commits meant lowering the limit from 200 to 0 stored 20 and then 2 on the way, and `persist()` evicted on every write — so a settings keystroke deleted every conversation without a favorite).*

*Previously: 2026-09-17 — ADR-170 (the search panel's cost stops scaling with the vault: the match snippet was 99% of a keystroke — 398ms at 500 conversations — because it re-tokenized every line for every rendered row, and the result list was uncapped; plus three defects found reviewing ADR-169's own diff).*

*Previously: 2026-09-17 — ADR-169 (the related-conversations floors are measured, per model, and the index warms in the background: the shipping 0.35 sat BELOW the median score of a random pair, two hypotheses were refuted by the measurement, and a cold first click costs ~19 minutes on a 200-conversation vault).*

*Previously: 2026-09-17 — ADR-168 (search matches by degree, and widens along the note dimension: one graded matching rule finds German compounds and longer-typed forms, a relevance floor keeps the loosened rule from returning the corpus, `note:` searches the notes a conversation attached or cited, and an automatic widening always says so).*

*Previously: 2026-09-16 — ADR-167 (the strip under the composer, measured in the running app: Obsidian pads every `.view-content` at (0,2,0), a theme added a phone-drawer reserve, and Obsidian's floating-nav fade painted the result; plus the two things that exemption uncovered — the composer's desktop clearance and a keyboard lift that reads Obsidian's own `--keyboard-height`).*

*Previously: 2026-09-16 — ADR-166 (glossary definitions read in the conversation's language: translated on open, cached in the term note per language, invalidated by a hash of the definition; under AUTO new definitions follow the passage's language).*

*Previously: 2026-09-16 — ADR-165 (the header shows what every answer is sent with: model | effort | language, resolved, tinted when set for this conversation, each changeable in one tap; rename and copy link move into a menu).*

*Previously: 2026-09-16 — ADR-164 (the plugin's own icon: one registered mark for every entry point, drawn to Lucide's rules so it reads as native; `bot` retired).*

*Previously: 2026-09-16 — ADR-163 (the cost of an answer is an estimate from a date-stamped table, shown where the tokens already are; addenda: the cost is snapshotted on the message at generation; prices come from models.dev through a weekly pull request, never a fetch; off by default; no price table and no per-user overrides in the settings — the toggle and a disclaimer naming models.dev). `≈ $0.012` follows the token counts on every assistant turn label, computed at render time from `models/modelPricing.ts`; a running total per conversation sits in the history panel; the next-send token estimate beside Send is removed. Off-switch in settings.*

*Previously: 2026-09-16 — ADR-162 (a cut-off reply says so, and the token rule lives in one place). Both providers report why a stream stopped; Pythia mapped `max_tokens`/`length` to "done" and the user saw a finished-looking answer. Now `Message.truncated` is persisted, a recovery card under the answer offers Continue / Retry with a raised limit / Compare, an empty reasoning reply says its budget went on thinking, and one pure `maxTokensAdvice` drives the settings-modal advice line, the warning beside Send and the card. Model rows carry speed · depth · cost tiers.*

*Previously: 2026-09-16 — ADR-161 (the second review: one implementation per interaction, pay for the keystroke, inherited stays inherited). 56 fixes across the UI controllers, settings surfaces, embedding layer and CSS — the parts the first review had only skimmed. Four popovers shared one latent leak (a deferred `document` listener added after the surface had already closed), now `ui/outsideDismiss.ts` with a lint rule confining raw document listeners; the conversation panel and the `#` picker re-tokenized their whole corpus on every keystroke, now cached; every typed settings character rewrote `data.json`, now debounced; the conversation modal pinned untouched temperature/max-tokens on Save; four summary paths still swallowed an empty result despite ADR-158; a truncated embedding index broke every later query; a term with a sanitized file name lost its real name. +18 tests (967 across 60 files).*

*Previously: 2026-09-16 — ADR-160 (compare models on the last exchange; the conversation ends with the user turn while it is pending). Long-press on the last user bubble gains **⇄ Compare**: the prompt is re-run on a picked model, sequentially, into a card with one tab per model. **Keep this answer** makes that tab the assistant turn and every other tab a fork named `<conversation> · <Model>`, branched from the kept message; sending is blocked until one is kept. The invariant that makes it simple: the original answer leaves `messages` and becomes candidate 0, so the send path needs no change and history never holds two answers to one prompt. Pure logic in `services/comparison.ts` (+22 tests), card in `ui/ComparisonController.ts`, the gesture and its bar extracted to `ui/ExchangeActionsController.ts` (sidebar.ts 1853 → 1763). 949 tests across 59 files.*

*Previously: 2026-09-16 — ADR-159 (validate at the boundary, and let the tooling say no). A whole-codebase quality and security review landed 55 fixes in five commits. The pattern behind most of them was the same: a value crossed a trust boundary — data.json, a template's frontmatter, a model's tool-call arguments, a file name — and was used as if it had been checked. `mergeSettings` and `parseConversations` now validate every field; `create_note` can no longer overwrite; malformed tool arguments go back to the model as an error instead of executing on `{}`; the SDKs' hidden retries are off; dates are local; deep links carry the vault. The second pattern was rules that lived only in prose: `strict`, `noUnusedLocals`, `eqeqeq`, and lint rules for `toLocaleDateString` and `innerHTML` now enforce what CLAUDE.md asks for. +46 tests (926 across 58 files).*

*Previously: 2026-09-15 — ADR-158 (a response is a list of blocks, and "" is not a diagnosis). The favorites summary ran and showed no card. `AnthropicService.callUtility` read `response.content[0]` and returned `""` unless that one block was text — but **a response is a list, and with extended thinking the first block is `thinking`**. It hit the favorites summary because that is one of only three utility calls that run on the *conversation's* model rather than the fast model, and the reporter is on Opus 5 at high effort. It was invisible because `callUtility` returns `""` for both "no text" and "it failed", and the callers read `""` as "nothing to show" and said nothing. Now every text block is collected (same fix on Mistral, whose chunk-list case had the identical hole), and an empty result reports itself. **The bug is old; what changed is how often a thinking block leads.** +5 tests (880).

*Previously, 2026-09-15 — ADR-157 (marks nest; the innermost one owns the tap). Only one direction was blocked: `findRange`/`paintRange` already ignore element boundaries, but `repaintTerms` skipped text inside `.p-highlight`/`.p-fork-origin`/`.p-merge-link`, so **favoriting a passage silently un-marked every term in it**. The exclusion's stated reason — overlapping wrappers to untangle — was wrong: terms paint last, so they *nest* inside, and each unwrapper targets its own class. Terms may now nest (only term-in-term is still refused), `normalize()` rejoins text split by an unwrap so a term straddling the seam still matches, and **the innermost mark owns the tap**, replacing a fixed type order that had never actually fired and left a visible term mark doing nothing inside a fork. Also fixes an ADR-151 bug: the tap lookup asked for `.p-term` only, so person marks were painted and dead. Resolution extracted to `ui/markTap.ts`. +19 tests (875).*

*Previously, 2026-09-15 — ADR-156 (the glossary anchor goes where the fork anchor goes). Fork and merge call `lastMark.after(anchor)`; the glossary called `block.after(anchor)`, so the definition appeared at the end of the term's paragraph instead of beside the term. The original reasoning — a block spliced into a sentence reflows the text — is true and does not survive: fork and merge pay the same price, so the paragraph version bought "reflow somewhere else", and somewhere else is worse, because **in a long paragraph the card lands far from the word that opened it**. A term also repeats, so several marked words would all open their card in the same place. ADR-138 already said the cards are one component differing only in the left rule's stroke; **where a card appears is part of being that component**. +5 tests (858) in a new suite — the anchor had no coverage at all, which is how the divergence hid behind an ADR claiming they were identical.*

*Previously, 2026-09-15 — ADR-155 (a segmented control's fill is state, not decoration). Selecting an effort level left the segment grey until the sheet was scrolled. **A cascade error cannot be fixed by scrolling** — scrolling forces a composite, so the class was already right and the pixel was not. Two mechanisms: the fill was `transition`ed, and on iOS WebKit a background-color transition started from a class toggle in a touch handler may not paint until the next composite (aggravated by the group's `overflow: hidden` + `border-radius` clip); and `:hover` was unconditional, so iOS's sticky hover left `--background-modifier-hover` on the segment just tapped — a second grey reading as "selected". The transition is gone (a selection must be true at the moment of the tap) and `:hover` is now behind `@media (hover: hover)`, the line this codebase already draws twice. Reasoned, not reproduced: no iOS here.*

*Previously, 2026-09-15 — ADR-154 (the on-accent label is pure black or white, and says so twice). The Send button rendered a dark label on the accent fill. The mechanism was already wired correctly, so the question was why a working mechanism produces a dark label — and there are two candidates, both now closed. **The value:** `readableOnAccent` was allowed to keep a theme's `--text-on-accent` whenever it cleared AA, but black and white are the two highest-contrast choices against any colour, so deferring to a token can only lower contrast; it now gets `[]` and returns `#ffffff`/`#000000`. **The property:** these buttons are `all: unset`, `all` resolves the *inherited* `-webkit-text-fill-color` to `inherit`, and **WebKit reads that in preference to `color`** — so the `color:` line never got a say on iOS. All four on-accent rules now restate it. The contrast half is unit-tested; the WebKit half is reasoned, not reproduced. +7 tests (853).*

*Previously, 2026-09-15 — ADR-153 (run-in labels in the sources row; no wikilink brackets). A screenshot with nineteen web citations showed the `WEB` row wrapping to five lines with only the first starting at the label column. Not a tuning problem: `.p-sources-row` is `flex-wrap: wrap`, and **a wrapped flex line starts at the container edge, not under the first item** — there is no hanging indent in flex, so the 54px could only ever align each row's first line while charging 54px of a ~300px sidebar for all of them. Replaced with a run-in `Web:` prefix. The `[[ ]]` brackets go with it: the label now says the name is a note, so the brackets repeat it and cost four characters on the row that just ran out of width; the affordance survives as accent colour + hover underline. The context inspector keeps its brackets — it has no label. +4 tests (846).*

*Previously, 2026-09-15 — ADR-152 (two regressions in the conversation panel's search row). The clear ✕ was most likely WebKit's native one, removed by ADR-108's `-webkit-appearance: none` reset — so an explicit control was built rather than unpicking a reset that exists for a good reason. And ADR-107's auto-focus raises the iOS keyboard on open, which **overlays** the webview and puts the last conversations underneath; auto-focus is a keyboard affordance and is now desktop-only. The panel's existing inset fix turned out to be a hand-rolled copy of `ui/keyboardInset.ts` that had dropped `MIN_KEYBOARD_INSET`, so it padded the list at rest too — replaced with the shared, tested `keyboardOverlap`/`watchViewport`. Both fixes are kept: the focus change removes the unbidden keyboard, the inset handles the wanted one. +3 tests (842).*

*Previously, 2026-09-15 — ADR-151 (people are glossary entries). "Highlight a name and see who they are in every later conversation" is ADR-136 with a different noun, so `GlossaryEntry.kind` is `"term" | "person"` and everything is shared: folder format, merge rule, theme property, anchor, and **one index** — people and terms match in a single alternation. Only three things differ: the folder, the resolver, and the mark (solid underline where a term is dotted; the anchor adds a `double` left rule to the existing series). The prompt differs most: `describePerson` leads with what the passage establishes and is told to say it does not know rather than guess, because a person the model has never met is the normal case in a working vault. Vault-first-then-model-knowledge was the user's call with the risk stated; generated entries carry `source: model` visibly. The duplicated selection rule became `ui/entitySelection.ts`. +16 tests (839).*

*Previously, 2026-09-15 — ADR-150 (one note per term; the glossary folder is the database). Verified, not assumed: Obsidian Bases is a core plugin where **"each row is a file"**, and Dataview inline fields attach to the **page** with no per-heading scope. A theme-filtered deck is a per-term view, so one note per term is the precondition for the feature, not a preference — and ADR-149's visible labels were solving the wrong half, making fields visible to a reader while leaving every term invisible as a row. Terms are now notes with frontmatter (`aliases` is Obsidian's own property; translations are flat `term_xx` keys because properties have no object type; `theme` holds `[[links]]`), the theme note carries an embedded base filtered to itself, and `Conversation.theme === undefined` means *follow the conversation name* rather than a copy of it. Renaming is centralized so the theme moves with `fileManager.renameFile`, which rewrites the links. Writes merge rather than overwrite. `renderEntry`/`upsertGlossaryEntry` deleted. +34 tests (823).*

*Previously, 2026-09-15 — ADR-149 (the glossary note is the interchange format). The question behind "are there standards for glossaries?" was how to *avoid* building a flashcard reviewer: Pythia captures terms, other tools drill them. Only half of this has standards — terminology content does (SKOS, ISO 12620, ISO 704, TBX), flashcard drilling does not. Two findings followed: **a field inside `%% pythia: … %%` does not exist** to any external reader, and the flat alias list could not say whether "counter" was an inflection or a translation — wrong as of ADR-148's six languages. So card-relevant fields (`Forms:`, `Translations:`, `Context:`) became visible markdown with only provenance left in the comment, `aliases` narrowed to same-language forms, `translations` became language-tagged, `context` is new (one verbatim sentence, ISO 12620's attested context), and ISO 704's definition rules went into the prompt. Labels are English in every vault because they are keys, not prose. +16 tests (797).*

*Previously, 2026-09-15 — ADR-148 (one language setting, resolved per conversation). `outputLanguage` reached only the utility prompts, so a user could pin German and still get English chat answers; it now also feeds `buildSystemPrompt`. Six options (Obsidian's language, the conversation's language, German, English, Italian, Spanish), a global default with a per-conversation override, and one resolver — `BaseProvider.languageLabel(conversation?)` — behind every prompt. Two values resolve rather than name: `auto` adds **no instruction at all** (the absence is the feature) and `obsidian` follows Obsidian's UI locale into any of its ~30 languages. The system prompt gets a longer directive than the utility calls, because a chat answer has to hold its language across turns against a user typing in another one. +16 tests (781).*

*Previously, 2026-09-15 — ADR-147 (the panel was inset from its own leaf). Fifth report of dead space below the composer, after four shipped fixes that all changed padding *inside* the panel. The user then reported that the conversation panel leaves a gap **left and right as well** — and `.p-history` is `inset: 0` on `.pythia-view`, so it outlines the panel's true edges. **No padding inside the composer can produce a gap on the left.** The panel was inset on three sides by its own leaf container; only the bottom strip was large enough to notice. Fixed with `.workspace-leaf-content[data-type="pythia"] { padding: 0 }`. Verified in the failing direction first: without the rule the panel and the history overlay are both inset 8px left, 8px right, 34px bottom; with it, flush on all four sides. ADR-146's change is kept, its explanation withdrawn — the "exactly one 34pt home indicator" arithmetic was numerology, because an ordinary bottom padding produces the same 34. **When a fix fails twice, the next move is not a better guess at the same evidence; it is to get different evidence.**

*Previously, 2026-09-15 — ADR-146 (the composer does not reserve a home indicator; reverses ADR-132/134 and hard rule 7). Fourth report of dead space below the composer. Measured from the screenshot (DPR 3): **42 CSS px below the send button where 8 was intended** — 8 plus exactly one 34pt home indicator, so ADR-134's conditional override is not firing on that device. Rather than debug the measurement a third time, the question became what it was buying: a home indicator is only under the composer when Pythia is the bottom-most thing on screen, and Obsidian's own mobile chrome sits between a sidebar leaf and the edge. `env(safe-area-inset-bottom)` is gone from `.p-input-area` (now `padding: var(--s2) var(--s3) var(--s1)`), and `--p-bottom-inset` / `needsBottomSafeArea` are deleted with it. It stays on `.pythia-modal` and the action sheet, which really do touch the screen edge. Verified with 34px substituted for the env() Chromium reports as 0: 4px below the send button and **0px between the input area and the panel's bottom edge**. 42 → 4. The rule: **`env()` describes the device, not the element.** −4 tests (765).*

*Previously, 2026-09-15 — ADR-145 (a hairline grid on rendered tables). Making wide tables scroll (ADR-131/134) and stopping them splitting words (ADR-144) left a readability problem those fixes created: at sidebar width one cell wraps to three lines beside a neighbour that wraps to one, and with no rules between columns the eye loses which line belongs where. A 1px grid in `--background-modifier-border`, `border-collapse: collapse`, and `padding: 3px var(--s2)`. **A full grid rather than row rules**, because the risk here is the other axis from a page-width table — a multi-line cell beside a single-line one is a column-tracking problem, and a table that scrolls sideways needs a vertical rule to show that a column is half off-screen. The header gets a 2px bottom rule in the same token, not a fill, which would read as a card (hard rules 3/4). Verified at 300px against a theme forcing `break-all`: borders render, `Messbarkeit` still occupies one line box, table 407px in a 300px frame and still scrollable — appearance only, every earlier measurement unchanged.*

*Previously, 2026-09-15 — ADR-144 (corrections: Pythia broke its own words, and a label that never existed). Three records stated that Obsidian themes' `word-break: break-all` split `Messbarkeit` into `Messba / rkeit`. Measured with **no theme loaded at all**: inside `.p-ai-body` a narrow cell splits the word across two line boxes, the identical cell outside it does not. The cause was Pythia's own `.p-ai-body { word-break: break-word }` — a deprecated alias for `overflow-wrap: anywhere` — inherited into every table cell it renders. Fixed with `overflow-wrap: break-word`, which keeps long URLs from overflowing while leaving words intact, on every surface including the ones `decorateTables` never wraps. ADR-135's conclusion survives; its reasoning does not — the selector beat an inherited value, not a theme. Separately, ADR-140 justified the 54px label column as "the reference row's existing label width"; that row has no label and never has, in the DOM — only in the spec. Also fixed: a glossary entry now records the model that actually wrote it (lookups run on the provider's fast model, not `defaultAnthropicModel`), and the two standing lint warnings are gone. +3 tests (769), zero lint warnings.*

*Previously, 2026-09-15 — ADR-143 (choosing a conversation happens in the conversation panel). Linking a passage opened a `ConversationSuggestModal`: a second, differently-shaped search over the same list, on the same screen as the one ADR-107 had just called "the single in-view conversation-search surface". `openHistoryView(pick?)` now takes an optional pick descriptor — without it the panel switches conversations as before, with it a tap hands the conversation to the caller — so search, ranking, snippets, date grouping and the keyboard model are the same code because they are the same panel. Three things change while picking, each because the purpose did: the **delete control and long-press menu are hidden** (a trash icon under a thumb that is aiming to select), the **source conversation is excluded**, and the **placeholder is the caller's**, since it is the only signal of the mode. The modal stays for the command-palette entry points, which can run with no view open. A latent bug surfaced: `historyCleanup` was assigned inside the focus `setTimeout`, so for one tick the panel was open and the controller did not know it, and a second open stacked a second overlay. Paid for structurally — the mount fixture moved to `tests/helpers/viewHarness.ts` and the panel describes to `tests/historyPanel.test.ts`, dropping `viewRender.test.ts` from 650 to 331 lines and **removing the last grandfathered test ceiling** from the ADR-097 ratchet. +8 tests (766).*

*Previously, 2026-09-15 — ADR-142 (a link is a fork, stated in the other direction). ADR-130 built merge as fork's inverse and then dressed it as a different thing: dashed rule on the anchor and banner, `git-merge` icon, label `VERKNÜPFT`. A fork and a link are one relationship seen from two ends, so the link anchor and merged-from banner now **are** the fork anchor and banner — grouped into the same CSS rules, not merely styled to match, so there is no second copy to drift. Chromium confirms every compared computed property and the rendered height are identical. Two exceptions, both requested: the **unlink control stays in the meta line** (a link can be removed; a fork cannot be un-forked), and the header uses the **`link` icon** — the meta line's `unlink` stated positively — with the noun **`VERKNÜPFUNG`** rather than the past participle, because the header names what the card *is*, like `ABZWEIGUNG`. The **mark** stays a dashed underline: with the cards unified it is the only place the distinction survives before the reader taps. ADR-138's stroke rule is narrowed — solid accent now means "a conversation", dotted still means "a term". 34 lines of duplicated CSS deleted.*

*Previously, 2026-09-15 — ADR-141 (summaries: a contract the model can count, and a ceiling the display owns). Generated summaries varied in length by model, arrived as bullet lists inside a five-line inline card, and narrated the session — "a summary was generated and inserted at the top of `_inbox/Unbenannt.md` … as requested". The old rule banned the *opening phrases* only, so the narration moved into the body; and the model was not misbehaving, since that conversation's substance genuinely *was* an action. Both summary prompts now share one `SUMMARY_RULES` block (they had been carrying two drifting copies) that bans the act rather than the phrasing — summarize what a produced document **says** — sets a length the model can count (five sentences, under 100 words, not "brief"), and requires plain prose. The token cap was deliberately left alone: a cap low enough to force brevity truncates instead, and on a reasoning model it also pays for hidden reasoning. Because a prompt is a request, and because summaries already on disk will never be regenerated, the fork and merge anchors also clamp to five lines with a fade and a "mehr" control that appears only on real overflow — measured at 7 lines unclamped, exactly 5 clamped. +6 tests (758).*

*Previously, 2026-09-15 — ADR-140 (the template is a reference, not a caption; supersedes ADR-129's placement). ADR-129 put the template name in the assistant turn label, next to the model, clock and token counts — a row of facts about the *generation*, where a note the user wrote does not belong. It moves to the sources row that web search introduced, **first**, because it is the frame the answer was written in rather than one of the passages inside it, and as a **`[[wikilink]]`**, which is not a new affordance: vault citations in that same row already render that way, and both now share one `renderWikilink`. The template gets **no number** — the numbers are citation indices matching the chips in the prose, and nothing cites the template. Rows run **TEMPLATE → VAULT → WEB**, from the user outwards: the template is theirs, the vault notes are their own knowledge they can correct, the web is the outside and the only part that can rot — which is also the order in which to trust it, and it puts the longest, most-wrapping row last. The vault row is no longer relabelled `SOURCES` when no web row is present. Harmony between the rows comes from one component with one axis of difference (numbered + `↗` for the web, `[[…]]` for the vault), plus a new **54px label column** — the reference row's existing width — so three stacked rows start their chips at one x instead of three. Which turns show it is unchanged (`turnTemplateCaption`: first answer, and wherever a template changes), and it is **removed** from the turn label rather than duplicated. +14 tests (752), the first coverage `ui/sourcesRow.ts` has had. Icons in place of the word labels were considered and declined — the three kinds have no distinct glyphs at 11px, the column is read once rather than aimed at, and the words pair it with the REFERENZ row.*

*Previously, 2026-09-15 — ADR-139 (one date format, and icons centred on cap height). Four reported details in the inline anchors' meta row. The glossary's `erklärt von` prefix is gone — fork and merge show a bare model name, and the prefix is the one part the reader already knows. **All UI dates are now `15 Sep 2026`**, locale-independent like `formatClockTime` already was: `toLocaleDateString` renders "15. Sept. 2026" in German and "Sep 15, 2026" in US English, and a 9px mono label drawn in a fixed rhythm cannot have a width that changes under the user — nor be asserted without pinning a locale. `Im Glossar öffnen` takes the shared `Öffnen →` control, its wording kept as the tooltip. And the meta-row icons now centre on **cap height**, not on `vertical-align: middle`, which centres on x-height and left them a measured 1.09px low beside caps and digits; the 0.09em nudge was picked by measuring two candidates across sans, serif and mono faces and holds within 0.11px in all three. +5 tests (743). Build, lint, file-size and tests green.*

*Previously, 2026-09-15 — ADR-138 (the inline anchors are one component; the fork anchor is its spec). The glossary anchor had drifted faint — `--text-faint` rule and icon, faint label, 12px title, a long open label that wrapped the meta row — and read as disabled next to fork and merge. The cause was ADR-136's argument applied to the wrong element: a term **mark** is the quietest of the four because it repeats many times per screen, but an **anchor** never repeats — it is opened one at a time by a deliberate tap. Fork is now the explicit spec for all three (2px accent rule, accent icon, `--text-muted` 600 label, 11.5px title, shared `Öffnen →`), and the only thing that varies is the rule's stroke: **solid fork, dashed merge, dotted term**. The merge label had drifted the same way and is aligned too. The rule worth keeping: quietness belongs to marks, not to anchors. CSS plus one button label; no behaviour change, 738 tests still green.*

*Previously, 2026-09-15 — ADR-137 (glossary terms match their inflections and translations). Exact matching missed most real occurrences: define "Zähler" and the glossary still misses "Zählers" and "Zählern", and a term defined in a German answer is never recognised in the English the same conversation uses. Entries now carry `aliases`, **stored rather than derived** — a stemmer is language-specific, brutal on German compounds, and above all cannot be corrected by hand, which is ADR-136's whole point. The variants come back from the *same* call as the definition (`DEFINITION:` / `VARIANTS:`, parsed like the existing `TITLE:` / `SUMMARY:` contract), because the model holding the passage is the one that knows whether the answer's "counter" is that "Zähler" — and a second call would double the wait. `buildTermMatcher(terms)` is replaced by `buildTermIndex(entries)` returning `{ matcher, canonical }`: with aliases the matched form is no longer the term, so the mark records the canonical term and tapping "Zählern" opens "Zähler". Canonical terms are registered before aliases so note order cannot decide which entry a word opens. Storage rides last in the existing `%% pythia: … %%` marker, so notes written before this change are byte-identical. +15 tests (738). Build, lint, file-size and tests green. Not runtime-verified in Obsidian.*

*Previously, 2026-09-15 — ADR-136 (glossary: look a term up once, understand it everywhere). Terminology in an answer used to force a fork or a follow-up prompt just to ask "what does this mean". Selecting a term and pressing **Define** now resolves it without touching the message list, because the lookup runs as a utility call like `generateSummary` does. Three decisions, all confirmed by the user against alternatives: **the definition lives in a vault note**, not on the conversation, so it survives deletion, is correctable by hand, and is readable by other tools; **the source is the vault first, then the model given the passage**, which is what lets it explain the sense that applies here rather than every possible meaning, and needs no new API key or off-device call; and **every occurrence is marked in every conversation**, which makes the glossary compound — the second time a term appears anywhere it is already explained and costs nothing. That third choice removed a whole data structure: the note is the only source of truth, so nothing about a term is stored on a conversation. New `services/glossary.ts` (pure: parse, upsert, `buildTermMatcher`), `services/GlossaryService.ts` (vault I/O, lookup chain, cache invalidated by our writes and by hand edits), `ui/GlossaryController.ts`, `repaintTerms` in `HighlightPainter`, `defineTerm` through `BaseProvider`/`LLMProvider`/`LLMRouter`, a `glossaryNote` setting, i18n and CSS. Marks are `<pythia-term>` with a **dotted faint underline** — deliberately the quietest of the four mark types, because it is the only one that repeats. Paid for under the ADR-097 ratchet by extracting `ui/citationPainter.ts` out of `sidebar.ts` and `withConversationBacklink` out of a duplication in `SelectionController` (1,891 → 1,877, ceiling lowered; SelectionController back under 600). +33 tests (723). Build, lint, file-size and tests green. Not runtime-verified in Obsidian.*

*Previously, 2026-09-15 — ADR-135 (review of ADR-134 before trusting it, after two failed fixes). Three findings. **One real gap, fixed:** `adjustForKeyboard` ran only on `visualViewport` events, focus, blur and open — but opening, closing or resizing a leaf moves the panel's bottom edge and fires none of those, so `--p-bottom-inset` would go stale the moment the sidebar's layout changed. Now also subscribed to the workspace's `resize` and `layout-change`. The viewport wiring moved into `watchViewport` in `ui/keyboardInset.ts` (all viewport concerns in one module; `sidebar.ts` 1,903 → 1,891, ceiling lowered). **Two verifications that held:** the conditional inset was tested against the real stylesheet with `env(safe-area-inset-bottom)` substituted for the value iOS computes — 24px padding without the override, 8px with it, 24px again when removed — and the resulting gap below the send button, 26px before, independently matches the 25px measured in the user's screenshot, confirming the diagnosis from a second direction. **And the strongest evidence for the table fix, which is empirical rather than theoretical:** `word-break: normal` appears exactly once in the stylesheet, inside `.pythia-view .p-scroll-frame > table th, td`. The user's 2.10.1 screenshot shows long German words unbroken, which is only possible if `decorateTables` really wrapped that table and that selector really beat the theme. `width: max-content` and `max-width: 32ch` were added to those same two selectors, so they apply for the same reason. Also recorded: after the fix ~8px remains below the composer, not zero — that is `--s2`, deliberate. Build, lint, file-size and 694 tests green.*

*Previously, 2026-09-15 — ADR-134 (the two fixes that did not fix anything). Both ADR-131 and ADR-132 shipped in 2.10.1 and neither resolved what was reported. **Tables:** ADR-131 lifted the width cap with `max-width: none`, which is necessary but not sufficient — a table still sizes itself to its containing block, so it kept fitting the panel and paid for it by wrapping one long cell into an 18-line, 399px-tall column. Measured at a 320px panel it did technically overflow, by 31px, which is why the tests passed and the eye saw no change. Fixed by `width: max-content` plus a `max-width: 32ch` cap per cell: 469px wide in a 296px frame, the long cell at 7 lines, the row at 163px. **Bottom space:** ADR-132 blamed `adjustForKeyboard` setting a height, on the strength of a luminance reading taken from a JPEG that showed the strip darker than the panel. Re-measured on a PNG, the strip is pixel-identical to the chat background (26,26,26), so the panel was filling its leaf all along and the space is padding inside it — **25 CSS px**, the `env(safe-area-inset-bottom)` reserve applying where no home indicator exists. That was the original diagnosis, abandoned on bad evidence. The inset is now measured: `needsBottomSafeArea` compares the panel's bottom edge against the layout viewport, and the view sets `--p-bottom-inset: 0px` when something else is below. ADR-132's change is kept — setting a height on an `overflow: hidden` pane is genuinely unsafe — but its claim to have fixed this strip is withdrawn. +4 tests (694). Build, lint, file-size and tests green.*

*Previously, 2026-09-15 — ADR-133 (a background reload could silently roll a conversation back, losing its newest turn). Reported: an assistant answer that had been on screen was gone an hour later, its user prompt still present, forcing the prompt to be re-sent. `watchDataJson` polls data.json every 5s and calls `reloadFromDisk` on any external mtime change, which on an iCloud or Obsidian Sync vault fires constantly. `reloadFromDisk` cancelled the pending debounced write and `loadPluginData` then did `p.conversations = loaded` — a **wholesale replace with no recency check**. The only guard, `shouldRefuseLoad`, refuses a load of zero conversations; it says nothing about a disk copy that is merely older. So any stale rewrite of data.json replaced fresher in-memory state, and the next save made the rollback permanent — exactly "keeps the earlier turns, loses the newest one". Fixed by reconciling instead of replacing: new pure `mergeConversations(memory, disk)` keeps the newer copy of each conversation by `updatedAt`, keeps conversations present on only one side (no tombstones exist, and resurrecting beats destroying), ties go to memory, disk order preserved with memory-only appended last, and a first load is still exactly the disk list. Whatever memory wins is marked dirty and flushed so disk catches up. Two supporting fixes: the own-write timestamp is now stamped after `saveData` resolves as well as before, so a slow mobile write no longer falls outside its own 3s window and gets re-read as external; and the watcher seeds its mtime baseline from the file instead of the clock, so a data.json older than load time no longer masks the next real external write. +10 tests (690). Build, lint, file-size and tests green. Not runtime-verified in Obsidian.*

*Previously, 2026-09-15 — ADR-132 (the panel stops shrinking itself when no keyboard is open). A reported dead strip under the composer measured **67 CSS px** of uncovered leaf, and the giveaway was that it was *darker than the panel background* and that the panel was cut ~1.4 CSS px below the Send button — clipping the input area's own mandated `env(safe-area-inset-bottom)` padding. Only one thing sets a height on the content pane: `adjustForKeyboard`, which shrank it by `containerBottom - (visualViewport.offsetTop + height)` **on every viewport event, keyboard or not**. In a stacked mobile sidebar the panel is not the bottom-most thing on screen, so that difference is Obsidian's own chrome, not an obstruction — and shrinking by it removed height the panel needed, while `.pythia-view { overflow: hidden }` clipped the rest. Two changes: the compensation is now **gated on a real keyboard** (`ui/keyboardInset.ts`, viewport shrink ≥ 120px — a soft keyboard is ≥250px, chrome and the home indicator are tens of px and are already covered by the CSS safe-area padding), and it applies **`padding-bottom` rather than `height`**, which is what the code's own comment always claimed it did: padding lifts the content while the panel keeps filling and painting its whole leaf, so no strip can be uncovered and no safe-area padding can be clipped. Hard rule 7 is untouched. The decision is a pure function with 8 unit tests (681) because the browser state it reasons about cannot be reproduced headlessly. Corrects an earlier diagnosis in this session that blamed double-counted safe-area padding; measurement of the screenshots disproved it. Build, lint, file-size and tests green. Not runtime-verified in Obsidian.*

*Previously, 2026-09-15 — ADR-131 (wide tables scroll instead of being squeezed). A model-generated table in a ~300px sidebar wrapped every cell, and wrapped them **mid-word**: a heading like `Messbarkeit` rendered as `Messba / rkeit`. (This line originally blamed Obsidian themes' `word-break: break-all`; **ADR-144 corrects that** — the cause was Pythia's own `.p-ai-body { word-break: break-word }`.) The scroll frame for this already existed — `decorateCodeBlocks` has wrapped every `table` in `.p-scroll-frame` with `overflow-x: auto` and drag-to-pan for some time — but it never did anything, because a table with automatic layout shrinks to its container rather than overflowing it, so the frame had nothing to scroll. Two CSS rules under `.pythia-view` (ADR-065 scoping) fix it: `max-width: none` lets the table exceed the frame, and cell rules (`overflow-wrap`/`word-break: normal`, `hyphens: none`, `min-width: 8ch`) stop words being split while still allowing wrapping between them. Measured in headless Chromium at 320px against a theme that forces `break-all`: before, table 296px = frame 296px, not scrollable, `Messbarkeit` across 2 line boxes; after, table 346px in a 296px frame, scrollable, 1 line box. Coverage extended from assistant messages to **every** markdown surface (summary cards, fork anchor, merge anchor) via the new `ui/renderMarkdown.ts`. Three extractions came with it, each shared by more than one caller: `ui/tableDecorator.ts` (`decorateTables`), `ui/dragToPan.ts` (`attachDragToPan`, now shared by code, diagrams and tables) and `ui/renderMarkdown.ts` — `sidebar.ts` 1,920 → 1,912, ceiling lowered. +8 tests (673). Build, lint, file-size and tests green. Not runtime-verified in Obsidian.*

*Previously, 2026-09-14 — ADR-130 (Merge: the inverse of Fork — a passage points at an existing conversation and surfaces its summary in place). Fork carries a selected passage OUT of a conversation into a new one; there was no way to point a passage AT a conversation that already exists, so a reader who recognized "this is the thing I worked through in that other conversation" had to leave, find it, read it, and come back. `Merge` joins the selection toolbar next to `Branch` (assistant content only, same single-message + trimmed-selection rules as fork), opens the existing `ConversationSuggestModal` over every OTHER conversation, and on confirmation records a `MergeLink` on the conversation holding the passage, generating the target's summary first if it has none. The passage then paints as `<pythia-merge class="p-merge-link">` (a dashed accent underline — NOT a third highlighter fill, which would be unreadable next to yellow favorites and accent fork origins) and tapping it opens `.p-merge-anchor`, the mirror of the fork anchor: target name, its conversation summary, `N messages · MODEL · date [· outdated]`, one-tap regenerate, unlink, and `Open →`. **Deliberately display-only** — `ContextBuilder` injects nothing, so a merge costs zero tokens per turn (the user's explicit call; a regression test asserts the system prompt is byte-identical with and without merges). New `ui/MergeController.ts` (which also renders a `.pythia-merge-banner` at the top of the conversation a link points at, so the relationship reads from both ends the way a fork's does, derived on read via the pure `incomingMergeLinks`) + `repaintMergeLinks` in `HighlightPainter`; `persistence.normalizeMerges` guards the read path and `evictConversations` now protects merge targets, so the cap can't silently delete a link's other end. Also extracted `ui/longPress.ts` (one 450 ms gesture for the Send menu, the fork anchor and future surfaces — three hand-rolled copies collapsed into one), moved `unwrapCodeFence` into `services/messageUtils.ts` and `applyAccentContrast` into `ui/accentContrast.ts`, which paid for the new wiring under the ADR-097 ratchet: `sidebar.ts` 1,951 → 1,920, ceiling lowered. +35 tests (665). Build, lint, file-size and tests green. Not runtime-verified in Obsidian (no live window here).*

*Previously, 2026-09-12 — ADR-129 (the template belongs to the answer, not the header; turn labels drop the role caption). The template name was a caption pinned under the header title, which said what the *conversation* was but nothing about which answers it produced — and it had to be `position: absolute` to keep out of the header's flex row (ADR-098). It now rides the assistant turn label, stamped per message (`Message.templateId`, recorded at generation time like `Message.model`) and rendered **only on the turn where a template starts applying** — the first answer, and again wherever a second template takes over mid-conversation — so a constant template is stated once instead of on every turn. Legacy messages fall back to `Conversation.templateId` on both sides of the comparison, so an old conversation captions exactly its first answer with no migration. Same change drops the `DU`/`PYTHIA` role captions (superseding that part of ADR-067): the accent bubble vs. the plain body already distinguishes the two, and the caption was the least informative token on a line that also carries model, template, time and tokens. Label rendering moved out of `sidebar.ts` into `ui/turnLabel.ts` (pure `(row, msg, conv)` functions) to pay for the new code under the ADR-097 ratchet — 2,018 → 1,951, ceiling lowered — and to make the caption rules unit-testable without mounting the view (+8 tests, 630). `.pythia-template-label` and the header's `position: relative` are gone; `i18n` keys `turnUser`/`turnAI` removed, `templateLabel` retained as the caption tooltip. Build/lint/filesize/tests green. Not runtime-verified in Obsidian (no live window here).*

*Previously, 2026-09-10 — ADR-128 (fork anchor: always-current summary + visible regenerate). The origin-side fork anchor already read the fork live on open (so it showed the latest STORED summary), but there was no cue when that summary had gone stale relative to the fork's newer messages, and regenerating was hidden behind a 450 ms long-press on "Öffnen". Now `ForkController.buildForkAnchor` computes staleness (fork's last message timestamp > the displayed summary's `updatedAt`; ISO strings sort chronologically) and (1) appends an `outdated`/`veraltet` marker to the meta line + tints the new refresh control with the accent when stale, and (2) adds a VISIBLE one-tap regenerate button (`.p-fork-anchor-refresh`, `rotate-cw`) that regenerates the displayed summary type (conversation by default, so it also creates a first summary) via the existing `generateForkSummary`. The long-press menu is KEPT (it still lets you choose conversation vs favorites). Deliberate choice: opening the preview does NOT auto-fire an LLM call — "latest" means always show the newest stored summary + flag staleness + make refresh one tap, not spend tokens on every glance (auto-regenerate-on-open remains available as a future opt-in). +i18n (`forkRefreshSummary`, `forkSummaryStale`, en/de) + CSS (`.p-fork-anchor-refresh`). Build/lint/tests green. View code (no new unit test — consistent with the fork-anchor DOM being exercised at the fake-provider seam).*

*Previously, 2026-09-10 — ADR-127 (the model popover stays open after a selection). **Context:** picking a model applied it and closed the popover, so anything that follows a model switch — effort, temperature, max tokens, all reached through the popover's own `Gesprächseinstellungen…` footer — cost a reopen. This bites hardest exactly where it should not: switching to a reasoning model is the case that most often needs an effort change. **Decision:** the popover behaves as a panel, not a one-shot menu. A selection applies the model and repaints the list in place; dismissal is an outside click, Escape, the model badge, or the footer. Every row now owns a check element whose visibility the repaint toggles (it used to be created only for the active row), and a confirmed touch selection clears the armed row so the hint does not linger and a later tap re-arms instead of re-applying. The repaint reads the conversation directly: `applyModelChoice` sets provider/model before its first await, so only the store write is deferred. The footer stays the ONLY route into the settings modal — no auto-open after picking a reasoning model, which would take the panel away again and guess at intent. **Consequence:** one extra dismissal tap for the common switch-and-return path, paid to remove a reopen from every switch-then-configure path; accepted by the user explicitly. No layout or state changes elsewhere — the header is not rebuilt by a model change, so the popover and its anchor survive a selection. Not runtime-verified in Obsidian (no live window here); build/lint/619 tests green.*

*Previously, 2026-09-04 — ADR-126 (embedding: start the Worker from a resource-path URL, not a blob — restores off-thread on `capacitor://` builds). ADR-125 diagnosed WHY indexing froze the app: the environment (origin `capacitor://localhost`, on desktop too) blocks `blob:` URLs, so `new Worker(blobUrl)` is refused and embedding falls back to the UI-thread iframe. ADR-125 made that survivable by throttling; ADR-126 fixes the ROOT by getting inference back OFF the UI thread. The plugin now writes the embedding bundle (the same one inlined in `main.js`, via `getEmbeddingBundle()`) to `<pluginDir>/embedding-worker-<version>.mjs` ONCE per version (stale-version files cleaned up best-effort) and starts the Worker from `adapter.getResourcePath(path)` — a same-origin, blob-free URL the WebView allows where `blob:` is blocked. `WorkerEmbeddingProvider` gained an injected `spawnUrl` (defaults to the blob path); `FallbackEmbeddingProvider` now tries **blob Worker → resource-path Worker → iframe**, so on a `capacitor://localhost` document (where the resource path is same-origin) the Worker starts off-thread and the freeze disappears entirely. Fails safe: if the resource-path Worker also can't start (e.g. `getResourcePath` is cross-origin on some desktop builds, or a `worker-src` CSP blocks it), it falls through to ADR-125's throttled UI-thread build — no regression. Cost: a ~1.6 MB worker file in the plugin dir (syncs once per version; duplicates the inlined bundle — a later build step could emit it instead of writing at runtime). Caveats (honest): same-origin/`worker-src` behavior can't be verified headlessly — the wiring + fallback are unit-tested (619), on-device confirmation needed (the console should stop showing the `blob:` "Not allowed to load local resource" refusal, and indexing should no longer freeze the app).).*

*Previously, 2026-09-04 — ADR-125 (vault RAG: throttle the build when embedding runs on the UI thread — supersedes ADR-124). ADR-124 gated on `Platform.isMobile`, but a Desktop console proved the real signal is different: the origin was `capacitor://localhost` and `blob:` URLs were blocked ("Not allowed to load local resource: blob:…") **on desktop too**, so the Web Worker (loaded from a blob URL) was refused and `FallbackEmbeddingProvider` fell back to the same-origin iframe = inference on the renderer UI thread. A 311-note build then froze the app — and `Platform.isMobile` is false there, so ADR-124 did nothing. The correct signal is whether the Worker actually engaged, not the platform. Fix: providers expose `isOffThread()` (`true` only for a live Worker; the iframe returns `false`; `FallbackEmbeddingProvider` reflects the active backend); `VaultRagService.refresh()` awaits `provider.ready()`, reads it, and when NOT off-thread it (1) `hydrateForQuery()`s an already-populated persisted index and serves queries against it WITHOUT rebuilding (a rebuild would re-freeze the app every session — incremental edits keep it fresh via `applyChanges`), and (2) builds a not-yet-built index THROTTLED — `VaultIndexService.sync` gained a `{ yieldEveryNotes, breatherMs }` throttle, set to yield after EVERY note with a 12 ms breather on the UI-thread path so Obsidian stays responsive during the build (slower, one-time; a Notice explains it). Off-thread keeps the coarse default cadence. `applyChanges`/`reindex` are no longer platform-gated (the throttle + hydrate-skip cover the UI-thread case). This unifies mobile and blocked-worker-desktop under one runtime-detected path and removes ADR-124's "build on desktop" assumption (false when the worker is blocked everywhere). +1 test (throttled sync still indexes every note); 619. Build/lint/filesize green. Caveats (honest): the on-device path still can't be validated headlessly — capability detection, throttle cadence and hydrate logic are unit-tested, live confirmation needed. And throttling fixes the RESPONSIVENESS symptom; if a very large UI-thread build still slows partway from WASM-heap growth, a follow-up can recycle the backend every N notes to bound memory (not done here — it needs the off-thread finding first, and a blob-free Worker via a plugin resource path is the better root fix to try).).*

*Previously, 2026-09-04 — ADR-124 (vault RAG: don't build the index on mobile — query-only). Field report: on a 311-note vault, first indexing degraded app performance after ~half the notes. Console proved the cause: the origin is `capacitor://localhost` (Obsidian **mobile**), and `blob:` URLs are blocked ("Not allowed to load local resource: blob:capacitor://…") — so the Web Worker (loaded from a blob URL) is refused and `FallbackEmbeddingProvider` falls back to the same-origin **iframe, which shares the renderer's UI thread**. A full build then runs hundreds of single-threaded WASM inferences (`ort-wasm-simd-threaded.jsep.mjs`) on the main thread, degrading the whole app as the WASM heap grows. There is no off-thread option on Obsidian mobile, so building there inherently blocks the UI. Fix — **on a main-thread-only backend, never embed vault NOTES; only embed the QUERY** (one inference per turn, cheap even on the UI thread): `refresh()` on mobile calls the new `VaultIndexService.hydrateForQuery()` (loads the persisted index and marks it queryable WITHOUT re-embedding), `applyChanges` (incremental) is skipped, and `reindex` is refused — each with a one-time "build it on desktop" Notice. This works because the index `.bin` lives in the plugin dir (`.obsidian/plugins/<id>/`), so a desktop-built index SYNCS to mobile (like `data.json`) and mobile queries against it; if none exists yet, retrieval returns [] gracefully. `VaultRagService` gained an injectable `isMainThreadOnly` seam (defaults to `Platform.isMobile`) for testability. +2 tests (hydrate-only makes a persisted index queryable with zero note embeds; empty store is ready but returns []). 618 total. Build/lint/filesize green. Caveat (unchanged for this class): the on-device mobile path can't be validated headlessly — the gating + hydrate logic are unit-tested, but on-device confirmation is still needed.).*

*Previously, 2026-09-04 — ADR-123 (per-conversation `data.json` store — REJECTED / won't build). The idea: split conversation persistence out of the single `data.json` into one file per conversation and write only the dirty ones, so a save costs O(dirty) not O(all). It was spec'd (a `splitConversationStore` flag + reversible migration) and then **rejected** without implementing. Reasons: (1) **It doesn't solve the problem it looked like it solved.** The user pain nearby is the iCloud/Obsidian-Sync reload — but that reload is a DELIBERATE feature (ADR-010: cross-device sync via polling — a conversation started on Desktop reaches Mobile), not churn. Its frequency is driven by iCloud touching the synced file, not by our write size, and the manifest would still live in `data.json` and still move on every change — so the split changes reload frequency not at all. (2) **It actively endangers that cross-device hand-off.** iCloud/Obsidian Sync propagate files independently and non-atomically; the single `data.json` is one atomic sync unit, so a conversation and its messages always arrive together. Split across a manifest + N body files, the manifest can reach Mobile before the bodies it names (conversation shows empty), and because the watcher polls only `data.json` (ADR-010), a body arriving later — with no manifest change — is never loaded until the next manifest touch. That's a regression on the exact Desktop→Mobile case, mitigable only by also watching the `conversations/` folder + per-entry hashes — new complexity in service of a downside. (3) **It widens the data-loss surface.** iCloud parks individual files cloud-only (empty read / `.icloud` placeholder); with N files, any body can come back missing, and a naive "missing body ⇒ prune" turns an eviction into a permanent delete. The single-file design has ONE such surface, already guarded (ADR-011: iCloud-eviction refusal). More files also means more `(conflicted copy)` surface under Sync. (4) **The upside is small and local.** The write-amplification win only matters past a few hundred KB of history, is a local-disk cost (not the sync cost the user feels), and if it ever bites there are cheaper, sync-safe levers (e.g. a no-op-reload guard that skips a refresh when reloaded content is byte-identical — no format change, no migration). Net: a local micro-optimization that trades a load-bearing, well-guarded cross-device design for more moving parts and more ways to lose data. The analogous lever WAS worth taking for the vault RAG index, where it's local-only with no sync/atomicity stakes — that shipped as ADR-122. The spec draft (`docs/per-conversation-store-spec.md`) was removed; this ADR is the record. Revisit only if telemetry shows the single-file write is a real bottleneck AND the cross-device atomicity + eviction rules above are solved first.).*

*Previously, 2026-09-04 — ADR-122 (vault RAG: batch index persistence). ADR-121's event-driven `updateNote`/`removeNote` each rewrote the WHOLE `.bin` (`serializeIndex(all)`), so the watcher flushing N edited notes did N full-index writes (~6 MB each at the 5k cap). Added `VaultIndexService.applyBatch({updates, removes}, {cap})`: all mutations happen in memory (via `updateInMemory`/`removeInMemory` helpers that no longer persist) and the index is serialized + written AT MOST ONCE per batch. `updateNote`/`removeNote` are now thin single-item wrappers over `applyBatch` (behaviour unchanged); `VaultRagService.applyChanges` builds one `{updates, removes}` batch from the flushed files → one write per debounced flush instead of one per note. +2 tests (single write for a multi-change batch; no write when nothing changed). 616 total. The analogous `data.json` cost (whole-file rewrite per save) was investigated as a per-conversation store but REJECTED — see ADR-123.).*

*Previously, 2026-09-04 — ADR-121 (vault RAG perf: event-driven indexing + one ML bundle). Two more perf wins after the scale review. (1) **Event-driven incremental indexing** — the watcher used to re-run a FULL scan (`refresh` → read + hash every in-scope note + rewrite the whole .bin) on every debounced edit; on a 5k-note vault, editing one note = 5k reads/hashes. Now the watcher batches the actually-changed `TFile`s (and deletes/renames) and calls `VaultRagService.applyChanges`, which issues TARGETED `VaultIndexService.updateNote(path)` / `removeNote(path)` ops — one embed per edited note. New ops chain (`enqueue`) serializes updates against full builds so they can't interleave; `updateNote` re-embeds on content-hash change, adds new (respecting the note cap), drops emptied/unreadable/out-of-scope notes; no-ops until the index is built (a full build handles an unbuilt index, so this never eagerly loads the model). (2) **One embedding bundle instead of two** — the iframe and worker were each a full `@huggingface/transformers` bundle, doubling ~0.85 MB in `main.js`. Merged into a single `frame/entry.ts` that detects its context at runtime (`typeof window === "undefined"` → worker, else iframe), built once by esbuild and inlined once via `embeddingBundle.getEmbeddingBundle()` (a lazy getter — referenced exactly once, and not evaluated on mere import so unit tests that don't apply the esbuild define don't crash). The iframe provider wraps the shared bundle in a `<script type=module>` at runtime (escaping `</script`); the worker Blobs it. Deleted `bootstrap.ts` + `worker.ts`. `main.js` 2.5 MB → 1.6 MB. +7 tests (targeted updates). Deferred still: worker-side ranking. Caveat unchanged: the unified bundle's worker path can't be validated headlessly, but its iframe branch is a verbatim port of the proven `bootstrap.ts`, so the fallback stays safe.).*

*Previously, 2026-09-04 — ADR-120 (vault RAG scale: streamed indexing, note cap, cooperative ranking). Q: does indexing break on a 30k-note vault? Yes, in three ways, now fixed. (1) **Memory** — `collectIndexableNotes` read EVERY note's content into one array and `doSync` held all their chunk strings too (~300 MB+ of transient strings at 30k → OOM/renderer-crash risk). Fixed by STREAMING: `IndexableNote` is now `{ path, load() }` (a lazy loader, not eager content); `doSync` reads + chunks + embeds one note at a time and releases its text before the next, so peak memory is bounded regardless of vault size. The per-note content-hash compare (serialized as `h`, survives reload) still means only changed notes re-embed. (2) **Unbounded scale** — new `vaultContextMaxIndexedNotes` setting (default 5000, 0 = unlimited): a pure `selectIndexPaths` helper scopes + caps the path list (no content read to count), and a one-time Notice warns "indexing N of M — scope to folders / raise the cap" instead of silently OOM-ing. (3) **Per-query jank** — `query`'s ranking scanned all chunk vectors synchronously on the UI thread (~tens–>100 ms at 30k); it now scans COOPERATIVELY (yields every 2000 notes), so a large corpus never blocks the UI in one burst. Note: this is cooperative on the host thread, not moved into the Worker — true worker-side ranking (worker holds the index) is deferred: it can't be validated headlessly and the iframe fallback would need it too, doubling untestable surface; cooperative yielding removes the hitch at far lower risk. +9 tests (streamed lazy-load, per-note progress, and the pure scope/cap helper). Net: a 30k vault now indexes safely when scoped, and fails LOUDLY with guidance (cap) rather than crashing when not.).*

*Previously, 2026-09-04 — ADR-119 (vault RAG: off-thread Worker, folder scope, reindex, watcher). Field report: with vault context on, indexing froze ALL of Obsidian (not just Pythia). Root cause: the embedding model runs on the **WASM backend inside a same-origin `about:srcdoc` iframe**, which shares Obsidian's renderer main thread — so embedding a whole vault ran heavy synchronous inference on the UI thread. ADR-118's "non-blocking" only moved the `await` off the send path; the compute still froze the UI. Fixes, all in one branch: (1) **Web Worker backend** — `services/embedding/host/frame/worker.ts` + `WorkerEmbeddingProvider` run the model on a real background thread (blob-URL module worker; esbuild builds it as a second browser bundle inlined via `__WORKER_CONTENTS_PLACEHOLDER__`). `embeddingProviderFactory.createEmbeddingProvider` returns a `FallbackEmbeddingProvider` that tries the worker and, if a blob worker is refused (CSP) or fails to init, transparently falls back to the iframe — so embedding always works. (2) **Cooperative throttling** — `VaultIndexService.sync` yields to the event loop every few embeds and reports `onProgress`, so even on the iframe fallback the UI stays responsive during a build; a sticky live Notice shows "Indexing N/M". (3) **Folder scope** — new `vaultContextFolders` setting (empty = whole vault, minus Pythia's folders) keeps the index small on large vaults. (4) **Reindex** — `VaultIndexService.clear()` + a "Rebuild index" settings button and a `reindex-vault-context` command. (5) **Watcher** — debounced (5s) `vault.on(modify|create|delete|rename)` refresh, gated so it never eagerly indexes unless the feature is the default or the index already exists. Structural: the vault-RAG lifecycle moved out of the bloated `main.ts` into `services/VaultRagService.ts`; the embedding-model + related + new vault-context settings moved into `ui/embeddingSettings.ts` (both to respect the file-size ceilings). Cost: `main.js` grows ~0.85 MB (the ML runtime is bundled for both the iframe and the worker) — a follow-up can unify them into one context-detecting bundle. **The Worker cannot be validated headlessly** (WASM-in-worker inside Obsidian, and this codebase already hit WebGPU instability), so it ships behind the throttled-iframe fallback and needs live confirmation. 598 tests. FOLLOW-UP within the same branch — a second field report ("Obsidian does a hard reload when using Pythia", i.e. the renderer process CRASHES) traced to onnxruntime-web's default **multi-threaded WASM**: transformers 3.8.1 sets `wasm.proxy = false` but never constrains `wasm.numThreads`, so ORT spawns nested WASM worker threads + SharedArrayBuffer, which is unstable in Obsidian's Electron renderer (the same "reload the whole app" class as WebGPU, and worse inside our Worker — nested threads). Fixed by forcing `env.backends.onnx.wasm.numThreads = 1` in `model.ts` (applies to both the iframe and worker backends). Independent of the worker, so it also fixes the crash on the released iframe-only build — a candidate for a fast 2.6.1 hotfix.).*

*Previously, 2026-09-03 — ADR-118 (vault RAG made non-blocking — bug fix). Reported: with vault context on, a turn showed the "downloading the semantic model" notice, then ended with the button back to Send and NO LLM reply. Root cause: retrieval ran the WHOLE-VAULT embedding synchronously inside the send turn (ADR-116's `VaultIndexService.retrieve` did `sync(allNotes)` then embedded the query), gated on the first-use model download — so the turn blocked on a tens-of-MB download + embedding every note, and any failure/slowness in that path took the reply down with it. Fix: retrieval is now strictly additive and off the send path. `VaultIndexService` split into `sync(notes)` (build/refresh, sets an `isReady()` flag) and `query(text, {exclude})` (embeds ONLY the query and ranks the already-indexed vectors — safe to await in a turn). `main.ts` kicks the index build/refresh in the BACKGROUND (`syncVaultIndex`, coalesced, never awaited by the turn, failures logged not surfaced) and, on a turn, returns [] immediately while `!isReady()` — so the LLM reply is never delayed by indexing; once the background index is ready, later turns rank against it (query-only embed, fast). Net effect: RAG can only ever ADD context to a turn, never block or break it. Trade-off: the first turn(s) right after enabling get no vault context until the index finishes building — surfaced with a one-time "Building the vault index…" notice. `exclude` (already-attached) filtering moved to `query` and is applied AFTER ranking but BEFORE the limit so excluding a top hit doesn't shrink the result. Tests updated to the sync/isReady/query API (596 total). This is why headless verification matters: the fake-provider unit tests passed on the blocking design because they never exercised a real model download — the failure only appeared in a live vault.).*

*Previously, 2026-09-03 — ADR-117 (vault RAG: on-the-fly control, provenance, and a gating fix). Three follow-ups to ADR-116 after a review of how it surfaced. (1) **Per-conversation toggle** — a `library`-icon toolbar button (mirroring the research-mode globe) flips a new `Conversation.vaultContext` flag; `getRelevantNotes` now gates on `conversation.vaultContext ?? settings.vaultContextEnabled`, so the setting/command becomes the *default* and the button is the on-the-fly per-conversation control (same two-level model as `researchMode` vs `webSearchDefault`). (2) **Security + citation gating fix (important)** — `buildSystemPrompt` decided the citation instruction (`GROUNDING_INSTRUCTION`) and the ADR-115 untrusted-content framing from `conversation.contextNotes.length`, but RAG appends notes to the request without storing them there. So in the primary case (RAG on, no manual notes) retrieved notes were injected **uncited and unframed** — untrusted content reaching the system prompt without the "treat as data" guard. Fixed by threading a `hasAttachedNotes` signal (true when note text is actually inlined) from `BaseProvider.resolveUserContent` into `buildSystemPrompt`; both instructions now fire on `contextNotes.length > 0 || hasAttachedNotes`. This closes the hole for RAG notes and for any one-shot attached note that isn't in `contextNotes`. (3) **Provenance** — retrieved paths are recorded per conversation on the plugin (`getAutoContext`) and rendered as distinct, read-only "auto" pills in the reference row (muted+italic, no ×), refreshed after each turn; combined with the now-guaranteed citations, the user can see exactly what was pulled in. To fund the sidebar additions under its size ceiling, `onCitationClick`+`renderSourcesRow` were extracted to `ui/sourcesRow.ts` (`openCitationSource`/`renderSourcesRow` free functions) — net sidebar unchanged. +2 tests (the gating fix); the toggle/pills are view code (unit-tested at the fake-provider seam already). Follow-ups unchanged: settings-tab UI, and reusing the vault index for link-suggestion.).*
*Previously, 2026-09-03 — ADR-116 (vault-wide semantic RAG). Pythia consumed only hand-picked context notes; the on-device embedding engine built for ADR-109 indexed *conversations* only. This points the same engine at the *vault*: when `vaultContextEnabled` is on, each turn auto-retrieves the most semantically-relevant notes and injects them as context. Reuse-first — `embeddingIndex.ts` (diff/serialize/hash), `vectorMath.ts` (quantize/cosine) and `IframeEmbeddingProvider` are shared unchanged; new code is a pure retrieval core (`vaultRetrieval.ts`: `noteEmbedChunks` heading-aware chunking + `rankByQuery` best-chunk cosine) and `VaultIndexService.ts` (structural twin of `ConversationIndexService`, incremental `sync`+`retrieve`). Key decisions: (1) **share one embedding provider** across related + vault services (`main.ts` `ensureEmbeddingProvider`) so the heavy model/iframe loads once, not twice; the vault index persists under a separate `vault-embeddings-<model>.bin` (`VaultIndexStore` gained a `prefix`) so the two indexes never collide. (2) **Inject at `LLMRouter`, not the view** — a `setVaultRetriever` hook merges retrieved paths into `attachedNotes` inside `streamMessage` (now async, fail-open), so retrieval reuses the entire attached-note pipeline (excerpting, token guard, ADR-115 untrusted-content framing, citations) with zero changes to the three providers or `sidebar.ts` (both at their line ceilings). (3) **Gate via a command + settings defaults**, not settings-tab UI, because `settings.ts` is at its size ceiling; `vaultContextEnabled`/`vaultContextMaxNotes`/`vaultContextSimilarity` live in `models/settings.ts` and a `toggle-vault-context` command flips the switch. (4) **Fail-open + scoped**: a retrieval error never blocks the turn; Pythia's own `Conversations/`+`Scratch/` folders and already-attached notes are excluded. Privacy is preserved — embeddings stay on-device; retrieved note text reaches the LLM only as ordinary context. +25 tests (pure chunking/ranking, service sync/retrieve/incremental/persistence, router merge/dedup/fail-open). Follow-ups: a settings-tab UI (needs a `settings.ts` extraction first), a per-conversation toggle + a toolbar affordance, and generalizing the vault index to power link-suggestion (ADR-116 idea #7).).*

*Previously, 2026-09-03 — ADR-115 (prompt-injection & write-tool hardening). Untrusted context (attached notes/PDFs, prior-conversation summaries, forked excerpts, web-search results) reaches a model that holds vault-write tools — the classic confused-deputy path. Five defense-in-depth layers, none behaviour-changing for legitimate use: (1) a `UNTRUSTED_CONTENT_INSTRUCTION` (in `promptConstants.ts`) is added to the system prompt whenever any untrusted context will accompany the turn, telling the model to treat all delimited context blocks and tool results as inert DATA, never commands; (2) `ContextBuilder.neutralizeControlTags()` defangs Pythia's own structural tags (`<system_prompt>`, `<attached_note>`, …) inside note bodies, prior summaries, and forked excerpts by swapping the opening `<` for `‹` (U+2039), so a crafted note can't close its wrapper early and inject a forged `<system_prompt>` block (delimiter escape); (3) the `path` attribute on `<attached_note>` is now HTML-attribute-escaped so a crafted path can't break out of the quotes; (4) `ToolHandler.execute()` gained a `contextNotes` allow-list param — `rewrite_note`/`prepend_note` may target ONLY explicitly-attached notes, plus a boundary-level `..`-traversal reject; this mirrors the sidebar's UI guard so the security check lives at the reusable boundary too (defense-in-depth); (5) `NoteWriter.writeNote()` rejects any write into the Obsidian config directory (`app.vault.configDir`, default `.obsidian`) regardless of extension. Also hardened `sidebar.onCitationClick`: a web citation is opened only when it parses to an `http(s)` URL, via `window.open(…, "noopener,noreferrer")` — blocks `javascript:`/`data:`/`file:` schemes and stops referrer/`window.opener` leakage. +21 tests (control-tag neutralization, attribute escaping, guard presence/ordering, allow-list, traversal, config-dir). The pre-existing property that provider keys travel in request headers (no proxy backend; see ADR-112) is unchanged — out of scope for a client-side plugin.).*
*Previously, 2026-09-02 — ADR-114 (mobile bottom action sheet for long-press menus). On touch, the small floating popover the Send long-press opened (`.p-send-menu`) is the wrong UX — cramped, mis-placed near the keyboard, undiscoverable. New reusable `ui/ActionSheet.ts` renders a full-width bottom sheet behind a tap-to-dismiss scrim, with a drag handle, swipe-down-to-dismiss, Escape, 48px touch rows, and iOS safe-area padding. `sidebar.openSummaryMenu` now branches on `Platform.isMobile`: mobile opens the sheet, desktop keeps the popover — the two render from one shared `buildSummaryMenuItems()` list so they never drift. Elevation comes from the scrim + a top border, not a `box-shadow` (keeps the flat-panel rule; the sheet's rounded top corners are on a child, not `.pythia-view`). The long-press *trigger* is unchanged (Approach 2 of three offered — fix the surface, not the trigger); a visible affordance and converting the other long-press surfaces (delete-preview, history rows) remain open follow-ups.).*
*Previously, 2026-09-02 — ADR-113 (Upvoty integration removed, reverting ADR-111). In practice the Upvoty remote MCP endpoint rejected the user's valid REST API token with 401/403 when presented as `Authorization: Bearer <token>` — the endpoint appears to want either OAuth (how claude.ai's own connector authenticates) or a differently-presented/dedicated token, and Upvoty publishes no REST/MCP auth docs to disambiguate. Rather than ship a speculative, unverifiable auth client, the whole feature was removed: deleted `services/UpvotyService.ts` + its tests, the four `upvoty_*` tools and their gating (`getToolDefinitions`/`allowedToolNames` back to the `researchEnabled`-only signature), `buildUpvotyArgs`, the `upvotyMode` fields on `Conversation`/`PythiaTemplate`, the `upvotyServerUrl`/`upvotySecretName`/`upvotyDefault` settings, `SecretStore.setUpvotyKey`, the `plaintextUpvotyKey` plumbing, the `megaphone` toolbar toggle + settings section, and the i18n strings. The ADR-112 secret-redaction hardening is independent and was kept. If Upvoty is revisited, the open question to resolve first is the exact MCP auth scheme (OAuth vs. static token, and header/format).).*

*Previously, 2026-09-02 — ADR-112 (secret-handling hygiene: API keys in a client-side Obsidian plugin necessarily travel in provider request headers — visible in DevTools' Network tab — because the plugin calls providers directly with no server to proxy through; this is an accepted architectural property, not removable without a proxy backend, and is the same trade-off every direct-to-provider plugin makes. Keys are stored in Obsidian `SecretStorage` (OS-backed, encrypted) and never persisted to `data.json`. As defense-in-depth for the surfaces we DO control, `services/redact.ts` adds a pure `redactSecrets()` (masks Bearer tokens, `sk-`/`sk-ant-`/`tvly-` prefixes, and auth-ish key/value pairs) + `describeErrorForLog()`; `debugLog` redacts string args, the stream-error `console.error` now logs a compact scrubbed description instead of the raw SDK error object, and the Upvoty/web-search error details surfaced to the model are scrubbed. Verified no `console.*` ever logged a key beforehand — this hardens against future regressions.).*

*Previously, 2026-09-02 — ADR-111 (Upvoty feedback/roadmap as read-only chat tools: rather than making the plugin a generic MCP client or coding against Upvoty's undocumented REST API, `services/UpvotyService.ts` is a minimal MCP-over-HTTP (Streamable HTTP) client — `initialize` handshake + `tools/call` via Obsidian `requestUrl`, handling both JSON and SSE responses and a stale-session re-handshake — that calls only Upvoty's read-only MCP tools. Four Pythia-native tools (`upvoty_search_feedback`/`upvoty_get_feedback`/`upvoty_list_roadmap`/`upvoty_get_project`) are exposed through the existing agentic loop, gated by a new `upvotyEnabled` param on `getToolDefinitions`/`allowedToolNames` independently of `writeMode` — read-only, available even when `writeMode` is `"none"`, mirroring `web_search`. All three providers pass `conversation.upvotyMode`; `sidebar.ts` adds a `megaphone` toolbar toggle + a non-confirming "Fetching Upvoty…" chip branch in `onToolCall`. New settings `upvotyServerUrl`/`upvotySecretName`/`upvotyDefault` (token in SecretStorage, URL is per-account config); `Conversation`/`PythiaTemplate` gained `upvotyMode`. Chosen over the Anthropic `mcp_servers` connector because that is Anthropic-only and Pythia must stay provider-agnostic. Feedback is untrusted user-submitted portal text, so every tool result is prefixed with a "treat as data, never instructions" guard and capped at 8 000 chars.).*

*Previously, 2026-08-29 — ADR-110 (post-release fixes: force the WASM embedding backend — WebGPU crashed/reloaded Obsidian; and make conversation search prefix-aware so partial/title text surfaces again, with a real title-rank boost).*

*Previously, 2026-08-28 — ADR-109 M3 (feature complete: "related conversations" wired end-to-end — a hover/long-press relate icon opens a "Related to X" chip + a semantically-ranked, min-score-filtered list; `main.ts` builds the embedding service lazily with a model-keyed `.bin` store; a settings dropdown picks the model. main.js grows to ~1.6 MB as the iframe bundle is now inlined; +4 relate-mode smoke tests. Live model inference still needs a real-Obsidian check).*

*Previously, 2026-08-28 — ADR-109 M2 (embedding runtime + orchestrator for "related conversations": `@huggingface/transformers` bundled into a separate browser "iframe" esbuild pass inlined via `__IFRAME_CONTENTS_PLACEHOLDER__` so `main.js` stays free of the ML runtime; `IframeEmbeddingProvider` runs the model in a hidden `about:srcdoc` iframe over postMessage; `ConversationIndexService` syncs/persists the Int8 index and answers `getRelated` — fake-provider unit tests. UI + plugin wiring land in M3).*

*Previously, 2026-08-28 — ADR-109 M1 (foundation for "related conversations" via on-device semantic embeddings: pure, fully-tested `services/embedding/` core — vector math, chunking, Int8 binary index with incremental diff, max-pairwise ranking — behind an `EmbeddingProvider` interface, plus the model registry and `embeddingModelId` setting; runtime + UI land in M2/M3).*

*Previously, 2026-08-28 — ADR-108 (search-panel polish: headerless — back button moved into the search row, "+" dropped; trash-can row delete; the accent tint now marks the focused row (hover or ↑/↓ selection) while the active conversation shows only a grey label).*

*Previously, 2026-08-28 — ADR-107 (one conversation-search surface: the quick switcher is folded into the history panel, which is now opened by a header loupe icon with its search input auto-focused and ↑/↓/Enter keyboard nav; the header title becomes plain, non-interactive text — its click and `▾` removed).*

*Previously, 2026-08-28 — ADR-106 (conversation search ranks by lexical TF-IDF over content — title + LLM summary + message bodies via the existing `services/noteRelevance.ts` scorer, new `services/conversationSearch.ts` + a `SuggestModal`-based picker with match snippets — chosen over on-device semantic embeddings after reading obsidian-similarity's source; the transformers.js/MiniLM design is documented as the Phase-2 seam).*

*Previously, 2026-08-28 — ADR-104 (`appContainer.ts` composition root — an async `AppContainer.create()` factory constructs every plugin service in dependency order after `loadPluginData`, and the plugin exposes each as a getter so `plugin.llmRouter` etc. keep working with no call-site changes; `ConversationStore` now OWNS the conversation list and `plugin.conversations` is a read/write accessor, ending the bidirectional coupling).*

*Previously, 2026-08-27 — ADR-102 (model picker shows a plain-language "good for" example line per model — hover-revealed on desktop, first-tap-reveals / second-tap-confirms on touch — to help users choose without capability jargon; curated for every catalog model in `models/modelGuidance.ts`, localized en/de).*

*Previously, 2026-08-27 — ADR-101 (a global free-text `customInstructions` setting is appended to every chat system prompt inside a `<custom_instructions>` block, after the conversation's own system prompt — the ChatGPT-style "custom instructions" slice; app-contract instructions stay hard-coded, and the no-solicitation guard stays always-on per ADR-100).*

*Previously, 2026-08-27 — ADR-100 (a `NO_SOLICITATION_INSTRUCTION` is always appended to the chat system prompt, suppressing the assistant's boilerplate closing offer to "save this as a note" / "shall I continue with the next section?" — while still permitting a genuine clarifying question).*

*Previously, 2026-08-27 — ADR-099 (web search auto-arms for a single send when the outgoing message reads as time-sensitive and the research toggle is off — a per-turn armed clone offers `web_search` without persisting `researchMode`; the globe pulses to show it fired; trigger wording in the tool description and recency nudge strengthened to a search-first default; `webSearchAutoArm` setting, default on).*

*Previously, 2026-08-27 — ADR-098 (header icon order reworked left→right to history · name · rename · link · delete · model · new; the name group absorbs the flex space so the "+" is always the last child and never shifts, the template caption is pulled out of the flex row into an absolute label, and the history-overlay header frame is matched to the main header so "+" holds the same position across both views).*

*Previously, 2026-08-27 — ADR-097 (`#`-mention note picker drills into folders in place — ArrowRight / swipe-left / a trailing › opens a folder to browse its contents, ArrowLeft / swipe-right / a back row steps up; Enter/tap on a folder still attaches the whole folder, so the addition is non-breaking).*

*Previously, 2026-08-27 — ADR-096 (fork selection is trimmed at storage and search, so the source-side fork-origin mark re-finds and paints — restoring the blue highlight, the tap-to-open inline summary anchor, and the "Forked from" scroll-to-span; fixes a latent bug where a fork selection carrying edge whitespace/newlines was unfindable).*

*Previously, 2026-08-27 — ADR-094 (optimizer output must be the bare prompt: a shared `OUTPUT_ONLY_INSTRUCTION` appended to the request forbids preamble/sign-off/rules, and a pure `cleanOptimizedOutput()` strips residual fences/preamble/rules — fixes "Sure! Here's…" wrapper text landing in the input box).*

*Previously, 2026-08-27 — ADR-093 (prompt optimizer rewrites the input textarea in place — optimize with the settings framework, replace via `execCommand("insertText")` so ⌘Z / iOS shake revert — instead of an in-conversation preview/confirm/retry flow; no auto-send).*

*Previously, 2026-08-27 — ADR-092 (on-accent label color keeps a theme token only when it clears WCAG AA on the user's accent, else forces pure black/white; fixes the unreadable "Senden" label ADR-082 missed. Extracted to the tested `readableOnAccent()`).*

*Previously, 2026-08-27 — ADR-091 (prompt optimization moves from an input-toolbar wand icon to a third "Optimize prompt" item in the Send long-press menu; greyed when input is empty or no optimizer template is set).*

*Previously, 2026-08-27 — ADR-090 (favorite/fork highlights adopt smsag.de's "highlighter marker" style — asymmetric corners, diagonal gradient ink sweep, theme-adaptive text-shadow; colors unchanged, always visible).*

*Previously, 2026-08-27 — ADR-087 (an errored or empty send now persists the user turn up front and discards partial replies), ADR-088 (conversation eviction preserves survivors' insertion order so "most recent = last element" holds), ADR-089 (web-search citations reconciled by domain and inline web citing re-enabled via a shared `WEB_CITATION_INSTRUCTION`; revises ADR-077's "stop instructing web citations").*

*Previously, 2026-08-27 — ADR-086 (favorites and fork origins are wrapped in custom elements `<pythia-favorite>` / `<pythia-fork>` instead of `<mark>`, so a fork's accent tint is no longer overridden by theme `mark` rules; supersedes the accent-on-`<mark>` mechanism of ADR-064/065).*

*Previously, 2026-08-27 — ADR-085 (Favorite and Branch/Fork are hidden in the selection toolbar over a user prompt bubble and guarded in their handlers — both apply to assistant content only).*

*Previously, 2026-08-27 — ADR-084 (on a fork, the fork banner renders above the summary cards — order: context inspector → fork banner → summary cards → messages).*

*Previously, 2026-08-27 — ADR-083 (the fork banner's "branched from" link is a `<span>`, not an `<a>`, matching the standard clickable-link pattern and dropping Obsidian core's anchor underline).*

*Previously, 2026-08-27 — ADR-082 (on-accent label text auto-picks the higher-contrast of Obsidian's `--text-on-accent` / `--text-on-accent-inverted` for the user's accent, computed at runtime into `--p-on-accent`).*

*Previously, 2026-08-27 — ADR-081 (turn labels anchor the day — the first user turn of each new calendar day, and the first message of a conversation, carry an absolute date; same-day turns stay time-only).*

*Previously, 2026-08-27 — ADR-080 (the fork anchor's meta line shows the summary's generation date after the model, matching whichever summary is displayed; model + date hidden until a summary exists).*

*Previously, 2026-08-24 — ADR-079 (a fork now injects the exact passage it was branched from as a `<forked_from_excerpt>` anchor alongside the source summary, so the branch's opening question stays tied to the specific point, not just the broad topic).*

*Previously, 2026-08-24 — "Pythia Final" redesign, phase 7 (F10): ADR-076 (in-panel history view — a full-panel overlay with date groups, fork/favorite counts, forks indented under their source, active row tinted, opened from a new `history` header button).*

*Previously, 2026-08-24 — "Pythia Final" redesign, phase 7 (F9): ADR-075 (header title opens an anchored quick switcher — search, fork-indented rows, keyboard nav, hover-delete — additive to the command-palette fuzzy modal).*

*Previously, 2026-08-24 — "Pythia Final" redesign, phase 7 (F7): ADR-074 (the model chip opens an anchored quick-pick popover — provider groups, context-window labels, Reasoning tags, active check, and a footer to the full settings modal — instead of jumping straight to the modal).*

*Previously, 2026-08-24 — "Pythia Final" redesign, phase 7 (F5): ADR-073 (the `#` navigator's Abzweigungen section becomes a fork **tree** — source row with a `Quelle` tag, child forks indented under a vertical rule with status dots, active branch tinted with an `aktiv` tag).*

*Previously, 2026-08-24 — "Pythia Final" redesign, phase 5: ADR-072 (model-declared citations `F2/F11` — `⟦cite:note:…⟧`/`⟦cite:web:…⟧` markers, parsed/numbered by Pythia into a new `Message.sources`, painted into `.p-cite` chips with a `QUELLEN` / `WEB`+`VAULT` sources row; markers stripped from note exports).*

*Previously, 2026-08-24 — "Pythia Final" redesign, phase 4: ADR-071 (context inspector card `F2/F3` — an outline card under the summary cards listing context notes as wikilinks + system-prompt estimate, switching to a per-source budget breakdown with mini-bars and a `Zusammenfassen` action at ≥80% usage).*

*Previously, 2026-08-24 — "Pythia Final" redesign, phase 6: ADR-070 (minimal centered empty state `F6` — accent sparkle, heading, mono keycap hints — and the conversation-settings Effort control becomes a segmented Standard/Niedrig/Mittel/Hoch control `F8`, keeping a "Standard = no override" segment).*

*Previously, 2026-08-24 — "Pythia Final" redesign, phase 3: ADR-069 (3px context-budget bar under the header — fill = usage / model window, warning color + header percent chip at ≥80%; the next-send token estimate moves from the Send button label to a mono label left of the button).*

*Previously, 2026-08-24 — "Pythia Final" redesign, phase 2: ADR-068 (vault-note references render as `[[wikilinks]]` — faint brackets, accent name, mono token estimate, `×` remove — retiring the bordered `.p-pill`; add affordance becomes a `+ Notiz` text link).*

*Previously, 2026-08-24 — "Pythia Final" redesign, phase 1: ADR-066 (frameless code blocks + selection toolbar — hairlines and a mono header replace the grey `--background-secondary` box) and ADR-067 (per-message turn micro-labels `DU · HH:MM` / `PYTHIA · MODEL · HH:MM`, backed by a new optional `Message.model`).*

*Previously, 2026-08-24 — ADR-065 (scope view CSS above Obsidian core: `.pythia-view mark.…` (0,2,1) so the fork accent stops being overridden to yellow, and a `background-color: transparent` reset on `button/input/textarea` (0,1,1) so plugin controls aren't painted grey by Obsidian desktop's form-field background).*

*Previously, 2026-08-24 — ADR-064 (fork-origin highlight now uses the favorites highlighter mechanism — translucent `color-mix(var(--color-accent) 40%)` mirroring `--text-highlight-bg`, with a readable fallback instead of a solid accent fill).*

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

### ADR-065 — Scope view CSS above Obsidian's core selectors (specificity fixes)

**Status:** Active

**Context:** Two long-standing visual bugs turned out to share one root cause — Obsidian's own stylesheet out-ranking Pythia's by CSS specificity:
1. The fork-origin highlight (ADR-064) kept rendering yellow instead of accent. `mark.p-fork-origin` (specificity 0,1,1) only *ties* Obsidian core / theme `.markdown-rendered mark` (0,1,1), which loads after the plugin and so won, pinning the background to `--text-highlight-bg`. Favorites masked the bug because they use that same token — the tie was invisible until forks asked for a *different* color.
2. On **desktop only**, every plugin button and input rendered with a grey background. Obsidian desktop `app.css` styles `button:not(.clickable-icon)`, `input`, and `textarea` with a grey `--interactive-normal` / form-field background at (0,1,1); the plugin's component rules (`.p-tool-btn`, `.p-send`, … via `all: unset`) sit at (0,1,0) and lose. Mobile Obsidian doesn't set that background, so it never appeared there. (The codebase already half-knew this — `.p-send:not(.stop)` carried a comment about needing 0,2,0 to beat the reset's border.)

**Decision:** Make Pythia's controlling rules out-specify Obsidian's rather than tie it.
- Scope the mark rules under the view root: `.pythia-view mark.p-highlight` / `.pythia-view mark.p-fork-origin` (0,2,1), beating any `mark` rule at (0,1,1).
- Extend the global reset to `button, input, textarea` under `.pythia-view` and add `background-color: transparent` (0,1,1, loaded after core → wins the tie); buttons that want a fill opt back in at (0,2,0) — `.p-send:not(.stop)` now restores the accent fill alongside its border.

**Alternatives rejected:** `!important` (blunt, hard to override later, and unnecessary once specificity is correct); per-component `.pythia-view` prefixes on every button (far more churn than fixing the shared reset + the one solid-fill button); leaving the marks unscoped and only tweaking color values (the values were never the problem — they were being overridden wholesale).

**Consequence:** Fork highlights show the accent color; plugin controls are transparent on desktop except where they intentionally opt into a fill. CSS-only. General rule going forward: **view chrome must be scoped under `.pythia-view` (and marks as `.pythia-view mark.…`) so it out-ranks Obsidian core (0,1,1); a bare element+class tie is not enough because themes and core load after the plugin.**

### ADR-066 — Frameless components (code blocks, selection toolbar, fork anchors)

**Status:** Active (reverses ADR-046's framed-box treatment for these components)

**Context:** The "Pythia Final" design consolidates on a frameless visual language: structure comes from hairlines (`--background-modifier-border`), 2px accent left-rules, and mono micro-labels rather than filled grey boxes. ADR-046 had unified code blocks, tool-call chips and the optimizer result on the `--background-secondary` "framed box" formula. The Final design keeps that formula **only** for outline cards (summaries + the context inspector) and removes the grey fill from code blocks, the selection toolbar, and fork anchors.

**Decision:** Make code blocks and the selection toolbar frameless.
- **Code block:** `.p-code-frame` drops the `--background-secondary` fill, border and radius; it now carries only top/bottom hairlines and a header row (`.p-code-head`: `code-2` icon + language name `.p-code-lang` at mono 9px + hover/touch copy button). The `<pre>` loses its box and reserved top padding. Copy stays hover-reveal on desktop, always-visible under `@media (hover: none)`.
- **Selection toolbar:** `.pythia-sel-toolbar` swaps the grey band for the panel background (`--background-primary`) with a top hairline only, and gains a right-edge `mask-image` fade as the horizontal-carousel affordance.

**Alternatives rejected:** keeping the framed boxes (contradicts the Final language); a bespoke code-block token (the point is *removing* the fill, not renaming it); a JS-measured overflow fade for the toolbar (pure-CSS mask is simpler and the fade doubles as a permanent "scrolls sideways" hint).

**Consequence:** Calmer, typography-driven code and toolbar surfaces. Mostly CSS; the code-block decorator gains a header row and a language label. Outline cards remain the only filled component family.

### ADR-067 — Per-message turn micro-labels

**Status:** Active (reverses the earlier "no avatar or label per AI message" / "no turn dividers" rules)

**Context:** The Final design labels every turn: `DU · 14:31` right-aligned above user bubbles and `PYTHIA · SONNET 4.6 · 14:32` above AI messages (mono 9px, letter-spacing 0.08em, `--text-faint`). This supersedes the earlier decision to keep messages label-less. The model shown must reflect the model that actually produced a given message, which can differ from the conversation's current model after a switch.

**Decision:** Render a `.p-turn-label` as the first child of every message row via `renderTurnLabel()`. Add an optional `Message.model` recorded at generation time; the AI label reads `msg.model` and falls back to `Conversation.model` for legacy messages that predate the field. Time is formatted by a pure `formatClockTime()` (locale-independent 24h `HH:MM`, unit-tested). New i18n keys `turnUser` / `turnAI`.

**Alternatives rejected:** deriving the model label from the conversation only (mislabels historical turns after a model switch); storing a formatted time string on the message (redundant with the ISO `timestamp`, and not reflowable); per-turn avatars (heavier than the design's mono micro-label).

**Consequence:** Every turn is attributable at a glance. One additive, backfill-safe schema field (`Message.model`); no migration. Turn labels also appear on the streaming row (using the conversation's current model) so the live turn is labelled before it is persisted.

### ADR-068 — Wikilink note references replace the bordered pill

**Status:** Active (retires `.p-pill`)

**Context:** The Final design renders every vault-note reference as an Obsidian-style `[[wikilink]]` rather than the bordered accent pill (`.p-pill`): faint `[[`/`]]` brackets (`--text-faint`), an accent clickable name, an optional mono token estimate, and a faint `×` remove affordance. The pill's rounded border reads as a "chip/tag"; the wikilink reads as "a note", matching how the same notes appear in the vault and unifying the reference row, attachments, context inspector and sources on one visual.

**Decision:** Replace the pill DOM/CSS with a `.p-wikilink` (`.p-wikilink-bracket` / `-name` / `-tokens` / `-x`). The `.md` extension is stripped from the displayed name. The dashed circular add-button becomes a `+ Notiz` text link (`addNoteInline`, hover → accent). The horizontal-scroll container (`.p-pills`) is kept as-is.

**Alternatives rejected:** keeping the pill (contradicts the Final language and the "outline cards are the only bordered family" rule); rendering references through Obsidian's real internal-link machinery (heavier, and these are context attachments with custom open/remove behavior, not literal document links).

**Consequence:** Note references read natively as notes across every surface. CSS + one DOM builder changed; the same `.p-wikilink` markup will be reused by the context inspector and citation source rows in later phases.

### ADR-069 — Context-budget bar in the header; token estimate beside Send

**Status:** Active

**Context:** The Final design surfaces how full the model's context window is as a 3px bar directly under the header row (fill = usage / window), turning warning-colored with a header percent chip past ~80%. It also moves the next-send token estimate out of the Send button label — the button reads just "Senden"/"Stopp" — into a mono label immediately left of the button. `models/knownModels.ts` already exposes `getContextWindow(model)`.

**Decision:** Add `.p-ctx-bar` (track + `.p-ctx-bar-fill`) between the header and chat, and a `.p-ctx-chip` in the header. `updateContextBar()` computes usage from the last message carrying `tokenUsage` (`inputTokens + outputTokens` — the context as of the last exchange, excluding the unsent draft) over `getContextWindow(conv.model)`; at `frac >= 0.8` it adds `.warn` (fill → `--text-warning`) and shows the percent chip. Both the bar and chip scroll the conversation to the top on click (the context inspector will expand there in the next phase). `updateSendBtnLabel()` now only sets the mono `.p-send-estimate` ("nächste ~Xk", key `nextSendEstimate`) and delegates the bar to `updateContextBar()`. The dead `sendBtnEstTitle` key was removed (enforced by the i18n dead-key test).

**Alternatives rejected:** a composer-level budget banner (the design deliberately frees the composer of this and centralizes budget in the header); recomputing usage by re-tokenizing the whole history each keystroke (the last turn's `inputTokens` already is the measured context size — cheaper and more accurate than an estimate); keeping the estimate in the button label (crowds the button and fights the "Senden/Stopp only" spec).

**Consequence:** Budget is always visible without opening anything, and the composer footer is quieter. No data-model change; usage reads existing `tokenUsage`. Numbers still use the app's existing dot-decimal short format (e.g. `~4.3k`) rather than the mockup's German comma — locale-aware number formatting is a separate, app-wide change.

### ADR-070 — Minimal empty state (F6) + effort segmented control (F8)

**Status:** Active

**Context:** Two small Final-design pieces. (F6) The empty conversation should be a calm, centered welcome — accent sparkle, "Womit kann ich helfen?", and three mono keycap hints (`#` attach note, `⌘P` commands, `⇧↵` newline) — not a paragraph of prose. (F8) The conversation-settings Effort control should be a segmented Niedrig/Mittel/Hoch control (active = accent fill) rather than a dropdown.

**Decision:** (F6) Add `renderWelcome()` producing `.p-welcome` (sparkle + `.p-welcome-title` + `.p-welcome-hints` with `.p-keycap` chips), used for every empty-conversation branch (new conversation, and after deleting the last exchange). The no-*active*-conversation fallback keeps its plain hint. New keys `emptyHeading` / `emptyHintAttach` / `emptyHintCommands` / `emptyHintNewline`; the now-dead `startConversationBelow` was removed. (F8) Replace the effort dropdown with a `.p-effort-seg` segmented control, **keeping a leading "Standard" segment** for "no override" — the semantic the old empty dropdown option carried, which a bare Low/Mid/High control cannot express. The disabled state (model doesn't support effort) greys and disables the segments.

**Alternatives rejected:** a three-segment control with no "Standard" (silently loses the "no override" state — a behavior regression); reusing `.pythia-empty` for F6 (it's a text block, not the centered sparkle layout); a separate reset button for effort (an extra control where a segment does the job).

**Consequence:** The empty panel matches F6 and the settings modal matches F8 without dropping the override semantics. Keycaps show `⌘P` literally on all platforms (not remapped to Ctrl on Windows/Linux) — acceptable for a hint; a platform-aware keycap is a later refinement.

### ADR-071 — Context inspector card (F2/F3)

**Status:** Active

**Context:** The Final design adds a context inspector: an outline card at the top of the message list (with the summary cards) that makes the prompt's context legible. In normal mode it lists each context note as a wikilink with its token estimate, a `+ Notiz hinzufügen` action and a system-prompt estimate; when the window is ≥80% full it becomes a budget breakdown — conversation history (with message count), each note, and the system prompt, each with a 64px mini-bar and token value, plus an "almost full" warning row with a `Zusammenfassen` action.

**Decision:** Render the inspector into a stable `.p-inspector-wrap` created just under `.p-summary-cards` on every full rebuild; `fillContextInspector()` (re)builds the card and is also called from `renderReferencePills()` so add/remove of notes refreshes it live. It is shown only when there are context notes **or** the budget is tight (no empty card otherwise). Usage/window come from the last turn's `tokenUsage` over `getContextWindow(model)` (same source as the header bar); the system-prompt estimate reuses `buildSystemPrompt()` + `estimateTokensFromText()`; per-note tokens are `round(bytes / 4)`. History tokens in breakdown mode are `used − notes − system`. The `Zusammenfassen` button reuses the existing `generateConversationSummary()`. The card is `--background-primary` filled (the outline-card family) and collapsed by default; open state persists across rebuilds within the session.

**Alternatives rejected:** always showing the inspector even with no notes (noise); a separate token-accounting pass (the header already derives usage from `tokenUsage` — reuse it); making the system-prompt row removable (it isn't user-editable context); computing exact per-source tokens by re-tokenizing note bodies each render (the byte/4 estimate matches the reference-row estimate and is far cheaper).

**Consequence:** Users can see and prune what fills the window, and get a one-tap path to condense history before hitting the limit. Reuses existing token accounting and the wikilink + summary plumbing; no data-model change.

### ADR-072 — Model-declared citations (F2/F11)

**Status:** Active

**Context:** The Final design shows numbered citation chips inside AI text (¹²) that map to a sources row under the message (a single `QUELLEN` row, or split `WEB`/`VAULT` rows in research mode). The RAG pipeline does not track which note produced which claim — but the model already receives note paths (`<attached_note path=…>`) and web results, and is already asked to cite. The gap is turning free-text citing into a structured, renderable contract.

**Decision:** A model-declared marker contract, parsed and numbered by Pythia.
- **Marker:** `⟦cite:note:<path>⟧` and `⟦cite:web:<domain>⟧`. The kind prefix removes vault/web ambiguity; `⟦ ⟧` are not Markdown and the web form is a bare domain (no scheme), so a marker survives `MarkdownRenderer.render()` as literal text — no wikilink transform, no URL autolinking — which is what lets it be painted afterward. The instructions live in `GROUNDING_INSTRUCTION` (notes, gated on attached notes) and the research/recency block (web, gated on research mode), so citations are only requested when a real source exists.
- **Parsing:** pure `services/citations.ts` (`parseCitations`, `stripCitationMarkers`, `eachCitationSegment`) — deduped by (kind, ref), numbered by first appearance, unit-tested.
- **State:** an additive `Message.sources` (`MessageSource[]`), set on the assistant turn; legacy/absent → parsed from content on render (backfill-safe).
- **Render:** `paintCitations()` walks text nodes and swaps each marker for a `.p-cite` chip (mirrors the favorites re-paint since `MarkdownRenderer` rebuilds the DOM each time); `renderSourcesRow()` appends `QUELLEN` or `WEB`+`VAULT` rows. A chip/link opens the note or `https://<domain>`.
- **Export hygiene:** `stripCitationMarkers()` is applied in `NoteWriter.appendConversationSlice` so saved notes never carry raw markers; selection copy/insert read painted DOM text, which already has none.

**Alternatives rejected:** `[[cite:…]]` (Obsidian renders it as an internal link); embedding raw URLs in markers (autolinking splits the marker across nodes); numbering by the model (it can't know the final order, and duplicates break); a retrieval-grounded citation index (a much larger pipeline change — this is model-declared attribution, explicitly scoped as such). Degrades gracefully: no markers → no chips, no row.

**Consequence:** Sourced answers are attributable inline with no retrieval-layer change. One additive schema field; markers only appear with notes/research attached. Not yet done: the F11 token line "· N Suchen" search count (needs per-message search tracking) and German comma number formatting.

### ADR-073 — Fork branch tree in the navigator (F5)

**Status:** Active (refines the flat Forks list from ADR-054's navigator)

**Context:** Branching is the hero feature; the Final design shows the `#` navigator's Abzweigungen section as a **tree** — the source conversation (root) with a `Quelle` tag, its child forks indented under a vertical rule, each child a status dot + name + (active → tinted with an `aktiv` tag / else message count) — rather than the previous flat list of a conversation's direct forks.

**Decision:** Compute the fork family from the store: the root is the current conversation's parent (`forkedFromId`) when it is a fork, else the current conversation; children are all conversations forked from that root. Render a `.p-nav-tree-source` row (fork icon + name + `Quelle`) and a `.p-nav-tree-children` container (1px left rule) of `.p-nav-tree-item` rows (`.p-nav-dot` + name + `aktiv`/count). The current conversation's row — source or child — gets `.active` (accent 8% tint). Rows open their conversation via the existing `setActiveConversation`. New keys `navSourceTag` / `navActiveTag`.

**Alternatives rejected:** a full recursive multi-level tree (forks-of-forks) — the data model is one level deep in practice and the mock shows one level; a deeper tree can extend `.p-nav-tree-children` later; keeping the flat list (loses the source/sibling context that makes branching legible).

**Consequence:** From any fork you can see and jump to its source and siblings, with the active branch marked — the navigation the hero feature needs. Store-only reads; no data-model change.

### ADR-074 — Anchored model popover (F7)

**Status:** Active

**Context:** The Final design changes the model chip from a shortcut that opens the full conversation-settings modal (F8) into an anchored quick-pick popover: provider groups (ANTHROPIC/OPENAI/MISTRAL), each row a model name + right-aligned context window (1M/200k/128k), a `Reasoning` tag on reasoning models, an accent check on the active row, and a footer `Gesprächseinstellungen…` that still opens the full modal.

**Decision:** `openModelPopover()` builds a `.p-model-pop` from `MODEL_CATALOG` (skipping `hidden`), positioned `fixed` from the chip's bounding rect but kept a DOM descendant of `.pythia-view` so the scoped control styles still out-rank Obsidian core (ADR-065). Selecting a row applies provider+model immediately (`applyModelChoice` → save + `updateModelBadge`) and closes; the footer opens the existing `ConversationSettingsModal`. Toggle on re-click; close on outside-click or Escape; torn down on view close and rebuild. The chip gets `.open` (accent inset border) while the popover is up. New keys `reasoningTag` / `openConvSettings`.

**Alternatives rejected:** replacing the settings modal entirely (temperature/effort/max-tokens still need it — the popover complements it via the footer); a native Obsidian `Menu` (renders as a bottom sheet on mobile, not anchored to the chip — same reason the summary menu is hand-rolled); appending to `document.body` (would lose the `.pythia-view` scoping that keeps Obsidian's grey button reset from repainting the rows).

**Consequence:** One-tap model switching from the header, full settings one tap deeper. Reuses the model catalog and settings modal; no data-model change.

### ADR-075 — Anchored quick switcher on title click (F9)

**Status:** Active (additive — the command-palette fuzzy modal remains)

**Context:** The Final design opens conversation switching from the header title as an anchored panel (inset under the title, shadowed) with a search field, result rows showing a mono `Model · N Nachrichten · date` sub-line, forks indented under their source with a branch icon and `Zweig · N Nachrichten`, hover-delete, keyboard nav, and a footer key-hint — distinct from the centered fuzzy `ConversationSuggestModal`. The agreed direction keeps three switching surfaces: this anchored switcher (title click), the in-panel history (F10), and the existing modal (command palette).

**Decision:** Repoint `onConvNameClick` at `openQuickSwitcher()`, which builds a fixed-position `.p-switcher` anchored to the header (kept under `.pythia-view` for style scoping). Sources are listed by recency with their forks indented; typing filters by title with the match highlighted; ↑/↓ move a selection, ↵ opens, Esc/outside-click closes; a hover `✕` deletes via the shared `deleteConversationWithConfirm()` (extracted from the old handler). `cmdBrowseConversations` in `main.ts` still constructs `ConversationSuggestModal`, so the palette keeps the fuzzy modal untouched.

**Alternatives rejected:** replacing the fuzzy modal (the plan explicitly keeps it as a separate surface); a full fuzzy-scoring match in the panel (a plain substring highlight is enough for the anchored quick-pick; the modal covers fuzzy search); appending to `document.body` (loses `.pythia-view` scoping).

**Consequence:** Fast, in-context switching with fork structure visible, without giving up the palette modal. Store-only reads; no data-model change. Date sub-lines use a small `formatConvDate` helper (today/yesterday/short date), reused by the in-panel history view.

### ADR-076 — In-panel history view (F10)

**Status:** Active (additive — the quick switcher and palette modal remain)

**Context:** The Final design adds a full-panel conversation browser: a header (`‹ back · Gespräche · search · +`), date groups (HEUTE/GESTERN/DIESE WOCHE/older), rows with a mono `Model · N Nachr. · ⑂ forks · ★ favorites` sub-line, forks indented under their source, the active conversation tinted, and hover-delete. It is the third switching surface alongside the anchored quick switcher (F9) and the command-palette modal.

**Decision:** A `history` header button opens `openHistoryView()`, which renders a `.p-history` overlay (`position: absolute; inset: 0`) over the panel — its own header (back/title/new), a search field, and a date-grouped list. Sources are listed by recency; `historyBucket()` labels each group; because the list is sorted, group headers emit on change. Forks are indented under their source with `git-branch`; source sub-lines show fork (`⑂`) and favorite (`★`) counts. Rows open a conversation (reusing `setActiveConversation`) or delete via the shared `deleteConversationWithConfirm()`. Escape or Back closes; torn down on view close/rebuild. Reuses `formatConvDate`/`abbreviateModel` and the switcher's search-row styles.

**Alternatives rejected:** a full `buildUI` view-mode swap (far more invasive — an overlay gives the same full-panel takeover without threading a mode through every render path); replacing the quick switcher or palette modal (the plan keeps all three surfaces); paginating/virtualizing the list (unnecessary at expected conversation counts — revisit if it grows).

**Consequence:** A browsable, grouped history with branch structure and per-conversation signal, without disturbing the chat render path. Store-only reads; no data-model change. A dedicated `history` header button is the entry point (a future `⋯` overflow menu could host it instead).

### ADR-077 — Web sources are deterministic; foreign citation markers stripped

**Status:** Active (refines ADR-072 for the web/research path)

**Context:** ADR-072 relied on the model emitting `⟦cite:note:…⟧` / `⟦cite:web:…⟧` markers. In practice models have strong, divergent native citation habits for web results — e.g. GPT-4o mini emits `【1†source】` — and ignore the requested `⟦cite:web:…⟧` format. The result: the model's markers leaked into the answer as raw text and no `WEB` sources row appeared, even though Tavily returned the sources deterministically in the `web_search` tool result.

**Decision:** Stop depending on the model to cite web results.
- **Capture sources deterministically.** `parseWebSourcesFromResult()` (pure, in `WebSearchService`) parses the `### N. Title` / `URL:` blocks of the formatted tool result. `sidebar` accumulates these per send in `pendingWebSources` (reset when the stream starts, appended in the `web_search` tool-call branch) and merges them into the message's sources via `appendWebSources()` (deduped by URL, numbered after any vault citations, bare domain as the display title, full URL kept in `ref` for opening). The existing `renderSourcesRow` then shows the `WEB` row.
- **Stop instructing web citations.** The `<recent_context>` block and the tool-result header no longer ask the model to emit markers or a sources list (which also avoids duplicate web sources when a model *does* comply).
- **Strip foreign markers.** `stripForeignCitations()` removes `【…†…】`-style markers before rendering AI content and in `stripCitationMarkers` (note export). Only fullwidth brackets containing a `†` are removed, so ordinary CJK `【…】` text is untouched.
- **Vault citations stay model-declared** (`⟦cite:note:…⟧`) — there is no competing native habit there, and the note path isn't otherwise recoverable.

**Alternatives rejected:** mapping the model's `【N†source】` indices to Tavily results (the numbering isn't guaranteed to align across models); per-model citation-format prompts (brittle, endless); keeping the model-declared web markers (unreliable, and leaks raw text). 

**Consequence:** Research answers now show a clean `WEB` sources row built from the real Tavily results regardless of the model, and stray `【…†source】` noise no longer appears. Adds two pure, unit-tested helpers; no data-model change (`Message.sources` already existed).

### ADR-078 — Frameless code blocks: neutralise the `--code-background` token, don't just override the selector

**Status:** Active (fixes the incomplete ADR-066 frameless code block)

**Context:** ADR-066 made AI code blocks "frameless" (white background, no border) by overriding `.pythia-view .p-code-frame > pre { background: var(--background-primary) }`. In practice a grey fill persisted. Obsidian (and themes) paint code from the `--code-background` CSS variable, read by core `pre`/`code` rules and by any theme-supplied wrapper element. A selector override only wins where our selector actually matches and out-ranks the other rule; it does nothing when the grey is contributed by a nested element or a rule carrying `!important`/hardcoded `background-color`.

**Decision:** Attack the token, not just the selector.
- **Redefine the token at the view scope:** `.pythia-view { --code-background: var(--background-primary) }`. Anything downstream that reads `--code-background` (core rules, theme wrappers, nested `code`/`span`) now resolves to the panel background — the actual override channel.
- **Belt-and-braces explicit pin:** `.pythia-view .p-code-frame > pre`, its `code`, and any `code span` also set `background`/`background-color: var(--background-primary) !important` and `border/box-shadow: none !important`, defeating themes that hardcode `background-color` on `<pre>`/`<code>` instead of using the token.

**Scope guard:** inline single-backtick code (`--background-secondary`) and summary-card `pre` (`--background-secondary`, explicit) set their backgrounds directly, not via `--code-background`, so both are untouched by the token redefinition.

**Alternatives rejected:** raising selector specificity further (still loses to a nested element that reads the token); `!important` on the selector alone (misses wrappers we don't select). Redefining the token covers every reader in one line.

**Consequence:** AI code blocks are reliably frameless across themes. Overriding a design token — rather than chasing individual selectors — is the durable pattern for Obsidian-core/theme fills; prefer it whenever core paints from a documented CSS variable.

### ADR-079 — A fork injects the branched-from passage as context, not just the source summary

**Status:** Active (complements ADR-042 / ADR-058 / ADR-060)

**Context:** A fork carried only the *whole-conversation* summary of its source (`forkedFromSummary` → `<previous_conversation_summary>`, ADR-042/058/060). But a fork is started from a **specific selected passage**, and that passage was used only for display (the fork banner and the source's accent origin-mark) — never sent to the model. So the fork knew the broad topic but not the exact point being drilled into. Reported case: a conversation about Germany, forked from the closing "…complex history and robust cultural identity…" sentence, then asked "Name other countries with a similar complex history." The summary carried enough for the model to name Germany, but the answer read as generic — the model was never told *which* passage "similar" pointed back to. (The summary path itself was working; this is the missing second half.)

**Decision:** `buildSystemPrompt` now also emits a `<forked_from_excerpt>` block, framed by `FORKED_EXCERPT_INSTRUCTION`, whenever `conversation.forkedFromSelection` is set. It sits **after** the summary block: the summary gives the topic, the excerpt names the specific anchor the opening question ("this", "these", "similar", "others like it") refers back to. The field was already captured at fork time (`main.ts`) and already persisted — this only routes it into the prompt. No data-model, settings, or locale change; the context-bar token estimate (`buildSystemPrompt(conv)` in `sidebar.ts`) reflects the added block automatically.

**Relation to ADR-042:** ADR-042 removed *pre-filling the compose box* with the selection (a UX annoyance — the user had to delete it). Giving the selection to the **model** as system-prompt context is a different, purely additive mechanism and does not reintroduce that behavior — the input box still starts empty.

**Alternatives rejected:** seeding the selection as a fake first user message (pollutes the visible transcript and the message history sent on every turn); merging it into the summary text (conflates two distinct things — the source's own summary vs. this branch's anchor — the same conflation ADR-058 untangled).

**Consequence:** A fork's first question now resolves its back-references against the exact passage, so branching from a specific point stays on that point instead of drifting to the generic topic. Covered by three `ContextBuilder` unit tests (excerpt block present + framed; summary-before-excerpt ordering; absent when no selection).

### ADR-080 — Fork anchor meta line shows the summary's generation date

**Status:** Active (extends ADR-058 / ADR-059)

**Context:** The inline branch-back fork anchor (ADR-058) closes with a `.p-fork-anchor-meta` line that read `N Nachrichten · Model · Öffnen →`. The model ID there was low-value — the same abbreviated model already shows in the quick switcher and history sub-lines — while the one fact the anchor's summary could not convey was *how current* it is. The top-of-conversation summary cards already surface this (`formatSummaryTimestamp(updatedAt)` in the card header, ADR-054), but the fork anchor — which renders the very same `summaryText` / `favoritesSummary.text` — did not, so a reader at the origin snippet had no way to tell a fresh synthesis from a stale one.

**Decision:** The meta line now appends the summary's generation date after the model: `N Nachrichten · Model · <date · time> · Öffnen →`, reusing `formatSummaryTimestamp` for parity with the summary cards. The anchor prefers the favorites synthesis over the conversation summary (ADR-059 precedence), so `buildForkAnchor` tracks which one it displays (`summaryKind`) and shows the matching timestamp (`favoritesSummary.updatedAt` vs `summaryUpdatedAt`). Model and date are emitted **only when a summary exists**; an un-summarized fork collapses to `N Nachrichten · Öffnen →`. No data-model, settings, or locale change — both timestamps were already stored.

**Confirmed invariant:** the anchor and the top-of-conversation summary bar read the same fields on the same `Conversation` object, so regenerating a summary from either surface (the anchor's long-press menu or a card's refresh button) updates both; the date reflects that shared state.

**Alternatives rejected:** replacing the model outright (loses the at-a-glance provider cue when several forks branch from one source); a relative "vor 3 Tagen" format (diverges from the absolute `formatSummaryTimestamp` the cards already use).

**Consequence:** A reader scanning origin snippets can tell how fresh each branch's summary is without opening the fork, and the anchor stays visually consistent with the summary cards. Pure presentation change in `buildForkAnchor`; no test surface added.

### ADR-081 — Turn labels anchor the day on the first user turn of each new day

**Status:** Active (extends ADR-067)

**Context:** ADR-067 gave every message a mono micro-label carrying the time (`DU · HH:MM`, `PYTHIA · MODEL · HH:MM`). Time-only is ambiguous the moment a conversation spans more than one day or is reopened later — a bare `10:28` says nothing about *which* day. The date was always available (`Message.timestamp` is full ISO 8601); it just wasn't surfaced anywhere in the transcript.

**Decision:** The first user turn of each new calendar day inserts an absolute date between `DU` and the time (`DU · 27 Aug 2026 · HH:MM`); same-day turns stay time-only. The very first message of a conversation also gets the date (no prior message — it anchors the start). `isFirstMessageOfDay(msg)` locates the message in `activeConversation.messages` and compares its local day to the previous message's (any role), so it holds in both the full-rebuild and incremental-append render paths without threading a "prev" argument. `formatTurnDate()` renders `day numeric · short month · numeric year` via `toLocaleDateString`.

**Scope:** user turns only. In normal use the user always initiates, so a day's first message is a user turn; an assistant-first day (not reachable through the compose flow) would not be tagged, which is acceptable for a day *anchor*.

**Alternatives rejected:** a full-width date separator row between turns (heavier DOM + a new locale string; the inline label reads as part of the turn a user already scans); reusing `formatConvDate`'s relative "Heute/Gestern" (relative labels drift — "Heute" becomes wrong the next day, defeating the point of a stable date; absolute with year stays correct on reopen).

**Consequence:** A transcript scanned top-to-bottom now shows exactly where each day begins, with no clutter on same-day turns. Pure presentation change in `renderTurnLabel` + two private helpers; no data-model, settings, locale, or test surface added.

### ADR-082 — On-accent label text adapts to the user's accent luminance

**Status:** Active

**Context:** Solid `--color-accent` fills (the Send button, active `.p-tool-btn.is-active`, active `.p-effort-seg-btn.active`) drew their label with `color: var(--text-on-accent)`. Obsidian ships `--text-on-accent` (and `--text-on-accent-inverted`) but the value is **static** — the theme fixes it (white in the default theme) and never recomputes it from the user's chosen `--color-accent`. A pale or mid-tone accent (reported: a mid purple on the "Senden" button) therefore rendered those labels at poor contrast, near-illegible. Obsidian never decides *which* of the two on-accent tokens to use; that decision was missing.

**Decision:** Add `PythiaSidebarView.applyAccentContrast()`. It resolves `--color-accent`, `--text-on-accent`, and `--text-on-accent-inverted` to concrete rgb by setting each on a hidden probe `<span>` and reading `getComputedStyle(probe).color` (the browser normalizes hex/`hsl()`/named forms to `rgb()`), then sets `--p-on-accent` on the `.pythia-view` root to whichever token has the higher **WCAG contrast ratio** against the accent (pure functions in `services/color.ts`: `parseRgb`, `relativeLuminance`, `contrastRatio`, `betterOnAccent`). The three CSS rules now read `color: var(--p-on-accent, var(--text-on-accent))`, so the theme token still applies until (and if) JS sets the variable — no flash, safe fallback. It runs in `buildUI()` and re-runs on Obsidian's `css-change` workspace event, so switching accent/theme in Appearance settings updates the labels live without reopening the view.

**Why Obsidian's own tokens (not pure #fff/#000):** keeps the fix theme-native — a theme that styles `--text-on-accent-inverted` as, say, a dark navy is honored. Because the choice is made by *measured* contrast (not an assumption that the tokens are pure black/white), it stays correct even if a theme customizes or swaps them; if a token is undefined the probe falls back to `#fff`/`#000` in the `var()` default.

**Scope:** solid accent fills only. Accent *tints* — the user bubble (`color-mix(--color-accent 12%, --background-primary)` with `--text-normal`), highlighter marks, hover washes — already pair with readable text and are untouched.

**Alternatives rejected:** hardcoding pure black/white (guarantees contrast but bypasses theme on-accent styling — the point of choosing Option A was to stay native); a CSS-only solution (CSS cannot branch on a custom property's luminance); parsing the raw `--color-accent` token string (fragile across hex/hsl/named/var-reference forms — the probe sidesteps all of it).

**Consequence:** On-accent labels stay legible across any user accent and update live on theme changes. New pure module `services/color.ts` with 13 unit tests (parse, luminance, contrast, and the token-choice decision incl. the reported mid-purple case and non-black/white theme tokens). Any future solid-accent surface must use `var(--p-on-accent, var(--text-on-accent))`, not bare `--text-on-accent` (noted in design.md).

### ADR-083 — Fork banner "branched from" link uses the standard span link pattern

**Status:** Active

**Context:** The fork banner's "branched from" link (`.pythia-fork-source-link`, `renderForkBannerEl`) was the extension's lone remaining clickable link built as an `<a>` element. Its rule already set `text-decoration: none`, but the link still rendered permanently underlined: Obsidian core styles anchors (`a`) at a specificity that out-ranks a bare `.pythia-fork-source-link` (0,1,0) plugin rule, so the underline came back at rest. It also used `--interactive-accent` rather than the design system's mandated `--color-accent`.

**Decision:** Build the link with `createSpan` instead of `createEl("a")`, and style it exactly like the extension's other in-panel links (`.p-source-web`, `.p-wikilink-name`): `color: var(--color-accent); cursor: pointer;` with underline only on `:hover`. A `<span>` carries no default underline, so the rest state is clean without scoping the selector under `.pythia-view` to beat core. The click handler is unchanged.

**Alternatives rejected:** scoping `.pythia-view a.pythia-fork-source-link` to out-specify core (works, but keeps a one-off `<a>` link that diverges from every other clickable link in the panel — the span *is* the house pattern); keeping `<a>` with `text-decoration: none !important` (fights the cascade with `!important`, which the codebase avoids).

**Consequence:** The link matches the rest of the UI — no stray underline at rest, underline on hover, accent color from the standard token. Establishes the rule (noted in design.md) that in-panel links are spans, never `<a>` elements. The one other `createEl("a")` (a tool-call chip file link in `onToolCall`) is out of scope here and can follow if it shows the same artifact.

### ADR-084 — Fork banner renders above the summary cards

**Status:** Active

**Context:** On a forked conversation's first paint, `renderMessages` laid out the top of the scroll as: context inspector → summary cards ("Speisekarten") → fork banner ("Verzweigt von…") → messages. But the fork banner is the primary *orientation* cue for a fork — it says where this branch came from and links back to the source — while the summary cards are secondary reference. Placing the banner below the summaries pushed it away from the first message and buried the "where am I" signal under content.

**Decision:** Reorder the full-rebuild block in `renderMessages` so the fork banner (`renderForkBannerEl`, rendered only when `conv.forkedFromId` is set) comes directly after the context inspector and before the `.p-summary-cards` container. New vertical order: context inspector → fork banner → summary cards → messages. Both the banner and the summary container are direct children of `messagesEl` appended in call order; no CSS sibling/adjacency selectors reference either, and `summaryCardsEl` is still assigned before `renderSummaryCards()` reads it, so the move is purely positional.

**Consequence:** A fork opens with its provenance banner adjacent to the first message and above the summaries, matching how the branch is meant to be read. Non-forks are unaffected (no banner). Pure ordering change; no data-model, CSS, or test change.


### ADR-085 — Favorite and Fork are assistant-only in the selection toolbar

**Status:** Active

**Context:** The selection toolbar (Copy · Favorite/Unfavorite · Branch/Fork · Insert · Inbox) appeared for any text selection inside `messagesEl`, including a **user prompt bubble** (`.p-msg-user`). Both Favorite (`onFavoriteSelection`) and Fork (`onForkConversation`) resolve their target by `data-msg-id` and fall back to `.p-bubble` as the body — the user row carries a `data-msg-id`, so favoriting or forking from one's *own* prompt was in fact possible, not blocked. Neither makes sense: a favorite highlights a passage of the model's answer worth keeping; a fork branches from a point in the model's reasoning (its selection becomes the `<forked_from_excerpt>` anchor for the branch). Anchoring either to the user's own prompt is meaningless.

**Decision:** `handleSelectionChange` now detects whether the selection's `commonAncestorContainer` is within a `.p-msg-user` row and, if so, hides `favBtn` and `forkBtn` (the fork button is now held on `this.forkBtn` for that toggle); Copy / Insert / Inbox stay visible for the user's own text. Defense in depth: `onFavoriteSelection` and `onForkConversation` also early-return when the resolved message row has class `p-msg-user`, so the actions are impossible even if a button is reached another way. Assistant messages (`.p-msg-ai`) are unaffected.

**Consequence:** Favorite and Fork are assistant-content-only, both in what the toolbar offers and in what the handlers permit — matching their meaning (a saved highlight / a branch excerpt from the model's output). No data-model or locale change; existing favorites on user bubbles (if any were created before this) remain tappable to unfavorite. Verified via build/lint/tests; no new unit test (DOM-selection behavior in the view class has no harness).


### ADR-086 — Favorites and fork origins use custom elements, not `<mark>`

**Status:** Active (supersedes the accent-on-`<mark>` mechanism of ADR-064 / ADR-065)

**Context:** Favorites and fork origins were both painted as `<mark>` elements (`ui/HighlightPainter.ts`, shared `paintRange`), differing only by class (`p-highlight` yellow vs `p-fork-origin` accent). The fork was meant to render in the accent color, but kept showing yellow. Root cause: `<mark>` is styled by Obsidian core and community themes (`.markdown-rendered mark`, `--text-highlight-bg`), and those stylesheets load **after** the plugin's. ADR-064/065 tried to win the cascade by scoping `.pythia-view mark.p-fork-origin` (0,2,1) to beat the (0,1,1) core rule — but that only defeats that one selector; any theme that styles `mark` more specifically or with `!important` reverted the fork to yellow, and on engines without `color-mix` the accent declaration was dropped to the yellow fallback anyway. The accent *value* was never the problem — painting onto `<mark>` was.

**Decision:** Wrap favorites in a **`<pythia-favorite>`** custom element and fork origins in **`<pythia-fork>`** (hyphenated, spec-valid custom-element names) instead of `<mark>`. `paintRange` gained a `tagName` parameter (default `pythia-favorite`; forks pass `pythia-fork`). A custom element has **no** theme rules targeting it, so `.pythia-view pythia-fork { background: color-mix(in srgb, var(--color-accent) 25%, transparent) }` applies with no specificity contest and no scoping tricks; `--text-highlight-bg` remains the no-`color-mix` fallback. Favorites keep `--text-highlight-bg` (yellow). Element classes (`p-highlight` / `p-fork-origin`) and data attributes (`data-fav-id` / `data-fork-id`) are retained for JS identification and the flash state; all querySelectors are now class-based (`.p-highlight` / `.p-fork-origin`), element-agnostic. Both switched (not just forks) for a symmetric, element-targeted styling model, per the maintainer's call.

**Trade-offs:** custom elements carry no `<mark>` "highlighted reference" ARIA semantics — a minor accessibility loss accepted for the reliable styling. Bare names like `<fork>` were rejected in favor of hyphenated `pythia-*` (bare names are "unknown elements," not spec-valid custom elements, and risk a future standard tag). Injected only into the live DOM after render (never into stored markdown), so Obsidian's sanitizer is not involved and re-render repaints cleanly.

**Consequence:** Forks reliably render as an accent-tinted highlighter, visually distinct from yellow favorites, in every theme and Obsidian build — no cascade fight. `HighlightPainter` tests assert both wrapper tag names. Any future highlight kind should follow the same custom-element pattern rather than styling `<mark>`.

### ADR-087 — An errored or empty send keeps the user turn and discards partial replies

**Status:** Active

**Context:** `sendMessage()` pushed the user's `Message` into `conv.messages` but persisted nothing until a reply *completed* — the only `conversationStore.save(conv)` was in the success branch of `onComplete`. Two failure paths fell through that gap: (1) on a mid-stream error the handler called `finalize(partial)` — rendering the partial reply into the DOM but never adding it to `conv.messages` nor saving, so the visible reply vanished on the next full re-render and the user's own message was unpersisted (lost on a clean close or an iCloud/Sync reload); (2) an empty response (`!fullText`) removed the streaming row and returned, again leaving the user turn unsaved. The partial that was rendered had never been sent to the model as a real turn, so keeping it also desynced the visible transcript from the history the model actually sees.

**Decision:** Persist the user turn up front, and never keep a partial reply.
- Immediately after `conv.messages.push(userMsg)`, call `await conversationStore.save(conv)` so the user's message survives regardless of what the response does.
- On a stream **error**, drop the streaming row outright (no `finalize`), discarding any partial text. The user retries from a clean state. `createStreamingBubble`'s now-unused `getPartial()` was removed.
- On an **empty** response, keep the (already-saved) user turn and just remove the empty streaming row.

**Alternatives rejected:** persisting the partial reply as a real assistant message (it never reached the model, so it would mislead the next turn's context and imply a completed answer); keeping the partial visible but unsaved (the transcript would then differ from saved history and disappear on any rebuild); dropping the user message on empty/error (silently loses what the user typed). All three were put to the maintainer; "keep the user turn, discard the partial" was chosen.

**Consequence:** A failed or empty send no longer loses the user's message, and the transcript always matches saved history. One extra debounced save per send (coalesced with the reply's save on success).

### ADR-088 — Conversation eviction preserves insertion order of survivors

**Status:** Active

**Context:** `evictConversations()` returned the surviving conversations **re-sorted by `updatedAt` descending**, and `persistData()` assigns that back to `plugin.conversations`. The rest of the app treats the array as insertion-ordered — `onOpen()` and `handleDeleteConversation()` pick "the most recent" as `conversations[length - 1]` (the last-pushed). After any eviction (only once a vault exceeds `maxConversations`, default 200) the reorder silently made `[length - 1]` resolve to the **oldest** conversation, so the plugin would open / fall back to the wrong one, and the reordered array was then persisted to disk.

**Decision:** Use `updatedAt` only to *select* which unprotected conversations survive (the newest `slots`), then return survivors filtered from the original array so their relative order is unchanged. Protected conversations (starred or active in any leaf) are still always kept. The misleading docstring ("Returns the evicted list…") was corrected — the function returns survivors, not evictees.

**Consequence:** "Most recent = last array element" holds before and after an eviction. A regression test asserts survivor order and that `result.at(-1)` is the newest conversation.

### ADR-089 — Web-search citations reconciled by domain; inline web citing re-enabled

**Status:** Active (revises the "stop instructing web citations" decision of ADR-077; the deterministic-capture and foreign-marker-stripping parts of ADR-077 stand)

**Context:** ADR-077 stopped instructing the model to cite web results (to avoid leaked markers and duplicate sources) and captured Tavily sources deterministically. Two rough edges remained: (1) the `web_search` **tool description still told the model to "cite them inline,"** directly contradicting the `<recent_context>` block and tool-result header that said *not* to — an instruction the model receives on every research turn; (2) when a model *did* emit `⟦cite:web:<domain>⟧`, `parseCitations` stored it with `ref = <domain>` while `appendWebSources` deduped Tavily results by **full URL**, so the same site could list twice.

**Decision:** Make inline web citing a first-class, consistent path (the web analogue of ADR-072's note-citation rule), and dedupe by domain.
- **One shared instruction.** New `WEB_CITATION_INSTRUCTION` in `promptConstants` tells the model to append `⟦cite:web:<domain>⟧` after a web-derived statement and *not* to add its own sources list. Both `ContextBuilder`'s `<recent_context>` block and `WebSearchService`'s tool-result header reference it, and the `web_search` tool description is reworded to match — the three sites can no longer contradict.
- **Dedupe by domain.** `appendWebSources` now compares by normalized domain (new exported `webDomain()` helper) instead of full URL, so a model's bare-domain marker and Tavily's full-URL result for the same site collapse to one source. The first occurrence wins, which keeps the inline `⟦cite:web:…⟧` chip mapping intact.

**Alternatives rejected:** deterministic-only, i.e. keep forbidding inline web citation and strip any `⟦cite:web:…⟧` markers (simpler, but discards a citation the model volunteered and leaves web answers without inline chips); upgrading the kept source's `ref` to Tavily's full article URL (would break the `${kind}:${ref}` marker→source key used by `eachCitationSegment`, dropping the chip). Put to the maintainer; "reconcile by domain, allow inline" was chosen.

**Consequence:** Research answers can carry inline web chips like note citations, web sources never double-list, and the model receives one coherent citation instruction. `stripForeignCitations` (ADR-077) still removes `【…†…】` native-format noise; deterministic Tavily capture is unchanged.

### ADR-090 — Favorite/fork highlights use smsag.de's "highlighter marker" style

**Status:** Active (restyles the highlight surface of ADR-086; the custom-element mechanism of ADR-086 is unchanged)

**Context:** Favorites (`<pythia-favorite>`) and fork origins (`<pythia-fork>`) rendered as flat solid blocks — `background: var(--text-highlight-bg)` (yellow) and `color-mix(var(--color-accent) 25%, transparent)` respectively, with `border-radius: 2px`. The maintainer wanted them to read like the "highlighter" hover effect on the smsag.de homepage links, keeping each highlight's existing color. That site's `a:hover` rule is the classic marker effect: `border-radius: 1em 0 1em 0` (asymmetric, hand-drawn corners), a diagonal `linear-gradient(-100deg, …)` sweep of a pale ink at varying alpha, and `text-shadow: 1px 1px 1px #fff` for legibility over the ink.

**Decision:** Port the *shape* of that effect to both highlight elements while preserving their colors and making it Obsidian-theme-safe.
- **Marker sweep, own color.** Each element's `background` becomes `linear-gradient(-100deg, …)` built from its own token — `--text-highlight-bg` for favorites, `--color-accent` for forks — via `color-mix`. The gradient's peak stop is the full token value (favorite) or ≈30% accent (fork, matching the prior 25% tint), so the color is unchanged; lighter stops (12–45%) build the uneven sweep. A plain `background: <solid>` line precedes the gradient as the no-`color-mix` fallback.
- **Asymmetric corners.** `border-radius: 1em 0 1em 0`, with `box-decoration-break: clone` so the ink and corners stay clean across line wraps.
- **Theme-adaptive text-shadow.** `text-shadow: 1px 1px 1px var(--background-primary)` — a white halo in light themes (as on smsag.de), a dark halo in dark themes — instead of a hardcoded `#fff` that would look wrong on Obsidian dark themes.
- **Always visible, not hover-gated.** The marker is the resting appearance (not a `:hover` reveal): favorited/forked spans must stay findable in the transcript, which is the whole point of the feature.

**Alternatives rejected:** reveal-on-hover only (most literal copy of the site, but favorites/forks would be invisible at rest — only reachable via the navigator); recoloring favorites to smsag.de's blue (collides with the accent-blue fork highlight — the two would be indistinguishable); a hardcoded white text-shadow (breaks on dark themes). The hover-behavior and text-shadow questions were put to the maintainer; "always visible" + "adapt per theme" were chosen.

**Consequence:** Both highlights read as a hand-drawn highlighter marker in either theme, colors untouched, with no new elements or JS — a pure `styles.css` change to the two existing rules. The `p-highlight-flash` navigator-jump pulse is unchanged (it briefly fills solid, then settles back to the marker gradient).

### ADR-091 — Prompt optimization moves from a toolbar icon to the Send long-press menu

**Status:** Active (extends ADR-057's Send long-press menu)

**Context:** The inline prompt optimizer was launched from a dedicated wand icon in the input toolbar (`.p-optimize-btn`, one of attach/save/optimize/apply-template/research). The maintainer wanted the toolbar icon removed and the feature folded into the long-press menu on the **Send** button, alongside the two summary actions (ADR-057) — a third entry — to declutter the toolbar and group the "do something with my draft/conversation" actions in one place.

**Decision:** Remove the toolbar button and add a third `.p-send-menu` item.
- **Menu item.** `openSummaryMenu` gains an **Optimize prompt** entry (`sparkles` icon via `setIcon`, matching the menu's icon convention), after Summarize conversation / Summarize favorites. Its action runs the existing `OptimizationController.start()` (via `ensureInputExpanded()`), unchanged.
- **Disabled state.** Greyed (`.p-send-menu-item-disabled`) when the input is empty **or** no optimizer template (`settings.promptOptimizerTemplateId`) is configured — the maintainer chose the stricter of the offered conditions so the item never launches into an immediate no-op. (The other menu items likewise grey on "nothing to act on".)
- **Icon** is `sparkles` — already used in the empty-state welcome, so it renders in every Obsidian/Lucide version (chosen over `wand-sparkles`/`wand`).
- **Controller decoupling.** `OptimizationController`'s `optimizeBtnEl` dependency became optional and every use is guarded: there is no longer a toolbar button to reflect the in-progress "active" glow onto, so the in-message `.p-optimize-indicator` plus the disabled Send button are the sole progress feedback. Dead artifacts removed: the `optimizeBtnTooltip` i18n string and the `.p-optimize-btn` / `pythia-wand-pulse` CSS.

**Alternatives rejected:** disabling only on empty input while leaving the missing-template case to a click-time Notice (more discoverable, but the maintainer preferred never offering a dead action); keeping a toolbar button *and* the menu entry (defeats the declutter goal); a native Obsidian `Menu` (renders as a mobile bottom sheet, not anchored to Send — already rejected by ADR-057).

**Consequence:** The input toolbar drops one icon; prompt optimization, conversation summary, and favorites summary now live together in the Send long-press menu. No behavior change to the optimizer flow itself.

### ADR-092 — On-accent label falls back to pure black/white when theme tokens fail AA

**Status:** Active (fixes a gap in ADR-082)

**Context:** ADR-082 made accent-filled labels (Send button, active tool/effort pills) readable by computing `--p-on-accent` as whichever of the theme's two on-accent tokens (`--text-on-accent` / `--text-on-accent-inverted`) has the higher measured contrast on the user's accent. But that only ever chooses *between the two theme tokens* — when **both** read poorly on the accent (a pale/mid accent, or a theme whose "inverted" token is itself a low-contrast tint rather than black), the less-bad token is still unreadable. This is exactly what the user reported: the "Senden" label stayed low-contrast (dark purple on light purple) despite ADR-082.

**Decision:** Extract the choice into a pure, unit-tested `readableOnAccent(accent, tokens, aa = 4.5)` in `services/color.ts`, and add a **pure black/white fallback**. It keeps the highest-contrast theme token *only when it clears WCAG AA (4.5)* on the accent — so a theme that deliberately tints a still-readable label is respected — and otherwise sets `--p-on-accent` to pure `#ffffff` or `#000000`, whichever contrasts more, which is guaranteed readable on any accent. `applyAccentContrast()` now just resolves the accent + theme tokens via its probe span and delegates. The older `betterOnAccent()` (which could only pick between the two tokens) is removed. `--p-on-accent` still stores the CSS var string when a theme token wins, so the label tracks a later theme edit to that token.

**Alternatives rejected:** always force pure black/white regardless of the theme token (simplest and always readable, but discards a theme's intentional on-accent tint even when it reads fine — e.g. a conventional white label on a saturated accent that clears AA); lowering the AA threshold below 4.5 (would preserve more conventional white-on-accent labels but risks leaving borderline cases unreadable — 4.5 is the correct bar for the small 10px Send label, and the threshold is a parameter if it needs tuning).

**Consequence:** On-accent labels are readable on every accent and theme, not just the ones where one of the theme's two tokens happened to work. The decision is covered by `tests/color.test.ts` (including the both-tokens-poor case). No CSS or markup change — the same `color: var(--p-on-accent, …)` wiring from ADR-082 stands.

### ADR-093 — Prompt optimizer rewrites the input in place, not via an in-conversation preview

**Status:** Active (replaces the preview/confirm flow that shipped with the inline optimizer; the Send-menu entry point from ADR-091 stands)

**Context:** The optimizer rendered the flow *inside the conversation*: a ghost preview bubble of the original prompt, an "Optimizing…" indicator, then the optimized text as a result box with three buttons — **Use this** (which also *sent* the message), **Discard** (restore original), **Another version** (regenerate). That put a transient, message-shaped UI into the transcript for something that only ever targets the input box, coupled optimization to sending, and needed `MarkdownRenderer` + several `.p-msg-optimize-*` / `.p-optimize-*` rules.

**Decision:** Make it a direct, in-place edit of the prompt textarea. `OptimizationController.start()` now: reads the input, optimizes it with the settings framework (`defaultPromptFramework`), and **replaces the textarea content in place** — no preview/result/action UI, and it does **not** auto-send. The user then either presses Send or reverts.
- **Undo via the native stack.** The replacement uses `document.execCommand("insertText")` (select-all, then insert) rather than assigning `inputEl.value`, because only the former enters the textarea's native undo history — so **⌘Z** (desktop) and **iOS shake-to-undo** restore the original. A direct-assignment fallback covers engines where `execCommand` is unavailable (no native undo there — notably Android, which has no system undo gesture; accepted as a known gap per the maintainer, who preferred no extra Undo affordance).
- **Progress cue.** During the call the textarea and Send are disabled and the Send button shows the `optimizingIndicator` label (mirroring how it shows "Stopp" while streaming) — the in-conversation indicator is gone.
- **"Another version" is just re-running** the optimizer from the Send menu on the current input; the dedicated retry button is removed.
- The controller shed its `messagesEl` / `component` / `scrollToBottom` / `sendMessage` deps; removed CSS (`.p-msg-optimize-*`, `.p-optimize-*`) and four now-dead i18n keys (`useThisBtn`, `discardBtn`, `anotherVersionBtn`, `optimizingIndicatorFramework`).

**Alternatives rejected:** keeping the in-conversation preview (the reported problem — it reads as a chat turn and coupled optimize-to-send); a transient in-input Undo chip in addition to native undo (offered; the maintainer chose native-undo-only, accepting the Android gap); a custom (non-native) undo so ⌘Z is unnecessary (would not integrate with ⌘Z / shake, which the maintainer explicitly wanted).

**Consequence:** Optimizing a prompt is now a quiet, in-place rewrite the user reviews in the input box and sends (or undoes) themselves — no transcript clutter, no forced send. Android users lack an easy revert (documented). The Send button briefly widens to fit the "Optimizing…" label.

### ADR-094 — Optimizer output must be the bare prompt (output-only instruction + deterministic cleanup)

**Status:** Active (follows ADR-093)

**Context:** With ADR-093 the optimizer result is dropped straight into the input box, so it must be *only* the rewritten prompt. But the optimizer sends the template body (plus the framework instruction) as the user message with an **empty system prompt** — nothing told the model to suppress conversational wrapper. A chatty model (e.g. gpt-4o-mini) returned the CO-STAR rewrite wrapped in `Sure! Here's how you can restructure your prompt…:`, surrounding `---` rules, and a closing `With this structure in place, your prompt is now well-defined…` — all of which then landed in the input box.

**Decision:** Constrain the output at the source and clean up deterministically.
- **Output-only instruction.** A shared `OUTPUT_ONLY_INSTRUCTION` is appended to the optimizer's user message (both the inline `optimizeText` and the `run()` command path). It's appended to the **user message, not sent as a system role** — the optimizer utility path (`callUtility`) would push a system message even to OpenAI reasoning models, which reject one, so the user-message slot is the compatible place. It forbids preamble, sign-off, explanation, opener phrases ("Sure"/"Here's"/…), quotes, code fences, and horizontal rules.
- **Deterministic safety net.** A pure `cleanOptimizedOutput()` post-processes the result: unwrap a surrounding code fence, drop a single leading conversational preamble line (opener word + trailing colon — an optimized prompt never opens that way, so it can't remove real content), and strip leading/trailing standalone horizontal rules. Trailing prose is left to the instruction (deterministic trailing-sentence removal is too prone to eating real content).
- Both live in a new **obsidian-free `services/promptOptimizerText.ts`** so the cleanup is unit-tested directly (`tests/promptOptimizer.test.ts`), matching the repo's pure-module-plus-tests pattern.

**Alternatives rejected:** sending the instruction as a **system prompt** (breaks on reasoning models via `callUtility`); aggressively scrubbing trailing sentences with a regex (high false-positive risk on legitimate final instructions); editing the example optimizer templates only (the user's own template is arbitrary and can't be relied on — the constraint must come from code).

**Consequence:** The optimizer returns a clean, ready-to-send prompt regardless of the user's template or how chatty the model is; residual fences/rules/preamble are stripped as a fallback. If a small model still leaks a trailing sentence despite the instruction, that's the remaining gap — addressable with more scrubbing if it recurs.

*(ADR-095 is the selection-toolbar assistant-scope hardening — `resolveSingleAssistantMessage()` — which lives on a separate branch; see that branch's decisions.md.)*

### ADR-096 — Fork selection is trimmed so the source-side fork-origin mark can be re-found

**Status:** Active

**Context:** A user reported that after forking a passage, the **source** conversation no longer showed the blue fork-origin highlight, the tap-to-open inline fork summary anchor, or scrolled to the branched span from the "Forked from" link — while the fork itself was created fine. All three depend on one thing: `repaintForkOrigins` re-finding the branched text in the source message (via `findRange`, `full.indexOf(text)` over the concatenated text-node data) and painting a `<pythia-fork>` mark; the "Forked from" link and the anchor both key off that painted `.p-fork-origin[data-fork-id]`. Root cause: `onFavoriteSelection` stores `sel.toString().trim()` but `onForkConversation` stored the **untrimmed** `sel.toString()`. `Selection.toString()` can carry a block-boundary newline or content-edge whitespace that the concatenated data never contains, so `indexOf` returns −1 and the mark never paints. Favorites (trimmed) worked; forks didn't. The bug is latent (present in 2.0.4 too — `ui/HighlightPainter.ts` is byte-identical between 2.0.4 and 2.0.7), which is why a single-word fork worked but a phrase with edge whitespace did not.

**Decision:** Two robustness fixes, since a fork's origin mark must survive imperfect stored data:
1. **Trim the selection** at both ends of its lifecycle: `onForkConversation` stores `sel.toString().trim()` (matching favorites), and `repaintForkOrigins` trims `forkedFromSelection` when searching — so forks **already saved** untrimmed paint on the next render (no migration).
2. **Occurrence-index fallback:** `repaintForkOrigins` (`ui/HighlightPainter.ts`) now falls back to the **first** occurrence when the stored `occurrenceIndex` doesn't resolve — `findRange(text, occ) ?? findRange(text, 0)`. This is the case that actually explains the reported single-word failure: a fork of a short word that **repeats** in the message (e.g. "SSIH") records a non-zero index; favorites in the same conversation were unique phrases (index 0), so they painted while the fork silently didn't. A visible mark on the first occurrence beats none (it restores the blue highlight, the tap-to-open anchor, and the "Forked from" scroll-to-span); the fallback only triggers when the exact index fails, so a valid index is unaffected.

A `debugMode`-gated diagnostic in `sidebar.ts`'s `repaintForkOrigins` logs each fork's stored text/index and whether its mark actually landed, so a still-broken branch-back is traceable without guessing. Regression tests in `tests/HighlightPainter.test.ts` cover both the edge-whitespace and out-of-range-index cases.

**Alternatives rejected:** a one-time data migration to rewrite stored selections (unnecessary — trimming/fallback at search time fixes old forks for free); making `findRange` whitespace-**insensitive** by normalizing whitespace runs on both sides (fixes multi-block selections too, but changes matching semantics for favorites and risks over-matching — deferred unless multi-block forks prove to need it); repainting fork origins *after* `paintCitations` to align the DOM state (favorites paint before citations and work, so citation timing isn't the differentiator — not pursued).

**Consequence:** Forking a repeated short word (or a whitespace-padded selection) now paints the accent fork-origin mark in the source, restoring the tap-to-open anchor and the "Forked from" scroll-to-span. If the fallback lands on the wrong occurrence of a repeated word, the mark is at least visible on that word. **Known limitations (traceable via the debug log):** a selection spanning *multiple* blocks carries interior newlines that trimming can't remove; and if the stored selection genuinely isn't present in the rendered text (e.g. it captured an adjacent citation chip's number), even the fallback can't find it — both would need the deferred whitespace-normalizing `findRange` or repainting after citations.

### ADR-097 — `#`-mention picker drills into folders in place (Option A)

**Status:** Active

**Context:** Typing `#` in the prompt input opens `ui/InlineSuggest.ts`, a flat dropdown of matching folders (max 3) and notes (filled to 8). A folder match could only be *attached wholesale* (`getFilesInFolder` — the whole recursive subtree) on Enter/tap; there was no way to look inside a folder and pick individual files. The request was to let the user open a matched folder — via ArrowRight on desktop, a swipe on mobile — and browse its files.

**Decision:** Add an in-place drill-down (Option A of three considered — the others were an inline accordion and Miller/two-pane columns). The picker keeps a `folderStack`; empty = the flat global search, and descending pushes a folder whose contents (subfolders + `.md`/`.pdf` files, filtered by the still-typed fragment) replace the list, prefixed by a **back** row and an explicit **"Attach all (N)"** row. Interaction model, chosen to keep ArrowRight and swipe the *same* gesture while staying non-breaking:
- **ArrowRight / swipe-left / trailing › chevron** = drill into the highlighted folder.
- **ArrowLeft / swipe-right / the back row** = step up one level (ArrowLeft at the top level is *not* consumed, so it still moves the textarea caret).
- **Enter / tap on a folder** = attach the whole folder, exactly as before — drilling is purely additive.
On each drill or back step the typed fragment is cleared (`clearFragment` leaves the bare `#`), because the fragment that matched the folder name would match nothing inside it; further typing then filters within the level. Drilling lands the selection on the first content row (past back/attach-all). The single-column design needs no extra width — important in a narrow Obsidian sidebar — and the swipe handlers (horizontal-dominant, ≥40px) mirror the arrow keys so mobile has parity. Three i18n keys added to both locales (`inlineAttachAll`, `inlineDrillTooltip`, `inlineBackTooltip`).

**Alternatives rejected:** inline accordion expansion (collides with the 8-item cap, eats horizontal room with indentation, and horizontal swipe reads as "move sideways" not "unfold" — weak mobile story); Miller/two-pane columns (wants width the sidebar rarely has; heaviest for a lightweight autocomplete).

**Consequence:** Folders are browsable without leaving the input. Mouse-only users get the › chevron and back row (no keyboard/swipe needed); keyboard and touch users get symmetric drill/back gestures. Not unit-tested — the behavior is DOM/layout- and vault-mock-heavy (the scroll-into-view even depends on `offsetTop`/`clientHeight`, which the DOM stub reports as 0); the entry-building split into pure `buildGlobalEntries`/`buildFolderEntries` keeps it reviewable. **Known limitation:** deep subtrees are browsed one level at a time; the per-level content cap is ~20 rows (scrollable), and folders with more are filtered by typing rather than paged.

### ADR-098 — Header icon order and a right edge the "+" never leaves

**Status:** Active

**Context:** The header packed the conversation name (flex-grow) first, then `[model][link][history][delete][+]`. Two problems: the requested order differs, and the "+" new-conversation button visibly *jumped* between the main view and the "all conversations" history overlay. Root cause of the jump: the undocumented, unstyled `.pythia-template-label` div was created as the header's **last** flex child, so whenever a conversation had a template it rendered "Template: X" *after* the "+", shoving the button leftward — while the history overlay (a separate `.p-history-head`) had no such label, so its "+" sat at the true right edge. The two overlay/main frames also had different left padding (`--s2` vs `--s3`).

**Decision:** Reorder the header left→right to **history · name (grows) · rename · link · delete · [ctx chip] · model · new**, per the maintainer's spec (chosen layout: name absorbs the flex space, so the action cluster and the "+" stay pinned to the right — the rename pencil now lives in that right cluster, not glued to the name). To make the "+" position invariant:
1. The **"+" is always the last flex child.** The name's `.p-title-group` (`flex: 1`) absorbs all free space, so showing/hiding any other control (model, link, delete, ctx chip) shrinks the name area, never moves the "+".
2. The **template caption is removed from the flex row** — `.pythia-template-label` is now `position: absolute` (centered along the header's bottom edge), so it can never displace the "+".
3. The **history-overlay header frame matches the main header** exactly (same `padding: s2 s2 s2 s3`), so toggling the overlay leaves the "+" at an identical x.
Empty state (no active conversation) keeps only **history · name · +** — rename/link/delete are `display:none` and the model badge was already hidden by `updateModelBadge`; `deleteConvBtn` became a stored field so `renderHeader` can gate it too.

**Alternatives rejected:** pencil glued to the name on the left (maintainer chose the conventional title-left / actions-right cluster instead); giving the history overlay the full icon set (most of it is irrelevant to a list view — kept minimal `[← back][title][+]`, only the frame aligned); leaving the template label in-flow but reordered (any in-flow position still displaces a neighbor when it toggles — absolute is the only stable fix).

**Consequence:** The "+" holds one position across empty/active states and across the main/history views. The rename pencil moved from inside the title group to the right cluster. Not unit-tested (pure DOM/CSS layout); verified by reading the flex model — the single `flex:1` name group is the only grow region, and the "+" is terminal in both headers. **Known limitation:** the absolute template caption is centered on the header's bottom edge and truncates at 60% width; a very long template name shows only its head.

### ADR-099 — Web search auto-arms on time-sensitive sends

**Status:** Active

**Context:** The Tavily `web_search` tool was offered to the model *only* when the per-conversation research globe was toggled on (`conversation.researchMode`, default off), gated identically in three places — the tool list ([ToolHandler.getToolDefinitions](../services/ToolHandler.ts)), each provider's request, and the recency nudge in [ContextBuilder.buildSystemPrompt](../services/ContextBuilder.ts). So with the globe off the model had *no* search tool and answered from memory with no signal it could have searched. The maintainer's report — "when I'd expect it, it doesn't fire" — is exactly this: a question needing current info sent in a conversation whose globe was never lit. The plumbing was otherwise sound (`tool_choice` auto, 25 tool rounds, `WebSearchService` never throws).

**Decision:** Auto-arm `web_search` for a **single send** when the research toggle is off, the outgoing message reads as time-sensitive, and a Tavily key is set — chosen over "always available, model decides" and "just make the toggle eager" (maintainer picked auto-arm). Mechanism:
- A pure, unit-tested heuristic `looksTimeSensitive(text, currentYear)` ([services/webSearchHeuristics.ts](../services/webSearchHeuristics.ts)) matches whole-word recency/uncertainty cues (latest, current, now, news, price, version, "who is the", …) and any year ≥ the current one. Conservative by design: a false positive costs only an unused tool in the request, while the failure we're fixing is false *negatives*.
- At send time `sendMessage` computes `autoArmedSearch` and passes an **armed shallow clone** `{ ...conv, researchMode: true }` to `streamMessage` for that turn only. The provider reads `conversation` read-only and the assistant reply is appended by sidebar's own callbacks over the *original* `conv`, so nothing armed is ever persisted — the globe stays off after the turn. The same effective flag feeds the two `allowedToolNames` gates so an armed search is actually permitted to execute.
- The globe **pulses** (`.is-auto-armed`, a 2× accent keyframe) so the auto-arm is visible without flipping the persistent toggle.
- Trigger wording strengthened in *all* modes (not just auto-arm): the tool description and the recency nudge now say to search *before* answering whenever a fact can change or can't be verified, and to prefer a needless search over a confidently outdated answer.
- New setting `webSearchAutoArm` (default **on**; `Object.assign` merge backfills it for existing users), so a user who doesn't want unprompted Tavily calls can disable it while keeping the manual globe.

**Alternatives rejected:** "always available when a key is set" (removes the failure entirely but hits Tavily on the model's judgment in every conversation — more credit exposure than the maintainer wanted); mutating `conv.researchMode` transiently instead of cloning (a debounced/`onComplete` save mid-send would persist it — `saveData` serializes the whole object, so a transient field leaks); a heuristic that also parses relative dates/NER (heavier, and the cue+year set already covers the reported cases).

**Consequence:** Search now fires on time-sensitive questions without the user remembering the globe, while the persistent toggle still forces eager+grounded research when they want it, and both are opt-outable. **Known limitations:** the heuristic is English/German-cue and keyword-based, so an oblique time-sensitive question with no cue word and no year still won't auto-arm (the manual globe remains the fallback); and auto-arm only *offers* the tool — the model can still decline to call it.

### ADR-100 — Suppress the assistant's closing save-as-note / continue offer

**Status:** Active

**Context:** With capable models (e.g. Opus), long answers — a book summary was the reported case — reliably ended with a boilerplate solicitation: *"Would you like me to save this as a structured note in your vault, or continue with the next section?"* Every turn. The `DEFAULT_SYSTEM_PROMPT` never asks for this; it is emergent, driven by the "integrated into the user's personal knowledge base" framing plus the visible note-writing tools (`create_note`/…), which the model reads as an invitation to offer saving. It also appears under a *custom* system prompt, so patching the default text alone wouldn't fix it.

**Decision:** Add a `NO_SOLICITATION_INSTRUCTION` constant and always append it as its own part in `ContextBuilder.buildSystemPrompt`, after the (default or custom) system-prompt block. It tells the model to stop when the substantive answer is complete and not to tack on an offer to save/export/format-as-note or a "shall I continue?" proposal — while explicitly exempting a genuine clarifying question the model needs answered to do the current task, so real disambiguation isn't gagged. Applied unconditionally rather than behind a setting because `buildSystemPrompt(conversation)` takes only the conversation (no settings handle), the behavior is near-universally unwanted, and the guard is scoped narrowly; a per-conversation or global opt-out can be threaded later if a user wants the offers back. Only the chat path is affected — summary/title/optimizer generations use their own prompts, not `buildSystemPrompt`.

**Alternatives rejected:** editing `DEFAULT_SYSTEM_PROMPT` only (misses custom-prompt conversations, where the behavior also shows); removing the KB-framing / hiding the note tools (they're wanted — the goal is to stop the *unsolicited offer*, not the capability); a settings toggle (rejected for now — needs a `buildSystemPrompt` signature change to reach settings, and the default everyone wants is "suppressed").

**Consequence:** Replies end at the answer. The exact-output `buildSystemPrompt` tests were updated to expect the always-present guard (it now sits between the system-prompt block and any summary/excerpt parts), plus a test asserting the guard is present. **Known limitation:** it's a prompt-level nudge, not a hard filter — a model may still occasionally close with an offer; and it's unconditional, so a user who *wants* the save prompt has no toggle yet.

### ADR-102 — "Good for" model guidance in the picker (hover on desktop, two-tap on touch)

**Status:** Active

**Context:** Users struggle to choose a model; the popover showed only name, context window, and a "Reasoning" tag — insider signals. Of three options considered (see backlog #119 for the deferred task-first picker), the curated per-model "good for" example line was chosen as lowest-risk. The maintainer further ruled out capability jargon: "deep reasoning / fast / slow" is meaningless to most users, so the descriptor style is **recognizable example tasks** ("Long chapters, in-depth comparisons" / "Quick facts, short rewrites") a user matches their own intent against.

**Decision:** Add a plain-language example line under every model row. Constraints from the maintainer:
- **Smaller text**, and **revealed on demand** — desktop shows it on `:hover` (gated `@media (hover: hover)`), so the list stays scannable; the row grows to a second line only while hovered.
- **Touch two-tap:** on a coarse pointer (`matchMedia("(hover: none), (pointer: coarse)")`), the first tap *arms* the row (reveals the example + a "Tap again to select" hint) without selecting; a second tap on the same row confirms. Tapping a different row moves the armed state. Desktop keeps first-click-selects.
- **Every model** in `MODEL_CATALOG` has an entry — enforced by `tests/modelGuidance.test.ts` (present, non-empty, en + de, no stale ids).
The strings live in `models/modelGuidance.ts` as a per-id `{ en, de }` map, **not** in the `t()` table: the natural lookup is by model id (dynamic), which the dead-key i18n test can't see, so a dedicated map localizes it via a new `getLang()` helper without tripping that check. Row markup split into a `.p-model-pop-line` (name/tag/ctx/check) plus `.p-model-pop-good` / `.p-model-pop-taphint`; the row became a flex column.

**Alternatives rejected:** capability descriptors (deep reasoning/fast — the jargon the maintainer rejected); human-persona or everyday-scale metaphors (memorable but risk reading as condescending in a knowledge tool, and metaphor emoji would break the "no emoji icons" design rule); always-visible examples (clutters the list — the maintainer wanted hover/tap reveal); routing the strings through `t()` with dynamic keys (breaks the dead-key test).

**Consequence:** A lost user hovers (or taps) a model and reads what it's for in their own words, in their UI language. **Known limitations:** the examples are curated prose that must be kept sensible as the catalog changes (the test only enforces presence, not accuracy); the desktop hover-reveal grows the row, a small reflow within the scrollable popover; and the two-tap touch flow adds one tap on mobile (mitigated by the explicit "Tap again to select" hint).

### ADR-101 — Global custom instructions (settings-driven, appended to the system prompt)

**Status:** Active

**Context:** Users wanted to add their own standing guidance (tone, formatting, always-avoid rules) without editing each conversation's system prompt, and to see the plugin's built-in behavior guidance rather than have it be invisible. A full editable-rule registry was considered (see the design discussion) but carries the heavy costs — per-rule migration reconciliation, snapshot-vs-live semantics, three-layer precedence, and the risk of users breaking app-contract instructions (the `⟦cite:…⟧` markers and tool descriptions the app parses). The chosen slice is the cheap 80%: one global free-text field, ChatGPT-style.

**Decision:** Add a `customInstructions: string` setting (default `""`; `Object.assign` merge backfills existing users). `buildSystemPrompt(conversation, customInstructions = "")` appends it, when non-empty, inside a `<custom_instructions>` block placed **after** the conversation's own system prompt and **before** the no-solicitation guard and any summary/excerpt/recency parts — so it reads as user guidance layered on the persona. Threaded from settings at the two call sites (`BaseProvider.resolveUserContent` for the real send, `sidebar` for the context-inspector token estimate, so the estimate stays accurate). App-contract instructions (grounding/web citation markers, tool descriptions, `<recent_context>`) remain hard-coded and are deliberately **not** surfaced as editable — only free-form style/behavior guidance is user-owned. The no-solicitation guard stays always-on (ADR-100), not converted to a toggle.

**Alternatives rejected:** an editable rule *registry* with per-rule toggles and per-conversation/template scope (deferred — that's where migration, snapshot semantics, and layering all concentrate; revisit on demand); surfacing the built-in contract instructions as editable defaults (they're plumbing the app parses — editing them silently breaks citations/source lists); per-conversation rather than global (global is the simpler default; the per-conversation `systemPrompt` field already exists for conversation-specific needs).

**Consequence:** Users get always-on custom guidance in one box, kept in a labeled `<custom_instructions>` block. **Trade-offs to keep in mind:** the text is added to every request (tokens on every turn, counted by the context-budget estimate) and changes the cached system-prompt prefix (editing it invalidates Anthropic prompt-cache hits until the next warm-up); and it's *live*, not snapshotted — an edit applies to all conversations, old and new, on their next turn.

### ADR-103 — Controller extraction is the standing pattern for decomposing the view and plugin, guarded by a file-size ratchet

**Status:** Active

**Context:** `sidebar.ts` (3,735 lines, ~105 methods) and `main.ts` (951 lines) are god-objects, while the rest of the codebase is cleanly factored — the provider layer (`BaseProvider` template method + `LLMRouter`, ADR-045/ADR-051), the pure `services/persistence.ts`, and `ConversationStore`. The view already has the right decomposition pattern in two places: `NavigatorController` and `OptimizationController` are extracted controllers driven by a `Deps` interface (the plugin, specific DOM elements, and callbacks back into the view), and #94 already lifted `buildUI` sub-steps and `CodeBlockDecorator`/`DeleteFileModal` out. A side-by-side comparison with a peer plugin (obsidian-similarity, which keeps every file small behind ports/adapters) made the gap concrete: Pythia's *process* discipline (CI, tests, docs, provider abstraction) is ahead, but its *structural* discipline is undermined by the two UI/entry monoliths — and nothing stopped them re-growing.

**Decision:** Treat controller extraction as the standing convention and give it a guardrail, rather than tolerating the monoliths or rewriting them wholesale.
1. **Pattern:** further view/plugin decomposition uses the existing `Deps`-interface + callback controller shape (as `NavigatorController`/`OptimizationController`). Cohesive method+field clusters move into `ui/` controllers; methods called from `main.ts` stay as thin delegating facades on the view so an extraction PR never touches `main.ts`.
2. **Sequence:** many small, behaviour-preserving, individually-green PRs, risk-ascending — History → Summary/Inspector → Fork → Selection → Header → TranscriptRenderer → Composer/Send (the 270-line `sendMessage` last). Then `main.ts` splits into `SecretStore` / `PluginDataStore` / `ConversationService` / `ViewManager`, and an `AppContainer` composition root lets `ConversationStore` own the conversations array instead of reaching into `plugin.conversations`.
3. **Guardrail:** a file-size ratchet (`scripts/check-file-size.mjs`, wired into CI ahead of the build) — a 600-line default for every `.ts`, with explicit grandfathered ceilings for `sidebar.ts`/`main.ts` that may only be lowered as extractions land. A new file over the default, or a grandfathered file grown past its ceiling, fails CI.

The per-PR roadmap is tracked as engineering-review #120–#123. **PR0 (this change)** establishes the guardrail and the first *tested seam* of the riskiest target before touching it: `services/sendPolicy.ts` lifts `sendMessage`'s two pure post-turn trigger predicates (`shouldGenerateTitle`, `shouldGenerateChapterName`) behind characterization tests, because the method is too DOM- and plugin-entangled to instantiate in a unit test and its trigger conditions (the message-count boundary, the date-name regex) are exactly what a careless extraction silently breaks.

**Alternatives rejected:** an ESLint `max-lines` rule instead of the custom script — it can't express per-file grandfathered ceilings, so a single global cap either fails immediately on the monoliths or is set so high it never bites; a big-bang rewrite of `sidebar.ts` — the value is in small, reviewable, individually-shippable steps (how #94 already worked), not one unreviewable diff; introducing an MVVM layer or UI framework — violates the hard rule against a framework mount, and the repo's own callback-controller pattern is already sufficient; writing a full end-to-end characterization test of `sendMessage` now — impractical (≈50-field view, heavy mocking) and a test that re-implements the logic would be tautological, so the pure predicates are pinned instead.

**Consequence:** new features start decomposed; the two monoliths can only shrink (CI enforces it); and the eventual `SendController` extraction inherits a tested core. Costs: a small indirection (the predicates now live in a module) and the per-PR discipline of lowering the ratchet ceilings. Each later extraction earns its own short ADR only if it makes a non-obvious structural choice; the routine mechanical moves are tracked in engineering-review, not here.

### ADR-104 — `AppContainer` composition root + `ConversationStore` owns the conversation list

**Status:** Active

**Context:** #121 split `main.ts` into services (`SecretStore`/`PluginDataStore`/`ConversationService`/`ViewManager`) but they were still constructed inline in `onload`, and `plugin.conversations` was a plain array that `ConversationStore` mutated directly — the bidirectional coupling flagged when comparing Pythia to obsidian-similarity's ports/adapters design. This is the last step of the ADR-103 roadmap (engineering-review #122).

**Decision:** Introduce `appContainer.ts` as the single composition root, and invert conversation ownership.
1. **Composition root:** `AppContainer.create(plugin)` is an **async factory** (not a plain constructor) because `loadPluginData()` must run *before* the provider services are built — they read the freshly-decrypted API keys — which a constructor can't sequence. It constructs `PluginDataStore` → `await loadPluginData()` → the providers/router/`TemplateLoader`/`NoteWriter`/`WebSearchService`/`ToolHandler`/`PromptOptimizerService`/`SecretStore`/`ConversationService`/`ViewManager`, in the original order, and exposes them as `readonly` fields. `onload` shrinks to `new ConversationStore(this)` + `this.container = await AppContainer.create(this)` + register view/commands/events.
2. **Getter delegation:** the plugin keeps `plugin.llmRouter` / `plugin.conversationStore` / … working via getters returning `this.container?.X`, so none of the ~dozens of `this.plugin.X` call sites across the controllers changed. Zero ripple.
3. **Ownership inversion:** `ConversationStore` now holds `private _conversations` and is the sole owner; `getAll()` returns the live array, `setAll()` replaces it (the only writer of the reference — used by `loadPluginData` and persist-time eviction). `plugin.conversations` becomes `get`/`set` accessors delegating to the store, ending the bidirectional coupling.

`ConversationStore` is deliberately **not** built inside `AppContainer` and is a direct plugin field: it owns the list and must exist *before* `AppContainer.create()` runs `loadPluginData` (whose `plugin.conversations = loaded` write flows through the accessor into the store). Constructing it first in `onload` satisfies that ordering without a bootstrap hack.

**Alternatives rejected:** a synchronous `AppContainer` constructor (can't express the load-before-providers ordering); routing `plugin.X` through `plugin.container.X` at every call site (a large, risky ripple across every controller — the getters avoid it entirely); building `ConversationStore` inside the container (creates a chicken-and-egg with `loadPluginData`, which writes conversations before the container exists); keeping the bidirectional coupling (leaves two owners of the array — the exact smell this step removes).

**Consequence:** one place wires the services; the conversation list has a single owner; `plugin.conversations` is a thin accessor. The `ConversationStore` unit tests were updated to seed via the store's own array (`store.getAll().push(...)`) rather than a plugin field. **Known limitation / caveat:** this touches the plugin's load/lifecycle path, which has no unit coverage and could not be runtime-tested in this environment — it is verified by `tsc` + lint + build + the 434-test suite and by preserving construction order exactly; a smoke-test on plugin load is recommended.

### ADR-105 — View-render smoke tests: mount the real view headlessly against a stubbed `obsidian`

**Status:** Active

**Context:** The 2.1.2 regression (#124 — summary cards + context inspector stopped rendering on conversation open) shipped past a green 438-test unit suite because the *view render path* had zero automated coverage. Every controller and service is unit-tested, but nothing exercised "open a conversation → the expected surfaces appear in the DOM." The decomposition made this gap worse in one sense: `renderMessages` is now a thin coordinator whose whole job is to *call* the controllers in the right place, and that wiring — the exact thing #124 broke — is invisible to controller-level unit tests (the controllers themselves were fine; the view stopped calling them). This is the top watch-item from the obsidian-similarity engineering comparison: strong unit discipline, but no integration coverage of the surface a user actually sees.

**Decision:** Add `tests/viewRender.test.ts` — presence-of-surface smoke tests that mount the **real** `PythiaSidebarView` and a **real** (headless) plugin, then assert the major surfaces exist in the DOM after opening a seeded conversation. Deliberately scoped to *does the surface mount*, not pixels or interactions — the cheapest check that catches this bug class.
1. **Stubbed `obsidian` via alias, not per-test factory.** The `obsidian` npm package is types-only (`"main": ""`), so it can't load at runtime; suites that mount the real view pull the whole `obsidian` surface transitively through `main.ts`/`sidebar.ts`. A shared `tests/mocks/obsidian.ts` stub is wired in with a Vitest `resolve.alias` (`/^obsidian$/`). Suites that declare their own `vi.mock("obsidian")` still shadow the alias, so existing tests are unaffected.
2. **`.ts` preferred over `.js` in the resolver.** `main.js` (the esbuild bundle) sits next to `main.ts`; Vite's default extension order would resolve a bare `../main` import to the bundle (which does a runtime `require("obsidian")` that bypasses the stub). `resolve.extensions` lists `.ts` first so tests hit source.
3. **Obsidian DOM helpers polyfilled onto `Element.prototype`.** Obsidian augments elements with `createDiv`/`createEl`/`empty`/`setText`/`addClass`/… at runtime; happy-dom gives bare elements, so the test installs the subset the view calls before mounting.
4. **Single-render flow, fresh plugin per test.** Tests seed exactly one conversation and let `onOpen` auto-select it — the real "open the sidebar" path, one full-rebuild render. A fresh plugin per test (`beforeEach`) is essential: a shared store leaves prior conversations around, so `onOpen` renders once *before* the test's own render, and the second pass repopulates the inspector via the reference-pills refresh — masking exactly the missing-first-render regression the test exists to catch. This was found the hard way: the first draft (shared plugin) passed even with the bug reintroduced.

**Validation:** the suite was verified by *reintroducing* #124 (removing the two populate calls from `renderMessages`) and confirming the two regression tests fail while the other three stay green — a test that can't fail on the bug is worthless.

**Alternatives rejected:** controller-level tests of `renderSummaryCards()`/`refresh()` in isolation (they'd pass — the controllers were never broken; only the view's call site was); a full Obsidian integration harness / snapshot tests (a brittle maintenance tar pit, far more than the bug class warrants); leaving it to manual smoke-testing (what let #124 ship). **Consequence:** the highest-value coverage gap from the engineering review is closed with a reusable fixture; add a scenario here whenever a new surface must render on open/switch.

### ADR-106 — Conversation search: lexical TF-IDF over content, not semantic embeddings

**Status:** Active

**Context:** The conversation picker (`ConversationSuggestModal`) matched only `"${name}  [${date}]"` through Obsidian's `FuzzySuggestModal` — a user could find a past conversation by its *title* but not by anything discussed inside it. The motivating idea was to rank conversations by a *similarity score* so relevance, not an exact title match, surfaces the right one — modelled on [obsidian-similarity](https://github.com/jorammillenaar/obsidian-similarity), which does on-device semantic search.

We read that plugin's source to ground the choice. It runs `@huggingface/transformers` (transformers.js — **not** TensorFlow.js) with Xenova ONNX MiniLM models (384-dim; `all-MiniLM-L6-v2` English default, `paraphrase-multilingual-MiniLM-L12-v2` for other languages), WebGPU-or-WASM, the model **downloaded from HuggingFace on first run** and cached (inference is local; the initial fetch is not). Around that: an iframe-isolated model host, document chunking, an Int8-quantized packed binary vector index (`embeddings-<modelId>.bin`), and hash-based (`contentHash`/`updatedAt`) incremental re-indexing. A capable but substantial subsystem (~dozen+ files).

**Decision:** Ship **lexical TF-IDF** ranking, reusing the existing `services/noteRelevance.ts` scorer (already IDF-weighted per ADR-043 and already powering note chunking + `#` suggestions). New pure module `services/conversationSearch.ts`:
1. **Weighted haystack per conversation** = title (repeated ×3 so a name hit outranks a passing body mention) + **LLM `summaryText`** + all message bodies.
2. `rankConversations(queryTokens, …)` — empty query → recency order (unchanged default); non-empty → score-descending, zero-score conversations dropped.
3. `bestMatchSnippet(...)` — the best-matching message line, shown muted under each result so the *why* is visible.

Wired into all three conversation-search surfaces (they were each title-substring only):
- **In-panel history view (F10)** and **anchored quick switcher (F9)** in `ui/HistoryController.ts` — the primary "Gespräche" surfaces with the "Suchen…" box. Empty query keeps the date-grouped, fork-indented listing; a non-empty query switches to a **flat, relevance-ranked list** (best match first) with a match snippet per row. Haystacks are memoized per open (`haystackFor`), so keystrokes only re-score. The quick switcher's `addRow` gained a `snippetTokens` param that skips the title-substring gate in ranked mode (else content-only matches would be dropped).
- **Command-palette picker (`ConversationSuggestModal`)** — switched from `FuzzySuggestModal` to `SuggestModal` with a custom `getSuggestions` (mirrors `CommandHubModal`).

`FavoritesSuggestModal` stays fuzzy (short labels, no content to search).

**Why lexical wins here specifically:** (a) conversations are *long* — the concept is almost always present as a literal word somewhere, so lexical recall is far higher than in the short-note case embeddings were built for; (b) **folding in the LLM summary buys the cheap half of semantic recall for free** — the model's own paraphrasing ("automobile", "Fahrzeug") already sits in the summary, so a query word the messages never used can still match; (c) zero new deps, instant, offline, mobile-safe, private — none of the embeddings machinery, and no "download a model from a third-party host on first run" asterisk in a bilingual (DE/EN) vault where the multilingual model is the slower one.

**Alternatives rejected:** *transformers.js embeddings now* (option analysed in full above — the large subsystem earns little over summary-augmented lexical for long documents; held as the documented Phase-2 seam if real usage shows cross-language recall gaps, e.g. English query against a German chat); *TensorFlow.js / Universal Sentence Encoder* (dated, English-first, ~25 MB model, flaky WebGL in the webview — transformers.js dominates it on every axis, which is why obsidian-similarity itself uses transformers.js); *keeping title-only fuzzy* (the actual gap).

**Consequence:** conversation search now ranks by content relevance with a visible match snippet, at near-zero cost. **Watch-item:** if cross-language or true-synonym recall becomes a frequent miss, add a semantic layer using obsidian-similarity's proven design — iframe-isolated transformers.js, chunk-level max-pairwise cosine, Int8-quantized packed index, `contentHash` incremental — rather than reinventing it. Tests: `tests/conversationSearch.test.ts` (haystack title-weighting + summary-synonym recall, ranking/filtering, snippet extraction/truncation).

### ADR-107 — One conversation-search surface: fold the quick switcher into the history panel, opened by a header loupe

**Status:** Active

**Context:** After ADR-106, there were *three* conversation-search entry points: the header-title click opened an anchored **quick switcher** popover (`.p-switcher`), the far-left header icon opened the full **history panel** (`.p-history`), and the command palette opened a modal. The switcher and the panel did nearly the same thing (search + browse conversations) with two separate code paths and two visual treatments — redundant, and the title-click affordance (`Name ▾`) was an easy-to-miss, non-obvious way to reach search.

**Decision:** Collapse the two in-view surfaces into one.
1. **Header icon → loupe.** The far-left header button's icon changes from `history` to `search` (`HeaderController`), tooltip → "Search conversations" / "Gespräche durchsuchen". It still opens the same `.p-history` overlay.
2. **Auto-focus search on open.** `openHistoryView` focuses the search input immediately, so the panel opens ready to type — it *is* the search surface now, not just a browse list.
3. **Keyboard navigation added to the panel.** ↑/↓ move a `.selected` row, Enter opens it, Esc closes — recovering what the switcher had, so the auto-focused input is fully keyboard-drivable. Selection is a flat `rows[]` collected during render (group headers excluded), working in both browse and search modes.
4. **Quick switcher removed.** `HistoryController.openQuickSwitcher`, the `.p-switcher` popover markup/CSS, the `HeaderDeps.openQuickSwitcher` wiring, and the now-orphaned `getConvNameEl`, `switcherHint`, and `dateToday`/`dateYesterday` i18n keys are all deleted. The `.p-switcher-search`/`-input`/`-del`/`-fork-icon` classes stay — the panel reuses them.
5. **Title is now inert.** The header conversation title drops its click handler and the `▾` dropdown chevron and renders as plain, non-interactive text (`.p-title` loses `cursor:pointer`/hover). Clicking it does nothing.

Behaviour of the panel's search/browse itself is unchanged from ADR-106 (empty → date-grouped/fork-indented; query → flat relevance-ranked with snippets).

**Rejected / deferred:** keeping the anchored popover as a lightweight second surface (the redundancy was the problem); porting the switcher's inline per-row rename into the panel (dropped — the header pencil renames the active conversation; renaming an arbitrary conversation from the list is a rare need, revisit if asked). The command-palette `ConversationSuggestModal` stays as the third, keyboard-command entry point.

**Consequence:** one obvious way to find a conversation — a labelled loupe that opens a focused, keyboard-drivable search/browse panel. Fewer surfaces, one code path, less CSS. **Coverage:** four `tests/viewRender.test.ts` smoke tests exercise the DOM path — loupe click opens the panel with the search input focused, empty box browses (date groups) while a query switches to a flat ranked list with a snippet, ↑/↓ move the `.selected` row and Enter opens+closes, and the header title renders as an inert chevron-free `<div>`. (The fixture gained global `createDiv`/`createEl`/`createSpan`, which `HistoryController.rowSub` needs.)

### ADR-108 — Search-panel polish: headerless, focus-accent, grey active label

**Status:** Active

**Context:** After ADR-107 the `.p-history` panel still carried its old chrome — a separate header row (`arrow-left` back · title · "+"), an `✕` glyph for row delete, and the accent tint on the *active* conversation (a holdover from when the panel was a passive browse list). With the panel now the primary search surface, that chrome is redundant: the title duplicates the loupe's intent, the "+" duplicates the main header's, and tinting the *active* row conflicts with the ↑/↓ focus cue (both wanted a highlight).

**Decision:** Six small changes to `HistoryController.openHistoryView` + `styles.css`:
1. **Remove the header row** (`.p-history-head`/`.p-history-title`, and the orphaned `histTitle` i18n key).
2. **Move the back button into the search row**, to the left of the loupe.
3. **Drop the "+"** — new-conversation stays on the main header.
4. **Trash-can delete** — `setIcon(del, "trash")` replaces the `✕` glyph (`.p-switcher-del` now sizes an SVG).
5. **Accent marks focus, not active** — `.p-history-row:hover`/`.selected` take the accent tint the active row used to have (hover **and** keyboard selection, per the user).
6. **Active = grey label only** — the active conversation drops its accent background; it's indicated solely by a grey mono `.p-history-active` label (localized "aktiv"/"active", reusing `navActiveTag`). The `.p-nav-tag` class stays untouched (still used by the navigator).

**Consequence:** the panel reads as a search box first; the accent unambiguously means "the row in focus" while "which one is open" is a quiet grey tag. No behavioral change to search/browse/keyboard nav — the ADR-107 smoke tests still pass.

### ADR-109 — Related conversations via on-device semantic embeddings

**Status:** Active (M1 landed; M2/M3 to follow)

**Context:** Lexical conversation search (ADR-106) matches shared words but misses conceptual relatives (crypto ↔ blockchain, "Auto" ↔ "car"). The user wants a **"related conversations"** affordance: hovering a conversation row (long-press on mobile) reveals a relate icon; clicking it re-sorts the panel to show **only sufficiently-similar** conversations, ranked by **semantic similarity** to that source. This is the Phase-2 seam ADR-106 documented — now chosen, with **local embeddings** (no API, no data egress) as the method.

**Decision:** Port obsidian-similarity's proven engine, adapted to conversations, delivered in three milestones (one PR each) so the risky runtime lands after a fully-tested pure core:

- **M1 (this ADR) — foundation, no runtime dependency.** A pure, fully-tested `services/embedding/` core: `vectorMath` (L2-normalize → Int8-quantize → cosine / **max-pairwise cosine**), `conversationText` (chunk a conversation: lead = title + summary, then message bodies packed to a char budget), `embeddingIndex` (`IndexedConversation`, FNV `conversationContentHash`, `diffIndex` for **incremental** add/drop, compact **Int8 binary** serialize/deserialize for a `.bin` in the plugin dir), and `relatedConversations.rankRelated` (max-pairwise cosine vs a source, min-score floor, source excluded). Everything sits behind an `EmbeddingProvider` interface and is tested with fabricated vectors. The `models/embeddingModels.ts` registry (Xenova MiniLM: **English** `all-MiniLM-L6-v2` and **Multilingual** `paraphrase-multilingual-MiniLM-L12-v2`, both 384-dim) and an `embeddingModelId` setting (default Multilingual, DE+EN) are added; `mergeSettings` back-fills it.
- **M2 — runtime + UI.** The real `EmbeddingProvider` (transformers.js / onnxruntime-web), an index service that builds/persists/incrementally-updates the `.bin`, the relate icon (hover + long-press) + related-mode chip + related-sorted list in `HistoryController`, and the settings dropdown.
- **M3 — polish.** First-run model-download progress, offline/empty handling, re-index on conversation change, graceful degradation when the model can't load.

**Key design choices (M1):** *chunked + max-pairwise* (per the user — higher fidelity on long chats than one-vector-per-conversation); *Int8 quantization* (¼ the size of Float32, negligible ranking error); *content-hash incremental* (only changed conversations re-embed); *model as a user setting* (English/Multilingual). Similarity floor `DEFAULT_MIN_SCORE = 0.35` (tunable) — "only sufficiently-similar" per the user, so a weakly-related tail is hidden.

**Honest caveat (carried into M2):** the model **downloads from HuggingFace on first use** (tens of MB) — local inference, but not zero-network at setup; the multilingual model is the slower one. transformers.js bundling in an Obsidian plugin is the main M2 risk.

**Consequence:** the whole similarity/index/ranking substance is correct and tested before any heavyweight runtime is introduced; M2 can focus purely on the embedding runtime + UI against a stable, verified core.

**M2 update (landed):** added `@huggingface/transformers` and the embedding runtime. To keep the heavy ML runtime out of the plugin bundle, `esbuild.config.mjs` builds the iframe entry (`services/embedding/host/frame/bootstrap.ts` → `model.ts`, which imports transformers) as a **separate browser pass** (`write:false`, ~850 KB) and inlines it into `main.js` via the `__IFRAME_CONTENTS_PLACEHOLDER__` `define` — verified: `main.js` contains no `onnxruntime`/`huggingface` code, and the placeholder is only pulled in once the provider is actually imported (M3). `IframeEmbeddingProvider` runs the model in a hidden same-origin `about:srcdoc` iframe (obsidian-similarity's isolation) over a `texts[] → vectors[]` postMessage protocol. `ConversationIndexService` (provider + `IndexStore` injected) syncs incrementally, persists the Int8 index, and answers `getRelated` — unit-tested with a fake provider (6 tests). The chunked-vs-single decision from M1 holds; chunking happens host-side (`conversationText`) so the iframe stays a pure embedder. **Not yet verifiable here:** live model download + inference inside a real Obsidian window — deferred to M3's UI + manual check. **Deliberately deferred to M3:** plugin wiring (which inlines the 850 KB and grows `main.js`), the settings dropdown, and the relate-icon/chip/related-list UI — so M2 ships proven plumbing with zero bundle bloat and no dormant user surface.

**M3 update (landed — feature complete):** wired end-to-end and user-facing.
- **UI (`HistoryController`):** each row gains a **relate icon** revealed on hover (desktop) → *related mode*: a dismissible **"Related to ‹name›" chip** above the list, and only the conversations `getRelated` returned (min-score-filtered, most-similar first). Clearing the chip or typing in the search box exits back to browse/search. ↑/↓/Enter work over the related rows. On **touch** there is no hover, so a **long-press** (500 ms; the ensuing click is suppressed) opens an Obsidian **context menu** exposing *both* hover-only row actions — **Show similar** and **Delete** (delete omitted for the active conversation, matching the desktop row). Menu items carry the `git-compare` / `trash` icons.
- **Wiring (`main.ts`):** `getRelatedConversations(sourceId)` builds the embedding service **lazily on first use** (so the model/iframe only load when the feature is used), memoized and keyed by `embeddingModelId`; changing the model (or unload) tears down the provider. Persistence is `VaultIndexStore` — a model-keyed `.bin` in the plugin dir. A first-run `Notice` warns that the model downloads.
- **Settings:** a dropdown selects English vs Multilingual, invalidating the service on change.
- **Bundle:** importing the provider inlines the iframe bundle, so `main.js` grows ~739 KB → ~1.6 MB. This is the cost of the local model and lands only now that the feature is real.
- **Tests:** 4 `viewRender` smoke tests stub `plugin.getRelatedConversations` (so no real model runs) and assert the relate icon renders, a click opens the chip + related-only list, and clearing/typing exits.
- **Icon:** `git-compare` (relate/compare), tooltip "Related conversations" / "Ähnliche Gespräche".

**Still unverified here (inherent):** live model download + inference inside a real Obsidian window — needs a manual smoke test in the app; the code degrades gracefully (Notice on load/inference failure, exits related mode).

### ADR-110 — Post-release fixes: force WASM for embeddings, prefix-aware conversation search

**Status:** Active

**Context:** Two bugs surfaced after 2.3.0 shipped.
1. **"Show similar" reloaded the whole of Obsidian.** The embedding model (`model.ts`) auto-selected the **WebGPU** backend whenever `navigator.gpu` existed (`device: webgpu ? "webgpu" : "wasm"`, `dtype: "fp16"`). WebGPU compute in Obsidian's Electron renderer is unstable — requesting a WebGPU device crashes the GPU process, and Electron reloads the window. That's exactly the reported symptom (immediate full-app reload on invoking related mode).
2. **Search missed text that was plainly visible.** Conversation search (ADR-106) matched **exact tokens only** (`scoreRelevanceTokensWeighted` → `set.has(token)`), so typing a *partial* word as-you-type ("bound") never surfaced "boundaries", and the pre-content-search era's substring/fuzzy title matching was gone. (Also latent: `TITLE_WEIGHT` repeated the title into the haystack, but the tokenizer dedupes, so the ×3 was a silent no-op — titles didn't actually rank higher.)

**Decision:**
1. **Always use the WASM backend** (`device: "wasm"`, `dtype: "q8"`) — portable and stable, if a bit slower. WebGPU is removed from the auto-path; revisit it behind an explicit opt-in only once verified safe in Electron.
2. **Prefix-aware, IDF-weighted matching** in `rankConversations`: a query token matches a candidate token by **equality OR prefix**, so a partial word surfaces the conversation; ranking keeps smoothed IDF (rare words dominate) and now applies a real **×3 title boost** by matching against the conversation's *name* tokens directly (replacing the dead haystack repetition). `bestMatchSnippet` prefix-matches too. `conversationSearch.ts` no longer uses the shared `scoreRelevanceTokensWeighted` (note-relevance keeps it unchanged).

**Consequence:** related mode no longer risks crashing Obsidian, and search behaves like search-as-you-type again (partial words + titles surface reliably). Tests: prefix match, title-over-body ranking, prefix snippet. **Note:** live model inference in a real Obsidian window still needs the manual smoke-test — the WASM switch is the most probable crash fix, not a runtime-verified one; if a reload persists, the next signal is the developer-console error at model load.

---

### ADR-129 — The template belongs to the answer it produced, not the header

**Status:** Active

**Context:** A conversation started from a template showed `Vorlage: X` as a caption under the header title. Two problems. **Informationally**, it is a property of the header only by accident: it says what the conversation was seeded with, not which answers that template actually shaped — and the header already carries the conversation's identity (name, model, context). **Structurally**, it was the header's last flex child and displaced the "+" button, which ADR-098 had to fix with `position: absolute` plus a `position: relative` on `.p-header` — a caption held out of the layout it sits in. The turn label (ADR-067/081) is the line that already answers "what produced this message": model, time, token counts.

**Decision:** Move the template into the assistant turn micro-label and delete the header caption.

1. **Stamped per message.** `Message.templateId` is recorded at generation time, exactly like `Message.model`. Reading `Conversation.templateId` at render time would retro-label older answers whenever the template changes, or after a fork into a conversation with a different one — the meta line is a provenance record of *that* answer, and provenance must not be rewritten by later state.
2. **Rendered only where a template starts applying** — the first answer of the conversation, and again wherever a second template takes over mid-conversation (`turnTemplateCaption` compares against the previous assistant turn's template). A conversation's template is constant for most of its life, so captioning every answer would be noise on a line already carrying four fields; captioning the transition states it exactly where it is news.
3. **Legacy conversations need no migration.** Messages predating the field fall back to `Conversation.templateId` on *both* sides of the comparison, which captions exactly the first answer of an old conversation — the same result the new data produces.
4. **No role captions.** `DU` / `PYTHIA` are dropped from every turn label (superseding that part of ADR-067). The accent bubble vs. the plain body already distinguishes user from assistant; the role was the one token on the line that never told the reader anything they could not see. `turnUser`/`turnAI` removed from both locales; `templateLabel` is kept as the caption's `title` tooltip.
5. **Truncation, not wrapping.** `.p-turn-template` is its own span with `max-width: 18ch` and `text-overflow: ellipsis`, so a long template name yields before the model, time, or token counts do on a narrow sidebar.

**Alternatives rejected:** a colored chip or pill for the template (the turn label is flat mono `--text-faint` by design — a pill would compete with the user bubble's accent and the reference wikilinks); rendering it on *every* assistant turn (repetition on a line that is already four fields long, for information that changes at most once or twice per conversation); keeping it in the header but restyled (leaves the informational mismatch, and keeps a caption that has to be lifted out of the flex row it lives in).

**Consequence:** the header returns to a plain flex row (no `position: relative`, no absolutely-positioned child), and the template becomes readable at the point of use. Cost: the template is not visible while scrolled past the first answer — accepted, because it is stated at the transition and the conversation's seed is not something the reader needs on every turn. Label rendering moved to `ui/turnLabel.ts` as pure `(row, msg, conv)` functions, which paid for the new code under the ADR-097 ratchet (`sidebar.ts` 2,018 → 1,951, ceiling lowered) and made the caption rules unit-testable without mounting the view (+8 tests). Not runtime-verified in Obsidian (no live window here); build, lint, file-size and 630 tests green.

---

### ADR-130 — Merge: the inverse of Fork — a passage points at an existing conversation

**Status:** Active

**Context:** Fork (ADR-058/079/128) is one-directional. It takes a selected passage OUT of a conversation and starts a new one anchored to it, and the source then paints the origin snippet so the branch's summary can be read in place. The opposite move had no affordance at all: while reading an answer you often recognize that a passage is the same subject you already worked through *in a conversation that exists*. The only ways to act on that were to fork (creating a redundant third conversation), or to leave, search, read, and navigate back — losing the reading position and leaving nothing behind for the next read.

**Decision:** A merge link — a passage in this conversation pointed at another conversation, surfacing that conversation's summary exactly where the passage sits.

1. **Creation mirrors fork.** `Merge` sits next to `Branch` in the selection toolbar, under the identical constraints (ADR-085: assistant content only, both selection endpoints inside one `.p-msg-ai`, guarded again in the handler; ADR-096: the selection is trimmed at storage and at search, or the mark can never be re-found). `cmdMergeConversation` opens the existing `ConversationSuggestModal` — the same ranked full-text conversation search the command palette uses (ADR-106) — over every conversation except the current one.
2. **The summary is resolved before the anchor opens**, not after. If the chosen conversation has no `summaryText` and has messages, one `generateSummary` call is awaited behind a `generatingSummary` notice, so confirming a merge always lands on a populated preview. This is ADR-042's ordering decision applied to the mirror case, and for the same reason: a link that is briefly empty reads as broken.
3. **Display-only — nothing reaches the model.** A merge adds no block to the system prompt. Unlike a fork, which deliberately carries `forkedFromSummary` and `forkedFromSelection` as context, a merge is a reading aid; injecting every linked conversation's summary would tax every subsequent turn for a link the user placed once, and there can be many per conversation. A regression test in `ContextBuilder.test.ts` asserts the prompt is byte-identical with and without merges, and that a merge alone does not flip the untrusted-context guard on.
4. **Visible from both ends, like a fork.** A fork announces itself twice: the child carries a "Forked from" banner and the source paints the origin passage. A merge is the same shape reflected — the painted passage lives in the conversation that made the link, and a `.pythia-merge-banner` at the top of the conversation it points at names every conversation that merged with it, with the passage excerpt, linking back to that passage and expanding its anchor. The first iteration of this ADR shipped without the banner, which left the far end silent and was the one place merge genuinely failed to mirror fork. The inbound list is **derived on read** (`incomingMergeLinks(conversations, targetId)`, a pure exported function), never stored as a back-reference: one record with one owner means deleting a link, or the conversation holding it, can never strand a stale pointer on the other side.
5. **Stored on the conversation holding the passage.** `Conversation.merges: MergeLink[]` — `{ id, conversationId, messageId, text, occurrenceIndex, createdAt }`, the same shape as `Favorite` plus a target. This keeps the link where it paints and needs no back-reference to maintain — the banner in point 4 is computed from these same records, so the target stays a pure reader of the relationship rather than a second place to keep in sync.
6. **A third mark treatment, not a third highlighter.** Favorites own the yellow ink sweep and fork origins the accent one (ADR-090); a third fill would be illegible beside them and could overlap the same span. A merge link is a **dashed `--color-accent` underline** (`<pythia-merge class="p-merge-link">`, solid + faint accent wash on hover), which reads as "this points elsewhere", survives sitting on top of a favorite highlight, and uses only existing tokens. The custom element is for the same reason as `<pythia-fork>` (ADR-086): no theme `mark` rules to out-specify.
7. **The anchor mirrors the fork anchor, minus what does not apply.** `.p-merge-anchor` is frameless with a **dashed** 2px accent left-rule (so the two inline anchors are distinguishable at a glance), and carries the target's name, its summary, `N messages · MODEL · <date> [· outdated]`, a one-tap regenerate, an unlink button, and `Open →`. Staleness uses ADR-128's rule verbatim. Two deliberate differences from the fork anchor: **only the conversation summary is offered** (a fork anchor prefers a favorites summary; a merge target is an independently named conversation and its own recap is what was asked for), and **regeneration never renames** — it calls `generateSummary`, not `generateSummaryWithTitle`, because a fork starts life as a generic "Fork of X" and wants a real title, whereas renaming a conversation the user already named, from inside someone else's passage, would be a surprise.
8. **Both ends are kept alive.** `evictConversations` now protects any conversation that is a merge target, exactly as it protects starred conversations — the cap would otherwise silently delete the other end of a link the user placed deliberately, with nothing left on screen to explain it. A target that is deleted outright stops painting (the mark simply does not appear, as a fork origin does when its fork is deleted) while the record is retained, so a restored backup restores the link. `persistence.normalizeMerges` drops malformed entries on load, for the same reason `sanitizeMessages` exists: the paint path reads `merges` for every rendered message, so one bad record would take the message body down with it.
9. **Navigator section, shown only when it has content.** `Merged` sits between the fork tree and Favorites, collapsed by default, listing each link by its target's name with a jump-to-passage click and a hover ✕. The section is omitted entirely when there are no merges, so users who never merge gain no permanent clutter.

**Alternatives rejected:** *injecting the merged summary into the system prompt* — rejected by the user; it turns a one-time reading aid into a per-turn token cost, and the fork path already covers the case where another conversation genuinely is the context. *Copying the target's messages in* — a real content merge blows the token budget, duplicates history in two places, and has no sane reconciliation for the fork tree. *A stored back-reference on the target* — the banner is derived instead, so there is exactly one record per link and nothing to keep consistent. *Reusing the fork-origin mark and anchor with a flag* — the two would then be visually identical and mutually exclusive on the same span, and `ForkController` would grow a second mode instead of a second controller.

**Consequence:** Fork and Merge are now a matched pair: fork answers "this deserves its own conversation", merge answers "this already has one". The cost is a sixth selection-toolbar button (the toolbar is a horizontally scrolling carousel, so it absorbs one) and a third mark treatment to learn. New code: `ui/MergeController.ts` (marks, anchor, inbound banner, and the pure `incomingMergeLinks`), `repaintMergeLinks` in `HighlightPainter`, `normalizeMerges` in `persistence`, `cmdMergeConversation` in `ConversationService`, plus i18n (en/de) and CSS. Paid for under the ADR-097 ratchet by two extractions that stand on their own: `ui/longPress.ts` collapses three hand-rolled copies of the same 450 ms press-and-hold into one tested helper, `unwrapCodeFence` moves to `services/messageUtils.ts` as a pure function, and `applyAccentContrast` moves to `ui/accentContrast.ts` (it read nothing from the view but the root element, and moving it keeps `services/color.ts` DOM-free and unit-testable) — `sidebar.ts` 1,951 → 1,920, ceiling lowered. +35 tests (665). Not runtime-verified in Obsidian (no live window here); build, lint, file-size and tests green.

---

### ADR-131 — Wide tables keep their natural width and scroll, instead of being squeezed

**Status:** Active

**Context:** A reported screenshot showed a five-row, three-column table from an assistant answer rendered in a phone-width sidebar. Every cell had wrapped, and the wrapping was *mid-word*: `Messbarkeit` became `Messba / rkeit`, `Stoffwechselenergie` became `Stoffwechsele / nergie`. The table was unreadable, and the obvious request was to make it wider and scrollable, the way code blocks and rendered diagrams already are.

Investigating showed the requested mechanism was **already built**: `decorateCodeBlocks` wraps every rendered `table` in a `.p-scroll-frame` with `overflow-x: auto`, a thin scrollbar and drag-to-pan, and the CSS for that frame has existed since the "Wide table scroll containers" block was added. It has never had any visible effect. Two reasons, both necessary to fix:

1. **A table never overflows on its own.** With `table-layout: auto` a table sizes itself to its containing block, wrapping cell content as needed, rather than overflowing. So the frame's `overflow-x` had nothing to act on — the table simply shrank to 296px inside a 296px frame.
2. **Something breaks words inside cells.** ~~Obsidian themes commonly set `word-break: break-all` or `overflow-wrap: anywhere` on table cells. That is what splits a single word across lines~~ — **corrected in ADR-144: this was wrong.** The culprit was Pythia's own `.p-ai-body { word-break: break-word }`, which behaves like `overflow-wrap: anywhere` and is inherited by every cell of every rendered table. Measured with no theme loaded at all: inside `.p-ai-body` a narrow cell splits `Messbarkeit` across two line boxes; the identical cell outside it does not. The rest of the point stands and was the operative half — with words breakable a column's minimum content width collapses to one character, which is what let the table shrink so far.

**Decision:** Fix it in CSS on the table inside the existing frame, and extend the decoration to every surface that renders markdown. Three choices were put to the user and decided by them:

1. **Wrap at word boundaries with a floor width, not `nowrap`.** The alternative — one line per cell, exactly what code blocks do — produces the widest table and the most scrolling. The chosen rule keeps prose cells compact while guaranteeing no word is ever split: `overflow-wrap: normal`, `word-break: normal`, `hyphens: none`, plus `min-width: 8ch` so a short column (`gut`, `mittel`) is not crushed to one character per line by a wide neighbour. The floor is in `ch` so it tracks the cell's own font instead of assuming a pixel size, and it is a floor only: a column whose longest word is wider still gets that width.
2. **No sticky first column.** Pinning the row label while the rest scrolls was offered and declined. The whole table scrolls as one, which also matches code blocks and diagrams, neither of which pins anything.
3. **Every markdown surface, not just assistant answers.** Summary cards, the fork anchor and the merge anchor render markdown through a view callback that previously did a bare `MarkdownRenderer.render`, so a table in a summary got no treatment at all. They now go through `ui/renderMarkdown.ts`.

Specificity follows ADR-065: the rules are scoped `.pythia-view .p-scroll-frame > table th` so they out-rank Obsidian core and theme rules, which load after the plugin.

**Verification:** measured in headless Chromium at a 320px viewport, against an emulated theme forcing `word-break: break-all`, comparing the stylesheet with and without this ADR's block. (ADR-144: the emulated theme was unnecessary — Pythia's own `.p-ai-body` rule reproduces the split on its own — but it does not invalidate the measurement, which only ever asked whether this ADR's rules win against a hostile inherited value.) Line counts come from `Range.getClientRects().length`, which yields one rect per rendered line, so a single-word cell spanning two rects is proof of a mid-word break.

| | table width | frame width | scrollable | `Messbarkeit` line boxes |
|---|---|---|---|---|
| Before | 296px | 296px | no | 2 |
| After | 346px | 296px | yes | 1 |

**Alternatives rejected:** *`white-space: nowrap` on every cell* — the literal code-block treatment, and the widest possible table; rejected by the user in favour of less horizontal scrolling. *A sticky first column* — genuinely useful on a narrow panel, since scrolling right otherwise loses the row label, but declined as added complexity. *Shrinking the table's font size to fit* — hides the problem rather than fixing it, and breaks the documented type scale. *Assistant messages only* — leaves the same bug in summary cards.

**Consequence:** a wide table now behaves like the other wide content types: natural width, horizontal scroll, drag-to-pan, thin scrollbar. Cost is that a wide table must be scrolled to read in full, which is the trade the user chose over squeezing. Three helpers were extracted along the way, each now shared by more than one caller rather than living in whichever module happened to need it first: `ui/tableDecorator.ts` (`decorateTables`, idempotent via `data-decorated` so re-renders never nest frames), `ui/dragToPan.ts` (`attachDragToPan`, shared by code blocks, diagrams and tables) and `ui/renderMarkdown.ts` (`renderRichMarkdown`, replacing three identical inline callbacks in the view). That paid for the change under the ADR-097 ratchet: `sidebar.ts` 1,920 → 1,912, ceiling lowered. +8 tests (673). Not runtime-verified in Obsidian (no live window here); build, lint, file-size and tests green.

---

### ADR-132 — Keyboard avoidance only when there is a keyboard, and by padding rather than height

**Status:** Active

**Context:** A user reported a large dead strip between the composer toolbar and the bottom edge of the Pythia leaf, and supplied a second screenshot of another plugin in the same stacked mobile sidebar whose content reached the edge. Measuring the screenshots rather than eyeballing them settled it:

| | measurement |
|---|---|
| Dead strip | 185 device px = **67 CSS px** |
| Strip luminance vs panel background | 30.0 vs 34.0 — **darker**, so it is not panel background |
| Panel bottom vs Send button bottom | 4 device px = **1.4 CSS px** |
| Same region in the comparison plugin | no band above ~9 CSS px |

Two facts follow. The strip is *uncovered leaf*, not padding inside the panel, because it does not have the panel's background. And the panel is cut off barely below the Send button, which means the input area's own bottom padding — a minimum of 8 CSS px, and `env(safe-area-inset-bottom)` where that is larger, mandated by hard rule 7 — is being clipped. Both require the pane to have an explicit height smaller than its content, with `.pythia-view { overflow: hidden }` cropping the remainder.

Exactly one thing sets a height there: `adjustForKeyboard`. It computed `containerBottom - (visualViewport.offsetTop + visualViewport.height)` and, whenever positive, shrank the pane by it — on every `visualViewport` resize and scroll, on focus and on blur, and once at open. Nothing in it tested whether a keyboard was actually present. Its own header comment described applying *padding*; the implementation had drifted to setting *height*.

The at-rest case is where that goes wrong. In a stacked sidebar the Pythia leaf is not the bottom-most thing on screen: other leaves and Obsidian's own chrome are below it. The difference the function measures is then simply "how much screen exists below this panel", which is not an obstruction and must not be subtracted from the panel.

**Decision:**

1. **Gate on a real keyboard.** `ui/keyboardInset.ts` exposes the rule as a pure function. A soft keyboard shrinks the visual viewport by at least ~250px on any phone; Obsidian's bottom chrome and the home indicator are tens of pixels. `MIN_KEYBOARD_INSET = 120` sits between the two. Below it the function returns 0 and the panel is left exactly as the layout made it. The home indicator keeps being handled where it always was, by the input area's `env(safe-area-inset-bottom)` padding, so hard rule 7 is untouched.
2. **Apply `padding-bottom`, not `height`.** This is what the code's comment always claimed. Padding lifts the content while the element still occupies and paints its whole leaf, so no strip of background can be uncovered, and `overflow: hidden` has nothing to clip — in particular it can no longer crop the safe-area padding it is supposed to coexist with. Both properties are still cleared on every call, which also heals a panel left shrunken by an older build.
3. **The rule is pure and unit-tested.** `visualViewport` and a soft keyboard cannot be reproduced headlessly, and this is precisely the part that was wrong, so the arithmetic is separated from the DOM and covered by 8 tests: at rest, the stacked-sidebar geometry that caused the bug, a sub-threshold shrink, a real keyboard, partial coverage, a panel entirely above the keyboard, a scrolled visual viewport, and rounding.

**Alternatives rejected:** *Removing the input area's safe-area padding* — an earlier diagnosis in this same session blamed a double compensation between that padding and this function, and the measurements above disproved it: the padding is being clipped, not doubled. It is also a hard rule. *Keeping the height-shrink but clamping it* — leaves the mechanism that uncovers leaf background and clips padding, just with a smaller blast radius. *Dropping keyboard avoidance altogether* — the panel would sit under the keyboard when Pythia is the full-height leaf, which is the case the function was written for and which still needs it.

**Consequence:** the panel fills its leaf at rest, matching every other plugin in the sidebar, and the workaround the user had adopted — collapsing the composer to reclaim space — is no longer needed for that purpose. Residual risk, stated plainly: the removed at-rest correction was added deliberately, its commit message citing "Obsidian's own bottom chrome (tab bar, home indicator)". If some full-screen layout really did depend on it, the composer could sit a few pixels low there; the safe-area padding is the intended remedy and raising `MIN_KEYBOARD_INSET`'s companion behaviour would be the fallback. Not runtime-verified in Obsidian (no live window here); build, lint, file-size and 681 tests green.

---

### ADR-133 — Reloading data.json reconciles with memory instead of replacing it

**Status:** Active

**Context:** A user reported that an assistant answer they had seen on screen — and screenshotted — was gone roughly ninety minutes later. The user prompt that produced it was still in the conversation, as was every earlier turn, so they re-sent the prompt. Losing a completed answer is the most serious class of bug this plugin can have, because the work is unrecoverable and the user only finds out later.

The send path is not at fault: the assistant message is pushed onto `conv.messages` and `await conversationStore.save(conv)` runs immediately, the debounce is 300ms, and `onunload` flushes. The loss happens after the write.

`watchDataJson` polls data.json every five seconds and treats any mtime newer than the last seen value, outside a three-second own-write window, as an external change — then calls `reloadFromDisk`. Its own comment records that this fires *constantly* on iCloud and Obsidian Sync vaults, which is why the reload was made silent. `reloadFromDisk` called `cancelPendingPersist()` and then `loadPluginData()`, whose final act was:

```ts
p.conversations = loaded;
```

A wholesale replace, with no comparison against what was in memory. The only guard, `shouldRefuseLoad`, covers one specific catastrophe — disk came back with zero conversations while memory had some, the iCloud eviction case. It says nothing about a disk copy that merely lags memory. So a sync that rewrote data.json with an older snapshot, or a write that had not yet landed, replaced fresher state; the cancelled persist meant nothing rewrote it; and the next save wrote the rolled-back list back out, making it permanent. The signature of that failure is precisely the one reported: the conversation survives, its history survives, its newest turn does not.

**Decision:** reconcile the two lists rather than letting either win outright. `mergeConversations(memory, disk)` in `services/persistence.ts` is pure and unit-tested, and applies four rules:

1. **Newer `updatedAt` wins, per conversation.** ISO 8601 sorts chronologically, so the comparison is a string compare; a missing timestamp sorts oldest, which is the safe direction because it loses only to a copy that actually carries one.
2. **Ties go to memory**, which may hold edits not yet stamped onto disk.
3. **A conversation on only one side is kept, never treated as deleted.** Without tombstones, "deleted on another device" and "created here and not yet saved" are indistinguishable, and resurrecting a deleted conversation is a far smaller harm than destroying one the user is still writing in. Deletes on this device are unaffected, since `ConversationStore.delete` removes from memory and persists in the same step, leaving neither side holding it.
4. **Disk order is preserved and memory-only conversations are appended.** The app reads `conversations[length - 1]` as "most recent", so unsaved conversations belong at the end. With memory empty the result is exactly the disk list, so startup is unchanged.

Whatever memory won is marked dirty and flushed at the end of `reloadFromDisk`, so the stale file is corrected rather than left to be fixed by the user's next edit.

Two supporting fixes, both of which made spurious reloads more likely and so widened the window:

- **The own-write stamp is taken after `saveData` resolves as well as before.** It was only taken before. `saveData` can take seconds on mobile with a large data.json, so the mtime bump could land outside the three-second window and the plugin would re-read its own write as external.
- **The watcher seeds its mtime baseline from the file rather than from `Date.now()`.** data.json is routinely older than the moment the plugin loads, and a clock-based baseline could mask the next genuinely external write.

**Alternatives rejected:** *Flushing memory over disk before reloading* — symmetrical to the original bug, and clobbers a real change from another device. *Refusing any reload whose disk copy is older* — coarser than per-conversation reconciliation and throws away legitimately newer conversations that arrive in the same file. *Dropping the watcher* — cross-device sync stops working, and the watcher is not the defect; replacing state without comparing it is. *Tombstones for deletions* — the correct long-term answer for distinguishing a delete from an unsaved creation, but a persisted-format change that this fix does not need.

**Consequence:** a stale data.json can no longer roll a conversation back, and a pending write can no longer be discarded by a background reload. The accepted cost is rule 3: deleting a conversation on one device while another device holds it unsynced can resurrect it, which is visible, reversible, and strictly preferable to silent loss. +10 tests (690). Not runtime-verified in Obsidian (no live window here); build, lint, file-size and tests green. The report cannot be reproduced headlessly, so this is a fix to a provable defect on the path that produces exactly the reported symptom, not a confirmed reproduction of that specific incident.

---

### ADR-134 — Correcting ADR-131 and ADR-132: tables that still did not scroll, space that was never uncovered leaf

**Status:** Active. Supersedes the table sizing of ADR-131 and withdraws ADR-132's claim about the composer dead space.

**Context:** 2.10.1 shipped both fixes and the user reported that neither had changed anything. They were right, and the two failures have different shapes worth recording separately.

**1. The table fix was incomplete, and its test was too weak to notice.**

ADR-131 gave the table `max-width: none`, on the reasoning that Obsidian caps rendered tables and the cap had to be lifted before the table could exceed its frame. True, and still necessary. But lifting a cap does not make a table want to be wider: with `table-layout: auto` a table sizes itself to its containing block and wraps cell content to fit. So it went on fitting the panel, and absorbed a 200-character cell by turning that column into eighteen lines and the row into 399px of vertical scrolling.

The measurement that "proved" ADR-131 asked whether the frame scrolled at all. It did — by 31px, entirely from the `min-width: 8ch` floors. A binary "scrolls: true" was satisfied by a result no reader would call fixed.

**Decision:** `width: max-content` on the table, so it takes the width its columns actually want, plus `max-width: 32ch` per cell as the cap that makes that usable. Without the cap a single long cell would set the table's width and the row would be one endless line; with it, long text wraps at a readable measure and the neighbouring columns keep their natural width. Measured at a 320px panel against a theme forcing `word-break: break-all`:

| | table width | frame | row height | lines in the long cell |
|---|---|---|---|---|
| ADR-131 as shipped | 327px | 296px | 399px | 18 |
| ADR-134 | 469px | 296px | 163px | 7 |

The lesson is about the assertion, not the CSS: **"does it scroll" was the wrong question; "how tall did the row become" was the one that would have caught this.** The new check records row height and line count, which cannot be satisfied by a 31px overflow.

**2. The dead space was never uncovered leaf. The evidence was bad.**

ADR-132 concluded that `adjustForKeyboard` was shrinking the content pane and leaving a strip of exposed background below it. The load-bearing evidence was a luminance sample showing the strip at 30.0 against a panel background of 34.0 — darker, therefore not the panel. That reading came from a JPEG screenshot, averaged across a band that included the sidebar rail, and compared against a baseline taken elsewhere in the same lossy image.

Re-measured on a PNG, sampling actual RGB across the panel only, the strip is **(26,26,26) — pixel-identical to the chat area above it**. The panel was filling its leaf the whole time. The space is padding inside the input area, and it measures **25 CSS px**: `env(safe-area-inset-bottom)` reserving room for a home indicator, in a stacked sidebar where another leaf sits below and there is no home indicator to clear.

That was the first diagnosis offered in the session. It was abandoned because the JPEG reading appeared to contradict it. **A measurement that overturns a sound mechanical argument deserves more scrutiny than one that confirms it**, and this one got less.

**Decision:** the inset becomes conditional on measurement, because CSS cannot express it. `env(safe-area-inset-bottom)` reports the device inset wherever the element sits, so only the layout can answer "am I the bottom-most thing on screen". `needsBottomSafeArea(containerBottom, layoutHeight)` answers it with a 4px tolerance for sub-pixel layout, and the view sets `--p-bottom-inset: 0px` when the answer is no. The CSS keeps `max(var(--s2), …)` and keeps `env()` as the default, so a full-height Pythia leaf behaves exactly as before and hard rule 7's intent is preserved; the rule's literal text is updated to name the override.

**What ADR-132 keeps:** its change stands on its own merits. Setting an explicit `height` on a pane that is `overflow: hidden` can crop the input area and its mandated padding, and running that arithmetic with no test for whether a keyboard is open was wrong regardless. What is withdrawn is only the claim that this caused the reported strip. Both behaviours now live in `updateViewportInsets`, which applies them together since both are driven by the same events.

**Alternatives rejected:** *Removing the safe-area padding outright* — breaks the full-height case the rule exists for. *A media query or platform check* — neither can see where the element sits in the layout. *Leaving the table to wrap and shrinking its font* — hides the problem and breaks the type scale.

**Consequence:** a wide table now visibly scrolls instead of growing a 400px row, and the composer sits flush with the bottom of its leaf when another leaf is below it. +4 tests (694). Not runtime-verified in Obsidian; the table result is measured in headless Chromium against the real stylesheet, and the inset rule is a pure function tested at the exact geometry of the report.

---

### ADR-135 — Reviewing ADR-134 instead of asserting it

**Status:** Active

**Context:** Two consecutive fixes had shipped without changing what was reported, so the user declined to take a third on trust and asked for a review. That is the correct response to the track record, and "I checked, it's fine" would have been worth nothing. The review looked for ways ADR-134 could fail in the real app rather than in the harness.

**Finding 1 — a real gap in when the inset is recomputed. Fixed.**

`--p-bottom-inset` is only correct if it is recalculated whenever the panel's bottom edge moves. It was wired to `visualViewport` resize and scroll, textarea focus and blur, and once on open. None of those fire when a *leaf* opens, closes or is resized — which is exactly the event that changes whether something sits below Pythia in a stacked sidebar. Open Pythia alone (inset correctly kept), then open a second leaf beneath it, and the dead space returns with nothing to trigger a recompute.

The view now also subscribes to the workspace's `resize` and `layout-change`. The `visualViewport` wiring moved into `watchViewport` in `ui/keyboardInset.ts`, which returns a disposer — those listeners take a `VisualViewport` target that Obsidian's `registerDomEvent` does not accept, so they must be removed by hand, and keeping that next to the rest of the viewport logic makes the obligation visible. Its doc comment states plainly that it covers viewport changes only and that workspace events are the caller's job, so the gap cannot be reintroduced by someone reading only that function.

**Finding 2 — the inset logic verified against the real stylesheet, not a stand-in.**

Headless Chromium reports zero safe-area insets, which would have made a naive test pass for the wrong reason. Substituting the value iOS computes, into the real `styles.css`:

| state | computed `padding-bottom` | gap below the send button |
|---|---|---|
| iOS inset, no override (2.10.1) | 24px | 26px |
| `--p-bottom-inset: 0px` (2.10.2) | 8px | 10px |
| override removed (full-height leaf) | 24px | 26px |

The 26px "before" independently reproduces the 25px measured in the user's screenshot. Two methods, one answer, which is what the earlier JPEG luminance reading failed to provide.

**Finding 3 — the table fix rests on evidence from the user's own screenshot.**

The doubt worth taking seriously was whether the CSS reaches the table at all in the real app: whether `decorateTables` wraps it, and whether the plugin's selector beats Obsidian and the theme, which load after the plugin and win ties (ADR-065).

Both are already proven. `word-break: normal` appears exactly once in the whole stylesheet, inside `.pythia-view .p-scroll-frame > table th, td`. The 2.10.1 screenshot shows `absichtlich`, `Zeilenumbruch` and `sicherzustellen` unbroken where ~~the theme's `break-all`~~ **— corrected in ADR-144: where Pythia's own inherited `word-break: break-word` —** would have split them. That rule can only have applied if the wrapper was present and the selector won. `width: max-content` and `max-width: 32ch` were added to those same selectors, so they reach the table for the same reason. This is stronger than any harness result, because it comes from the user's device.

**The conclusion survives the correction; the reasoning does not.** The evidence proved the selector reaches the table, and it still does. What it did not prove — and was read as proving — is *whose* rule it was beating. The selector had to out-specify an inherited declaration from `.p-ai-body`, not a theme, so it never depended on winning the ADR-065 specificity contest it was credited with winning.

**Stated honestly:** the fix leaves about 8px below the composer, not zero. That is `--s2`, the same rhythm used everywhere else, and the comparison plugin shows none only because its content is an edge-to-edge scrolling list. Anyone expecting a flush edge will still see 8px and should know that is intended.

**Residual risk, not eliminated:** none of this runs inside Obsidian. Layout is measured in Chromium against the real stylesheet, the decision rules are pure functions under test, and the selector question is settled by the user's screenshot — but the combination has not been seen working on the device.

**Consequence:** one genuine defect found and fixed before it could produce a fourth failed attempt, and the two claims that mattered now rest on measurement or on evidence from the reporter's own screen rather than on reasoning alone.

---

### ADR-136 — A glossary: look a term up once, understand it everywhere

**Status:** Active

**Context:** When an answer uses a term the reader does not know, the only ways to ask were a follow-up prompt, which derails the thread, or a fork, which creates a whole conversation to hold one sentence. Both are heavy for "what does this word mean here", and neither leaves anything behind: ask again next week and you pay again.

The user framed the want as "a provider for terms, similar to Tavily". The provider abstraction is right and fits the codebase, where `LLMRouter` over `LLMProvider` is already that shape. The Tavily part is not: an external lookup answers a different question than the one being asked.

**Decision:** three choices, each put to the user with its alternatives, each confirmed.

**1. The definition lives in a vault note, not on the conversation.** A term explained once should be known in conversations that do not exist yet, should be correctable when the model gets it wrong, and should outlive the conversation that happened to ask. None of that is possible in conversation state. The note is plain markdown, `## Term` followed by the definition, so it reads correctly with no plugin installed, supports multi-paragraph entries, and is block-linkable as `[[Glossary#Term]]`. Provenance rides in an Obsidian comment, invisible when read normally. Parsing is deliberately tolerant: a heading with no body yields an empty entry rather than being dropped, because losing a hand-written entry to a strict parser is far worse than carrying an odd one through.

**2. The vault first, then the model given the passage. No web tier.** The vault tier is what makes the feature compound rather than repeat work. The model tier only runs for terms never seen, and receives the passage, which is the entire advantage over a dictionary: a dictionary can say what "Bauteil" means in general, but only the surrounding sentences say which sense an answer meant, and that sense is what the reader is stuck on. A web tier was offered and declined; it would need a key, send the passage off-device, and answer worse than a model holding the passage.

**3. Every occurrence, in every conversation.** The alternative, marking only the passage you looked up, behaves like a favorite and makes you look the same term up repeatedly. Marking globally turns the glossary into a live reading layer.

That third choice is also what made the implementation smaller rather than larger. Because the note is the only source of truth, **no new field was added to `Conversation` at all** — unlike favorites, fork origins and merge links, which each store a span. Terms are matched, not stored.

**Consequences for the painter.** Matching any of N terms anywhere is a different problem from re-finding one stored span. `buildTermMatcher` compiles one alternation over every term rather than running a pass per term, which is the difference between linear and quadratic as the glossary grows, and sorts longest-first because JavaScript alternation is first-match, not longest-match, so "Coding" would otherwise win over "Sparse Coding". Boundaries use lookarounds over `\p{L}\p{N}_` rather than `\b`, which is ASCII-only and would mis-bound German, Greek or Cyrillic terms. The walk skips code, links, citation chips, and text already inside another mark, so a term inside an identifier is not marked and no overlapping wrappers are produced.

**Consequences for the design.** A term mark is the only one of the four that repeats, often many times per screen, which makes its quietness load-bearing rather than a preference: a loud treatment forty times down a page would wreck the prose it exists to help you read. So a dotted underline in `--text-faint`, the conventional affordance for a definition, accent only on hover, and clearly subordinate to the three marks the reader placed deliberately. The definition anchor attaches after the mark's block rather than inline, because a term sits mid-sentence and splicing a block into a sentence reflows the text around it; fork and merge anchors can attach directly because their marks are deliberate, often sentence-length selections.

**Alternatives rejected:** *An external term API first* — the user's own framing, but generic by construction: it cannot disambiguate the sense, which is the actual problem. *Conversation-scoped definitions* — simpler and side-effect-free, but the knowledge never accumulates. *Injecting definitions into the system prompt* — a glossary is a reading aid, like a merge link (ADR-130), and would tax every later turn for a lookup done once. *Marking only the looked-up passage* — makes the feature a note to self rather than a reading layer.

**Consequence:** terminology is answered in place, with no new prompt and no fork, and the answer accumulates in the vault where it can be corrected and reused. Costs: a vault write per new term, which is a visible side effect and is why the note path is a setting; and a glossary that grows without curation will mark more and more text, which the quiet styling is the first defence against. +33 tests (723), covering the parser's tolerance, upsert preserving hand edits and the preamble, longest-match and non-ASCII bounding, and the painter's idempotency and skip rules. Not runtime-verified in Obsidian (no live window here); build, lint, file-size and tests green.

---

### ADR-137 — Glossary terms match their inflections and translations, from a stored list

**Status:** Active

**Context:** ADR-136 matched the stored term and nothing else, case-insensitively and whole-word. The user asked whether synonyms and language variants should be covered. They should: exact matching is a real gap, not a nicety, and it is worst in exactly the conversations this plugin is used for.

Define "Zähler" and the glossary still misses "Zählers" and "Zählern" — in German the uninflected nominative is often the *least* common form in running text. Define "Neuron" and "Neuronen" is unmarked. And because these conversations mix German prose with English technical vocabulary, a term defined in one language is never recognised in the other, which defeats the point of a compounding reading layer: the second occurrence is the one that was supposed to be free.

**Decision:** store the other surface forms on the entry as `aliases`, and get them from the same call that writes the definition.

**1. Stored, not derived.** The obvious alternative is a stemmer or a fuzzy match. Rejected on three counts. It is language-specific, so it would need one implementation per language the user writes in; it is brutal on German compounds, where a stem shared with an unrelated word is common; and above all it cannot be corrected. ADR-136's central choice is that the glossary is a plain note the user can fix by hand when the model is wrong. A stored list keeps that property — a wrong variant is one word to delete in the note — while a stemmer's mistakes are unreachable.

**2. Returned by the definition call, not a second one.** The model that just read the passage is the best available judge of whether the answer's English "counter" means the same thing as its German "Zähler", because it has the passage in hand; a second call would have to be given the same passage again to be as good. It would also double the latency of a lookup the reader is waiting on. So `defineTerm` now asks for a structured reply, `DEFINITION:` and `VARIANTS:`, parsed by `parseDefinitionAndVariants` in the same shape as the existing `TITLE:` / `SUMMARY:` contract. The parser falls back to treating the whole reply as the definition, so a model that ignores the format still produces a usable entry and only loses the variants.

Variants are separated by `|` rather than commas because a surface form may contain spaces ("sparse coding"); commas are accepted only when no `|` appears, so a correctly formatted reply is never re-split. The list is capped at eight, decoration and `(plural)`-style annotations are stripped, and duplicates and the term itself are dropped — one bad reply must not start marking a dozen phrases in every conversation.

**3. The matcher now returns an index, not just a regex.** This is the part that forced a contract change rather than an addition. Before, the matched text *was* the term, so the painter tagged each mark with `match[0]` and the anchor looked that string up directly. With aliases the matched form is usually not the term, so `buildTermMatcher(terms)` is replaced by `buildTermIndex(entries)`, returning `{ matcher, canonical }` where `canonical` maps each normalised surface form back to the term that owns it. `repaintTerms` writes the canonical term into `data-term`, so tapping "Zählern" opens the entry filed under "Zähler" while the text on screen stays as the author wrote it.

Canonical terms are registered before any alias, so one entry's alias can never shadow another entry's own term — otherwise the order of headings in the note would silently decide which definition a word opens. Sorting stays longest-first across terms *and* aliases together, so an alias like "Sparse Coding" still beats a shorter term like "Coding". `GlossaryService.find` and `remove` match aliases too: selecting "Zählern" and pressing Define must find the existing entry rather than paying the model again for a word already known.

**4. Storage rides in the existing marker.** `aliases=a|b|c` joins `source` and `updatedAt` inside the `%% pythia: … %%` comment, placed **last** because it is the only field whose value may contain spaces and therefore needs the run to the closing `%%` as its terminator. `|` and `%` are stripped from a value on write, so a hand-edited alias cannot corrupt the marker. An entry with no variants renders no `aliases=` field at all, leaving notes written before this change byte-identical.

**Alternatives rejected:** *Algorithmic stemming* — per-language, lossy on compounds, and uncorrectable, which conflicts with the vault-first decision. *A separate "find variants" call* — same quality at best, double the wait. *Matching substrings instead of whole words* — would mark "Zähler" inside "Zählerstand", a different concept, and inside unrelated compounds; the whole-word bounding from ADR-136 is what keeps the marking trustworthy. *A `synonyms` heading in the note body* — human-readable, but it would have to be parsed out of prose the user also writes in, and the machine-owned comment already exists for exactly this.

**Consequence:** a term looked up once is recognised in the forms it actually appears in, including across the two languages a conversation mixes, and every one of those forms opens the same entry. Costs: the definition call is now structured, so a model that mangles the format loses its variants (the definition still survives); and the glossary marks more text than before, which makes ADR-136's deliberately quiet styling matter more, not less. The user can delete a wrong variant from the note by hand. +15 tests (738), covering marker round-trip with spaces, separator stripping, alias→canonical resolution, an alias never shadowing another entry's term, longest-match across terms and aliases, and the parser's separator, decoration, cap and fallback rules. Build, lint, file-size and tests green. Not runtime-verified in Obsidian.

---

### ADR-138 — The inline anchors are one component; the fork anchor is its spec

**Status:** Active

**Context:** Three features now open an inline card under a marked passage — fork (ADR-066), merge (ADR-130) and glossary (ADR-136) — and on screen they had stopped looking like the same thing. The glossary anchor rendered with a `--text-faint` left rule and icon, a faint micro-label, a 12px title and a long "Im Glossar öffnen" that pushed the meta row onto a second line; the merge anchor had drifted on the label and title too. Side by side, the glossary card read as disabled rather than as a peer.

The drift came from applying ADR-136's reasoning to the wrong element. That ADR argues, correctly, that a term **mark** must be the quietest of the four, because it is the only one that repeats — a loud treatment forty times down a page wrecks the prose it exists to help you read. That argument was then carried into the anchor, where it does not hold: an anchor never repeats. It is opened one at a time, by a deliberate tap, and it is the answer the user just asked for.

**Decision:** treat the three anchors as one component with one spec, and make the fork anchor that spec, since it is the oldest and the other two were already written as mirrors of it: 2px accent left rule, accent icon, `--text-muted` 600 monospace micro-label, 11.5px `--text-normal` title, 11px `--text-muted` body, and the shared `Öffnen →` open control. Box model, gap, padding, meta row and body typography were already identical across all three and are untouched.

**The one thing that varies is the left rule's stroke: solid fork, dashed merge, dotted term.** One property, three values, carrying the whole distinction — which is what makes it readable at a glance. Colour is not available for that job because all three are accent, and colour was never a good carrier here anyway: it would have to compete with the mark colours the same features already own.

The glossary's open button takes the shared `forkOpenShort` label; the specific wording survives as its tooltip and `aria-label`, so nothing is lost for a screen reader and the meta row stops wrapping. `.p-term-anchor-aliases` drops a `margin-top: -2px` that was fighting the anchor's own 5px gap.

**Alternatives rejected:** *Leave the glossary quiet* — consistent with ADR-136's sentence but not with its reason; the argument is about repetition, and an anchor does not repeat. *Make the glossary rule accent and solid* — then fork and term are distinguishable only by their label text. *A fill or border to separate the three* — ADR-066 chose frameless deliberately; three tinted cards in a transcript is exactly the card soup the design rules forbid.

**Consequence:** the feature the user tapped no longer looks disabled, and a reader who has learned one anchor has learned all three. The rule to keep: **quietness belongs to marks, which repeat, not to anchors, which do not.** No behaviour change, no new tests — CSS and one button label. Build, lint, file-size and 738 tests green.

---

### ADR-139 — One date format, and icons centred on cap height

**Status:** Active

**Context:** Four small things, reported from a screenshot, that are one thing underneath: the meta line under an inline anchor is a row of tiny mono text and 11px icons, and it only reads as a row if every part of it sits on the same line and says only what it has to.

**1. `erklärt von` is gone.** The glossary meta line read "erklärt von Sonnet 5 · …", where fork and merge read "2 Nachrichten · Opus 5 · …". The prefix is the one part of the row the reader already knows — the row is provenance at a glance, and a label explaining that a model name is a model name costs width in a line that has none to spare. The manual case keeps a short marker ("von Hand"), because there the fact *is* the information. `glossarySourceModel` is deleted rather than emptied.

**2. One date format, `15 Sep 2026`, everywhere.** `formatSummaryTimestamp` and `formatTurnDate` both called `toLocaleDateString(undefined, { day, month: "short", year })`, which renders "15. Sept. 2026" in German and "Sep 15, 2026" in US English: different order, different punctuation, different width. In a 9px mono label that is drawn in a fixed rhythm above every turn, a format that changes width under the user is a layout that changes with it — and it cannot be asserted in a test without pinning a locale. So `formatDate` is locale-independent, exactly like `formatClockTime` already was and for the same stated reason. Day-month-year with a three-letter month is also the form that cannot be misread in either language this plugin is used in, unlike anything month-first. `formatSummaryTimestamp` now composes `formatDate` and `formatClockTime` instead of two locale calls, so the clock is 24-hour everywhere too; the history view's month headers use the same month table (`SEP 2026`). Note this makes the month abbreviations English in a German UI — accepted deliberately: these are mono metadata labels, alongside model badges and token counts, not prose.

**3. `Im Glossar öffnen` → `Öffnen →`.** The shared control from ADR-138; the specific wording survives as the tooltip and `aria-label`, so nothing is lost for a screen reader and the meta row stops wrapping onto a second line.

**4. Icons centre on cap height, not on `vertical-align: middle`.** The refresh icon sat visibly low. `middle` centres an inline box on baseline + half the **x-height**, but the text beside it in this row is caps and digits, whose visual centre is baseline + half the **cap height**. Measured in headless Chromium against the real stylesheet: the icon's centre sat 1.09px below the text's cap centre — small, and unmissable once seen at 11px. The fix is a nudge of (cap − x-height) / 2 ≈ 0.09em.

That constant was chosen by measurement, not arithmetic: two candidates were tested across a sans, a serif and a mono face, because a theme can change the font under this rule. The nudge holds within 0.11px in all three. The alternative — giving the button a cap-height box and baseline-aligning it — missed by 1.5–2px in every font, because an inline-flex whose only child is an `<svg>` has no baseline and falls back to its bottom margin edge. Applied to all three anchors, per ADR-138.

**Consequence:** the meta row reads as one line again. The rule worth keeping: **`vertical-align: middle` is centred on x-height, so it is wrong next to caps, digits or small-caps labels — which is most micro-labels.** +5 tests (743), all on the date formatters, which are only testable at all because they no longer depend on the runtime locale. Build, lint, file-size and tests green. Not runtime-verified in Obsidian.

---

### ADR-140 — The template is a reference, not a caption

**Status:** Active — supersedes ADR-129's placement of the template caption

**Context:** ADR-129 moved the template name out of the header and into the assistant turn label, `OPUS 5 · PODCAST SUMMARY · 02:44 · ↑3.300 ↓5.139`. That was right to remove it from the header and wrong about where it landed. The turn label is a row of *facts about the generation* — which model, when, how many tokens — all of them numbers or identifiers that belong to that one turn. A template is not that. It is a note in the vault, written by the user, that the answer was produced through.

Meanwhile the answer already has a place for "what this was made from": the sources row that web search introduced, which lists numbered web pages and `[[wikilinks]]` to vault notes. The template belonged there the whole time, and the user asked for it directly.

**Decision:** the template moves from the turn label to the sources row, as its own labelled line above the citations.

**1. First, always.** It is the frame the answer was written in, not one of the passages inside it — everything listed below it was read *through* it. Ordering it after the web sources would file it as one citation among seventeen.

**1a. The rows run from the user outwards: TEMPLATE → VAULT → WEB.** The template is theirs and framed the whole answer; the vault notes are their own knowledge, which they can open and correct; the web is the outside, and the only part that can rot, move, or mislead. Top-down therefore moves from what the reader owns to what they do not, which is also roughly the order in which they should trust it — and it puts the longest, most-wrapping row (seventeen web chips, in the reported case) at the bottom where its wrapping disturbs nothing above it.

This also removed a conditional: the vault row used to be relabelled `SOURCES` when no web row was present, so the same row read two different ways depending on what else happened to be on screen. It is now always `VAULT`. One label per row type.

**2. A wikilink, `[[Podcast Summary]]`.** Not a new affordance: vault citations in this same row are already rendered as `[[…]]`, and the two now share one `renderWikilink`. In Obsidian, `[[…]]` is what "a note you can open" looks like, which is exactly what the user asked for — the template is now openable, which as a label it never was.

**3. No number.** This is the one structural difference from a citation, and it carries meaning. The numbers in this row are citation indices that match the superscript chips in the prose; nothing in the answer cites its template, so a number would be an affordance pointing at nothing.

**Harmony between WEB and TEMPLATE** — the question the user actually asked — comes from making them the same component and letting only the meaningful differences show:

| | shared | differs |
|---|---|---|
| label | 9px mono, uppercase, `--text-faint`, **54px column** | the word |
| chip | 11.5px, accent, click-to-open | numbered + `↗` (web, leaves the app) vs `[[…]]` (vault, stays) |

The 54px label column is new and is the part that makes it read as one block: with three stacked rows, ragged labels would start their chips at three different x positions. ~~54px is the reference row's existing label width, so Pythia now has one label-column width rather than two~~ — **corrected in ADR-144: the reference row has no label.** `docs/design.md` and `CLAUDE.md` both described a `REFERENZ` label in a 54px column that `.p-ref-row` has never rendered, and this ADR leaned on that description without checking the DOM. The number is still right, for the surviving reason: it clears the widest label (`TEMPLATE`, measured at 49px) with room for a wider theme monospace. `min-width`, not `width`, so a long translation is never clipped.

**Which turns show it: unchanged.** `turnTemplateCaption` still decides — the first answer, and again wherever a second template takes over. That rule was ADR-129's good half, and it moves with the fact rather than being re-derived. A template applies to every answer under it, so listing it on every turn would be *truthful* and would also repeat a constant down the whole transcript, which is the noise ADR-129 removed in the first place.

**And it is removed from the turn label, not duplicated.** Two copies of one string on one turn is the worst of both placements.

**Alternatives rejected:** *Icons instead of the word labels* — considered and declined: see the table below for what the words cost and buy. *Keep the caption and add the row* — duplication. *Show the template on every assistant turn* — repeats a constant; the reader learns it once. *A distinct colour or icon for the template chip* — a third treatment to distinguish something the label already names, in a row whose whole job is to be quiet. *Order it last, after the citations* — files the frame as one of the contents.

**On replacing the labels with icons.** Asked directly, and the answer is no. Three reasons, in order of weight — the third of which, pairing with the reference row's label, is withdrawn by ADR-144: that label does not exist. The first two stand on their own. The labels name *kinds*, and the three kinds have no distinct conventional glyphs: `globe` reads as web, but a template and a vault note are both "a document", and at 11px `file-text` and `vault` are the same small rectangle — the reader would be learning a private mapping to save reading three short words once. The column is passive: it is read on first encounter and skipped forever after, unlike a toolbar icon that is aimed at and pressed, so the usual argument for icons (a target, repeatedly hit, in tight space) does not apply. And the words pair this row with the REFERENZ row above the composer, which uses a text label in the same 54px column — replacing one and not the other would break the harmony this ADR just established. The one real gain would be about 34px of width back for the chips, which at 17 web chips is worth roughly half a chip per line. If that trade is ever wanted, the shape is icon-only in a ~20px column with `aria-label` carrying the word — not icon *plus* text, which is redundant and wider than either.

**Consequence:** the template is now openable with one tap, sits with the other provenance instead of among the token counts, and the turn label is back to being facts about the generation. +14 tests (752), including the first coverage `ui/sourcesRow.ts` has had. Build, lint, file-size and tests green. Not runtime-verified in Obsidian.

---

### ADR-141 — Summaries: a contract the model can count, and a ceiling the display owns

**Status:** Active

**Context:** Reported from a merge anchor in the wild, three complaints about generated summaries: they vary wildly in length by model, some carry the instruction into the output, and some arrive as bullet lists inside a five-line inline card.

The instruction leakage is the interesting one, because the prompt already forbade it — or appeared to. It banned the *opening phrases*: "This conversation…", "The user…", "We discussed…". The reported summary opened "A German-language summary was generated and inserted at the top of the source note `_inbox/Unbenannt.md`" and closed "The summary was placed at the top of the note as requested." Both perfectly legal under a rule that only polices the first five words.

And the model was not misbehaving. That conversation's *content* was a task: read a podcast transcript, write a summary into a note. Asked to summarize the substance of a conversation whose substance was an action, a model reports the action. The old rule also asked for "important outputs", which actively invites it. The fix is to ban the act, not the phrasing, and to say what to do instead: if the conversation produced a document, summarize what the document **says**.

**Decision:** one shared `SUMMARY_RULES` block behind both `generateSummary` and `generateSummaryWithTitle` — which were carrying two drifting copies of the same instructions — plus a display ceiling that does not depend on the model complying.

**1. A length the model can count.** "Keep it brief and factual" is read very differently by different models, which is exactly what was reported. "At most five sentences and under 100 words" can be counted while writing; "brief" cannot. Five and not two because the summary is also read back as a fork's context (`PRIOR_SUMMARY_INSTRUCTION`) — it has to carry the topic, not just label it.

**2. Prose only.** No headings, lists, bold or code. The summary renders in three places, the smallest of which is an inline anchor a few lines tall; list structure is built for a page and inflates that card without adding meaning at this length. The favorites summary is deliberately exempt — it is a study aid whose structure is the point.

**3. The token cap is not the lever, and was left alone.** Cutting `maxTokens` from 1024 to something that forces brevity produces a truncated summary, not a short one — and on a reasoning model the same budget also pays for hidden reasoning, so a low cap can return nothing at all. The cap stays a safety valve; the sentence count is the contract.

**4. The display carries its own ceiling.** A prompt is a request. Beyond model compliance, every summary already stored in a conversation was written under the looser rules and will never be regenerated unless the user asks for it — so a prompt-only fix leaves the reported screens exactly as they are. `clampSummary` bounds the inline fork and merge anchors at five lines with a fade and a "mehr" control, and the control appears **only when the content really overflows**, measured after layout. A summary that fits shows no affordance, because there is nothing behind it.

Clamp-and-expand rather than a fixed-height scroll box: the summary bar at the top of a conversation does use internal scrolling, but it is sticky chrome. An inline block mid-transcript that swallows the page scroll is a worse thing on touch. The summary *card* needed nothing — it is collapsed by default, so its length is already opt-in; the anchor is always open, which is what made it the reported surface.

Measured in Chromium against the real stylesheet: the reported summary renders 7 lines unclamped and exactly 5 clamped.

**Alternatives rejected:** *Strip the meta-narration in post-processing* — a regex for "was generated and inserted", "as requested" and their translations, applied to model prose, in two languages; it would mangle a legitimate sentence eventually and leaves the cause in place. *Summarize the summary when it is too long* — a second model call to repair the first. *Let the anchor grow* — that is the reported bug. *Drop the summary from the anchor and show only the title* — the summary is the reason the anchor exists.

**Consequence:** new summaries are bounded and about the subject rather than the session; existing ones are bounded on screen whatever they say. The rule worth keeping: **a prompt rule that names phrasings will be obeyed literally and evaded structurally — ban the behaviour, and say what to do instead.** +6 tests (758). Build, lint, file-size and tests green. Not runtime-verified in Obsidian, and the prompt half cannot be verified here at all: only real generations across models will show whether the contract holds.

---

### ADR-142 — A link is a fork, stated in the other direction

**Status:** Active — supersedes the dashed treatment of ADR-130's anchor and banner, and narrows ADR-138's stroke rule

**Context:** ADR-130 built merge as the inverse of fork and then dressed it as a different thing: a dashed left rule on the anchor, a dashed rule on the banner, `git-merge` for an icon, and the label `VERKNÜPFT` / `MERGED`. The user's objection is that this contradicts what the feature is — "you yourself wrote it's same same but different to forking" — and they are right. A fork and a link are one relationship seen from two ends: a fork says *this passage continues over there*, a link says *this passage belongs with over there*. Nothing about that difference is worth a different card.

The dashed rule came from ADR-138's rule that the stroke pattern distinguishes the three anchor types. That was the right instinct applied one type too far: the glossary term genuinely is a different kind of thing (a definition, not a conversation), but fork and link are the same kind and should read as the same kind.

**Decision:** the link anchor and the merged-from banner ARE the fork anchor and the fork banner. Not "styled to match" — grouped into the same CSS rules, so there is no second copy to drift. Verified in Chromium against the real stylesheet: every compared computed property of the two anchors, and their rendered height, is identical.

Two deliberate exceptions, both requested:

**1. The unlink control stays in the meta line.** A link can be removed; a fork cannot be un-forked. That control is the one functional difference between the two cards, and it lives where a card's controls live.

**2. The header is the link icon and the word `VERKNÜPFUNG`.** The icon is `link` — the meta line's `unlink` control stated positively — rather than `git-merge`, which is a developer's metaphor for something the user calls a Verknüpfung. The label changes from the past participle `VERKNÜPFT` ("linked", describing a state) to the noun `VERKNÜPFUNG` ("link", naming the thing), because the header names what the card is, the way `ABZWEIGUNG` does. `mergedFromLabel` follows: "Verknüpfung von".

With the cards unified, the header icon and word are the *only* thing telling them apart on screen — which is exactly what a header row is for, and why the label had to stop being a state.

**What did NOT change: the mark in the text.** A merge link is still a dashed accent underline, a fork origin still an accent fill. This looks like an inconsistency and is the opposite: with the two anchors now identical, the mark is the only place the distinction survives *before* the reader taps. Making both an accent fill would mean the reader learns which kind of thing they opened only after opening it, and ADR-130's original objection stands too — two identical accent fills side by side in one paragraph are unreadable. One place to tell them apart is enough; zero is not.

**ADR-138's stroke rule is narrowed, not dropped.** Solid accent now means "a conversation" (fork or link); dotted faint-to-accent still means "a glossary term". The rule was one property carrying a three-way distinction, and it is now carrying the distinction that actually exists.

**Alternatives rejected:** *Keep the dashed rule, change only the label* — the dash was the loudest signal that these were different things. *Unify the marks too* — removes the last pre-tap signal, see above. *Make the merge anchor reuse the `.p-fork-anchor-*` class names outright* — tempting, and it would guarantee identity, but the class name is also how `MergeController` finds its own nodes, and renaming them for tidiness risks the controllers reaching into each other's DOM.

**Consequence:** 34 lines of duplicated CSS deleted, and the two features read as the pair they are. The rule worth keeping: **when two features are the same idea in opposite directions, the default is one component with a different label — a different visual treatment has to earn its place, and "so you can tell them apart" is already answered by the label.** No behaviour change; build, lint, file-size and 758 tests green. Not runtime-verified in Obsidian.

---

### ADR-143 — Choosing a conversation happens in the conversation panel

**Status:** Active

**Context:** Linking a passage opened a `ConversationSuggestModal` — a second, differently-shaped search over the same list of conversations, reachable from the same screen as the one ADR-107 had just made canonical. ADR-107's words were "the single in-view conversation-search surface", and ADR-130 added a second one three days later without noticing.

The user's framing is the correct one: the established search view should open and the selection should happen there. Two searches over one list is not a preference; it is the user having to learn twice, and having to notice which one they are in — the modal has no date grouping, no fork indentation, no related-conversations affordance, and a different keyboard model.

**Decision:** `openHistoryView(pick?)` takes an optional pick descriptor. Without it the panel behaves exactly as before: tap a row, switch to that conversation. With it, tapping a row closes the panel and hands the conversation to the caller instead. Search, ranking, snippets, date grouping and the keyboard model are the same code, because they are the same panel.

`cmdMergeConversation` now calls `view.pickConversation({ excludeId, placeholder, onPick })` and does its linking work in the callback. The modal is gone from that path.

**Three things change while picking, each because the panel's *purpose* changed:**

- **The delete control is hidden.** A trash icon one thumb-width from every row is the wrong thing to offer when the intent is "choose this one". Same for the long-press row menu, which is delete plus relate.
- **The source conversation is excluded.** A passage cannot be linked to the conversation it is in, and offering a row that will be refused is worse than not offering it.
- **The placeholder is the caller's.** "Mit Gespräch verknüpfen…" instead of the generic search prompt, so the panel says what it is being used for. It is the only signal that the same panel is in a different mode, which is why it is not optional.

**The modal stays where it is still right.** `cmdBrowseConversations` and the resume-conversation command are invoked from Obsidian's command palette, which can run with no Pythia view open at all. ADR-107's rule is about the *in-view* surface; a palette command is not in view, and a modal is the right shape there.

**A latent bug surfaced while testing this.** `this.historyCleanup = close` was assigned inside the panel's focus `setTimeout(…, 0)`, so for one tick after opening, the panel was open and the controller did not know it. A second open in that window stacked a second overlay rather than toggling. Unreachable by tapping, reachable by code — the picker can be opened from a selection toolbar while the panel is already up. The assignment moved to the synchronous path; Escape stays bound a tick late, which is what the timeout was actually for.

**Alternatives rejected:** *Keep the modal and restyle it to match* — two implementations of one thing, which this codebase has already watched drift twice (ADR-138, ADR-142). *A dedicated picker component* — a third surface to fix the problem of having two. *Reuse the panel but keep the delete controls* — consistency with browse mode, at the cost of putting a destructive control under a thumb that is aiming to select.

**Consequence:** one conversation search in the app, in one place, with one set of behaviours — and anything that needs the user to name a conversation from now on has a home rather than a reason to write another modal. Paid for structurally rather than in lines: the mount fixture moved to `tests/helpers/viewHarness.ts` and the conversation-panel describes to `tests/historyPanel.test.ts`, which drops `tests/viewRender.test.ts` from 650 lines to 331 and **removes the last grandfathered test-file ceiling** from the ADR-097 ratchet. +8 tests (766). Build, lint, file-size and tests green. Not runtime-verified in Obsidian.

---

### ADR-144 — Corrections: Pythia broke its own words, and a label that never existed

**Status:** Active — corrects ADR-131, ADR-135 and ADR-140

This ADR fixes one bug and withdraws two claims that three earlier records stated as fact. The bug and the false claims are the same story, which is why they are one record.

**1. Themes never broke the words. Pythia did.**

ADR-131 opened by explaining that Obsidian themes set `word-break: break-all` on table cells, and that this is what rendered `Messbarkeit` as `Messba / rkeit`. ADR-134 repeated it, and ADR-135 built a verification on it — the 2.10.1 screenshot proves "the selector beat the theme".

Measured in headless Chromium with **no theme loaded at all**, only Pythia's own stylesheet, at a width that cannot fit the word:

| cell | line boxes | inherited `word-break` |
|---|---|---|
| inside `.p-ai-body` | **2** — split | `break-word` |
| identical cell outside it | 1 — intact | `normal` |
| inside `.p-ai-body`, inside `.p-scroll-frame` | 1 — intact | `normal` (the ADR-131 fix) |

The culprit is `.p-ai-body { word-break: break-word }`, a Pythia rule, inherited into every cell of every table it renders. `word-break: break-word` is a deprecated alias that behaves like `overflow-wrap: anywhere`: it breaks inside a word *and* collapses the element's min-content width to one character — which is also what let the table shrink so far, the mechanical half of ADR-131's point that was always correct.

**The fix:** `overflow-wrap: break-word` on `.p-ai-body`, `.p-summary-card-md` and the user bubble. It keeps the property's only real job — a long URL must not overflow a 300px panel — while leaving ordinary words intact. Measured against the real stylesheet at 300px: `Messbarkeit` in a plain table cell goes from 2 line boxes to 1, and the long URL still wraps onto 2 lines without overflowing. This fixes mid-word breaking on **every** surface, including the ones `decorateTables` never wraps.

**Why it was believed for three ADRs.** The blame was plausible (themes really do set `break-all`), the harness *emulated a theme* and so could never have distinguished the two causes, and the fix worked — which retired the question before anyone asked whose rule was being overridden. A fix that works is the strongest reason a wrong diagnosis survives. The lesson: **when a fix overrides something, name what it overrides and check that the thing is there.** The check was one measurement without the theme.

ADR-135's finding-3 conclusion survives: the selector does reach the table, and the screenshot does prove it. What it never proved is *whose* declaration it beat — and the answer, an inherited value from an ancestor rather than a theme's competing rule on the same element, means the fix never depended on winning the ADR-065 specificity contest it was credited with winning.

**2. The reference row has no label.**

ADR-140 justified the sources row's 54px label column as "the reference row's existing label width", so Pythia would have one column width instead of two. `.p-ref-row` creates only `.p-pills`; there is no label element and there never has been. `CLAUDE.md` and `docs/design.md` both described a `REFERENZ` label at 54px — the 2026-09-10 locale audit even noted the discrepancy and left it — and ADR-140 read the spec instead of the DOM.

The number stays, for the reason that survives: 54px clears the widest real label (`TEMPLATE`, measured at 49px) with slack for a wider theme monospace. The spec is corrected to describe the row that exists, and ADR-140's third argument against icons — that the words pair this row with `REFERENZ` — is withdrawn. Its first two arguments do not depend on it.

**3. Two smaller fixes shipped with these.**

A glossary anchor credited its definition to `settings.defaultAnthropicModel`, but lookups run on the active provider's *fast* model — so on an OpenAI vault the note claimed an Anthropic model wrote it. The entry now records the model that actually answered (`model=` in the `%% pythia: … %%` marker, `LLMRouter.fastModelFor()`), and entries written before this fall back to the old guess rather than showing nothing. And the two long-standing lint warnings are gone: a stale `eslint-disable` and an unused `App` import.

**Consequence:** words are no longer split mid-word anywhere in Pythia, by Pythia. Three records now say what is true, with the correction visible rather than silently rewritten — a doc that quietly changes its story teaches nothing. +3 tests (769). Build, lint (zero warnings for the first time in this series), file-size and tests green. Not runtime-verified in Obsidian.

---

### ADR-145 — A hairline grid on rendered tables

**Status:** Active

**Context:** ADR-131/134 made a wide table scroll instead of squeezing, and ADR-144 stopped it splitting words. What was left was a readability problem the width fix created rather than solved: at a sidebar's width, one cell wraps to three lines while its neighbour wraps to one, and with no rules between columns the eye loses which line belongs to which column. Borderless tables read well at page width, where rows are one line tall; they stop reading well the moment rows are ragged.

**Decision:** a 1px grid in `--background-modifier-border` on every cell, `border-collapse: collapse` so adjacent cells share one rule rather than stacking two, an outer rule on the table, and `padding: 3px var(--s2)` so the text is not crowded against it. Horizontal padding is the generous half — rows are already tall when cells wrap, so vertical padding stays tight.

**A full grid, not row rules.** Row separators are the conventional quiet choice and are the right one for a page-width table, where the risk is losing your place along a long row. Here the risk is the other axis: a multi-line cell beside a single-line cell is a column-tracking problem, and only vertical rules answer it. The table also scrolls sideways, so a column can be half off-screen — a vertical rule is what tells you that you are looking at a partial column rather than a short value.

**The header gets a heavier bottom rule, not a fill.** `border-bottom-width: 2px` on `th`, same token. A tinted header row would read as a card inside the transcript, which hard rules 3 and 4 exist to prevent, and `--background-modifier-border` at 2px is enough to separate a header from three body rows.

**Alternatives rejected:** *Row rules only* — answers the wrong axis, see above. *A tinted header row* — a background where the design system allows none. *A second, lighter border token for the inner rules* — every colour here has to be an Obsidian variable, and the only quieter one (`--text-faint`) is a text colour, not a divider.

**Verification** (headless Chromium, 300px panel, against an emulated theme forcing `word-break: break-all`, since that is the harness these table ADRs have always used): cells render `1px solid` in the border token, the header's bottom rule is 2px, `border-collapse` is `collapse`, `Messbarkeit` still occupies exactly **one** line box, and the table is 407px inside a 300px frame — still scrollable. The border changes appearance only; every property the earlier table ADRs measured is unchanged.

**Consequence:** a dense table with ragged rows is readable at sidebar width. Costs: a few pixels of width per column from the padding, which the scroll frame absorbs, and one more place that must stay scoped under `.pythia-view` (ADR-065). No behaviour change, no new tests — this is CSS whose only assertion is the harness above. 769 tests still green.


---

### ADR-146 — The composer does not reserve a home indicator

**Status:** Active — reverses ADR-132/134's bottom-inset handling and hard rule 7

**Context:** The dead space below the composer has now been reported four times. ADR-132 blamed a height assignment, ADR-134 corrected that to `env(safe-area-inset-bottom)` and kept the inset behind a measurement, ADR-135 reviewed that measurement and fixed a staleness bug in it. The user has since tested several themes and reports that both the distance and the overflow are Pythia's own.

They are. Measured from the reported screenshot (1188×2576, DPR 3): the accent send button ends at device row 2135, and the panel's background runs to 2261 before the surface below it begins — **126 device px, 42 CSS px, below the send button**, where the design intends `--s2` = 8. The difference is 34px: exactly one iPhone home indicator. So ADR-134's conditional override is not firing on that device — the input area is still taking the full `env()` inset while another leaf sits below it.

**Decision:** stop reserving it. `.p-input-area` is `padding: var(--s2) var(--s3) var(--s1)` — 4px at the bottom, which is also the "reduce it further" the user asked for. `--p-bottom-inset`, `needsBottomSafeArea` and `BOTTOM_EDGE_TOLERANCE` are deleted with it, because they existed only to switch off a padding that no longer exists.

**Why delete the mechanism rather than debug it a third time.** The measurement is sound arithmetic — `containerBottom >= innerHeight - 4` really does describe "the panel reaches the screen edge" — and it has still produced a wrong answer on the only device that matters, twice, for reasons not observable from here. At that point the question is not "what is wrong with the measurement" but **"what is this measurement buying?"** The answer is: a home indicator is only under the composer when Pythia is the bottom-most thing on the screen, and on Obsidian mobile the app's own chrome sits between a sidebar leaf and the screen edge. The inset was insurance against a case that is rare, cheap to fix if it ever appears (one line), and currently costing 34px on every screen.

Two attempts at conditional logic is the signal to ask whether the condition is worth having.

**What stays.** `env(safe-area-inset-bottom)` remains on `.pythia-modal` and the mobile action sheet. Those are full-screen overlays that genuinely touch the screen edge, where the inset does what it claims. The keyboard-overlap half of `keyboardInset.ts` also stays untouched — that one was never in doubt, and it is a different problem: content hidden *behind* a keyboard, not space reserved for nothing.

**Verification:** the harness substitutes 34px for `env(safe-area-inset-bottom)` before measuring, because Chromium reports 0 and would otherwise pass for the wrong reason (the habit ADR-135 established). Result: `padding-bottom: 4px`, 4px between the send button and the input area's bottom edge, and **0px between the input area and the panel's bottom edge** — so the panel now ends where its content ends. 42 → 4.

**Consequence:** ~38px of screen returned on every phone, and one fewer runtime measurement driving a style. The risk, stated plainly: if a Pythia leaf ever *is* the bottom-most thing on a phone, the send button sits 4px above the home indicator instead of clear of it. That is the trade the reporter asked for, having tested it on the device; restoring it is one declaration. **The rule worth keeping: `env()` describes the device, not the element — it cannot tell you whether *this* element is the one at the edge, and any code that tries to bridge that gap is guessing at a fact the layout already knows.** −4 tests (765, with `needsBottomSafeArea`'s suite deleted). Build, lint, file-size and tests green. Not runtime-verified in Obsidian.

---

### ADR-147 — The panel was inset from its own leaf

**Status:** Superseded in mechanism by ADR-167 — the inset was Obsidian's padding on `.view-content`, not on the leaf container; this rule is kept, and ADR-167 adds the one that works. Active — explains, and corrects the reasoning of, ADR-132, ADR-134, ADR-135 and ADR-146. **Its own mechanism was not the one either:** the inset was Obsidian's padding on `.view-content`, not on the leaf container — measured in the app in ADR-165, which keeps this rule and adds the one that works.

**Context:** Five attempts at the dead space below the composer, four of them shipped, none of them fixing it. Each looked at padding *inside* the panel — a height assignment, `env(safe-area-inset-bottom)`, a stale measurement of it, and finally removing it outright.

The user then reported something none of the previous reports contained: **the conversation panel (`der Verlauf`) leaves a small gap on the left and on the right too.**

That single observation falsifies every previous diagnosis at once. `.p-history` is `position: absolute; inset: 0` on `.pythia-view`, so it covers the panel exactly — which makes it an outline of the panel's true edges. And **no padding inside the composer can produce a gap on the left.** The panel was never the wrong size at the bottom; it was inset on three sides, and only the bottom strip was big enough to notice.

**Decision:** neutralize the inset on our own leaf container.

```css
.workspace-leaf-content[data-type="pythia"] { padding: 0; }
.pythia-view { padding: 0; }
```

Scoped by `data-type`, which Obsidian sets from `PYTHIA_VIEW_TYPE`, so no other plugin's leaf is affected.

**Verification** (headless Chromium, against a leaf container carrying `padding: 6px 8px 34px`, the shape the symptom describes): without the rule, the panel and the history overlay are both inset **8px left, 8px right, 34px bottom**; with it, both are flush on all four sides. The harness is checked in the failing direction first, so it cannot pass for the wrong reason.

**What this says about the previous four.** The arithmetic that made `env(safe-area-inset-bottom)` so convincing — 42px measured, 8px intended, difference 34, "exactly one home indicator" — was numerology. 34 is also a perfectly ordinary bottom padding, and the same number arrived by a different route. **A number that matches a hypothesis is not evidence for it when a second mechanism produces the same number**, and that is precisely the trap a measured-looking 34 walked me into.

ADR-146's change is kept: taking the composer's own bottom padding from 8 to 4 was asked for and is still right. Its *explanation* is withdrawn. Together the two changes take the strip from ~42px to ~4px, but they were never the same 34px.

**The method failure is the thing to keep.** Four diagnoses were wrong because every one of them was made from a screenshot that showed only the bottom edge. The decisive fact — that the left and right edges were inset too — was not in any of them, could not be inferred from them, and took one sentence from the person holding the device to supply. **When a fix fails twice, the next move is not a better guess at the same evidence; it is to go and get different evidence.** Asking "does anything else look inset?" would have ended this after the first failure.

**Consequence:** the panel fills its leaf. The bottom strip goes, and so do the side strips nobody had reported. Not runtime-verified in Obsidian, and stated plainly: what is verified is the *mechanism* — a leaf-container inset produces exactly this symptom on exactly these three sides, and this rule removes it. Obsidian's real padding values on the device are not known from here, so if any strip survives this, it is not the leaf container and I will instrument rather than guess again. 765 tests, build, lint and file-size green.

---

### ADR-148 — One language setting, resolved per conversation

**Status:** Active — supersedes the `outputLanguage` setting shipped with ADR-053 (auto / en / de)

**Context:** `outputLanguage` existed, defaulted to `auto`, offered English and German, and reached exactly one half of what Pythia writes: the utility prompts (summary, title, chapter name, glossary definition, favorites synthesis, note summary). The chat answer — the part the user actually reads — was never instructed at all. So a user could set German, watch every summary come back in German, ask a question in English, and get an English answer. The setting looked global and was not.

The request was for a "Sprache" dropdown with six options (Obsidian's language, the conversation's language, German, English, Italian, Spanish), defaulting to the conversation's language — which is what `auto` already did.

**Decision:**

**One setting, both halves.** `outputLanguage` now also feeds `buildSystemPrompt`, so a fixed language governs the chat answer as well as every utility call. This is the substance of the change; adding Italian and Spanish was two lines.

**A global default with a per-conversation override.** The global setting lives in the settings tab; `Conversation.outputLanguage` overrides it and is edited in the conversation settings modal, next to the model, temperature and effort overrides it now sits alongside. `undefined` means inherit — a distinct value, not the global's current value copied in, so a conversation that inherits keeps inheriting when the global setting changes later. Resolution is one method, `BaseProvider.languageLabel(conversation?)`, and every prompt in the class goes through it.

**Two of the six values are resolved rather than named.** `auto` resolves to the empty string, which adds *no instruction at all* — the absence is the feature. Saying "respond in the conversation's language" out loud is weaker than saying nothing, because a model with no language instruction already follows the conversation, whereas one holding a sentence about languages has something to reason about. `obsidian` resolves through Obsidian's UI locale, and follows it into any of the ~30 languages Obsidian ships, not just the four offered explicitly: a French Obsidian gets French. An unrecognizable locale falls back to English, not to `auto` — the user asked for a fixed language and silence would not give them one.

**Two instruction shapes, not one.** Utility prompts keep the one-line `langInstruction` ("Respond in Italian."). The system prompt gets `langDirective`, which is longer on purpose: a utility call produces one line from one instruction, whereas a chat answer has to hold its language across many turns against a user typing in another one. Naming that conflict — "even when the user writes to you in another language" — is what stops the model drifting back to the language of the question.

**What the setting does NOT touch.** The prompt optimizer. It rewrites the user's own prompt, and rewriting a German prompt into Italian would destroy the thing it was asked to improve. The optimizer works in the language it is given; that is correct and deliberate.

**Alternatives rejected.** *Per-conversation only* — the setting is a standing preference for most users, and making them set it per conversation is the wrong default even if the override is the more precise control. *Global only* — a bilingual vault has conversations in both languages, and one global switch makes the user choose which half to get wrong. *Clamping `obsidian` to the four listed languages* — it would hand a French user English answers while the dropdown says it follows Obsidian.

**Threading.** Four utility methods (`defineTerm`, `generateChapterName`, `generateConversationTitle`, `summarizeNotes`) had no conversation in reach; each gained an optional trailing `conversation?` parameter, mirrored on `LLMProvider` and `LLMRouter`, and every call site that has one now passes it. A glossary lookup still runs on the default provider's fast model — only the language rides along, not the provider choice.

**Consequence:** the setting now means what its name says. `langInstruction`/`langSuffix` changed signature — they take the *resolved label*, not the setting code, so there is one place that knows how a setting becomes a language. +16 tests (781 across 52 files), with the language suite split into `tests/outputLanguage.test.ts` because `messageUtils.test.ts` hit its 600-line budget. Build, lint, file-size and tests green. Not runtime-verified in Obsidian.

---

### ADR-149 — The glossary note is the interchange format

**Status:** Active — extends ADR-136/137; narrows `aliases` and moves it out of the provenance comment

**Context:** The question that started this was "are there standards for glossaries?", and the reason behind it was the opposite of a feature request: the user wants terms captured in Pythia and *drilled somewhere else* — browsed flashcard-style to learn the definitions met while reading. Not built here.

That reframes what the glossary note is for. Pythia's unique contribution is capture: it is inside the conversation, it holds the passage, it can ask the model. Browsing, testing and scheduling are solved problems with mature tools, and rebuilding them inside a 300px sidebar is the expensive mistake. **The note is therefore not a private store; it is the integration surface.**

Three findings followed.

**Only half of this has standards.** Terminology *content* is well standardized — SKOS (W3C) for the concept/label model, ISO 12620 for data-category names, ISO 704 for what makes a definition a definition, TBX (ISO 30042) for termbase interchange. Flashcard *drilling* has no standard at all; there is only de-facto tooling. So "use a standard" buys a clean, portable data model and does not buy a review app — those are separate decisions, and only the first one is ours.

**A field in a comment does not exist.** `aliases` lived inside `%% pythia: … %%`. That is an Obsidian comment, invisible to every external reader — so the moment the note has to be read by another tool, every field stored there is simply missing. This was invisible while Pythia was the only reader.

**The flat alias list could not name a language.** "Zählern" (an inflection) and "counter" (a translation) sat in one list with nothing to tell them apart. Tolerable while the vault was effectively bilingual; wrong as of ADR-148, which shipped six output languages — an Italian answer could file `contatore` against a German entry with no record of which language it belonged to.

**Decision:**

**Split the note by audience, not by tidiness.** Everything a reader needs — definition, `Forms:`, `Translations:`, `Context:` — is visible markdown. Only provenance (`source`, `updatedAt`, `model`) stays in the comment, because it is machine state rather than content. The `## Term` heading already provides the question/answer boundary, so no specific tool has to be chosen now: adapting to one later is a mechanical transform, not a re-modelling.

**`aliases` becomes same-language only; `translations` is language-tagged.** This is SKOS's distinction — an `altLabel` is same-language, and a label in another language differs by its language tag, not by being a different concept. Both are registered in the term index, so an Italian answer still marks "contatore" and opens the entry filed under "Zähler".

**`context` is new: one verbatim sentence from the passage.** ISO 12620 calls this an attested *context*. `defineTerm` is deliberately prompted for "the sense that applies here", which makes every definition depend on a passage the entry did not keep — so an entry read anywhere but next to its originating answer was quietly decontextualized. One sentence fixes that and costs one field.

**ISO 704's rules go into the prompt.** Name the broader category and what distinguishes the term within it; be substitutable for the term in a sentence; never define a term with itself; never open with "is when". Away from its passage, a circular or "is when" definition says nothing — and away from its passage is now the normal case.

**Labels are English in every vault.** `Forms:`, `Translations:`, `Context:` are keys, not prose: an external reader has to find them without per-vault configuration, which a localized label cannot offer. Stated as a deliberate cost, not an oversight.

**Alternatives rejected.** *TBX or SKOS/RDF as the storage format* — both destroy every property ADR-136 chose a markdown note for: a user cannot hand-correct XML, the file stops reading correctly with no plugin installed, and `[[Glossary#Term]]` stops resolving. TBX also serves CAT tools, which is not this use case. *Committing to one flashcard tool's syntax now* — the tool is undecided, and the fields are the part that would have to be right either way. *Building a reviewer and a scheduler* — explicitly not wanted, and the reason the standards question was asked.

**Compatibility.** The parser reads both shapes: legacy `aliases=` in the comment still loads, so a glossary written by an earlier build keeps marking its variants. Entries are upgraded lazily when re-defined; nothing is rewritten wholesale, per ADR-136's rule that the file is hand-edited between writes. Three characters are stripped from visible values — the `·` and `|` separators, and `%`, because a stray `%%` in the body would open a comment and swallow the rest of the note.

**What was deliberately not touched.** The inline glossary anchor still shows the definition alone. Context is redundant there (the passage is on screen), and the anchor is a lookup surface, not a study surface.

**Consequence:** the glossary note can be read by something other than Pythia, which is the whole point. +16 tests (797 across 52 files). Build, lint, file-size and tests green. Not runtime-verified in Obsidian — and the note format change in particular deserves a look at a real glossary before trusting it.

---

### ADR-150 — One note per term; the glossary folder is the database

**Status:** Active — supersedes ADR-136's storage choice and most of ADR-149's note format. Storage and themes only; person entities follow in ADR-151

**Context:** The requirement that broke the old storage was "browse the definitions I met, grouped by theme, and let authors enrich them". Verified against the documentation rather than assumed:

- Obsidian **Bases** is a core plugin, and **"each row is a file, and each column is a property of that file"**. Views: table, list, cards, kanban, map.
- **Dataview** inline fields (`Key:: Value`, bold keys supported, formatting stripped at index time) attach to the **page**. There is no per-heading scope; list items are indexed individually, headings are not.

So a single glossary note with `## Term` headings can never produce a per-term row, in either tool. **A theme-filtered deck is a per-term view**, which makes one note per term not a preference but the precondition for the feature. ADR-149's careful visible-label format was solving the wrong half: it made fields visible to a reader, but left every term invisible as a *row*.

**Decision:**

**One note per term**, in `<root>/Terms/`, with the data as frontmatter properties and the definition as the body. Theme notes live in `<root>/Themes/`.

**Properties, not our own labels.** `aliases` is Obsidian's **native** property, so search, autocomplete and linking work with no code of ours. Translations are flat keys (`term_en`, `term_it`) because Obsidian properties have no object type and a flat key becomes a Base column, which a list of `"en: counter"` strings cannot; the set is finite — the six languages of ADR-148. `theme` holds `[[links]]`, so the theme note gets backlinks for free.

**Contexts became plural.** One note per term means a term met in three conversations is one entry with three attestations. They are blockquotes in the body rather than a property: prose, unbounded in number, and useless as a Base column.

**The theme note is the deck, not a pointer to one.** It carries an embedded base filtered to itself (`theme.contains(this.file.link)`), so opening it *is* browsing that deck — a Cards view. Written once and never rewritten: the user owns it afterwards.

**`Conversation.theme === undefined` means "follow the conversation name"** — not a copy of the name. The distinction is the whole feature: a conversation that is following gets its theme renamed when the LLM titles it after the first exchange, while a pinned theme does not. `effectiveTheme()` resolves it in one place; the settings field writes `undefined` for an empty input, never the name.

**A fork inherits a resolved theme.** Copying `theme` verbatim would hand a fork `undefined`, and the fork would then follow its *own* name — inheriting nothing. So the fork is pinned to the source's effective theme, which is also what makes "inherited, but changeable" true.

**Renaming is centralized.** `ConversationService.renameConversation` is now the only path that changes a conversation's name, because the old name is needed *before* the assignment and four call sites were each doing it themselves. The theme note is moved with `fileManager.renameFile`, which is the call that rewrites the `[[links]]` in every term note — `vault.rename` would not.

**Merge, never overwrite.** A re-lookup adds themes and contexts to the existing note and keeps a `manual` definition as written; only the anchor's explicit regenerate replaces it. This is what makes a term met in several conversations one note, and what makes multi-author enrichment mostly conflict-free — two people editing different terms edit different files.

**What this deletes.** `renderEntry` and `upsertGlossaryEntry` are gone: we no longer write that format, and a writer for a format nothing writes is how two formats quietly drift apart. `parseGlossary` survives as the migration's reader, and its tests were rewritten against a **literal** 2.13.x fixture rather than a re-implemented renderer — a fixture generated by our own code could drift with it and still pass. Reading is now Obsidian's job: `all()` takes frontmatter from `metadataCache` and reads **no file at all**; the body is read for the one term whose anchor is opened (`hydrate`).

**Migration is a button, not a startup step.** Non-destructive, idempotent, and it leaves the old note untouched — the only way a user learns it worked is by looking, so it has to be safe to run twice.

**Alternatives rejected.** *List item per term in one note* — Dataview indexes list items, but Bases does not (row = file), so it would forfeit the core-plugin route and give up `## Term` headings, which are why `[[Glossary#Term]]` links worked. *Note per theme containing its terms* — reintroduces exactly the constraint being fixed, and a term can only be in one deck. *Keeping ADR-149's labels* — they make fields visible to a human reader and a term invisible to every query surface.

**Costs, stated plainly.** This reverses ADR-136's single-note decision and makes ADR-149's label format legacy one day after shipping it — the aliases/translations split, the context field and the ISO 704 prompt rules from that ADR survive; the storage does not. Homonyms are now worse than they were: two senses of one spelling need two note titles, and no disambiguation convention is implemented yet. Vault clutter is real, confined to one folder. `settings.ts` paid the ADR-097 ratchet with a `ui/glossarySettings.ts` extraction.

**Consequence:** a theme-filtered deck is a saved filter the user makes in a core plugin, and Pythia builds no browse UI, no scheduler and no export. +34 tests (823 across 53 files). Build, lint, file-size and tests green. **Not runtime-verified in Obsidian** — and this one writes into the vault, so the migration deserves a look at a real glossary before it is trusted.

---

### ADR-151 — People are glossary entries

**Status:** Active — extends ADR-150. The person-lookup resolution policy was chosen by the user with the risk stated; see "The decision that was not mine"

**Context:** The request was "a user highlights a name, and in future conversations that person is highlighted with info about them and the notes stored in Obsidian." Read plainly, that is ADR-136 with a different noun. Mark every occurrence, open an anchor, resolve vault-first — none of that is about terminology; it is about **entities**, and terms were simply the first kind.

**Decision: one mechanism, two kinds.** `GlossaryEntry.kind` is `"term" | "person"` (undefined reads as term, so every existing entry keeps its meaning). People are notes in `<root>/People/` with `type: person`, which is what a Base filters on. Everything else is shared: the folder format, the merge rule, the theme property, the anchor, and — importantly — **one term index**. People and terms are matched in a single alternation, because two passes over every text node of every message is precisely the cost that index exists to avoid.

**What differs, and only this.** Where an entry is filed; how it is resolved; and how the mark is drawn. A person mark is a **solid** faint underline where a term is dotted — the mark is the only signal of what a tap will open, so it has to differ; solid goes to the person because a name is the rarer of the two on a page and can afford the heavier stroke. The anchor is literally `.p-term-anchor` plus a modifier that changes the left rule to `double`, continuing the series (solid fork, dashed merge, dotted term, double person). Not a second set of rules — ADR-142 recorded what happens when a near-twin gets its own copy.

**The prompt is where a person genuinely differs.** `defineTerm` asks the model to explain a term as used in the passage. `describePerson` asks it to say what the *passage establishes* and to add outside knowledge only if confident it is the same person — and, explicitly, to say it does not know rather than guess. A term the model has never met is rare; a person it has never met is the normal case in a working vault, where the names are colleagues, clients and counterparties. A model that leads with recall writes a plausible biography for a stranger.

**The decision that was not mine.** I recommended vault-only for people, with no model tier: a named private individual is personal data, and a confidently invented biography is indistinguishable from a recorded one to whoever reads the note next. The user chose vault-first-then-model-knowledge with that risk stated, and that is their call. What I built in as a consequence: the model tier is the fallback rather than the source, the prompt is instructed to decline rather than guess, and every generated entry carries `source: model` **visibly** in the note — so the distinction between recorded and generated survives into the artifact, which is where someone will eventually act on it.

**Alternatives rejected.** *A separate PersonService with its own index and marks* — two implementations of mark-anchor-resolve, drifting from the first day, for a difference that is three fields wide. *Storing people on the conversation* — the same reason ADR-136 refused it for terms: a person met once should be known everywhere afterwards, including in conversations that do not exist yet. *A `person` subtype of the term prompt* — the instruction that matters ("say you do not know") is specific to people, and burying it in a shared prompt would make it easy to lose.

**What this deletes.** The duplicated selection rule. Define and Person accept the same shape of selection — a short span in assistant content, the whole message as its passage — and that was written twice within an hour of people existing. It is now `ui/entitySelection.ts`, pure enough to unit-test, which paid the ADR-097 budget `SelectionController` had just broken.

**Consequence:** a name highlighted once is marked in every conversation, its note carries theme links like any term, and a Base filtered `type == "person"` is a people directory the user builds themselves. +16 tests (839 across 54 files). Build, lint, file-size and tests green. **Not runtime-verified in Obsidian**, and the person prompt's refusal behaviour in particular is the thing to check first on a real name the model cannot know.

---

### ADR-152 — Two regressions in the conversation panel's search row

**Status:** Active — corrects ADR-107's auto-focus on mobile and restores the clear control ADR-108's reset removed

**Context:** Two reports about the same row.

**1. The clear (✕) is gone.** I could not find one in this panel's history, so it was most likely never ours: WebKit draws a clear button on a search field for free, and `.pythia-view input { -webkit-appearance: none }` — ADR-108's reset, which stops Obsidian's form-field fill from greying our inline inputs — removes it. Either way the fix is the same, and it is not a workaround: a native clear button is WebKit-only and effectively unstyleable, so unpicking a reset that exists for a good reason to get one back would be the worse trade. **The control belongs to us.**

**2. Auto-focus makes the bottom of the list unreachable on iOS.** ADR-107 opens the panel with the search input focused. On a phone that raises the on-screen keyboard immediately, and the keyboard **overlays** the webview rather than resizing it — so the panel keeps its full height and its last rows sit underneath. The last conversations cannot be tapped.

The panel already had a fix for this (`d3b3665`, "keep the last conversations reachable above the keyboard"), and the fix was a **hand-rolled copy** of arithmetic that already existed, tested, in `ui/keyboardInset.ts`. The copy lost the part that mattered: `MIN_KEYBOARD_INSET`. Without that floor, Obsidian's own bottom chrome measures as an obstruction, so the list was padded *at rest* as well — which does not help reach the last rows and costs a strip of the list on every open.

**Decision:**

**Add an explicit clear button**, hidden until the field has content so the row is a plain loupe + field at rest. `mousedown` is prevented so the button does not steal focus from the input — on a phone that would dismiss the keyboard the user is still typing on — and the clear happens on click. Re-focus only if the input already had focus: tapping ✕ with the keyboard up should keep it up, and must not raise one that was down.

**Do not auto-focus on mobile.** Auto-focus is a *keyboard* affordance: you open the switcher and type. On a touch device it covers the bottom of the very list the panel exists to show, to solve a problem — reaching the keyboard — that the user has not got. The panel now opens showing conversations, and the keyboard arrives when the user taps the field. Desktop is unchanged.

**Use the shared `keyboardOverlap` / `watchViewport`** instead of the local copy. The duplicated arithmetic is deleted.

**Why the inset fix is kept as well as the focus fix.** The keyboard can still be open — the user tapped the field and is searching — and the last rows must be reachable then too. The focus change removes the *unbidden* keyboard; the inset handles the wanted one. Fixing only one of them leaves a real case broken.

**Verification:** the mobile test was checked in the failing direction first — with `Platform.isMobile` honoured it passes, with the guard removed it fails — so it cannot pass because `activeElement` happened to be something else. The clear-control tests assert the hidden→visible transition and that clearing restores the full browse list, not just an empty field.

**Consequence:** a phone user opening the panel sees conversations rather than half a list and a keyboard, and a search can be cleared without selecting and deleting text. One copy of the keyboard arithmetic instead of two. +3 tests (842 across 54 files). Build, lint, file-size and tests green. **Not runtime-verified on iOS** — which is where both reports came from, so both deserve a look on the device.

---

### ADR-153 — Run-in labels in the sources row; no wikilink brackets

**Status:** Active — supersedes ADR-140's label column and its bracketed vault references

**Context:** A screenshot of a research answer with nineteen web citations. The `WEB` row wraps to five lines, and **only the first one starts at the label column** — every wrapped line begins at the container edge. The column ADR-140 introduced is doing nothing on four lines out of five while charging 54px for all of them.

The cause is not a tuning problem, and it was always going to happen: `.p-sources-row` is `display: flex; flex-wrap: wrap`, and **a wrapped flex line starts at the container edge, not under the first item.** There is no hanging indent in flex wrapping. The 54px could therefore only ever align each row's first line — which looked correct in every two-or-three-citation case it was designed against, and fell apart the first time a row wrapped.

ADR-144 already corrected one false claim about this column (that 54px was borrowed from the reference row, which has no label at all). The remaining claim — that the column makes stacked rows start at one x — is false too, for rows long enough to matter.

**Decision:**

**A run-in `Label:` instead of a column.** `Web: alleninstitute.org ↗ …`. The label joins the flow ahead of the first entry, so there is no alignment to fail to hold, and 54px of a ~300px sidebar comes back on every line. Title case with a colon rather than the old spaced uppercase: a colon is what makes a run-in read as a prefix rather than a heading, and the colon is added in code so a translator cannot drop it.

**No `[[ ]]` brackets on vault and template references.** ADR-140 drew them because `[[…]]` is what "a note you can open" looks like in Obsidian. That was sound when the row had nothing else to say what a name was — but the run-in label now says it out loud, so the brackets repeat a fact already stated and spend four characters doing it on the row that just ran out of width. The affordance survives where it already lived: accent colour plus a hover underline, the same as every other openable reference in the panel.

**The row's one remaining distinction is the `↗`.** A web entry is `example.com ↗`; a note is a bare accent-coloured name. That is enough, because the label has already declared which kind of row this is.

**What is unchanged.** The row order (template → vault → web, from the reader outwards), one label per row type unconditionally (ADR-144), the template carrying no citation number, and the numbers on everything that has one.

**Not changed elsewhere: the context inspector keeps its brackets.** Its note list has no label at all, so there the brackets are the only thing marking a name as a note. The two surfaces look different now, and that is the point — one of them says "Vault:" and the other does not.

**Alternatives rejected.** *A hanging indent* — `display: flex` cannot produce one; it would mean rebuilding the row as text flow with `text-indent`, to align something the label already identifies. *Icons instead of words* — ADR-140 rejected this and was right: at 11px a template and a note have no distinct glyph, and the reporter says the same. *Keeping the column and shrinking it* — the column's problem is that it does not apply to wrapped lines, which no width fixes.

**Consequence:** a nineteen-citation row reads as prose and fits the sidebar. +4 tests (846 across 54 files). Build, lint, file-size and tests green. **Not runtime-verified in Obsidian** — the report was a screenshot from a phone, and that is where the fix should be looked at.

---

### ADR-154 — The on-accent label is pure black or white, and says so twice

**Status:** Active — narrows ADR-130's accent-contrast pick; `readableOnAccent` itself is unchanged

**Context:** The Send button rendered a dark label on the accent fill — the primary action of the plugin, hard to read, on a phone.

The machinery for this already existed and was correctly wired: `applyAccentContrast` publishes `--p-on-accent` on `.pythia-view`, from `buildUI` and again on every `css-change`, and all four accent-filled surfaces consume it. So the question was not "why is there no mechanism" but **"why does a working mechanism produce a dark label"** — and there turned out to be two candidate answers, neither of which can be ruled out from here, and both of which are worth closing.

**The value it publishes.** `readableOnAccent` was offered the theme's `--text-on-accent` and `--text-on-accent-inverted` as candidates and kept the better one *whenever it cleared AA*, to respect a theme that deliberately tints its on-accent label. But black and white are the two highest-contrast choices that exist against any colour — **no theme token can beat both** — so deferring to a token can only ever lower contrast, and a token sitting just over 4.5 is still hard work at 10px mono. Respecting a theme's taste is not worth an unreadable primary action.

**The property that actually paints.** These buttons are `all: unset`. `all` resolves every property, including `-webkit-text-fill-color`, and that property is *inherited* — so `unset` makes it `inherit`, and the label inherits the surrounding `--text-normal`. **WebKit reads `-webkit-text-fill-color` in preference to `color`**, so on WebKit the `color:` line never gets a say, no matter what `--p-on-accent` holds. This is the mechanism that best explains a dark label under a correct value, and it is invisible on any engine that does not implement the property.

**Decision:** fix both.

**`applyAccentContrast` calls `readableOnAccent(accent, [])`** — the empty-token path the function already documented and supported. `--p-on-accent` is now always `#ffffff` or `#000000`, chosen by WCAG contrast against the resolved accent. `readableOnAccent` keeps its token handling: it is a general function with its own tests, and this is a decision about which caller asks for what.

**Every rule that sets `color: var(--p-on-accent, …)` restates it as `-webkit-text-fill-color`.** Four rules — Send, active toolbar button (and its hover), active effort segment. This is the only way to win on WebKit given `all: unset`, and it is a no-op everywhere else.

**Honesty about what is verified.** The contrast change is unit-tested and provably correct: the tests assert pure values across five accents including the reported indigo, and that the chosen one clears AA in each. The `-webkit-text-fill-color` change is **reasoned, not reproduced** — there is no iOS WebKit here to measure, and the CSS cascade rule it relies on is documented behaviour rather than something I observed failing. If the label is still dark after this, the value is not the cause and the fill property is not the cause, and the next step is to read the computed style on the device rather than add a third guess.

**Alternatives rejected.** *Dropping `all: unset` from `.p-send`* — it is what keeps Obsidian's `button` chrome off our controls, and removing it trades one theme bug for several. *Hardcoding white* — wrong on a pale or yellow accent, which is the case the whole helper exists for. *Raising the AA threshold instead of dropping tokens* — a higher bar still lets a mid-grey through on some accent, and black/white always beat it anyway.

**Consequence:** the primary action is legible on any accent a user can pick, and stops depending on a theme's opinion. +7 tests (853 across 54 files). Build, lint, file-size and tests green. **Not runtime-verified on iOS**, which is where it was reported.

---

### ADR-155 — A segmented control's fill is state, not decoration

**Status:** Active — fixes the effort segment's selection on touch; refines ADR-108's segment styling

**Context:** Selecting an effort level leaves the segment grey; it only turns accent after the sheet is scrolled. Reported against a build where ADR-108 had already "fixed" this control once.

Two mechanisms in the same eleven lines, and the scroll is what identifies which kind of bug this is: **a cascade error cannot be fixed by scrolling.** Scrolling does not change specificity or class state — it forces a composite. So whatever else is wrong, the class is already correct at the moment of the tap and the pixel is not.

**1. The fill was transitioned.** `.p-effort-seg-btn` carried `transition: background-color 0.1s, color 0.1s`. On iOS WebKit a `background-color` transition kicked off by a class toggle inside a touch handler may not paint until the next composite — which a scroll provides, exactly as reported. The control also sits inside `.p-effort-seg`, which is `overflow: hidden` with a `border-radius`: a rounded clip is a known aggravator for exactly this class of deferred background invalidation.

**2. `:hover` was unconditional.** iOS keeps `:hover` applied to the last-tapped element until something else is touched. The hover fill is `--background-modifier-hover` — a grey that, sitting next to the real accent selection, reads as "selected". That is a second grey on the same control, arriving from a different direction, on precisely the element the user just pressed.

**Decision:**

**Remove the transition.** A segmented control's fill answers "which one did I just pick". It has to be true at the moment of the tap, not 100ms later and not at the next composite. `color` goes with it, so the label and the fill can never disagree mid-flight — which is how this presented after ADR-154 set `-webkit-text-fill-color` (not a transitioned property): the label flipped to white instantly while the background lagged, so the selected segment read white-on-grey. ADR-154 did not cause the repaint bug; it changed what the bug looks like, from "nothing happened" to "unreadable". 0.1s was imperceptible either way, so nothing is lost.

**Gate `:hover` behind `@media (hover: hover)`.** The codebase already draws this line twice — the model popover's detail row (`hover: hover`) and the code-block/diagram copy buttons (`hover: none`). The segmented control should have been on the same side of it from the start.

**Why not a JS repaint nudge.** Reading `offsetHeight` after the class toggle would force a synchronous layout and probably work. It is also a guess stacked on a guess, invisible to the next reader, and it treats the symptom of a transition this control should not have had. If the two CSS changes do not fix it, the next step is to read the computed style on the device — not to add a third mechanism.

**Verification, stated plainly.** The JS is correct and was verified by reading: `paintEffort` calls `toggleClass("active", on)` and sets `aria-pressed` synchronously on click, for every button, so the state is right before any paint. The two changes are CSS and **not runtime-verified** — no unit test can observe an iOS composite, and there is no iOS here. What is verified is that the cascade now has only one source of grey on this control, and that nothing about the fill is deferred.

**Consequence:** the selected segment is accent the instant it is tapped. No test delta (853 across 54 files). Build, lint, file-size and tests green.

---

### ADR-156 — The glossary anchor goes where the fork anchor goes

**Status:** Active — corrects ADR-136's anchor placement

**Context:** Reported plainly: the glossary card is the same pattern as the fork card, but it appears at the end of the paragraph containing the term rather than immediately after the term. The code agrees — `ForkController` and `MergeController` both call `lastMark.after(anchor)`; `GlossaryController` called `block.after(anchor)`, resolving `block` with `markEl.closest("p, li, td, th, div")`.

That was deliberate, and the reasoning was written down: a term sits mid-sentence, and splicing a block element into a sentence reflows the text around it, whereas fork and merge marks are deliberate, often sentence-length selections that sit closer to a paragraph boundary.

**Why the reasoning does not survive contact.** The reflow is real, and it is the price — the paragraph breaks at the word. But fork and merge pay exactly the same price, for the same reason, and accepted it. What the paragraph version bought was not "no reflow"; it was "reflow somewhere else", and somewhere else turns out to be worse: **in a long paragraph the definition arrives far below the word that opened it, so the reader has to reconstruct the connection the anchor exists to make.** Proximity is the entire point of an inline anchor. A card at the end of a paragraph is a footnote, and this surface already has footnotes.

A term also **repeats**, which the original reasoning treated as irrelevant and which actually makes distance worse rather than better: several marked words in one paragraph would all open their card in the same place, with nothing to say which word it belonged to.

**Decision:** `markEl.after(anchor)`. ADR-138 already established that the three cards are one component differing only in the stroke of the left rule — solid fork, dashed merge, dotted term, double person. **Where a card appears is part of being that component**, not a per-feature choice, and the divergence was invisible in the CSS that ADR-138 was checking.

**Verification:** the placement tests were checked in the failing direction first — four of the five fail with `block.after(anchor)` restored and pass with `markEl.after(anchor)` — so they assert the change rather than the DOM's default shape. They also pin the two properties that make the placement meaningful: the card is the mark's `nextElementSibling`, and it stays *inside* the paragraph.

**Cost, stated:** the paragraph is now split at the term while the card is open. That is the same thing fork does, it reverses on close, and it is what puts the definition beside the word.

**Consequence:** +5 tests (858 across 55 files), in a new `tests/glossaryAnchor.test.ts` — the anchor had no coverage at all before this, which is why a placement divergence could sit behind an ADR that claimed the cards were identical. Build, lint, file-size and tests green. Not runtime-verified in Obsidian.

---

### ADR-157 — Marks nest; the innermost one owns the tap

**Status:** Active — reverses ADR-136's mark exclusion and replaces ADR-136/138's fixed tap order. Fixes a person-mark bug from ADR-151

**Context:** Asked for directly: a glossary term should still be markable inside a highlighted selection, and a selection should still be highlightable over a marked term.

Only one direction was actually blocked. `findRange`/`paintRange` walk text nodes and split per node, so a favorite painted across a term already works — element boundaries are irrelevant to them. But `repaintTerms` skipped any text node inside `.p-highlight`, `.p-fork-origin` or `.p-merge-link`, so **favoriting a passage silently un-marked every term in it** — the passage a reader is most likely to be working through.

The exclusion's stated reason was avoiding "overlapping wrappers that later unwrapping would have to untangle". They do not overlap, they **nest**: terms paint last (favorites → forks → merges → terms), so a term mark lands strictly inside the deliberate mark, and each unwrapper targets its own class and leaves the other alone. There was no tangle to avoid.

**Decision:**

**Terms may nest inside the three deliberate marks.** Only another term or person mark is still excluded — a term must not nest inside a term.

**`normalize()` before collecting text nodes.** Unwrapping a mark leaves its text split into adjacent nodes, and a term is matched *within a single node*, so a term straddling the seam would silently stop matching. This was latent before and becomes reachable once marks and terms share text.

**The innermost mark owns the tap**, replacing the fixed order (fork → merge → term → favorite). Every candidate is an ancestor of the tap target, so they form a chain and "innermost" is total. It is the right rule because **the outer mark stays tappable everywhere else along its span, while the inner one has nowhere else to be tapped** — a fixed type order leaves a visible mark that does nothing, which is worse than either outcome.

Worth recording: the old order between a term and a deliberate mark **had never fired**, because the painter refused to create the situation it arbitrated. It was written defensively, and the first time the case became real it was wrong. Depth also survives either nesting order, which matters because which mark ends up outside depends on which repaint ran last — a favorite created over an existing term wraps from the inside and inverts the usual order.

**A person mark was dead on tap.** The lookup asked for `.p-term` only, so `.p-person` — painted since ADR-151 — did nothing when tapped. Now `.p-term, .p-person`. That is a straightforward bug from ADR-151, found only because this change made me read the chain.

**Extraction.** The resolution moved to `ui/markTap.ts`, pure and unit-tested, which also paid the ADR-097 budget `SelectionController` broke again. That is the second extraction from this file in as many sessions (`entitySelection.ts` was the first); the file is at its ceiling and every further addition will have to buy its way in.

**Alternatives rejected.** *Keeping the type order and accepting dead marks* — a mark that cannot be opened is worse than either choice about which opens. *Resolving by mark type at paint time instead* (e.g. refusing to paint a term inside a fork) — that is the exclusion this ADR removes, with the same cost. *Normalizing the nesting order after every paint* — choreography across three controllers to make depth predictable, when depth is already sufficient.

**Verification:** both halves were checked in the failing direction. Restoring the exclusion fails four of the new painter tests; the tap tests cover nesting in both directions, including the inverted order a favorite painted over a term produces. Two tests in `tests/termPainter.test.ts` asserted the old exclusion and were rewritten — they are now the clearest statement of what changed.

**Consequence:** +19 tests (875 across 56 files). Build, lint, file-size and tests green. Not runtime-verified in Obsidian.

---

### ADR-158 — A response is a list of blocks, and "" is not a diagnosis

**Status:** Active — fixes the favorites summary producing no card; hardens `callUtility` on two providers

**Context:** Reported as: the favorites summary runs, and the box never appears. No error.

The UI path was innocent — mounting the real view and calling `summarizeFavorites` with a stubbed router renders the card correctly, and `buildFavoritesDigest` is fine including the orphaned-favorite case. The defect is one line in `AnthropicService.callUtility`:

```ts
const block = response.content[0];
return block?.type === "text" ? block.text.trim() : "";
```

**A response is a *list* of content blocks, and text is not guaranteed to lead it.** With extended thinking the first block is a `thinking` block; a server-side tool use can precede the answer too. In those cases this returns `""`.

**Why the favorites summary and not everything else.** Most utility calls run on `this.fastModel`. `generateSummary`, `generateSummaryWithTitle` and `generateFavoritesSummary` are the only ones that run on `resolveModel(conversation.model)` — the conversation's own model. On a reasoning-capable model at high effort, a leading non-text block is the normal case rather than the exception. The reporter's own conversation settings screenshot two messages earlier showed Opus 5 with effort *Hoch*.

**Why it was invisible.** `callUtility`'s documented contract is "return "" on empty/error", and the callers read `""` as "nothing to show": `runFavoritesSummary` returned early without a Notice, and `summarizeFavorites` skipped the render. A successful call that produced no text and an error that was swallowed were the same value, and neither said anything. **A sentinel that means both "nothing" and "it broke" cannot be reported on.**

**Decision:**

**Collect every text block.** Filter the content list to `type === "text"` and join. Never index 0, never infer from one block's type whether the response had text.

**Same fix on Mistral.** Its `content` is a string *or* a list of content chunks, and the list case returned `""` — the identical shape of bug, waiting for a model that returns chunks. OpenAI's shape has one `choices[0].message.content` string and is fine.

**Say something when the result is empty.** `runFavoritesSummary` now shows a Notice naming the likely cause (raise the token limit on a reasoning model) instead of returning silently. This does not fix the bug; it makes the next one of its kind reportable in one step instead of four rounds of probing.

**Write to the conversation the store holds.** `renderSummaryCards` re-reads through `getConversation()`, so the summary is written to `conversationStore.getById(conv.id) ?? conv`. Defensive rather than diagnosed — the captured reference and the stored one are the same object today — but a card can only appear if the object the renderer reads is the one that got the summary, and that invariant should not be implicit.

**Verification:** checked in the failing direction — restoring `content[0]` fails three of the five new tests (leading thinking block, several text blocks, leading tool use), and the two that still pass are the ones that were never broken. The UI path was ruled out by reproduction, not by reading.

**What this says about the earlier work.** The bug is old, not recent. What changed was the reporter's model and effort setting, which moved a leading `thinking` block from rare to routine. **"Recently introduced" describes when a latent bug became reachable at least as often as it describes a new one**, and the four things I checked first were all recent changes of mine, none of which were involved.

**Consequence:** +5 tests (880 across 56 files). Build, lint, file-size and tests green. Not runtime-verified against a live Anthropic response.


---

### ADR-159 — Validate at the boundary, and let the tooling say no

**Status:** Active — the outcome of the 2026-09-16 whole-codebase quality and security review (engineering-review #124–#178)

**Context:** The review was asked for at least fifty fixes, with maintainability, usability, performance and observability weighted highest. It found them without difficulty, and that is the finding worth recording: the defects were not scattered oddities but a small number of *shapes*, each repeated wherever the same kind of value crossed the same kind of boundary.

**Shape 1 — trusted input.** `mergeSettings` was `Object.assign({}, DEFAULT_SETTINGS, saved)`, so a `null`, a string where a number was expected, or an unknown provider from a sync conflict landed in `settings` and failed far away — as `vaultContextFolders.map is not a function` or an exhaustive-switch throw. `parseConversations` proved `id` and `messages` and nothing else; a record with `contextNotes: null` threw on first render. A template's `auto_prompt` was cast to string and sent verbatim. A model's tool-call arguments that failed to parse were executed as `{}`. The data.json watcher hardcoded `.obsidian` and never fired on a vault with a custom config directory — and never said so, because a missing file is its idle case.

**Shape 2 — silent failure.** `create_note` on an existing path overwrote it, through `writeNote`'s create-or-modify convenience, with no confirmation naming the note. `todayISO()` was UTC, so a conversation started at 23:30 in Berlin was filed under yesterday. The header's copy-link built its own deep link and had dropped the `vault` parameter. A `TypeError` from a programming error was classified as a network failure, retried twice and shown as connectivity. `generateConversationTitle` returned `"New Conversation"` on an empty reply and the auto-title path renamed the dated conversation to that. A `sendMessage` failure before the provider ran left `isStreaming` true — input disabled, Send reading "Stop" — with an unhandled rejection as the only trace.

**Shape 3 — rules in prose.** CLAUDE.md forbids `toLocaleDateString` (ADR-139) and HTML-string injection; nothing checked either. `tsconfig` had only `strictNullChecks`; `strict` passed with zero errors and `noUnusedLocals` found one dead field. The file-name sanitizer regex existed in three files, the deep-link builder in three, the default-model ternary in two.

**Decision:**

**Validate where the value enters, not where it is used.** `mergeSettings` type-checks every saved value against its default and rejects unknown enum values; `sanitizeConversationFields` repairs the scalars the app reads unguarded; `sanitizeMessages` drops a message without a usable role or id; `TemplateLoader` validates `auto_prompt` and integer `max_tokens`; `parseToolArguments` returns an `Error:` tool result the model can act on. Read-path guards further in stay as defense in depth, but they are no longer the only line.

**A write that can destroy content is a distinct operation.** `NoteWriter.createNote` refuses an existing path; the `create_note` tool uses it. `writeNote`'s overwrite is for `rewrite_note`, which the user confirms by name. Paths are normalized once (`normalizeVaultPath`), `ensureFolder` tolerates the folder appearing under it, and every summary-note frontmatter scalar is YAML-quoted.

**One retry policy, and it is visible.** The Anthropic and OpenAI clients are built with `maxRetries: 0`; `runStreamRound`'s two retries are the policy and they appear in the debug log. `streamMessage` logs one line per turn — duration, rounds, chars, tokens — and one on error, so a slowness or cost report can be answered from the console.

**`""` and `undefined` are not diagnoses** (extending ADR-158). An empty generated title keeps the dated name; an empty summary on resume is refused with a notice; a clipboard denial says "copy failed"; the chapter-name backfill stops on the first failure instead of logging one warning per message, and does not start at all without a key.

**Tooling encodes the rules.** `strict`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters` in `tsconfig.json`; `eqeqeq` (null-tolerant), `no-restricted-properties` for `toLocaleDateString`/`toLocaleTimeString`, and `no-restricted-syntax` for `innerHTML`/`outerHTML`/`insertAdjacentHTML` in ESLint. A rule the linter can state is a rule a future session cannot forget.

**One builder per fact.** `safeNoteName`, `normalizeVaultPath`, `yamlString` (pathUtils), `resumeDeepLink` (utils), `EMBEDDING_MODEL_IDS` / `RELATED_SIMILARITY_PRESETS` (embeddingModels) replace their copies.

**Three principles for what follows** (also in CLAUDE.md):

1. **Every boundary validates.** A value from disk, a note, a template, a model or the clipboard is untrusted until a function with a test has said otherwise — and the fallback is the default, never the raw value.
2. **Silence is a bug.** An empty result, a swallowed catch, a no-op on a missing file: each must either say something to the user, log something a report can quote, or be proven to be the idle case. `catch {}` needs a comment naming why silence is right.
3. **If it is a rule, the tooling enforces it.** A convention worth writing into CLAUDE.md is worth a lint rule, a compiler flag, or a test that fails in the forbidden direction. Prose is for the reasoning; the guard is for the regression.

**Verification:** each fix has a test that fails in the old direction where one can be written headlessly (+46: 926 across 58 files); the SDK retry change, the watcher path and the clipboard path are runtime-only and are documented as such. Build, lint, file-size (sidebar.ts 1891 → 1885 via `ui/emptyState.ts`) and tests green.

**Consequence:** the review's target was fifty; fifty-five landed. Not done, and deliberately: a request timeout on utility calls (the SDK's ten minutes stands), a `Bearer` header for Tavily (the body field works and is tested), and the delete-exchange gesture's hand-rolled long-press (it needs `preventDefault` on `touchstart`, which the shared helper's passive listener cannot give).


---

### ADR-160 — Compare models on the last exchange; the conversation ends with the user turn while it is pending

**Status:** Active — new capability

**Context:** The ask: from the long-press on the last user bubble, a third option next to delete and cancel — re-run the same prompt on another model, keep the answers side by side and comparable, then choose one as the conversation's answer while the others are stored as forks. Three product questions were put to the user and answered: the option runs **only the last user turn** (not the input draft); the candidates run **sequentially into one card with a tab per model** (not parallel columns); non-kept answers become **forks at the prompt, and sending is blocked until one is kept**.

**The invariant.** Everything else follows from one rule: *while a comparison is pending, the conversation ends with the user turn.* `startComparison` removes the existing answer from `messages` and stores it as candidate 0. Consequences:

- **The provider path is untouched.** `prepareStream` slices the trailing user message off history and sends it as the new turn — exactly the state a pending comparison leaves the conversation in. A candidate run is `llmRouter.streamMessage({ ...conv, provider, model, writeMode: "none" }, prompt.content, prompt.attachedNotes ?? conv.contextNotes, …)` through the same streaming state as a normal send, so Stop works, the input is disabled, and no provider gained a second abort controller.
- **History never holds two answers to one prompt.** There is no "pending" flag on a message and no filtering when history is sent. Sending is blocked (`comparePending`) because a new turn would have to choose an answer silently, which the user declined.
- **Cancel is trivial.** Put candidate 0 back.
- **Load-time repair is decidable.** `normalizeComparison` drops a comparison whose prompt is no longer the last message or that has no candidate with content, restoring candidate 0 where it can — a run the app closed on leaves an empty candidate, which is dropped.

**Keep.** `keepCandidate` appends the chosen candidate as the assistant message (its candidate id becomes the message id, so candidate 0 kept is byte-identical to the original turn — favorites and merge links on it still resolve) and returns a `ForkSpec` per other candidate: the source's settings with that candidate's provider/model, `[prompt, answer]` as its two messages, `forkedFromMessageId` = the kept message, name `<conversation> · <Model>`. Favorites and merge links on a non-kept answer travel with it into its fork rather than being deleted. `ConversationService.createComparisonFork` does the vault I/O. No `forkedFromSelection`: the whole exchange is the branch point, so the fork banner shows the source and its summary and the navigator lists the fork, but no origin mark is painted in the source — there is no passage to mark.

**Tools during a run.** `writeMode: "none"` withholds the note-writing tools from a candidate and the tool callback declines them with a readable error; web search stays on when research mode is on. A second model writing into the vault while the user is still choosing is a side effect they never asked for.

**Where it lives.** `services/comparison.ts` is pure (`startComparison`, `addCandidate`, `removeCandidate`, `keepCandidate`, `cancelComparison`, `forkNameFor`, `normalizeComparison`); `ui/ComparisonController.ts` owns the card, the picker (`suggest/ModelSuggest.ts`, a `FuzzySuggestModal` over keyed catalog models minus those already answering — not the header popover, which changes the conversation's model) and the run; `ui/ExchangeActionsController.ts` is the long-press bar, extracted from the view when it gained its third button. The card reuses the fork anchor's grammar (accent left rule, mono caps label) with tabs instead of a title; the active tab's fill is state and has no transition (ADR-155).

**Verification:** 22 pure tests (`tests/comparison.test.ts`) and 4 mounted-view tests (start removes the row and paints one tab; send is blocked; keep appends the message and creates the fork conversation with the expected name, model, branch point and messages; discard restores the original). The picker and a live candidate stream are runtime-only. Build, lint, file-size and tests green.

**Consequence:** +26 tests (949 across 59 files). `Conversation.comparison?` is additive and backfill-safe. sidebar.ts 1853 → 1763, ceiling lowered.


---

### ADR-161 — One implementation per interaction; pay for the keystroke; inherited stays inherited

**Status:** Active — the outcome of the second whole-codebase review (engineering-review #181–#236)

**Context:** The first review (ADR-159) read the services and persistence layers closely and the UI layer only for its wiring. This pass inverted that: every controller under `ui/`, both settings surfaces, the embedding and retrieval layer, the stylesheet, and the comparison code written the day before, read with fresh eyes. It found 56 defects. Three of the first review's principles held up — "silence is a bug" fired four more times, every time in code older than ADR-159 — and three new shapes emerged that the first three did not name.

**Shape 1 — the second copy.** The model popover, the navigator, the fork menu, the Send menu and the history panel each hand-rolled the same dismissal: add a capturing `document` listener *one tick later* (so the opening press does not close the surface), remove it on close. Four of the five had the same latent leak: a close before that tick — a conversation switch, a view rebuild — ran the cleanup before the listener existed, and the listener was added afterwards to nobody. The history panel had fixed its own copy months earlier; the fix never travelled. The same shape: a fifth hand-rolled 500 ms long-press in the history rows; two copy-to-clipboard buttons that turned a denied clipboard into an unhandled rejection; two identical parameter-support `switch`es (settings tab, conversation modal) that a new model would have desynchronized silently; `registerDomEvent` through the *view* on elements the fork anchor recreates on every open, leaving one dead listener set per open until unload.

**Shape 2 — work proportional to the corpus, not the keystroke.** `rankConversations` re-tokenized every conversation's full text on every keystroke of the conversation search; the `#` picker re-tokenized every vault file's title and headings on every character; the history rows ran a filter over all conversations per row to count forks (O(n²)); `looksTimeSensitive` compiled ~100 `RegExp`s per send; and every character typed into a settings text field called `saveSettings()`, which rewrites the *entire* `data.json` — settings and every conversation — and runs eviction. None of these showed at ten conversations. All of them show at two hundred.

**Shape 3 — a shown default becoming a stored one.** The conversation modal prefilled temperature and max-tokens with the *resolved* default and labelled them `· Standard` — then wrote both back on Save whether or not the user touched them. A conversation that had been following the global setting stopped following it the first time its settings were opened, with no visible change. CLAUDE.md already stated the rule for `theme` and `outputLanguage` ("undefined means follow; never copy the default in"); two fields in the same modal broke it.

**Decision — three principles, alongside ADR-159's three:**

4. **One implementation per interaction.** `ui/outsideDismiss.ts` is the one deferred dismisser (pointer, touch, Escape; disposer safe before the tick). `attachLongPress` gained the press point and a `touchOnly` mode so the history rows could use it. `copyWithFeedback` is the one clipboard button. `parameterSupport(provider, model)` is the one support rule. ESLint's `no-restricted-syntax` now rejects `document.addEventListener` / `window.addEventListener` outside an allow-list of files that own both the add and the remove — a new surface uses the helper or names its reason in the config.
5. **Pay for the keystroke, not the corpus.** `rankConversations` accepts pre-tokenized haystacks; the history panel and the `#` picker cache token sets for the life of the panel; fork counts are one pass per build; the cue patterns are compiled once; `PluginDataStore.saveSettingsSoon()` coalesces typed settings into one write 400 ms after the last key, flushed when the tab closes.
6. **Inherited stays inherited.** Save writes `undefined` for an override the user did not touch. The readout may say what applies; the record says what was chosen.

**Also in this round, under the first three principles:** four summary flows and the LLM-rename now report an empty result (ADR-158 applied to code that predated it); `deserializeIndex` refuses a truncated file instead of yielding short vectors that made every later `cosine()` throw; a glossary term whose file name had to be sanitized (`C#` → `C-`) keeps its real name in a `term` property; the glossary cache is invalidated on delete and rename, not only on modify; the Person button is hidden over user bubbles like Define; Insert-into-note checks that the remembered editor's leaf still exists; a model switch to a provider without a key says so at once; the delete-conversation flow has one copy; 22 hover *fills* moved under `@media (hover: hover)` and the toolbar toggle's state fill lost its transition (ADR-155, applied to the rest of the stylesheet); the model popover's hardcoded `rgba` shadow became the theme's `--shadow-l`.

**Where the principles live.** The canonical list is the "Engineering principles" section of `CLAUDE.md`, because that file is the one every session reads before it touches code — a principle stored anywhere else is advice, not a rule. Each principle names the guard that enforces it (a lint rule, a compiler flag, a helper, a test), and the reasoning behind it lives in its ADR. `docs/engineering-review.md` keeps the history of what each principle caught. This is deliberately not a fourth document: three places with three jobs (rule, reason, record) is already the maximum that stays in sync.

**Verification:** +18 tests (967 across 60 files): the dismisser's deferred-dispose case (the leak), the press point and `touchOnly`, truncated-index rejection, the `term` property round-trip, token-set scoring parity, `parameterSupport`, the root templates folder. Lint, file-size, build and tests green. Runtime-only: the settings debounce flush on tab close, the iOS sticky-hover change.

### ADR-162 — A cut-off reply says so, and the token rule lives in one place

**Context.** The thesis from the product side: most users do not know what a model switch implies, least of all that a reasoning model spends the same max-tokens budget on hidden thinking before it writes a visible word. Two things made that thesis a bug rather than a training problem. First, both providers *report* why a stream stopped — Anthropic `stop_reason: "max_tokens"`, OpenAI and Mistral `finish_reason: "length"` — and `runStreamRound` mapped every non-tool stop to `"done"`, so a reply cut at the cap rendered exactly like a finished one, and an empty reasoning reply (budget entirely spent on thinking) made the streaming bubble vanish with no word said. Principle 2, in the most literal form. Second, the one signal that did exist, the orange triangle beside Send, kept its explanation in a `title` tooltip, which a phone never shows; and the settings modal, where the switch actually happens, said nothing at all when a conversation pinned to 2000 tokens moved onto a reasoning model — only an *untouched* field followed the model.

**Decision.** Four layers, one rule.

1. **The stop reason survives.** `RoundResult.truncated` is set by all three providers; `BaseProvider.streamMessage` passes `{ truncated }` to `onComplete` as a third argument (`StreamFinish`); the view stores `Message.truncated: true` and `sanitizeMessages` drops any other value. The turn's debug line logs it.
2. **One rule.** `services/settingsAdvice.ts` — `maxTokensAdvice(model, conversationMaxTokens, globalMaxTokens)` — is the only place that decides a limit is too low and what to do about it. It returns `clear` when the conversation's own override is the low value and dropping it lets the model-aware default apply (principle 6: the override then follows the model again), and `pin` only when clearing cannot help because the global setting is the low value. The modal's advice line, `ui/SendHintController.ts` and the recovery card all read it, so they cannot disagree.
3. **Recover in place.** `ui/TruncationController.ts` paints a card under a truncated answer in the fork anchor's grammar, in this UI's warning colour: the cause with the number, and on the *last* answer only, three actions — **Continue** (sends a fixed continuation prompt as a new turn, keeping the user's draft), **Retry with N** (doubles the cap via `raisedMaxTokens`, splices the exchange through the shared `spliceExchange`, re-sends the prompt), **Compare** (the ADR-160 flow). Retry is withheld, not made destructive, when a star or merge link sits on the answer. An empty reply now always says something; an empty *truncated* reply says the budget went on thinking.
4. **Explain before the switch.** Model rows carry a `MODEL_PROFILE` line — speed · depth · cost as 1–3 tiers — and reasoning rows say they need a bigger budget. Tiers, not prices: prices change monthly, the ranking does not, and a test requires a profile for every catalog entry.

**Rejected.** Auto-raising the limit on model switch (a stored value is a user decision; the advice offers, the user confirms). A hidden continuation that stitches the second half onto the first message (the transcript would no longer match what was sent; a visible "Continue" turn is honest and costs one bubble). Parallel per-candidate retries (still no per-request abort controller). Local usage counters (nowhere to show them yet).

**Assumptions to check on a device.** `RETRY_MAX_TOKENS_CEILING = 65536`: a model with a lower output cap rejects the third doubling with an ordinary API error, which is the intended failure mode. The Continue prompt is a fixed sentence in the output language's locale, not the model's; a model answering in another language still understands it.

**Verification.** +30 tests (997 across 63 files): the three providers' stop reasons, `maxTokensAdvice` (switch → clear, low global → pin, plain model → nothing), `raisedMaxTokens`, `spliceExchange` (favorites and merge links go with the answer, save boundary stays consistent), the sanitizer's `truncated` guard, profile completeness, and view tests for the card (paints, three actions, Continue keeps the draft, Retry raises and re-sends, withheld under a star, no actions on an earlier answer, empty truncated reply) and the Send hint (same rule as the modal).

### ADR-163 — The cost of an answer is an estimate from a date-stamped table, shown where the tokens already are

**Context.** Every assistant message already records its model and token usage, and the turn label already shows `↑1.628 ↓941`. Tokens are the provider's unit; money is the user's. The question "what did this answer cost me" was answerable from stored data and was not answered anywhere. Meanwhile the toolbar carried a *next-send* token estimate (`next ~4.2k`, #28) — a prediction about a send that had not happened, derived from the last usage plus the draft's character count, competing for the narrowest row in the panel with the Send button and the max-tokens warning.

**Decision.** `models/modelPricing.ts` holds USD list prices per million tokens for every catalog model (input, output, and for Anthropic cache read and cache write), under `PRICING_AS_OF`. `estimateCost(model, usage)` prices the four counts at their own rates; a model with no row returns `null` and the label adds nothing — a missing number is honest, a wrong one is not, and a completeness test keeps the table in step with the catalog. The label reads `… · ↑1.628 ↓941 · ≈ $0.012`: computed at render time, so every past answer gets a number and nothing new is stored; two significant digits below a dollar, two decimals above, `<$0.0001` under half a hundredth of a cent. The tooltip names the as-of date and that web search is billed separately. The comparison card's tab meta and the history panel's row sub-line carry the same estimate — per candidate, and summed per conversation with a `+` when some answers came from an unpriced model. One setting, `showCost` (default on), hides all three. The next-send estimate is removed: the label now answers the question the estimate was guessing at, after the fact and exactly.

**Addendum (same day) — the table is a setting, and it says what it is.** Two things followed from "entered from memory". First, the prices are editable: `settings.priceOverrides` holds per-model corrections (input and output USD per million), rendered under a *List prices* heading in the settings tab as one row per catalog model with the built-in value as placeholder; an empty field means the built-in value, cache prices follow the input price at the built-in ratio, and an override never creates a row for a model that has none. `sanitizePriceOverrides` guards the table on load (principle 1: a NaN price would otherwise render `$NaN` on every label). Second, the disclaimer is part of the feature, not a footnote: the settings section opens with it, the toggle's description repeats its core, and the label tooltip carries the short form. The wording says four things in order — it is an estimate, not a bill; it comes from the provider's token counts and this table; the table ships as of a date and may be outdated or wrong for the user's account, region or plan; the provider's invoice is the only authoritative record. That is the sentence that matters if a stale price ever misleads someone: the plugin never claimed to know the bill.

**Addendum 2 (same day) — the snapshot, the pipeline, and off by default.** Three decisions after the table became editable. (1) *The cost is stored after all.* The first cut priced every answer at render time so a corrected table would correct the past; that is exactly wrong once prices change, because an answer from May re-priced with September's table is neither the bill nor the estimate the user saw. `Message.cost: { usd, asOf }` is written when the stream completes, with the prices in force then; the label and the conversation total prefer it, and only a message that predates snapshots is priced live. A user's price correction therefore applies from now on — a correction is knowledge, not evidence about the past. `sanitizeMessages` drops a malformed snapshot. The "Rejected" entry below records the earlier reasoning and is superseded on this point. (2) *Prices update through a pull request, never a fetch.* `scripts/update-pricing.mjs` pulls models.dev, maps every catalog model to its upstream id, rewrites the GENERATED block of `models/modelPricing.ts` and fails loudly on an unmapped model or a changed schema; `.github/workflows/update-pricing.yml` runs it weekly and opens a PR when a price changed, and the release checklist names the same script as the manual fallback. The release build reads only committed source: a fetch at build time would be unreviewed and non-reproducible, a fetch at run time a third-party call from every vault. A round-trip test keeps a hand edit and the script agreeing on formatting. models.dev was unreachable from the environment that wrote the script, so the first CI run verifies the schema and the id mapping. (3) *`showCost` defaults to off.* A number that can be wrong is opt-in; the disclaimer is the first thing the toggle's neighbourhood shows.

**Addendum 3 (same day) — no price table in the settings, and no per-user overrides.** Addendum 1 made the table editable: twenty-three rows with two fields each, the longest section of the settings tab, for a correction that helps one vault. Once the prices come from models.dev through a weekly pull request (addendum 2), the right place to fix a wrong price is upstream, where it fixes everyone's; a local override would also let a user's table and the shipped table disagree about the same model on the same day. `settings.priceOverrides`, `resolvePricing`, `sanitizePriceOverrides`, the rows and their strings are removed. What stays in the settings is the toggle and the disclaimer, which now names models.dev as the source with a link, says the prices are refreshed with each release and gives the build's as-of date. The label tooltip names the source too.

**Rejected.** Storing the cost on the message (prices change; a stored number would freeze the wrong one, and the counts are already there). Currency conversion (providers bill in USD; a rate would be a second table that rots faster). Including web-search cost (Tavily bills per call, not per token, and the plugin never sees the invoice). Keeping the next-send estimate alongside (two numbers in two units on one row, one of them a guess).

**Assumptions to check.** The prices were entered from memory on the as-of date and must be verified against the providers' price pages before release; the three Claude 5 rows assume Opus-tier pricing.

**Verification.** +30 tests (1027 across 65 files): the snapshot (stamped, undefined for an unpriced model, preferred over a live estimate and immune to later overrides), the label rendering the stored value and date, the load-time guard on `cost`, and the import script (catalog parsing against `MODEL_CATALOG`, cost-field mapping incl. cache prices, loud failure on an unmapped model with nearby ids, the renamed-id mapping, schema failure, and the committed table round-tripping through the renderer). Earlier:  a price row for every catalog model; overrides replace only the fields given, scale cache prices with the input price, and never create a row; the load-time guard keeps finite non-negative numbers for known models and drops the rest, also through `mergeSettings` and no stale rows; cache reads at the discount and writes at the premium; the input-rate fallback for rows without cache prices; `null` for unknown models; the formatter's three regimes; the conversation sum with its unpriced count; the label segment present when enabled, absent when off or unpriced.

---

### ADR-164 — One registered icon for every entry point, drawn to Lucide's rules

**Date:** 2026-09-16
**Status:** Accepted

**Context.** Every way into Pythia — the ribbon button, eight commands, two file-menu entries and the sidebar tab — carried Lucide's `bot`. It says "a chatbot", which is the least specific thing that can be said about the plugin, and it is the same glyph any other AI plugin is likely to pick, so a ribbon with two of them tells the user nothing. It also made the task commands (summarize favorites, toggle vault context, reindex) look like entry points, because they wore the same icon as "New conversation". Across the author's three plugins the same problem repeated: each borrowed a generic Lucide glyph (or, in one case, drew a monogram) and none of them looked like they came from the same hand.

**Decision.** Pythia registers its own icon, `pythia-logo`, once in `onload()` — the Python of Delphi, a serpent winding like lines of text with a single eye. It is used by the ribbon, the entry commands (`new-conversation`, `resume-conversation`, `hub`, `send-selection-to-pythia`, `send-selection-to-pythia-with-template`), the two file-menu entries ("Chat about note/folder") and `getIcon()` of the view. Task commands do **not** wear it: they carry the Lucide icon that names the task (`star`, `library`, `refresh-cw`), so the palette distinguishes "open Pythia" from "do something in Pythia". The three sibling plugins take the same shape (one `<name>-logo` id, registered before anything names it, ribbon + entry commands + main view, task commands on descriptive icons), so the family reads as one.

**How it is drawn.** On Lucide's 24-unit grid at stroke 2 with round caps and joins, stroke only, `currentColor` throughout — the rules Obsidian's own icons follow, so it sits in a row of them without standing out, and follows the theme and the accent rather than carrying a colour. `addIcon` draws inside a `0 0 100 100` box, so a `<g transform="scale(4.1667)">` carries the artwork over rather than the paths being rewritten: the module keeps the designer's coordinates verbatim, the stroke scales with the group, and the same artwork ships unchanged as `assets/logo.svg`. Registration happens before `registerView`, because a leaf restored from `workspace.json` asks for its icon during layout-ready and would otherwise draw nothing.

**Guards.** `tests/pluginIcon.test.ts` checks the id, the registration, the markup (one group, a path and a circle), the 100/24 scale, the Lucide attributes, stroke-only shapes, no colour literal, and the geometry verbatim. `tests/mocks/obsidian.ts` gains a capturing `addIcon` so a test can see what was handed over. The `"bot"` string no longer appears in the codebase.

**Consequences.** The sidebar tab, the ribbon and the palette all show one mark; a user who has enabled any of the three plugins recognises the others by it. `sidebar.ts` gained an import and paid for it by collapsing the multi-line `obsidian` import to one line (1759 → 1751, ratchet lowered). Nothing about the icon depends on a theme: it is `currentColor` on Obsidian's grid, so Klartext or any other theme colours it like the icons beside it. On GitHub's dark theme the README's `<img>` of the SVG renders `currentColor` as black — accepted rather than hard-coding a colour into the asset, which the icon rules forbid.

---

### ADR-165 — The header shows what every answer is sent with

**Date:** 2026-09-16
**Status:** Accepted — revises the header order of ADR-098

**Context.** The header carried the conversation's name and the model's abbreviation. Effort and answer language — which change every answer as much as the model does — lived in the conversation settings dialog, reached through the model popover's footer: two taps, and nothing on screen said they existed. The language case was the sharpest. A fixed language, "Obsidian language" and "conversation language" send three different things to the model (an instruction naming the language, the same instruction with the UI locale filled in, and no instruction at all — ADR-148), and none of them was visible. Meanwhile rename, copy link and delete held three of seven header slots. A first design brief listed every conversation setting and asked for a status strip; the designs it produced repeated controls that already sit beside Send (template, web search, vault context) and redesigned the settings dialog, and missed the point. The brief was narrowed to three values (engineering-review #259/#260, `docs/briefs/conversation-controls.html`), and the header built from the resulting mock-up.

**Decision.** The header row is `search · name · [ctx chip] · model | effort | language · ⌄ · delete · new`.

1. **One bordered group, three tap targets.** Model opens the existing model popover. Effort and language each open a short picker for that value alone — anchored under the segment on desktop, the bottom action sheet on mobile, the same split as the Send menu. A choice applies at the tap: the header repaints before the save, with no Save button and no detour through the dialog.
2. **Show what is sent, resolved.** The segment reads `Hoch`, `DE`, `AUTO` — never "Standard". `obsidian` shows the resolved locale code (unknown → `EN`, as the prompt falls back). `AUTO` is the one case with no instruction, and says so in the picker ("the model answers in the language you write in").
3. **Tint means "set for this conversation".** A plain segment follows the plugin settings; a tinted one is pinned. Each picker's first row returns to the default and stores `undefined` — principle 6, with a test that fails if it stores today's value. The header repaints when the settings tab closes, so a changed default shows immediately.
4. **A model without effort shows a dimmed dash**, and a tap says the model has no effort setting. A stored effort is kept for a later switch back but not tinted, because it is not an instruction now.
5. **Temperature and token limit stay out.** They change less often, the token warning already sits beside Send, and a 300px leaf has room for three values, not five.
6. **Rename, copy link and conversation settings move into a `⌄` menu.** Delete stays visible.
7. **Every picker explains its options in a visible line**, not a tooltip — most use is on a phone.

**Structure.** `ui/instructionState.ts` is the one resolution (conversation → setting → model support) and is pure; the header only paints it. `ui/choicePicker.ts` is the one picker (principle 4) and owns `placeBelow`, which the model popover now uses instead of its own copy. `ActionSheetItem` gained `detail` and `active` so the mobile sheet shows the same rows.

**Rejected.** A status strip of every conversation setting (repeats the composer toolbar; it was what the first brief asked for, and the wrong ask). One combined control opening a three-part panel (two taps again for the value you want). Showing "Standard · Hoch" in the header (long, and "Standard" is the word that hid the value). Tinting by "an instruction is active" rather than "pinned" (would not tell a user why a value changed when the global setting did).

**Consequences.** `HeaderController.updateModelBadge` → `updateInstructions`, `onModelBadgeClick` → `openConversationSettings`. The header's title truncates first on a narrow leaf; within the group only the model name may. The settings dialog is unchanged and still edits the same fields. +17 tests (1046 across 68 files): the two resolvers, and the header — resolved values, tint, picker writes, default → `undefined`, dimmed dash, repaint on a changed default, the menu.

---

### ADR-166 — Glossary definitions read in the conversation's language

**Date:** 2026-09-16
**Status:** Accepted — narrows ADR-148's "AUTO adds no instruction" for two prompts

**Context.** A term's definition is written once, at the first lookup, in whatever language that conversation resolved to, and the vault-first rule (ADR-136) then shows that text everywhere. Two things made this read as "the glossary is in English". First, the default language setting is AUTO, which adds no instruction; in a chat turn that lets the model follow the user, but `defineTerm`'s prompt is itself English, so the model answered in English even for a German passage — and the note kept it. Second, a term met later in a conversation of another language showed the stored text regardless. The expectation is that text follows the language setting.

**Decision.** Four parts, each confirmed by the user against alternatives.

1. **Translate at display, cache in the note.** When an anchor opens, the definition is shown in the conversation's language. If the stored definition is in another language, it is translated once (`BaseProvider.translateDefinition`, fast model) and written into the term note as `definition_<lang>`. The note stays the single source of truth; the cache syncs, is a column in a Base, and a wrong translation is corrected where the definition is.
2. **Under AUTO, the target is the language of the answer the term was tapped in.** It is detected locally (`services/languageDetect.ts`, function words), because a model call per opened anchor would put latency on the one interaction that must be instant. When the text is too short or mixed to tell, detection returns `null` and nothing is translated — unknown is never a guess.
3. **Hand-written definitions are translated too, and every translation says so** (`translated from DE` in the meta line). The user's own words are never silently replaced by the model's.
4. **Fix the source as well.** Under AUTO, `defineTerm` and `describePerson` now instruct "write the definition in the language the passage is written in". This departs from ADR-148's rule on purpose and only here: the rule's reasoning — silence lets the model follow the conversation — does not hold for a prompt written in English. New entries record their `language`.

**Cache validity.** `translated_from` holds an FNV-1a hash of the definition the translations were made from. A regenerate, or a hand edit of the body, changes the hash; every cached language is then stale, and the next translation deletes them all before writing the new one (`applyTranslation`), so a stale language cannot survive beside a fresh one. `mergeEntry` carries translations and the hash through a re-lookup untouched; `entryFrontmatter` never writes them — `GlossaryService.translate` is the only writer. Because Obsidian re-parses the written frontmatter asynchronously, the service also keeps this session's translations in memory, keyed by term, language and hash.

**What is not translated.** The term title (it is the word as it appears in the text, and marks match it), the aliases, and the context quotes (verbatim attestations; a translated quote is no longer one).

**Display.** The anchor never shows the stored text and then swaps it: while a translation runs, the body is a faint italic `Translating to EN…`. If the call fails or returns nothing, the stored definition is shown unmarked and a Notice says why (principle 2).

**Rejected.** A plugin-side cache file (does not sync, invisible to Bases, not editable). A body section per language (not a Base column; notes grow long). Obsidian's UI language as the AUTO target (predictable, but a German user reading an English conversation would get German definitions under English answers). A model call to detect the passage's language (latency on every open). Translating the stored definition in place (would destroy the original and make a second translation a translation of a translation).

**Consequences.** A term note can carry `language`, `translated_from` and one `definition_<lang>` per language read. `GlossaryEntry` gains `language`, `definitionTranslations`, `translatedFrom`. `LLMProvider`/`LLMRouter` gain `translateDefinition`. +23 tests (1069 across 69 files): the detector (seven languages, the short-definition overlap, a quoted English phrase, refusal on short or mixed text), frontmatter read and write, cache validity by hash, stale-language clearing, the target rule, the merge, both prompts under AUTO and a named language, and the anchor's four states — translated and marked, same language with no call, failure falling back unmarked, placeholder while pending.

---

### ADR-167 — The strip under the composer, measured: core pads every view, a theme added a reserve, core's fade painted it

**Date:** 2026-09-16
**Status:** Accepted — closes the thread of ADR-132, 134, 135, 146, 147

*(The three CSS rules and `tests/leafInset.test.ts` landed with the icon branch; the reasoning below was dropped by that merge and is restored here. Numbered 167 because 165 and 166 were taken while the branch was open.)*

**Context.** ADR-147 ended with a promise: if any strip survived the leaf-container fix, "I will instrument rather than guess again." One survived. On the phone, with Klartext, Send hung about 56px above the drawer's tab selector with a lighter band across the space. This time Obsidian 1.13.7 was run under a virtual display with `--remote-debugging-port`, put into phone emulation (`app.emulateMobile(true)`, 393x852, `is-phone`), the vault carried the built plugin and the theme, and the drawer was measured with `getBoundingClientRect` and `getComputedStyle`, before and after every change, in the same tab.

**What was there — three layers, none of them Pythia's.**

1. **Obsidian pads every `.view-content`.** `app.css` has `.view-content { padding: 12px }` and `.workspace-leaf-content .view-content { padding-bottom: max(var(--safe-area-inset-bottom), var(--size-4-8)) }` at (0,2,0): 32px on a desktop, the home indicator's 34px on a phone. Measured under the default theme on the desktop: `.pythia-view` computed `12px 12px 32px`. **This is ADR-147's "8 left, 8 right, 34 bottom"** — the sides and the home-indicator number, from one core rule. `.pythia-view { padding: 0 }` is (0,1,0) and never won; ADR-147's `.workspace-leaf-content[data-type="pythia"] { padding: 0 }` addressed an element whose padding was already 0. Core exempts its own views by data-type: `.workspace-leaf-content[data-type="markdown"] .view-content { padding: 0 }` at (0,3,0).
2. **Klartext 1.6.1 reserved 52px on every phone-drawer view** — `body.is-phone .workspace-drawer .workspace-leaf-content > .view-content { padding-bottom: var(--touch-size-l) }` at (0,4,1) — "so the last row cannot end up under the floating selector". The selector does not float: `.workspace-drawer-inner` is a flex column, the tab container is `flex: 1`, `.workspace-drawer-tab-options` is `position: relative`, below the view in normal flow. Dead space, replacing core's 34 with 52.
3. **Obsidian's floating-nav fade painted the empty strip.** `.is-mobile.is-floating-nav .workspace-drawer .workspace-leaf-content::after`: 48px, `pointer-events: none`, `linear-gradient(to top, var(--mobile-sidebar-background), transparent)` — meant to fade a file list under floating nav buttons, applied to every drawer leaf. Over an empty reserve, with the sidebar #222 against our #1a1a1a panel, it is the band in the report.

**Decision.** Three rules beside the ADR-147 one, all scoped to our leaf by `data-type`:

```css
.workspace-leaf-content[data-type="pythia"] .view-content { padding: 0; }                       /* core's own exemption shape, (0,3,0) */
body.is-phone .workspace-drawer .workspace-leaf-content[data-type="pythia"] > .view-content { padding-bottom: 0; }  /* (0,5,1) over a theme's (0,4,1) */
.is-mobile.is-floating-nav .workspace-drawer .workspace-leaf-content[data-type="pythia"]::after { display: none; }
```

Specificity, **deliberately never `!important`**: the keyboard lift (ADR-132) writes an inline `padding-bottom` on this element and must keep winning. The theme is fixed too (Klartext 1.6.2 removes its reserve), but the plugin does not depend on it: the shape any theme would use is what the plugin out-ranks. The fade is removed only for our leaf; the composer is not a scrolling list.

**Verification, in the running app.** Phone emulation, Klartext 1.6.1, old stylesheet: `.pythia-view` padding-bottom 52px, fade `display: block`, Send 56px above the view's edge. New stylesheet, theme unchanged: 0px, `none`, Send 4px above the edge and 5px above the selector's hairline; the band gone. Klartext 1.6.2 with the old stylesheet: 34px (core's) and the fade back — which is why all three rules are the plugin's to carry. Default theme, new stylesheet: 0px, `none`, 5px. Desktop, old stylesheet: `12px 12px 32px`; new: `0px`. `tests/leafInset.test.ts` loads core-shaped rules, then `styles.css`, then a theme-shaped rule — Obsidian's order — into happy-dom and asserts the desktop and phone cascades, that another `data-type` keeps both core's and the theme's padding, that inline padding still wins, and that the `::after` rule is scoped by `data-type`.

**The method, kept.** Five ADRs guessed at this strip from screenshots and reasoned about numbers; the sixth ran the app and read three stylesheets the plugin had never read, one of them Obsidian's own. The tooling is now known: the Linux build under Xvfb with `--remote-debugging-port`, `app.emulateMobile(true)` plus a device-metrics override for the phone, `Runtime.evaluate` for the measurements, `Page.captureScreenshot` for the proof. When a symptom is "on the device", the next step is a device, emulated if need be — not a sixth reading of the same picture.

#### ADR-167 addendum — what the exemption uncovered: desktop clearance, and the keyboard lift reads Obsidian's number

**Date:** 2026-09-16

Removing Obsidian's `.view-content` padding exposed two things it had been quietly doing.

**Desktop clearance.** ADR-146 set the composer's bottom padding to 4px while core's 32px still sat below it, unseen. With that gone, Send stood 4px from the window's edge. The composer now carries `var(--s3)` (12px) at the bottom; in the phone drawer it keeps 4px, because the tab selector's pill with its own margin sits directly below. One rule, `body.is-phone .workspace-drawer .p-input-area { padding-bottom: var(--s1) }`, and a comment naming why.

**The keyboard.** On the phone the keyboard began to cover the composer's bottom row. Measured in the emulator with Obsidian's `--keyboard-height` set: `.app-container` shrinks by the keyboard, but the drawer is `position: fixed; top: 0; bottom: 0` and does not — it stays full height, its own `padding-bottom: calc(max(safe-area, 16px) - keyboard-height)` clamps to 0, and the view *grows* by 34px toward the keyboard. So a composer in the drawer is under the keyboard unless lifted. Pythia's lift (ADR-132) measured the keyboard through `visualViewport`, and on iOS that estimate is short by roughly the home indicator; core's 34px of view padding had been covering the difference. Obsidian publishes the authoritative number: `--keyboard-height`, from the native keyboard frame, and draws its own editing toolbar at `100vh - keyboard-height`. `keyboardOverlap` now takes `keyboardHeight` too and lifts by the larger of the two estimates; it is 0 whenever no keyboard is open, so it can never pad the panel at rest (the ADR-132 invariant). `watchViewport` also listens to Obsidian's `keyboardWillShow` / `keyboardWillHide` window events (allow-listed in ESLint with the reason) and measures once more after the 300 ms animation, since the variable can land after the event. The conversation panel's list passes the same number through `readKeyboardHeight()`.

**Verification.** Emulator, phone drawer, `--keyboard-height: 300px` and the event dispatched: the composer's bottom moves from 744 to the keyboard's top at 552, and back when the variable returns to 0. Desktop: Send 12px above the leaf's edge. The device numbers themselves — how far short the visual viewport falls on a given iPhone — are not known from here; what is known is that Obsidian's number is the one Obsidian trusts for its own toolbar.


### ADR-168 — Search matches by degree, and widens along the note dimension

**Date:** 2026-09-17
**Status:** Accepted — revises ADR-107's ranking; leaves ADR-143's pick mode untouched

**Context — two defects, one surface.**

**1. Matching was one-directional.** `tokenMatches` accepted a candidate token only when it equalled the query token or **started** with it. That answers the as-you-type case ("kayak" → "kayaking") and nothing else, so two everyday searches came back empty with no way to tell they had:

| Typed | Stored | Before |
|---|---|---|
| `bound` | `boundaries` | hit |
| `boundaries` | `bound` | **miss** |
| `Vertrag` | `Mietvertrag` | **miss** |

The second row is the one that matters here. German compounds are **head-final** — the word being searched for sits at the *end* of the compound — so a prefix rule can never find them. Neither case is fixable by stemming: a stemmer is language-specific, lossy on compounds, and cannot be corrected by hand.

**2. Search only ever looked at conversation text**, while the thing people actually remember about a conversation is often the note they had open in it. Those paths are already persisted — `Message.attachedNotes`, `Message.sources` (`kind: "vault"`), `Message.templateId` — and search ignored all three.

**Decision 1 — one graded matching rule, in one place.** `services/tokenMatch.ts` returns a *strength*, not a boolean: exact `1`, prefix `0.9`, infix `0.6` (the compound case), reverse prefix/suffix `0.5`. The caller multiplies the token's IDF weight by it, so a compound hit is a real hit that still ranks below the word the user typed. Boolean matching could not express that — an infix hit on a rare token would outrank an exact hit on a common one.

**The length floors are the whole safety story.** A 2–3 character stopword ("in", "der") reverse-matches every long query token; without `MIN_REVERSE_HEAD`/`MIN_REVERSE_TAIL`/`MIN_INFIX_QUERY` the result set becomes the corpus, which is the same as no search at all. The tail floor is higher than the head floor because a compound's tail is where the accidents live: "Mietvertrag" ends with "trag" as well as with "vertrag".

**A loosened rule needs a floor at the other end too.** `score > 0` stopped being a sufficient filter the moment weak matches were possible, so `applyRelevanceFloor` drops anything below 15% of the best score. **Relative, not absolute**: IDF weights move with corpus size, and an absolute cut-off would mean different things in a 20- and a 2000-conversation vault.

`bestMatchSnippet` goes through the same function. A second, stricter copy of the matching rule is how a row surfaces on a compound hit and then shows no snippet — silence where an explanation belongs.

**No edit distance.** Typo tolerance is a separate decision with its own noise budget and its own cost profile; it is not smuggled in under this one.

**Decision 2 — widen the *dimension*, not the corpus.** The tempting version was a second index: vault notes as their own result rows. It was rejected, and the reasons are the design:

- **Pythia searches conversations; Obsidian searches notes.** Rebuilding vault search inside a sidebar competes with a better tool one keystroke away.
- **Scores from two corpora are not comparable.** IDF is relative to the document set, so merging two ranked lists into one is silently arbitrary.
- A second row kind would have to answer to pick mode (ADR-143), the keyboard model, the delete control and the fork indent — none of which mean anything for a note.

So a result is always a conversation, and what widens is the **haystack**. `ConversationFields` splits the searchable text into `title` ×3 · `notes` ×2 · `summary` ×1 · `body` ×1, replacing ADR-107's hard-coded "title hit ×3" with a weight per field, and the scope selects which fields are scored. `notes` ranks near a title because a note name is a *curated* label — and unlike a summary it was written by the user, not generated.

**Attached and cited notes weigh the same.** A citation is at least as strong evidence that the conversation was about that note: the model reached for it while answering rather than merely being handed it. The note dimension therefore costs **no vault I/O at all** — every path is already in `data.json`.

**Note bodies are deliberately not in v1.** Matching note *content* needs `cachedRead` over the union of attached paths, an async loading state, and its own weight (a long note's borrowed text otherwise drowns out the conversation's own words). It is the "I remember a phrase from the note" case, which Obsidian's own search already serves. The same keyword extends to it later without new syntax.

**Decision 3 — the scope is typed into the query, not added to the chrome.** `note:` · `conv:` · `all:` (with German aliases — this is a German-first plugin), parsed by `services/searchScope.ts`. No prefix means conversations, exactly as before. An **unknown** prefix is literal text, never a failed command, so "todo: rewrite the intro" stays a search. The panel has no chrome to spare, and a filter control would have to be built, translated, made keyboard-reachable and made to survive the mobile keyboard.

**Decision 4 — an automatic widening is never silent.** Syntax nobody discovers is not a feature, so a query that returns **fewer than 3** conversation-text hits also searches the note dimension. But a widened row does not visibly contain the query anywhere, which makes it exactly the row a user cannot explain — so it is announced three ways, all reusing what the panel already has:

- an `ALSO IN NOTES` group header (`.p-history-group`, the browse listing's own component) — widened rows never mix into the text hits;
- **`via <note>` on every widened row**, a bare accent vault name in the existing sub-line, no brackets, as in the sources row (ADR-153);
- the ADR-109 chip, which solved this identical problem once already: a mode the user did not type is active, here is a label and an ✕. On a phone, where the chip is easiest to miss, one `Notice` per panel open as well.

**The rule, stated so a test can fail in the forbidden direction: the chip announces what the user did *not* ask for.** A typed `note:` gets the `via` line but no chip and no group header — explaining back a scope the user chose themselves is noise. Widening never fires on an empty query (that is the browse listing) and never while picking a conversation (ADR-143: the panel is naming a target, and an unexplainable row is worse there than a short list).

**The chip's ✕ writes `conv: ` into the box** rather than flipping a hidden flag. The grammar is the control, so the undo is also where the user discovers the grammar exists.

**Consequence.** `rankConversations` takes fields and a scope instead of haystacks; `buildConversationHaystack` is gone — one builder per fact. The command-palette modal (`ConversationSuggestModal`, which ADR-143 kept for entry points that can run with no view open) shares the same `searchConversations`, so the palette gained the scope grammar, the widening and the `via` line for free. The panel's per-keystroke cost is unchanged: fields are memoized for the life of the overlay exactly as tokens were (ADR-161's principle 5), and the second ranking pass runs only in the thin-result case. +50 tests (1128 across 72 files).

**What this does not do.** It does not find a note never discussed; it does not tolerate typos; it does not match text inside a note. The first is Obsidian's job, and the other two are named above as later work behind the same keyword.


### ADR-169 — The related-conversations floors are measured, per model; and the index warms in the background

**Date:** 2026-09-17
**Status:** Accepted — revises ADR-109's scoring constants; the tool is `scripts/measure-related.mjs` (PR #147)

**Context.** Related conversations (ADR-109) ranked by max-pairwise cosine against three hard-coded floors — `strict 0.5` / `balanced 0.35` / `loose 0.2` — shared by two models whose score distributions had never been compared. Nobody could say what 0.35 *meant* on either model, which made every proposed change to the scoring a matter of taste. Three hypotheses were on the table: the floors are wrong; matches are driven by title+summary boilerplate; max-pairwise should become a mean of the top k.

**So it was measured first.** `scripts/measure-related.mjs` reads a real `data.json`, embeds with `@huggingface/transformers` in Node, and imports the REAL `conversationChunks`, `quantize` and `cosine` from the TypeScript sources — a reimplementation of the chunker would have measured a different system. Run on a 24-conversation vault, 554 chunks, 276 pairs, against both models. **The decision rules were written down before the numbers were read**, which is the only reason the refutations below were accepted rather than explained away.

**Finding 1 — the default floor was below the noise floor.**

| | multi | en |
|---|---|---|
| p50 of ALL pair scores | 0.462 | 0.341 |
| p90 | 0.643 | 0.567 |
| best-neighbour p50 | 0.751 | 0.671 |
| median results at `balanced` 0.35 | **19 of 23** | **11 of 23** |

`balanced = 0.35` sits *below the median score of a randomly chosen pair* on the default model. It was not filtering; it was listing. Even `strict` returned a third of the vault.

**Finding 2 — per-model floors are justified, by the pre-registered rule.** The rule was "a p90 gap above 0.05". It is **0.076** — and three independent estimators (p90, best-neighbour median, the floor calibrated for ~5 results) all put the offset at **~0.08**. The multilingual model scores every pair hotter, as paraphrase-multilingual models do. One shared constant therefore meant two different features depending on a dropdown in a different part of settings. The floors now live on the model (`EMBEDDING_MODELS[...].relatedFloors`), anchored to each model's own p75/p90/p95: **multi 0.55 / 0.65 / 0.75**, **en 0.45 / 0.57 / 0.67**.

**Finding 3 — the boilerplate hypothesis was wrong.** Predicted: >30% of winning pairs would be lead-chunk-to-lead-chunk, because summaries share one generated register (ADR-141's `SUMMARY_RULES`). Measured: **2.2%** (multi) and **0.4%** (en). Max-pairwise is matching content, not prompt style.

**Finding 4 — top-k mean was cancelled.** Its justification was Finding 3, which died. And independently: switching to mean-of-top-3 changes the #1 neighbour for **0 of 24** conversations on multi and 3 of 24 on en, with no evidence the reshuffle is an improvement. A change that is a no-op on one model and unexplained churn on the other does not get written.

**Finding 5 — an unpredicted one: the cold first click.** 554 chunks took **135s** through onnxruntime-node (~4 chunks/second); the English model is **4.4× faster** at 30.5s. At 23 chunks per conversation, a 200-conversation vault is **~19 minutes** cold — and the app runs WASM, not the native runtime, so slower, and on the iframe fallback (ADR-126) that is the UI thread. The first click on a grown vault was not slow; it was unusable. This outranked the floors.

**Decisions.**

1. **Per-model floors, on the model.** `relatedMinScore(preset, modelId)`. A constant that describes a model belongs next to it, and a test requires a floor for every preset of every catalog entry — a model added without floors would silently inherit another's numbers, which is the bug this ADR exists to fix. The cross-model assertion is **directional** (multi > en at every preset), so a re-measurement that moves the numbers does not break the suite; only a re-measurement that reverses the relationship does.
2. **Vault RAG keeps the old constants.** `VaultRagService` shared `relatedMinScore`, but it scores a query against note chunks, not a conversation against conversations — this ADR measured nothing about it. Retuning it on data that does not describe it would be guessing with extra steps, so `vaultRetrievalMinScore` keeps 0.5 / 0.35 / 0.2 and a test fails if the two are merged again. **Measure it separately before touching it.**
3. **A result limit, which now matters more than the floor.** `getRelated` always accepted `limit` and nothing ever passed it. The number of pairs clearing a fixed cosine grows **linearly with vault size**, so without a cap the list length is a function of how big the vault is rather than of relevance. Floor is the quality gate; `RELATED_RESULT_LIMIT = 20` is the screenful.
4. **Background warm at layout-ready**, in `services/embedding/warmIndex.ts`, so the first click is a ranking pass. Three guards, each load-bearing and each unit-tested because `main.ts` is excluded from coverage: **an index must already exist** (a missing `.bin` means the model was never downloaded, and a ~100 MB download nobody asked for at launch is not a warm), **desktop only** (the iframe fallback is the UI thread), and **two conversations minimum**. Fail-open and silent — the one catch in this codebase where silence is right, and it is logged rather than inferred (principle 2). The provider is built with `silent: true` so the "preparing the model" Notice does not fire for work the user did not request.
5. **A cancellable sync.** `sync(conversations, { signal })` aborts between conversations, and **commits what it already embedded before rethrowing**, so a cancelled cold build leaves the next one less to do rather than starting over. The panel aborts on close, on leaving related mode, and on the first keystroke of a search; an abort is the panel's own doing, so it reports nothing. The coalescing `await this.syncing` swallows rejections — a waiter must not inherit the previous caller's cancellation.

**What is NOT decided, deliberately.** Percentile-based floors — the striking part of the data is that the floors calibrated for ~5 results land at roughly the **p75–p78 of each model's own distribution**, i.e. the same *percentile* ports across models where the same *constant* does not. That is the better design, and it needs a second vault to confirm before it replaces three constants with a runtime computation. Engineering-review #269.

**Scope of the evidence, stated plainly.** One vault, 24 conversations, 276 pairs. The p90 *gap* is a property of the models and generalises. The absolute constants are a first estimate from one corpus — which is exactly why the percentile idea stays open rather than being ruled out, and why the numbers are recorded here with the command that produced them.

**Consequence.** `main.ts` crossed the 600-line ceiling and was split rather than grandfathered (`warmIndex.ts`, `host/workerBundleUrl.ts` — 590 → 599). +16 tests (1144 across 73 files).


### ADR-170 — The search panel's cost stops scaling with the vault

**Date:** 2026-09-17
**Status:** Accepted — completes ADR-168; the benchmark is `scripts/bench-search.mjs`

**Context.** ADR-168 shipped graded matching and the note dimension without measuring what a keystroke costs. ADR-169 then established the habit of measuring before tuning, so the same question was put to the search panel. Measured with the real functions on a synthetic corpus, one keystroke = rank + render:

| Vault | Rank | Snippets | Total per keystroke |
|---|---|---|---|
| 24 conversations | 1.0 ms | 14.5 ms | 15.6 ms |
| 200 | 0.4 ms | 84.8 ms | 85.2 ms |
| 500 | 0.8 ms | **398.1 ms** | **398.9 ms** |

**Ranking is free.** The graded `matchStrength`, the per-field scoring and even the second ranking pass when auto-widening cost under 1 ms together — the things most likely to be "optimized" on instinct were never the cost. `bestMatchSnippet` was 99% of it, through two compounding mistakes:

1. **It re-tokenized every line of every message on every keystroke.** Lines do not change between keystrokes; only the query does.
2. **The result list was uncapped**, so every match rendered a row, and every row ran a full snippet scan over its whole conversation.

**Decision 1 — cache the line tokens, on the fields, lazily.** `ConversationFields.lines` is `null` until the first snippet request for that conversation. Eager construction was rejected: line tokens are by far the largest thing this module produces (every line keeps its own array *and* its text, where the scored fields are deduped token sets), and building them for the whole corpus on panel open would trade a per-keystroke cost for a permanent memory one on a device that may be a phone. Only conversations that actually render ever pay, and at most `SEARCH_RESULT_LIMIT` of them do.

`bestMatchSnippet` therefore **requires** the conversation's fields rather than taking them optionally. An optional cache is a slow path that survives, and this is the call that runs once per rendered row per keystroke.

**Decision 2 — cap the rendered rows at 20**, in the pure layer so the panel and the command-palette modal inherit it together. This is ADR-169's argument applied to the surface it was not applied to: *the number of conversations matching a short query grows with the corpus, so an uncapped list makes cost a function of vault size rather than of relevance.* The cap slices an already-sorted list, so the best rows survive it, and it is applied **after** the widen decision — which fires below `WIDEN_MIN_RESULTS`, far under the cap, so capping can never change it. A test asserts both.

**Result**, from `scripts/bench-search.mjs`, worst keystroke while typing a word one character at a time:

| Vault | Before | After | Rows |
|---|---|---|---|
| 24 | 15.6 ms | 19.4 ms | 20 |
| 200 | 85.2 ms | 15.9 ms | 20 |
| 500 | **398.9 ms** | **10.5 ms** | 20 |

The point is not the multiple, it is the **shape**: the cost no longer grows with the vault. What remains is paid once on panel open (`fields`, 118 ms at 500 conversations) and on the first keystroke that renders a given conversation.

**A type that stopped a future bug.** Adding `lines` to `ConversationFields` broke `Record<keyof ConversationFields, number>` for `FIELD_WEIGHTS` — the compiler correctly refusing to let a cache slot become a weighted field. Rather than widen the record, the scored keys got their own name: `ScoredField`. A new cache slot can now be added without the type system asking what its search weight is.

#### ADR-170 addendum — three defects found reviewing ADR-169's own diff

Reviewing the previous day's merge rather than trusting it turned up three, all in code written hours earlier:

1. **The background warm read the entire index to ask whether it existed.** `VaultIndexStore.read()` does `exists()` then `readBinary()`; the warm used only the null check. On a large vault that is several megabytes decoded and discarded at every launch. `exists()` now answers the question it was asked.
2. **The warm's timer outlived the plugin.** `window.setTimeout(...)` with nothing cancelling it: disabling the plugin inside the delay ran the warm against a torn-down instance. It is now registered for teardown — the convention the same file demonstrates a hundred lines below.
3. **`warmIndex` stated its own guard twice** — an early return for the cheap half plus `shouldWarmIndex` for all of it. The cheap pre-check is right (it avoids a disk call on mobile), but a rule in two places drifts. Split into `canWarmBeforeIndexCheck`, which `shouldWarmIndex` composes, with a test asserting the two can never disagree.

Also: `DEFAULT_MIN_SCORE` was exported and used nowhere outside its own module — now private, because an exported constant invites a second source of truth. And `tokenScore` allocated a notes array for every (conversation × query token) pair even under the default scope, which never scores notes; it is now allocated on first match.

**The lesson worth keeping:** the ADR-169 diff was reviewed, tested and green, and it still carried a megabyte-per-launch read and a timer leak. Measuring the thing you changed does not review the thing you wrote.

---

### ADR-171 — A number being typed is not a setting, and lowering the cap is a deletion

**Context.** A user set the conversation history limit ("Gesprächsverlauf-Limit", `maxConversations`) to 0 — documented in both locales as *unlimited* — and was left with only the conversations that held a starred passage.

`evictConversations` is not the bug: `cap <= 0` returns the input unchanged, with a test that says so. The path to the data loss was the field, and the save behind it:

1. `settings.ts` bound every numeric field with `TextComponent.onChange`, which fires **per keystroke**, and stored any value that parsed and cleared the floor. Lowering "200" to "0" is four events — `20`, `2`, `""` (rejected), `0` — and the two intermediate ones are valid caps.
2. `saveSoon()` behind it is a 400 ms debounce. It resets on each keystroke, so it only fires mid-edit when the user pauses — deleting three digits and thinking for half a second is enough.
3. `PluginDataStore.persist()` evicted on **every** write, settings and secrets included. So a transient `2` deleted every conversation without a favorite, an open leaf or an inbound merge link, and then wrote data.json. No prompt, no notice, no undo — and the final `0` that the user actually intended arrived at an already-emptied list.

The failure needed all three, but each is wrong on its own terms. Eviction is a destructive write reached through a control that looked like a preference; the engineering principle "a write that can destroy content is a distinct operation" (ADR-159) was never applied to it, because from `persist`'s side it is one line about a cap.

**Decision.**

**A field being typed in is not a setting.** `ui/numberSetting.ts` holds the one rule: `parseNumberSetting` (pure — floor, optional ceiling, integer or decimal, and whether an empty field means *unset* rather than *invalid*) and `bindNumberSetting`, which shows the stored value and commits **on blur or Enter**. A rejected entry restores the stored value instead of clamping to something the user never typed. All six numeric settings fields go through it; `settings.ts` holds no `parseInt` any more. Closing the settings tab destroys the input before `blur` fires, so the binder returns its commit function and `PythiaSettingTab.hide()` runs the pending ones before flushing the debounced save.

**Only a conversation write applies the cap.** `persist({ evict })` now defaults to **off**; `saveConversations()` is the single caller passing `true`. A settings save and a secret save cannot delete a conversation at all — which is what makes the transient value harmless even if one is committed.

**Lowering the limit names what it deletes and asks.** `countEvictions` (pure, in `persistence.ts`) reports how many conversations a cap would remove, derived from `evictConversations` itself rather than from a second copy of its protection rules — a dialog that promises one number while the write performs another is worse than no dialog. Above zero, `ConversationCapModal` states the count and what survives (starred, open, merge target); Escape and the outside press count as no, and a cancelled dialog puts the stored limit back in the field. Only a confirmation writes, through `saveConversations` — the one save that evicts.

**Both settings descriptions say "deleted permanently"** and name the three protections. The old wording, "oldest non-starred conversations are removed when the limit is reached", reads like a cache eviction.

**Consequences.**
- The cap no longer applies the instant it is lowered by a settings write; it applies on the next conversation save, or immediately when the user confirms the dialog. That is the point — deletion follows a decision, not a keystroke.
- A conversation count above the cap can now persist for a while (between a confirmed lowering and the next conversation write). Nothing reads the cap except the eviction, so nothing else notices.
- `parseNumberSetting` rejects rather than clamps, so a field that is temporarily out of range simply snaps back on blur. Rejecting with no message is acceptable here only because the stored value reappears in the field — the user sees that the entry did not take (principle 2: silence is a bug).
- Not done, deliberately: **the default limit is still 200 and eviction is still silent when reached through normal use.** A conversation deleted because the 201st arrived gets no more warning today than it did before. The honest options are a much higher default, an archive-to-note step before deleting, or unlimited by default with a size warning — a product decision, recorded as engineering-review #291, not smuggled in with a bug fix.


---

### ADR-172 — The limit archives before it deletes, and "no limit" is an empty box

**Date:** 2026-09-18
**Status:** Accepted — closes engineering-review #292, which ADR-171 deliberately left open

**Context.** ADR-171 stopped the conversation cap from deleting while a number was being typed. It did not change what the cap *is*: at 200 conversations, the 201st still deleted the oldest unstarred one, permanently, with nothing said and nothing left. Two things were wrong with that, and one with how the limit was expressed.

**Decision 1 — a conversation is written to the vault before it is dropped.**
`archiveBeforeEviction` (**on by default**) and `archiveFolder` (`Pythia/Archive`). `NoteWriter.archiveConversationNote` writes one note per conversation: frontmatter Obsidian can query (`type`, `conversation`, `created`, `updated`, `provider`, `model`, `messages`, `archived`, `source` deep link, `context`) and the full transcript under `## You` / `## Pythia` headings, citation markers stripped. The builders are pure (`services/conversationArchive.ts`) and tested.

The vault is the durable store; `data.json` is a working file. Making eviction a **move** rather than a loss is what turns the cap back into a housekeeping setting — and it is why the default is on. A user who never opens the settings is exactly the user this protects.

**The order is the decision.** `applyCap` archives first and drops only what was written:

- a failed write **keeps** the conversation (`data.json` stays over the cap until the vault can be written — the right way round for a limit whose only job is to save space),
- `archiveConversationNote` goes through `createNote`, which refuses an existing path, and `archiveNotePath` suffixes until the path is free: two conversations may share a name and a day, and overwriting one with the other would destroy exactly what the archive exists to preserve,
- **both outcomes speak.** Archived, deleted-because-archiving-is-off, and could-not-archive each raise a `Notice`. Silent eviction is the bug this pair of ADRs is about (principle 2).
- One eviction at a time (`evicting` flag): `persist` can be re-entered while the archive is writing, and the second pass would archive the same conversation twice.

`partitionEvictions` returns `{ kept, removed }` and is now the one rule — `evictConversations` and `countEvictions` are both expressed through it, so the archive writes exactly the conversations the dialog counted and the eviction drops.

**Decision 2 — "no limit" is an empty field, not the number 0.** `maxConversations === 0` remains the stored form (no migration, and `evictConversations` already treats `cap <= 0` as unlimited), but the settings field shows **an empty box** for it, with a `no limit` placeholder. A value the user has to know means "unlimited" is a magic number: the reporter in ADR-171 typed exactly that, correctly, and lost their conversations on the way to it. The two representations meet in one place — `capFieldValue` and the field's `read` in `ui/conversationCapSetting.ts` — and nowhere else. The message cap gets the same treatment, because two "unlimited" conventions in one settings pane would be worse than either.

**Consequences.**
- The cap now costs vault I/O when it fires. It fires rarely (once per conversation past the limit), and the write is one note.
- The archive folder grows without bound by design. That is the point: it is Obsidian's problem now, in a format Obsidian can search, and it is the user's to prune.
- Typing `0` still parses and still means no limit; the field normalizes itself to empty on commit, so the magic number cannot be *read back* even when it can be typed.
- `settings.ts` crossed its ceiling twice during this change and was extracted twice: `ui/conversationCapSetting.ts` now owns the field, its dialog and the empty-box rule. 565 → 528 lines across ADR-171/172.
- Not done: **an explicit delete is still an explicit delete.** `DeleteConversationModal` does not archive — the user asked for that one, and filling the vault with notes for deliberate deletions is a different feature with a different default.

---

### ADR-173 — The delete dialog offers the archive

**Date:** 2026-09-18
**Status:** Accepted — closes engineering-review #293

**Context.** ADR-172 made the *automatic* eviction archive first. That left `DeleteConversationModal` as the only remaining path that destroys a conversation with no copy anywhere — and ADR-172 argued for leaving it alone, on the grounds that a deliberate delete is intent and that filling the vault with notes for deliberate deletions is a different feature.

Half of that still holds: it should not be automatic. The other half was wrong. "The user meant it" answers whether to ask; it does not answer *what to offer*. The moment of deleting is the only moment anyone knows whether this particular conversation mattered, and that is exactly when the cheapest possible save is worth one button.

**Decision.** Three buttons: **Archive** (`mod-cta`, leading) · **Delete** (`mod-warning`) · **Cancel**, with a hint line naming the folder. Archive writes the note and then removes the conversation; Delete removes it as before.

- **It is a choice, not a setting.** `archiveBeforeEviction` governs the automatic path, where nobody is present to be asked. Here somebody is, so the dialog asks rather than remembering a preference the user set months ago for a different conversation.
- **Both are one tap.** A safe option that costs an extra step (a checkbox to tick first, a second confirmation) is one people learn to skip, which would leave the dialog's safe path unused and the appearance of safety in its place.
- **Fail-closed, the same rule as the eviction.** `ConversationService.archiveConversation` returns `false` when the note could not be written, having already said why; the caller then does not delete. The conversation stays, which is the only acceptable outcome when the copy does not exist.
- **`archiveFolderOf(settings)`** now resolves the folder for all three callers (the eviction, the limit's dialog, this one). It was written out twice during ADR-172 and would have been three times here — the fallback for a cleared setting is one fact.

**Consequences.**
- Deleting is now a two-option decision, so the dialog is a beat slower to read. Acceptable: it is the one dialog in the plugin whose wrong answer cannot be undone.
- The archive folder can now grow from deliberate deletions too. Still Obsidian's problem to search and the user's to prune (engineering-review #294 is the readout that would make its size visible).
- No new setting. If "always archive on delete" turns out to be what people want, the dialog's own usage is the evidence for it, and a remembered default can be added later without changing the two actions.

---

### ADR-174 — The limit is measured in bytes, and the list is paged

**Date:** 2026-09-18
**Status:** Accepted — closes engineering-review #295–#297; the design it defers is #298

**Context.** ADR-171 to ADR-173 made the conversation cap safe. None of them asked whether its number was right, or what it was protecting against. Measured with the new `scripts/bench-store.mjs` (real functions, synthetic ~22 KB conversations; Node on a dev machine, so Obsidian mobile is several times slower):

| vault | data.json | rewrite per turn | startup parse |
|---|---|---|---|
| 200 | 4.5 MB | 19 ms | 12 ms |
| 450 | 10 MB | 45 ms | 23 ms |
| 1 000 | 22 MB | 87 ms | 66 ms |
| 2 000 | 45 MB | 179 ms | 133 ms |

**Decision 1 — the default cap is 450, and a vault still on 200 moves to it.** 200 capped `data.json` around 4.5 MB, an order of magnitude below where anything is felt: the default was deleting conversations for no gain. A saved 200 is migrated because it is the fingerprint of never having touched the field, and raising a cap can only ever keep more. Any other stored value, including `0`, is the user's.

**Decision 2 — the warning is a size, because the cost is a size.** The limit counts conversations; the price is bytes, since the whole file is rewritten after every message and a synced vault moves all of it again. A hundred long research conversations outweigh a thousand short ones, so a conversation count cannot be the trigger. `services/storageSize.ts` (pure, tested) holds `warn` at 25 MB and `high` at 50 MB, both read off that table — where a turn starts costing tens of milliseconds, and where that has roughly doubled and the startup parse is felt.

It surfaces twice, deliberately unequal: the settings tab **always** prints `Storage: 23.4 MB in data.json, 1 040 conversation(s)` under the limit — the number is the reason the setting exists and nothing else in the app exposes it — and a `Notice` fires once per load only at `high`. A warning the user has already acted on, repeated every launch, is how people learn to dismiss warnings. A size that cannot be read prints nothing rather than a zero: an invented number here would read as reassurance.

**Decision 3 — the browse listing is paged, and forks are indexed once.** Search has been capped at `SEARCH_RESULT_LIMIT` since ADR-170; the empty-query listing had no cap, so opening the panel built a row, a sub-line and three listeners for **every conversation in the vault**. Worse, it looked up each source's forks with `all.filter(…)` inside the loop over sources — quadratic, 28 ms of pure filtering at 2 000 conversations and 528 ms at 5 000, next to a `forkCounts` map built two lines above for the ⑂ badge.

Now `forksBySource` is built once per list build and both readers share it — the badge is `…get(id)?.length`, so the count and the rows cannot disagree — and `BROWSE_PAGE_ROWS = 50` draws a page with the rest behind a `show more` row that **appends** rather than rebuilds. 50 rather than 20 because the page has to fill a desktop panel, or the control appears before the user has scrolled. A source and its forks are always drawn together, so a page may overshoot: the fork indent means nothing once its parent is on the other side of a page break.

**Consequences.**
- At the new default the numbers are comfortable (10 MB, 45 ms per turn) and the readout stays quiet until roughly 1 100 conversations.
- The thresholds are constants read off one measurement on one machine. They are in a pure module with tests and a documented table so the next person can re-measure with the script rather than argue about the number.
- Paging changes what ↑/↓ can reach: keyboard selection covers the rendered rows, so a conversation past the page needs `show more` first. Search — which reaches everything, capped and ranked — is the way to find a distant conversation, and it is one keystroke away in the same panel.
- **None of this is the fix.** Every message still pays for the whole corpus. `scripts/bench-store.mjs` and `storageSize.ts` exist so that the point where that stops being acceptable announces itself instead of being discovered. The fix is engineering-review **#298** — an index plus one file per conversation — designed there in full, deliberately not scheduled: its real cost is not the storage layer but making `plugin.conversations` a loader rather than a live array, and nothing in a vault at today's sizes has earned that yet.

---

### ADR-177 — A template applied to a running conversation is a one-shot

**Date:** 2026-09-18
**Status:** Accepted

**Context.** One verb did two jobs. Creating a conversation *from* a template means "this conversation is this template" — the fields belong to it, permanently, and that is right. Applying a template *to* a conversation already running means "do this one thing now" — and it did the same permanent thing:

```ts
conv.systemPrompt = tpl.systemPrompt;   // and templateId, provider, model,
conv.maxTokens    = tpl.maxTokens;      // maxTokens, temperature, effort,
conv.writeMode    = tpl.writeMode;      // resumeMode, writeMode, contextNotes
```

Nine fields overwritten, no record of what they were, no way back. Applying a "Term Note" template to write one glossary entry left the conversation on that template's cheap model with its 2 000-token cap **for every later answer** — a truncation three turns later with no visible cause. It also silently dropped `output_folder`, which is only read when a template *creates* a conversation, so the one field the user set to control where notes land did not apply on this path at all.

Two smaller things fell out of the same confusion: the settings a template changed were invisible (engineering-review #258), and `Message.templateId` — documented as "the template active when this answer was produced" — could only ever mirror the conversation's.

**Decision — the applied template is a layer, not a write.**

`Conversation.pendingTemplate` holds a **snapshot** of what the template contributes, armed when it is applied and spent on the next committed answer. `services/pendingTemplate.ts` is pure and does both halves: `armPendingTemplate` takes the snapshot, `applyPendingTemplate` returns the conversation as *this turn* should be sent — the template's values over a clone, the conversation's own for everything it does not set, notes unioned with the user's first.

- **Nothing is stored.** This is engineering principle 6 — inherited stays inherited — applied to a whole template rather than one override. The resolution chain gains a layer: `pendingTemplate ?? conversation ?? settings ?? model default`.
- **A snapshot, not the path.** An edit to the template file between arming and sending must not change the turn under the user — the same reasoning as ADR-163's per-message cost.
- **Sent as a clone**, the way a comparison candidate already is (ADR-160) and an auto-armed web search already is (ADR-099). No provider changes: they receive a conversation and read it.
- **Cleared on a committed answer, not at send start.** An errored or empty reply leaves it armed, so the retry is the same shape.
- **One-shot, re-armed by hand.** "Applied until removed" was the alternative and is a two-line change in the clear step; the user asked for re-adding, and a template that expires cannot outlive the reason it was applied.
- **`templateId` on the answer becomes true**: it records the template that actually shaped that turn, so the sources row under the answer needed no change and now reports something the conversation's own field could not.
- **Visible while armed**: a pill leading the reference row, `Term Note ✕`, with no `[[ ]]` brackets — it is not a note in context, it is the thing shaping the turn — and its ✕ is how you disarm without sending.
- **Validated on the read path** (`sanitizePendingTemplate`). It reaches the send path directly: its `systemPrompt` becomes the prompt and its `writeMode` decides which tools the model gets. A malformed one is dropped, not repaired — losing an armed template costs one re-apply, and re-arming is the whole gesture.

**Consequences.**
- Creating from a template is unchanged: those fields still belong to the conversation.
- `resume_mode` in a template no longer applies on this path. It is the one field with no per-turn meaning — history selection is a property of the conversation, not of one answer — and silently pinning it was part of the bug.
- A conversation that had a template applied before this change keeps those fields; they were written and this ADR does not unwind them. New applications write nothing.
- The armed template survives a reload, because it is on the conversation and persisted. That is intended: arming is a deliberate act and the pill is on screen to say so.
- Engineering-review #258 shrinks again: the template's effect is visible *before* the send as a pill, and *after* it on the answer. What remains is reading the prompt text itself.

---

### ADR-178 — Rewriting a passage: the user picks the target, the model proposes, the write is its own step

**Date:** 2026-09-18
**Status:** Accepted

**Context.** The scenario is ordinary and had no path through Pythia: a note is open, the user talks to Pythia about part of it, and then wants that part changed. Everything for it existed except the one thing that matters. `Send selection to Pythia` starts a *new* conversation, throwing away the discussion that is the whole point. `rewrite_note` replaces a note **entirely**. `Insert into note` writes at wherever the cursor happens to be. Nothing could say *this passage, that answer*.

**Decision — an action, not a tool.**

The obvious implementation is a fourth write tool, `rewrite_selection`, called by the model. It is the wrong one: a tool means the **model** chooses the target, which means re-identifying the passage by its text at write time. ADR-096 spent three rounds on exactly that for fork selections, where the cost of a miss was a highlight that did not paint. Here the cost of a miss is a paragraph overwritten somewhere else in the user's note.

So the target is captured, not found:

1. **The user arms it from the editor** — a command and a context-menu item on a selection — which records `{ path, from, to, text }`: the range *and* the passage that was in it. `Conversation.pendingRewrite` holds it.
2. **It stays armed** until applied or dismissed. Unlike ADR-177's one-shot template, a rewrite is iterated — "shorter", "keep the second sentence" — and each answer while a target is armed is another proposal for the same passage.
3. **The passage rides in the message, not the system prompt**, wrapped in `<rewrite_passage>` with an output-only instruction, so a follow-up turn can still see what is being rewritten.
4. **The answer is a proposal.** Nothing is written when it arrives. A card under it offers *Replace in note · Copy · Discard* — a write that can destroy content is a distinct, named operation (ADR-159's corollary), and here the destruction would be of the user's own prose.
5. **Verify, then write.** `targetState` compares the range's current text against what was captured — **exactly**, no trimming, no whitespace normalization. `ok` writes; `stale` and `gone` refuse and say which, leaving the answer on screen to paste by hand. "Close enough" is the wrong test when the thing being replaced is a range: if the note moved by one character, the range already points at the wrong text.
6. **Through the open editor where possible**, because `editor.replaceRange` is one undo step and undo is the user's real safety net. A closed note is opened first rather than written blind.

`services/rewriteTarget.ts` holds the rule as pure functions over a string — `rangeText`, `targetState`, `replaceRange`, `targetLabel` — so the whole of it is tested without an editor.

**Two extractions paid for the change**, under the ADR-097 ratchet, and both were overdue:

- **`ui/referenceEntries.ts`** — which pills the reference row shows, and in what order, as a pure function. The row had quietly accumulated four unrelated things (attachments, outputs, auto-retrieved vault notes, the armed template) inside a DOM builder. The armed rewrite is the fifth, and it is a rule now, with tests. `sidebar.ts` 1730 → 1716.
- **`ui/editorSelectionEntries.ts`** — all three things a selection in the editor can do, together. Two of them were screens apart in `main.ts` and had drifted into near-copies. `main.ts` 602 → 564.
- `shouldAutoArmSearch` also moved into `services/sendPolicy.ts`: a four-term rule with no DOM in it, previously untestable where it sat.

**The locale tables are grandfathered** at 620 lines rather than split today. A line in `locales/*.ts` is one user-visible string, so the budget there measures vocabulary, not the structural discipline ADR-097 exists to bound. Splitting them per feature area is the real fix and is recorded as engineering-review #301.

**Consequences.**
- No `writeMode` involvement: this is not a model tool, so it works in a conversation where the model has no write tools at all. That is correct — the user is the one writing.
- A stale refusal will happen on a synced vault, and the message says which of the two reasons it was, because "nothing happened" is the failure this plugin has already been bitten by (principle 2).
- Applying is once: the card's affordance is spent and the target disarmed. Re-arm to apply again.
- Not built: multi-selection rewrites, and a diff view of what would change. The card shows the proposal as the answer already renders it; a real diff is a bigger piece and wants its own decision.
