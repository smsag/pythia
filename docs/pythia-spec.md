# Pythia — Product Spec

**Version:** 2.22.x
**Status:** Living document — rewritten 2026-09-18 from the 0.1 MVP draft ("Claude Vault Assistant"), which described a plugin that no longer exists
**Owner:** Steffen

---

## What this document is for

Three jobs the other docs do not do:

1. **The product framing** — problem, who it is for, what a user is trying to do. `architecture.md` says how it is built; this says why it exists.
2. **A shared vocabulary for the UI** — every surface, with the class name that targets it and the file that owns it. When a change is asked for, this is the page that makes *"the sub-line under a history row"* and `.p-history-sub` the same sentence.
3. **The deferred-decision register** — everything postponed, parked or deliberately not done, collected in one place instead of scattered across 175 ADRs and 300 review items.

| Question | Document |
|---|---|
| Why does it exist, what is it called, what was postponed | **this file** |
| How is it built — modules, data flow, dependencies | `architecture.md` |
| Why is it built that way — the reasoning behind each choice | `decisions.md` (ADRs) |
| What does it look like — tokens, components, CSS rules | `design.md` |
| What is wrong with it — defects, suggestions, status | `engineering-review.md` |
| How do I use it | `../README.md` |

Where this file and the code disagree, the code is right and this file is a bug.

---

## Problem statement

Chat assistants live outside the vault. Every session begins by transferring context by hand, and everything the session produces stays in a web app the user's notes cannot see. The knowledge worked out in conversation never becomes knowledge in the PKM.

**Expected outcome:** conversations are first-class vault objects — started from vault context, grounded in vault notes, writing back into the vault, and searchable alongside everything else the user knows.

---

## Who it is for

One person, precisely: **someone who already keeps their thinking in Obsidian.** Every design choice follows from that and not from "chat app with a vault plugin":

- The vault is the durable store; `data.json` is a working file. Anything worth keeping becomes a note (summaries, glossary entries, archived conversations).
- Obsidian's own machinery is preferred over a Pythia equivalent: properties over custom labels, Bases over a built-in browser, Obsidian search over a second search index.
- The panel must feel like part of Obsidian, not an app embedded in a panel (see `design.md`'s hard rules).

---

## User stories

| ID | As a… | I want to… | So that… | State |
|---|---|---|---|---|
| US-1 | Vault user | Start a conversation from the command palette | I never leave Obsidian | Shipped |
| US-2 | " | Start one with the active note or folder as context | I skip copy-paste | Shipped |
| US-3 | " | Use a template for system prompt + context notes | Recurring work starts consistently | Shipped |
| US-4 | " | Resume a past conversation | Work continues across sessions | Shipped |
| US-5 | " | Choose full history, summary or hybrid | I control token cost against fidelity | Shipped |
| US-6 | " | Save an answer as a vault note | Artifacts land in the PKM | Shipped |
| US-7 | " | Search past conversations | Sessions are part of my knowledge graph | Shipped (ADR-107/168) |
| US-8 | " | Have relevant notes pulled in automatically | I stop hunting for the right note | Shipped (ADR-116) |
| US-9 | " | Branch a conversation from a passage, or link one to another | Threads stay separable but connected | Shipped (ADR-057/130) |
| US-10 | " | Capture the meaning of a term where I met it | Vocabulary accrues instead of being re-asked | Shipped (ADR-136/150) |
| US-11 | " | Compare two models on the same prompt | Model choice is evidence, not folklore | Shipped (ADR-160) |
| US-12 | " | Know what an answer cost | Spend is visible before the invoice | Shipped (ADR-163) |
| US-13 | " | Keep old conversations without paying for them | Storage stops being a reason to delete | Partial (ADR-172/174; see D-1) |

---

## Scenarios

**S1 — Recurring artifact.** Palette → *New conversation from template* → "Job Application". Prompt, CV and reason-why notes load. The user pastes a job description, iterates, saves the draft to `Applications/`. The conversation keeps its own summary card and is findable by content months later.

**S2 — Asking the vault.** Vault context on. "What did we decide about the billing migration?" — the relevant notes are retrieved, cited by name under the answer, and appear as read-only pills in the reference row.

**S3 — Following a thread.** An answer contains a passage worth its own thread. Select → **Branch**. The fork inherits the prompt and template, opens empty, and both ends show the link. A term in the same answer is unfamiliar → select → **Define**, and it is a glossary note, marked everywhere it appears from then on.

**S4 — Housekeeping.** The vault passes the history limit. The oldest unstarred conversations are written to `Pythia/Archive/` as full transcripts, then removed from `data.json`; a Notice says how many and where. Nothing is lost that was not already in the vault.

---

## Commands

The palette carries eight entries; everything else lives inside `Pythia: Commands…`. The full table is in the README (single source, so it cannot drift twice). The sidebar opens from the ribbon icon or an `obsidian://pythia` link — there is deliberately **no** `Open sidebar` command.

---

## UI architecture

The view is one `ItemView` (`PYTHIA_VIEW_TYPE = "pythia"`), built imperatively into `containerEl.children[1]`. No framework, no shadow DOM.

**Naming convention:** `p-*` is the view's own vocabulary; `pythia-*` is used for marks inside rendered markdown and for surfaces that live outside the view (modals, action sheet, inline suggest). Both are in `styles.css`.

**Buttons** carry a role on top of their own class (ADR-188): `.pb` + `pb-primary` · `pb-secondary` · `pb-quiet` · `pb-destructive` · `pb-link` · `pb-icon` · `pb-seg` · `pb-tab` · `pb-chip-warn`. Ask for a button by its own class (where it is) and its role (how it looks): "the `.p-trunc-btn` secondaries".

### The panel, top to bottom

```
.pythia-view                                        sidebar.ts — the root; fills the leaf flush
│
├── .p-header                                       ui/HeaderController.ts
│   ├── .p-hdr-btn            (loupe)               opens .p-history with the search focused
│   ├── .p-title                                    conversation name, inert text, flex: 1
│   ├── .p-ctx-chip                                 attached-note count, when any
│   ├── .p-inst                                     the instruction group (ADR-165)
│   │   ├── .p-inst-seg.p-inst-model                → .p-model-pop
│   │   ├── .p-inst-seg.p-inst-effort               → .p-choice-pop / .p-sheet
│   │   └── .p-inst-seg.p-inst-lang                 → .p-choice-pop / .p-sheet
│   ├── .p-hdr-btn.p-hdr-menu (⌄)                   rename [↻ .p-choice-trailing = AI rename] · copy link · conversation settings
│   ├── .p-hdr-btn            (trash)               → DeleteConversationModal
│   └── .p-hdr-btn            (plus)                new conversation — always the last child
│
├── .p-ref-row                                      sidebar.ts — hidden when empty
│   └── .p-pills > .p-wikilink                      one per reference (template · rewrite · note · saved note · vault search)
│       ├── .p-source-icon · .p-wikilink-name · .p-wikilink-tokens   icon per source type (ADR-193)
│       └── .p-wikilink-x                           remove from context
│
├── .p-chat                                         sidebar.ts — the scroll area, flex: 1
│   ├── .p-inspector-wrap                           context inspector (what is in the prompt)  — a .p-acc like the summary cards (ADR-192)
│   ├── .pythia-fork-banner                         on a fork: "branched from …"   ui/ForkController.ts
│   ├── .pythia-merge-banner                        inbound merge links             ui/MergeController.ts
│   ├── .p-summary-cards                            ui/SummaryController.ts
│   │   └── .p-summary-card
│   │       ├── .p-acc-head > .p-acc-toggle         <button aria-expanded>: .p-acc-chevron · -icon · -title · -meta (ADR-192)
│   │       ├── .p-acc-actions                      ↻ .p-summary-card-regen (beside the toggle, never inside)
│   │       ├── .p-summary-card-body > .p-summary-card-md
│   │       └── .p-summary-card-footer              Kopieren · In Notiz speichern (pb-quiet); the timestamp is .p-summary-ts in .p-acc-meta
│   └── .pythia-messages-wrapper
│       ├── .p-turn-label                           ui/turnLabel.ts — model · time · tokens
│       │   └── .p-turn-cost                        ≈ $0.012, when showCost is on
│       ├── .p-msg-user > .p-bubble                 accent bubble, right-aligned
│       ├── .p-msg-ai > .p-ai-body                  rendered markdown, no container
│       │   ├── .p-cite                             numbered citation chips
│       │   ├── .p-scroll-frame                     wraps wide tables/code (ADR-131)
│       │   ├── .p-chart-card                       a ```pythia-chart block, drawn   ui/chart/card.ts
│       │   │   ├── .p-chart-head                   icon · title · .p-chart-actions (copy image · copy source)
│       │   │   ├── .p-chart-body > .p-chart-svg    responsive, re-laid out on resize — NOT pan-scrolled (ADR-210)
│       │   │   └── .p-chart-foot                   run-in "Sources:" + one entry per series source
│       │   └── marks: pythia-favorite · pythia-fork · pythia-merge · pythia-term · pythia-person
│       ├── .p-sources > .p-sources-row             Template: / Vault: / Web: (.p-sources-label)
│       ├── .pythia-tool-call                       write confirmation chip
│       ├── .p-note-write                           the ✓ chip of a note an answer wrote, redrawn from Message.noteWrites (ADR-218)
│       ├── .p-trunc                                cut-off card       ui/TruncationController.ts
│       ├── .p-compare                              comparison card    ui/ComparisonController.ts
│       ├── .p-answer-tabs                          a kept comparison's other answers, as tabs  ui/AnswerTabsController.ts
│       └── .p-del-bar                              delete · ⇄ compare · cancel  ui/ExchangeActionsController.ts
│
├── .p-index-wrap > .p-index-trigger  (#)           → .p-navigator      ui/NavigatorController.ts
│
└── .p-input-area                                   sidebar.ts
    ├── .p-composer                                 contenteditable; Enter = line break (ADR-175)   ui/ComposerField.ts
    │   ├── .p-composer-chip                        a note attached with # or dropped from the vault: library icon + name, reads as [[Name]] (ADR-213/214)
    │   └── .is-drop-target                         notes are being dragged over it (ADR-214)   ui/noteDrop.ts
    ├── .p-ctx-bar > .p-ctx-bar-fill                attached-note token budget
    └── .p-toolbar
        ├── .p-toolbar-left > .p-tool-btn           attach · save · globe (web) · library (vault context)
        ├── .p-send-hint                            token-limit warning   ui/SendHintController.ts
        ├── .p-model-hint                           optimizer's model suggestion (one send)   ui/ModelSuggestionController.ts
        └── .p-send-wrap > .p-send                  long-press → .p-send-menu
```

### Overlays and popovers

| Surface | Class | Owner | Opened by |
|---|---|---|---|
| Conversation panel | `.p-history` (inset 0 over the view) | `ui/HistoryController.ts` | header loupe, or pick mode |
| ↳ search row | `.p-switcher-search` · `.p-switcher-input` · `.p-switcher-clear` | " | always |
| ↳ list | `.p-history-list` → `.p-history-group`, `.p-history-row` | " | " |
| ↳ row parts | `.p-history-main` · `-row-title` · `.p-history-sub` · `-snippet` · `-via` · `-relate` · `.p-switcher-del` | " | " |
| ↳ badges | `.p-history-fork-count` (⑂) · `-fav-count` (★) · `-cost` · `.p-history-active` | " | " |
| ↳ paging | `.p-history-more` | " | past 50 rows (ADR-174) |
| ↳ chip | `.p-history-chip-wrap` | `ui/historyChip.ts` | related mode · auto-widened search |
| Navigator | `.p-navigator` → `.p-nav-section`, `.p-nav-item`, `.p-nav-tree-*` | `ui/NavigatorController.ts` | `#` button |
| Model picker | `.p-model-pop` → `.p-model-pop-row`, `-name`, `-good`, `-ctx` | `ui/HeaderController.ts` | `.p-inst-model` |
| Choice picker | `.p-choice-pop` → `.p-choice-row`, `-label`, `-detail` | `ui/choicePicker.ts` | effort / language segments |
| Mobile sheet | `.p-sheet` → `.p-sheet-scrim`, `-list`, `-item-*` | `ui/ActionSheet.ts` | the same, on touch |
| Send menu | `.p-send-menu` → `-icon`, `-label` | `sidebar.ts` | long-press on Send |
| Note picker | `.pythia-inline-suggest` → `.pythia-suggest-*` | `ui/InlineSuggest.ts` | `#` in the composer |
| Modals | `.pythia-modal` → `-desc`, `-hint`, `-buttons` | `suggest/*.ts` | various |
| Settings: section | a `Setting` heading plus `.pythia-section-intro`, the one sentence naming the section's remit | `ui/settings/section.ts` | every section of the plugin settings tab (ADR-209) |
| Settings: sections | Connections · New conversations · While answering · Prompt optimizer · On-device semantic search (+ Vault context) · Notes Pythia writes (+ Glossary) · History and storage · Troubleshooting | `ui/settings/*.ts`, ordered by `settings.ts` | the plugin settings tab; **only "New conversations" holds values a conversation can override**, and every row there says so |
| Chart card | `.p-chart-card` → `-head`/`-actions`/`-body`/`-svg`/`-foot`, and `--error` for a spec it cannot draw | `ui/chart/card.ts` | a ```pythia-chart block, in an answer **or in any vault note** — the plugin's only markdown code-block processor (ADR-210) |
| Settings: index status | a `Setting` row whose description is `.p-index-status-headline` + `.p-index-status-detail`; buttons *Build now* · *Rebuild index* | `ui/vaultIndexStatusSetting.ts` | the plugin settings tab, Vault context section (ADR-199) |

### Pinned content (ADR-216)

| Surface | Class | Owner | Opened by |
|---|---|---|---|
| Pin strip | `.p-pins` > `.p-pin` (a `.p-acc`) → `.p-pin-count`, `.p-pin-action` (`--open`: only while open), `.p-pin-text` / `.p-pin-rendered` | `ui/PinController.ts` | any pin; absolute at the top of `.pythia-messages-wrapper`, which carries `.has-pins` and `--p-pin-strip-h` |
| Pin button | `.p-pin-btn` beside Copy on `.p-code-actions`, `.p-diag-copy`, `.p-chart-actions`, `.p-table-actions` | `ui/pinSources.ts` (`appendPinButton`) | `decorateCodeBlocks(…, onPin)` — answers only |
| Table actions | `.p-table-block` > `.p-table-actions` (Copy · Pin) | `ui/tableDecorator.ts` | a table in an answer |

### Inline anchors (the three cards that open at a mark)

One component, three strokes on the left rule — solid fork, dashed merge, dotted term (ADR-138/142). Never restate a rule for one of them alone.

| Mark (in `.p-ai-body`) | Opens | Owner |
|---|---|---|
| `pythia-favorite` (yellow fill) | — (navigator entry) | `ui/HighlightPainter.ts` |
| `pythia-fork` (accent fill) | `.p-fork-anchor` → `-head`/`-icon`/`-label`/`-body`/`-meta` | `ui/ForkController.ts` |
| `pythia-merge` (dashed accent underline) | `.p-merge-anchor` (same parts) | `ui/MergeController.ts` |
| `pythia-term` / `pythia-person` (dotted / solid faint underline) | `.p-term-anchor` (+ `--person`) | `ui/GlossaryController.ts` |

The term anchor's meta row carries five controls (ADR-208): regenerate · `.p-term-anchor-sense` ("other sense", opening `.p-term-anchor-sensebox` / `-senseinput`) · remove · `.p-term-anchor-discuss` · open. The conversation that last one creates carries `Conversation.glossaryTerm`, which is what puts *Save to &lt;term&gt;* in the header menu (`ui/termDiscussion.ts`).

Marks nest; the innermost owns the tap (`ui/markTap.ts`).

### Asking for a change

Name the surface and the class: *"`.p-history-sub` should show the archive state"*, *"the `.p-inst` group wraps on a narrow phone"*, *"`.p-trunc` should offer X"*. That is unambiguous down to one file.

---

## Data model

`models/types.ts` is the source of truth. The shape, briefly:

- **`Conversation`** — identity (`id`, `name`, `createdAt`, `updatedAt`), what it sends (`systemPrompt`, `contextNotes`, `provider`, `model`, `resumeMode`, optional `maxTokens`/`temperature`/`effort`/`outputLanguage`/`writeMode`/`researchMode`/`vaultContext`), what it produced (`messages`, `summaryText`, `favoritesSummary`, `savedNotePath`), and how it relates to others (`forkedFrom*`, `merges`, `templateId`, `theme`, `comparison`).
- **`Message`** — `id`, `role`, `content`, `timestamp`, plus what that turn used and cost: `model`, `tokenUsage`, `cost` (snapshotted, ADR-163), `attachedNotes`, `sources`, `truncated`.
- **An optional field that is `undefined` means *inherit*** — never a copy of the resolved default (engineering principle 6). A control may show the default; it must not store it.

Everything else — templates, glossary entries, archives, summaries — is **a vault note**, not a record in `data.json`. That is the product position, not an implementation detail: notes survive the plugin.

---

## Non-functional requirements

| Concern | Requirement | Where it is enforced |
|---|---|---|
| Responsiveness | Work triggered by a keystroke is proportional to the keystroke, not the corpus | principle 5; `bench-search.mjs` |
| Storage | One message must not cost the whole corpus — measured, and the user is told the size | `storageSize.ts`, `bench-store.mjs`; **D-1** |
| Data safety | A write that can destroy content is a distinct, named operation; a failed archive keeps the original | ADR-171/172/173 |
| Privacy | Embeddings on-device; nothing leaves the vault but the provider calls and (opt-in) Tavily queries and the URLs it is asked to read | README → Data & Privacy |
| Reliability | Every boundary validates; the fallback is the default, never the raw value | principle 1 |
| Observability | Silence is a bug: a `Notice`, a `describeErrorForLog`, or a proof it is the idle case | principle 2 |
| Mobile | Every surface works in the phone drawer, with a soft keyboard over it | ADR-132/152/167 |
| Compatibility | Obsidian ≥ 1.4.0, desktop and mobile | `manifest.json` |

---

## Deferred & postponed decisions

Everything consciously *not* done, with the reason and what would make it worth revisiting. Numbered `D-n` here; the `#n` column points at the engineering-review entry that carries the detail.

### Product decisions awaiting a call

| # | Decision | Review | Position today | Revisit when |
|---|---|---|---|---|
| D-1 | **Split storage — an index plus one file per conversation.** Every message rewrites the whole `data.json` (87 ms at 1 000 conversations, and a synced vault moves all of it). | #298 | Designed in full, not scheduled. The real cost is making `plugin.conversations` a loader rather than a live array, not the storage layer. | The size readout reaches `warn` (25 MB) on a real vault and lowering the limit is not acceptable — or a feature needs partial loading anyway (#266). |
| D-2 | **Should archived conversations be indexed by vault context?** They are, today. | #300 | Undecided, both sides recorded. Excluding matches the two sibling folders; including is the only semantic path back to an archived conversation. | Before an archive fills on a real vault — afterwards it is a migration, not a default. |
| D-3 | **The model can change the vault and nothing says so.** `writeMode` defaults to `all`; no surface shows it, and a conversation cannot be made read-only. | #255 | **Decided 2026-09-18 — no change.** The write is implied by the words of the conversation: the model writes when it is asked to, and the blast radius is already bounded without a mode being visible — `create_note` refuses an existing path, `rewrite_note` can only target a note already attached as context, and **every** write shows a confirm chip naming the note before it executes. A standing permission indicator would restate what the confirmation already asks. | A write lands that nobody asked for, or a user reports not knowing the model could modify an attached note. |
| D-4 | **Resume mode silently drops history.** `summary` sends no prior messages, `hybrid` only the last six, for every later send. Nothing says so and nothing switches back. | #256 | **Decided 2026-09-18 — leave as is.** The default is `full`, so the silent case only exists for a user who deliberately chose otherwise. Folding it into `trimHistoryToBudget` was considered and not taken: it would change what "summary" means and rewrite the send path for a case nobody has reported. | Someone reports the model forgetting a conversation they can still see on screen. |
| D-5 | **Web-search state is ambiguous** — on · off · auto-armed · no-key are four states shown as two. | #257 | **Decided 2026-09-18 — leave as is.** Re-read against the code first: auto-arm is a **per-send override**, not a mode flip (`{ ...conv, researchMode: true }` is passed to that one send and never persisted), and an answer that searched carries its own evidence in the sources row (`Web: … ↗`). What is left is a label being narrower than the behaviour, not a hidden decision. | The heuristic fires on something plainly not time-sensitive, or a user asks why a search ran. |
| D-6 | **The system prompt cannot be read from the conversation.** A template also sets up to six fields when applied. | #258 | Open, Medium — but **smaller than first written**: the template's *name* is in the sources row under the answer it shaped (ADR-140), the model is on every answer's meta line, and effort and language are resolved in the header (ADR-165). With D-3 and D-4 decided, what stays invisible is max tokens (visible when it bites, via the truncation card) and the prompt text itself. | Next conversation-controls pass. |
| D-7 | **Two model pickers** with different information (header popover vs. settings modal). | #261 | Open, Low — principle 4 violation, kept because merging them changes two flows. | " |
| D-8 | **Summaries and prompt optimization are long-press only.** | #262 | Partly addressed by ADR-165; the rest stands. | " |
| D-9 | **An explicit delete does not archive.** | ADR-173 | Deliberate: a delete is intent, and archiving deliberate deletions fills the vault. The dialog offers Archive as a choice instead. | If the dialog's own usage shows people always choose Archive. |
| D-10 | **No "Enter sends" setting.** | ADR-175 | Deliberate: it doubles the send path, and the question is which behaviour is correct, not which is popular. | If asked for; then as a setting with a stated default, not a toggle to avoid deciding. |
| D-11 | **No retention policy for the archive folder**, and no size readout for it. | #294 | Pruning is Obsidian's job. A count beside the folder picker would answer the visibility half without Pythia owning retention. | Cheap; next docs/settings pass. |
| D-28 | **The model suggestion runs only on an optimize**, not on every send. | ADR-181 | The optimizer is the moment the user asked for help; a suggestion on every send is a second, unrequested voice beside Send. `recommendModel` already takes nothing optimizer-specific. | Someone uses the optimizer only to get the suggestion. |
| D-30 | **No *compare with* link on an answer from a suggested model.** | ADR-181 | Compare (ADR-160) already re-runs the last turn on another model via the long-press. A link would make the way back one tap. | A cheaper suggested answer is reported as worse and the user did not find Compare. |
| D-46 | **No setting to turn charts off.** The standing prompt rule always names `render_chart`. | ADR-210 | Deliberate: a chart is a way of answering, like a table or a list, and nothing offers to switch those off either. ADR-209's discipline also applies — there is no section whose one-sentence remit covers it. | Someone reports charts appearing where they did not want them, often enough that "ask for prose" is not the answer. |
| D-47 | **The exported PNG drops the theme's font** for a generic system stack. | ADR-210 | Forced: an SVG rasterised through an `<img>` is its own document and loads no webfont, and hard rule 2 forbids embedding one. The drift is mild; the alternative is a silent fallback to a serif face. | A user reports the PNG looking wrong beside the panel, or a way to inline a font arrives that does not mean shipping one. |
| D-48 | **No chart while the answer streams.** The block reads as raw JSON until the answer commits. | ADR-210 | Deliberate: it would mean parsing partial JSON on every token and flickering a wrong chart on the way to the right one. The block is short and the wait is the rest of the answer. | Charts start arriving early in long answers, so the JSON is on screen for a noticeable time. |
| D-49 | **No PNG written into the vault.** A refused clipboard falls back to the source block. | ADR-210 | It would be the codebase's first binary vault write, and it leaves loose files nobody asked for. The fallback covers the case it would serve. | The clipboard image write proves unreliable on a platform people actually use. |
| D-50 | **No scatter or stacked-area charts.** v1 draws bar, line and pie. | ADR-210 | Those three cover category comparison, change over time and share of a whole, which is what a research answer wants. Scatter needs two value axes and is rare in this material. | Asked for, with a real example the three cannot show. |
| D-12 | **No flashcard reviewer, scheduler or export for the glossary.** | ADR-149/150 | Deliberate and load-bearing: Pythia captures terms, Bases browses them. The note format is the integration surface. | Not planned. Re-opening this means re-reading ADR-150 first. |

| D-53 | **Pins are not in an archived conversation's note.** The archive writes the transcript; the pins, which are snapshots of parts of it, are left out. | ADR-216 | A pin is a reading aid for the live conversation; in a note, the passage is already there in the transcript. | An archived note is reopened as a conversation, or users ask for "what I pinned" in the archive. |
| D-54 | **A fork does not inherit pins.** Forks are built field by field; `pins` is not one of them. | ADR-216 | A fork starts a new line of thought from a passage; the source's pins belong to the source's line. | Users pin, fork, and expect the pin to follow — then copy them, never share them. |
| D-55 | **A pin never reaches the model.** Pinning is a reading aid, like a merge link or a glossary definition. | ADR-216 | Making a pin context would silently change every later answer, and cost tokens per turn for something the user pinned to LOOK at. | Users pin a spec to keep the model to it — then an explicit "use as context" toggle on the pin, never the default. |
| D-56 | **No Tavily `/crawl`, `/map` or `/research`.** Pythia reads one page (`read_url`) and runs searches; it does not walk a site or hand a question to an asynchronous research agent. | ADR-217 | Crawl and map are batch jobs, not chat actions, and scale credit use with a site's size. `/research` needs polling and returns its own citation formats, which clash with the `⟦cite:web⟧` contract (ADR-077). | A user asks for a multi-page task ("compare every pricing page on this site") often enough that repeated `read_url` calls are the workaround. |
| D-57 | **No `search_depth: "advanced"`, `auto_parameters` or raw page content on search.** Every search is `basic`, with 500-character snippets. | ADR-217 | Each can double a search's credit cost, or fill the context window, without anyone choosing it. `read_url` covers the "I need the whole page" case, one page at a time. | Credit cost per research answer is measured (Tavily's `include_usage`) and the better snippets are shown to change answers. |
| D-58 | **A `[[link]]` inside a message is not rewritten when its note is renamed.** Every stored path follows the rename (ADR-218), but the text of what was said stays as it was; tapping an old link says the note was renamed or deleted. | ADR-218 | The text is history, and the model reads it on the next turn. Rewriting it changes that history, and two notes sharing a name could make the new link point at the wrong one. | Users regularly rename notes that answers linked, and the "renamed or deleted" notice becomes a common tap rather than a rare one. |
| D-59 | **An answer's other tabs never leave the tab strip.** A kept comparison's alternatives are not searched, not in the archive note, not in a saved note and never sent to a model — history is the kept answer's `content` alone. | ADR-219 | The kept answer is the conversation; the others are there to be looked at. Searching or archiving them would put answers the user declined next to the one they chose. | Users search for, or want to keep in a note, an answer they did not choose. |
| D-60 | **No fork from a tab.** The other answers stay as tabs only; there is no "Continue in a fork" (user decision). | ADR-219 | Automatic forks hid the answers (the reason for ADR-219); a manual one was declined as a second place for the same answer. | Users copy a tab's text into a new conversation by hand to follow it. |

### Measurements not yet made

| # | Decision | Review | Position today | Revisit when |
|---|---|---|---|---|
| D-13 | **Vault-RAG retrieval floors are unmeasured.** ADR-169 measured conversation pairs; `vaultRetrievalMinScore` (0.5 / 0.35 / 0.2) is on faith. | #273 | The two maps are deliberately separate and a test fails if they are merged. The **naming** half is fixed (ADR-176): the shared type no longer carries the measured map's name. The **measurement** stays open. | Before touching either constant. Needs a query-to-note probe like `measure-related.mjs`. |
| D-14 | **Percentile floors instead of constants.** Calibrated floors land at p75–p78 of each model's own distribution — the percentile ports where the constant does not. | #269 | Better design, one vault of evidence. Needs a second vault, and a tiny vault needs an absolute sanity floor. | A second measured vault exists. |
| D-15 | **Provider SDKs had no runtime test.** Three majors were bumped; `tsc` and the bundle passed, no real call was made. | #290 | **Mostly closed by use (2026-09-18):** 2.21.0 shipped before the check, and several real chats since report no issues — which proves streaming and the tool loop on the provider in use. Still unproven: the other two providers, and the utility path (`callUtility` — Define, summaries, titles). | A chat and a Define have each run once on each of the three providers. |
| D-16 | **The settings copy undersells the embedding speed difference** (measured 4.4×). | #275 | Open, Low. | Next settings-copy pass. |
| D-51 | **The PNG export has never run.** Every step around it is tested, but `canvas.toBlob`, `ClipboardItem` and the SVG-as-image rasterisation do not exist headlessly, so the one thing the feature was asked for is unproven. | ADR-210 | Ships behind a fallback that costs nothing if it fails: a refused image write copies the source block and says so. The riskiest part — `var()` not crossing the `<img>` boundary — is answered by `inlineChartColors`, which IS tested (no `var(` survives the clone) and takes each swatch off the root's inline style rather than through the CSSOM. | First run on a real Obsidian: copy a chart, paste into a document, and check the colours survived and the text is not a serif fallback. Then iOS, where the clipboard may refuse the image whatever we do — the fallback notice should appear rather than nothing. |
| D-31 | **Does transformers.js actually run its WASM runtime inside a Node-enabled desktop Worker?** ADR-182 hides `process` so the `wasm` device is accepted; that the runtime then *works* there is unproven. | #307 | Ships behind the unchanged fallback chain, so a failure costs nothing it did not already cost — and the new backend log line names it instead of hiding it. Cannot be checked headlessly. | First run on Obsidian desktop: the `blob worker unavailable` warning should be gone and the log should read `worker (blob)`. Also check a second launch for a re-download — the browser model cache replaces the filesystem one on this path. |
| D-32 | **Recycling the embedding backend every N notes** as a hard ceiling on the WASM heap. ADR-125 named it and left it; ADR-182 left it again. | #308 | Batching + padding should make it unnecessary by bounding the distinct-shape count. Recycling is also awkward while the provider is shared with the related index — a recycle mid-sync would reject that sync's in-flight request. | The backend log says `worker` and a build still degrades, with a heap measurement to show it. |
| D-33 | **The iframe fallback's future.** Since ADR-182 it should be unreachable on desktop (blob Worker) and on phones (resource Worker), leaving it a guard for a hypothetical. | #307/#312 | It is the oldest backend, explicitly untested, and forces every branch that exists to survive it (`isOffThread`, the throttle parameters, `hydrateForQuery`, the throttled notice). It also already blocks worker-side ranking (ADR-120). But "always works" was not worthless, and deleting a fallback in the same change that rewrites the path above it is how you lose both. | The backend log from real installs shows nobody lands on it. Then delete it *with* its branches, or make it an explicit opt-in — not a silent consequence of a Worker failing. |
| D-34 | **`truncation: true` on the embed call**, which would bound the shape space harder than padding alone. | #308 | Not taken: it changes every vector longer than the tokenizer's window, silently invalidating ADR-169's measured `relatedFloors` and dropping text that is embedded today. Chunks are sized to fit instead (`embedChunkChars`). | Only together with a re-measurement of the related floors (D-13/D-14) — never on its own. |
| D-35 | **An append-only vault index.** Every persist serializes the whole index (~19 MB at the 5 000-note cap), so crash-safe flushing had to be rate-limited (30 s) rather than made as fine as it should be. | #310 | The 30 s floor bounds the write rate but not the write *size*; the loss window is a compromise between the two. A format that appends new vectors and compacts occasionally removes the trade-off entirely. Same shape as D-1 for `data.json`, and unlike D-1 this one is local-only with no sync-atomicity stakes — which is the argument ADR-123 used to justify ADR-122. | The flush shows up as sync churn on a real vault, or a large vault wants a tighter loss window than 30 s. |
| D-36 | **The embedding model is the wrong class for the job.** `paraphrase-multilingual-MiniLM` is a sentence-similarity (STS) model doing query-to-passage retrieval. | #319 | Chosen for ADR-109's symmetric conversation-pair question and inherited by vault RAG without re-deciding. It is upstream of D-13: measuring floors for a model you may replace calibrates the wrong thing. A retrieval model (e5, bge) needs asymmetric `query:`/`passage:` prefixes — a change to `EmbeddingProvider.embed`, not a dropdown entry — plus newly measured floors and a one-time reindex. | Before D-13's measurement, not after. Retrieval quality is reported as poor, or the spike is scheduled. |
| D-37 | **Sticky retrieval** — hold a note set for the conversation instead of re-retrieving per turn. | #322 | ADR-183 took the cheap half (carry the previous answer into the query). The set still churns turn to turn underneath a conversation still discussing turn 1's notes. Needs a "topic changed" rule, which is the whole decision. | The carry-over proves insufficient in use. |
| D-38 | **ADR-182's premise may be wrong for desktop.** The M2 Air still reports `iframe (UI thread)` after the `process` fix. | #332 | ADR-185 closes the one hole it could find (a non-configurable global defeating `defineProperty`) and makes the failure reasons visible. If the log says `Unsupported device`, the premise held and this closes it; if it says a blocked `blob:` plus a cross-origin resource path, ADR-125's original theory was right all along and the `process` work was necessary but not sufficient. | The next run's `embedding: backend resolved` log line. |
| D-39 | **The related-conversations index is not behind the build guard.** ADR-199's crash-loop breaker wraps the vault index only. | ADR-199 | That index is built only when the user asks for related conversations, and the background warm is desktop-only (ADR-169), so it cannot loop by itself; since ADR-199 it also uses the device's model, so a phone no longer loads the multilingual one for it. | A crash report from the related panel on a phone, or the warm is ever enabled on mobile. |
| D-40 | **A multilingual model a phone can hold.** ADR-199 gave phones the English model, losing cross-language matching there. | ADR-199 | **Closed by ADR-200 (2026-09-22).** Not a smaller model — none exists for this runtime — but the same model with its vocabulary cut to Latin script: identical vectors for Latin-script text (cosine 1.000000 on 413 texts), ≈ +370–400 MB on the iPhone against +900–1 000, and the phone reads the desktop's index. Non-Latin scripts degrade to character matching there; that is the residue, stated in the settings note. | A user whose notes are in Cyrillic, Greek or an Asian script wants them matched by meaning on a phone. |
| D-41 | **The model load is the phone's tightest moment.** With the Latin-script variant a build never warned, but the load itself touched WebKit's warning line (1 640 MB, ~400 MB under the kill) once per process. | ADR-200 | Transient: the downloaded bytes, the Cache API copy and the tokenizer parse coexist for a moment inside the Worker. Survived every load on the reporter's phone (three). Candidates if it ever bites: release the fetched buffer before session creation, or skip the cache write when the file came from cache. | A crash report at model load on a phone, or a phone with less memory than an iPhone 15 Pro Max. |
| D-42 | **The related-conversations sync has no crash-loop marker.** The vault build leaves a `BuildGuard` marker so a build the OS killed pauses the next one (ADR-199); the related sync, which also loads the model and embeds in a loop, leaves nothing. | ADR-203 (#362) | Not done. The related sync only runs when the user opens "Show similar", so a kill there is attributable and not a loop the user cannot escape — unlike the vault build, which the send path started on its own. Giving it a second marker would also mean a second pause to explain in the settings. | A report of Obsidian dying while "Show similar" is open, or the related index gaining an automatic trigger of its own. |
| D-43 | **`deserializeIndex` copies every vector out of the file it just read.** At the note cap both the buffer and the copies are alive at once — the peak lands exactly where the phone is tightest, next to the model load (D-41). Views into the buffer would halve it. | ADR-203 | Not done, because the trade is two-sided: views keep the whole buffer alive as long as ANY row survives, so a rebuild that replaces almost every row retains a buffer for the few it kept. Copies are independently freeable. Neither side is measured. | A memory measurement of an index load on the device, or a report of a kill while an index loads. |

### Deliberately out of scope

| # | Decision | Review | Why |
|---|---|---|---|
| D-17 | **Note bodies are not searched** — only note names, paths and the template name. | #266 | Needs `cachedRead` over the attached paths, an async loading state and a lower field weight so borrowed text cannot drown out a conversation's own words. Obsidian's search serves it today. |
| D-18 | **No typo tolerance in search.** | #267 | Edit distance has its own noise budget and its own per-keystroke cost profile. Kept out of ADR-168 on purpose. |
| D-19 | **Related rows show no evidence** — a bare name, no score, no matched chunk, which is the failure ADR-168 legislated against for search. | #274 | `maxPairwiseCosine` knows the winning pair and throws the indices away; the index does not persist chunk text. |
| D-20 | **`sync` can only abort between conversations** — one conversation's chunks embed in a single uninterruptible call. | #282 | Fine at the measured ~23 chunks, unbounded in principle. |
| D-21 | **Note-chunk caching keyed on `(path, mtime)`**; **`InlineSuggest` candidate cap.** | #73/#74 | Partial win only — scoring is query-dependent; the cap needs a product decision on result ordering. |
| D-22 | **Fork-path fire-and-forget hardening.** | #10 | `no-floating-promises` catches the bare cases; the fork-specific remainder is backlog. |
| D-23 | **A whitespace-normalizing `findRange`** for selections spanning multiple blocks. | ADR-096 | Changes matching semantics for favorites and risks over-matching. Deferred unless multi-block forks prove to need it. |
| D-24 | **An editable rule registry** (per-rule toggles, per-conversation scope) for system-prompt rules. | ADR-101 | That is where migration, snapshot semantics and layering all concentrate. The per-conversation `systemPrompt` field covers the real need. |
| D-25 | **Caching fetched web sources into the vault.** | ADR-062 | Search + recency only in that pass. |
| D-26 | **PDF and vision input for Mistral.** | ADR-045 | Explicit non-goal of the integration pass, deferred rather than guessed at. |
| D-29 | **A model suggestion is never applied automatically.** | ADR-181 | A silent model switch is the kind of change this plugin has never made: the chip is offered, the answer's label names the model. |
| D-44 | **No search field, tabs, folds or "Advanced" section in the settings tab.** Eight sections in one scroll, ~42 rows. | ADR-209 | Deliberate: Obsidian's settings pane is a single scroll and no core plugin nests navigation inside its own tab, so a plugin that does stops feeling native. The section intros are the orientation a search field would otherwise be asked to provide. | A section grows past roughly a screenful of rows on a phone, or someone reports hunting for a setting they knew existed. |
| D-45 | **Web search is spread across three sections** — the key in Connections, "research mode on" in New conversations, auto-arm and results-per-query in While answering. | ADR-209 | The cost of one consistent axis: those three rows genuinely differ in scope. Re-grouping them by topic is the arrangement ADR-209 removed. The descriptions cross-reference. | Someone looks for the Tavily key and does not find it, or a second feature ends up split the same way and the pattern reads as arbitrary. |
| D-27 | **`sidebar.ts` is excluded from coverage.** | #98 | Its logic is extracted into tested controllers instead; the view file is the thin coordinator. |
| D-30 | **A discussion never revises the definition.** | ADR-208 | The most valuable thing a forked discussion could produce is a better definition — but that field is protected from model writes on purpose, and rewriting it automatically would need the proposal card this flow deliberately does without. Worth revisiting once the discussion section has been used enough to say whether the definitions beside it actually go stale. |

### Closed by a decision, kept here so it is not re-litigated

- **Summary format** (old open decision 1) — prose, ≤5 sentences, substance not session; one shared `SUMMARY_RULES` (ADR-141).
- **Token-limit handling** (old 2) — the stop reason is reported, a card offers Continue / Retry / Compare, and one `maxTokensAdvice` rule drives every warning (ADR-162).
- **Conversation naming** (old 3) — AI-generated after the first exchange, renameable; the theme note follows the name unless pinned (ADR-150).
- **Per-file storage** (old #3) — still the answer, now designed as D-1 rather than assumed.
- **The composer's note link as a pill** (D-52) — the composer is a `contenteditable` and the link is a chip that reads as its `[[Name]]` (ADR-213).
- **Real embedding retrieval** (old #50) — shipped (ADR-116/126/169); the entry in the review predates it.

---

## Changelog of this document

| Date | Change |
|---|---|
| 2026-09-23 | ADR-209: the settings tab's sections and its section component added to the UI map; D-44 (no search field or nested navigation in the settings tab) and D-45 (web search spread across three sections). |
| 2026-09-22 | D-41: the phone's model-load peak (ADR-200 addendum, verified on the device). |
| 2026-09-22 | ADR-200: D-40 closed — a phone runs the Latin-script variant of the multilingual model. |
| 2026-09-22 | ADR-199: the settings index-status row added to the UI map; D-39 (the related index outside the build guard) and D-40 (a multilingual model a phone can hold). |
| 2026-09-18 | `.p-model-hint` added to the UI map; D-28–D-30 (the optimizer's model suggestion, ADR-181). |
| 2026-09-25 | ADR-219: the answer tabs (`.p-answer-tabs`) added to the UI map; D-59 (tabs are never searched, archived or sent) and D-60 (no fork from a tab). |
| 2026-09-25 | ADR-218: D-58 (links inside message text are not rewritten on rename); the permanent write chip (`.p-note-write`) added to the UI map. |
| 2026-09-25 | ADR-217: D-56 (crawl · map · research) and D-57 (advanced depth · auto-parameters · raw content) — the Tavily capabilities left out. |
| 2026-09-25 | ADR-216: the pin strip, pin buttons and table actions added to the UI map; D-53…D-55 (archive, fork inheritance, pins as context). |
| 2026-09-25 | ADR-214: dropping vault notes on the composer added to the map (`.is-drop-target`, `ui/noteDrop.ts`). |
| 2026-09-25 | ADR-213: `.p-composer` and `.p-composer-chip` replace `.p-textarea` in the UI map; D-52 closed. |
| 2026-09-23 | ADR-211: the composer keeps the link for a note attached with `#`; D-52 records why it is text rather than a pill. |
| 2026-09-23 | ADR-210: the chart card added to the UI map (the first surface that also renders outside the panel), and D-46…D-50 recorded — no off switch, the PNG's font, no chart while streaming, no PNG in the vault, and bar/line/pie only. |
| 2026-09-18 | Rewritten from the 0.1 MVP draft: current product framing, the UI vocabulary map, and the deferred-decision register (D-1…D-27). |
| 2026-09-18 | D-31…D-35 added from ADR-182 (embedding off the UI thread, a resumable vault build): the live-verification the fix still needs, backend recycling, the iframe fallback's future, why `truncation` was not taken, and the append-only index that would remove the flush-rate trade-off. |
| 2026-09-18 | D-36…D-38 added from ADR-183/184/185: the embedding model is the wrong class for query-to-passage retrieval, sticky retrieval instead of re-retrieving per turn, and whether ADR-182's premise holds on desktop at all. |
| 2026-05-07 | 0.1 MVP spec — "Claude Vault Assistant". |
