# UI architecture and naming

*Last updated: 2026-09-26 (ADR-230: the web-search globe is `ResearchToggleController`)*

*Previously: 2026-09-26 (ADR-224: the Vault context settings section replaces the embedding section and its index-status row)*

*Previously: 2026-09-25 (ADR-216: the pin strip)*

How the UI is put together and what its parts are called, so changes can be asked for (and found) by name. The words match `README.md` where the user sees them. The full class-by-class map lives in `docs/pythia-spec.md` → *UI architecture*; this file is the orientation that makes that map readable.

The UI is one Obsidian `ItemView`, `PythiaSidebarView` in `sidebar.ts`, built imperatively into `containerEl.children[1]` — no framework, no shadow DOM. The view builds the skeleton and hands each surface to a controller. Around it sit the **conversation panel** (an overlay inside the view), the **modals** in `suggest/`, the **settings tab**, the **editor context menus**, and one surface that lives in any vault note: the **chart card**.

## 1. Naming conventions

| Suffix / place | What it is | Examples |
|---|---|---|
| `…Controller` (`ui/`) | Owns one surface of the view: builds it, repaints it, handles its events. Created once by the view | `HeaderController`, `HistoryController`, `SummaryController`, `ForkController`, `TruncationController`, `ComparisonController` |
| `…Deps` / `…Host` | The interface a controller or module receives instead of the view: callbacks and getters, never `this` | `HeaderDeps`, `SelectionDeps`, `TermDiscussionHost`, `VaultWatcherHost` |
| `…Modal` / `…Suggest` (`suggest/`) | Obsidian `Modal` or `SuggestModal` subclass. Every dialog lives here, never in `sidebar.ts` | `DeleteConversationModal`, `ConversationSettingsModal`, `ConversationCapModal`, `CommandHubModal`, `NoteSuggestModal`, `ModelSuggestModal` |
| `…Setting` / `…Settings` (`ui/`) | A settings control too involved for one `Setting` row | `conversationCapSetting`, `vaultContextSettings`, `glossarySettings`, `pricingSettings` |
| `ui/settings/*.ts` | One section of the settings tab; `settings.ts` only orders them | `connections`, `conversationDefaults`, `answering`, `optimizer`, `notes`, `storage`, `troubleshooting` |
| `…Painter` / `…Decorator` | Walks rendered markdown and marks or wraps parts of it | `HighlightPainter`, `citationPainter`, `CodeBlockDecorator`, `tableDecorator` |
| lower-case module, no suffix | Pure logic, no DOM or DOM-light, unit-tested. The rule lives here; the controller only places it | `turnLabel`, `instructionState`, `composerKeys`, `composerTokens`, `markTap`, `keyboardInset`, `referenceEntries` |
| shared interaction helper | The one implementation of a gesture or widget (ADR-161) | `longPress`, `outsideDismiss`, `clipboard`, `dragToPan`, `accordion`, `choicePicker`, `ActionSheet` |
| `p-*` class | The view's own CSS vocabulary | `.p-header`, `.p-chat`, `.p-trunc`, `.p-history-row` |
| `pythia-*` class / element | Marks inside rendered markdown, and surfaces outside the view | `<pythia-fork>`, `<pythia-term>`, `.pythia-modal`, `.pythia-inline-suggest`, `.pythia-sel-toolbar` |
| `pb` + role | A button's look (ADR-188). Its own class holds layout only | `pb-primary`, `pb-secondary`, `pb-quiet`, `pb-destructive`, `pb-link`, `pb-icon`, `pb-seg`, `pb-tab`, `pb-chip-warn` |

The work is split three ways everywhere: **a pure module decides** (what a label says, which option is resolved, what a key does), **a controller draws** (where it goes, when it repaints), and **a service performs** (`services/` — the provider call, the vault write, the store). `sidebar.ts` wires controllers together and owns streaming and the message list; a rule that lands there is usually a rule that belongs in a pure module.

## 2. The panel, from top to bottom

```
.pythia-view                             sidebar.ts — fills the leaf flush, no inset
├─ .p-header                             HeaderController
│  ├─ loupe                              opens the conversation panel, search focused
│  ├─ .p-title                           the name, inert text, the only flex: 1
│  ├─ .p-ctx-chip                        attached-note count, when any
│  ├─ .p-inst  model | effort | lang     → .p-model-pop / choicePicker (sheet on mobile)
│  ├─ ⌄ menu                             rename (↻ = AI rename) · copy link · conversation settings
│  ├─ trash                              → DeleteConversationModal
│  └─ plus                               new conversation — always the last child
├─ .p-ref-row > .p-pills > .p-wikilink   ReferenceRowController — hidden when empty
├─ .p-pins                              PinController — pinned answer content, floating over the chat's top
├─ .p-chat                               the scroll area
│  ├─ context inspector                  ContextInspectorController (an accordion)
│  ├─ fork / merge banners               ForkController / MergeController
│  ├─ .p-summary-cards                   SummaryController (accordions)
│  └─ messages
│     ├─ .p-turn-label                   turnLabel — model · time · tokens · ≈ cost
│     ├─ .p-msg-user > .p-bubble         accent bubble, right-aligned
│     ├─ .p-msg-ai > .p-ai-body          rendered markdown, no container
│     │  ├─ marks                        favorite · fork · merge · term · person (HighlightPainter, markTap)
│     │  ├─ inline anchors               the card a tapped mark opens, right after it:
│     │  │                               fork (ForkController) · merge (MergeController) · term/person (GlossaryController)
│     │  ├─ .p-cite                      citation chips (citationPainter)
│     │  ├─ .p-scroll-frame              wide tables and code, panned sideways
│     │  ├─ .p-chart-card                ui/chart/card.ts
│     │  └─ pin icon                     beside Copy on code · diagram · chart · table (pinSources)
│     ├─ .p-sources                      Template: · Vault: · Web: (sourcesRow)
│     ├─ .pythia-tool-call               write-confirmation chip (ToolCallController)
│     ├─ .p-note-write                   the ✓ chip of a written note, kept on the message (ui/noteLinks.ts)
│     ├─ .p-trunc                        cut-off card (TruncationController)
│     ├─ .p-compare                      comparison card (ComparisonController)
│     ├─ .p-answer-tabs                  the tabs a kept comparison leaves on its answer (AnswerTabsController, ADR-219)
│     └─ .p-del-bar                      delete · ⇄ compare · cancel (ExchangeActionsController)
├─ .p-index-trigger  (#)                 → .p-navigator (NavigatorController)
├─ .pythia-sel-toolbar                   selection strip (SelectionController)
└─ .p-input-area
   ├─ .p-composer                        ComposerField — contenteditable; # opens the note picker (InlineSuggest)
   │  └─ .p-composer-chip                an attached note (# pick or dropped from the vault — noteDrop): library icon + name, reads as [[Name]]
   ├─ .p-ctx-bar                         attached-note token budget
   └─ .p-toolbar
      ├─ attach · save · globe · library  toolbarIcons; the globe is ResearchToggleController (on · no key · auto · off)
      ├─ .p-send-hint                    token-limit warning (SendHintController)
      ├─ .p-model-hint                   optimizer's model suggestion (ModelSuggestionController)
      └─ .p-send                         long-press → .p-send-menu
```

Sizes and colours are not in the controllers: spacing is the 4px grid (`--s1`…`--s4`), type is `--font-smaller` / `--font-small`, every colour is an Obsidian variable, and chart colours come only from `ui/chart/palette.ts`. See `docs/design.md`.

## 3. The other surfaces

- **Conversation panel:** `.p-history`, `HistoryController`. Covers the whole view (`inset: 0`). Browse by date, search (titles via `services/conversationFinder.ts`, meaning via Schreibstube — ADR-223), **related mode** (`RelatedMode`, with the dismissible `historyChip`), and **pick mode** — the same panel opened by `view.pickConversation()` to choose a merge target. Never a modal for that.
- **Pin strip:** `.p-pins`, `PinController`. One pin shown at a time — collapsed to one line (‹ n/m › · ↗), open for the content, copy and ✕. Pinned from the selection strip's *Pin* or a block's pin icon. Every jump in the chat lands below it (`scrollChatTo`).
- **Navigator:** `.p-navigator`, `NavigatorController`. Forks · Merged · Starred · All prompts.
- **Selection strip:** `.pythia-sel-toolbar`, `SelectionController`. Appears for a selection in the chat: Copy · Insert into note · Save to inbox · Star · Fork · Merge · Define · Person.
- **Send menu:** `.p-send-menu`, built in `sidebar.ts` (an `ActionSheet` on mobile). Summarize conversation · Summarize favorites · Optimize prompt (`OptimizationController`).
- **Rewrite:** `RewriteController` + `editorSelectionEntries`. A passage selected in the **editor** is armed as a target; the answer becomes a proposal card with *Replace in note*.
- **Modals:** `suggest/`.
  - Dialogs: `DeleteConversationModal` (Archive · Delete · Cancel), `DeleteFileModal`, `ConversationSettingsModal`, `ConversationCapModal` (history-limit confirm), `ResumeModeModal`, `CommandHubModal` (`Pythia: Commands…`), `InputModal`, `PromptInputModal`.
  - Pickers, mostly for command-palette entry points that can run with no view open: `ConversationSuggestModal`, `FavoritesSuggestModal`, `NoteSuggestModal`, `TemplateSuggestModal`, `FileSuggestModal`, `FolderSuggestModal`, `ModelSuggestModal` (the comparison's model choice).
- **Settings tab:** `settings.ts` orders eight sections — seven in `ui/settings/`, and **Vault context** in `ui/vaultContextSettings.ts`, which opens with a *Search by meaning* row saying whether Schreibstube can find notes (ADR-224) — each opened by `section()` with one sentence naming its remit. Only **New conversations** holds values a conversation can override.
- **Chart card:** `ui/chart/` — `layout` (geometry) → `render` (SVG) → `card` (the card) → `export` (PNG). Registered as the `pythia-chart` code-block processor in `main.ts`, so it draws in the panel *and* in any vault note.

## 4. Vocabulary

| Say | Means |
|---|---|
| **panel** / **view** | The whole Pythia leaf (`.pythia-view`) |
| **conversation panel** | The list-and-search overlay (`.p-history`); not the view |
| **pin** / **pin strip** | A snapshot of part of an answer, shown at the top of the chat (`.p-pins`); never sent to the model |
| **header** | The top row (`.p-header`) |
| **instructions** / **segments** | The model · effort · language group in the header (`.p-inst`) |
| **pinned** vs **inherited** | A segment set for this conversation (accent tint) vs following the settings (plain). *Standard* stores `undefined` |
| **reference row** / **pill** | The strip above the chat and one file in it (`.p-ref-row`, `.p-wikilink`) |
| **context inspector** | The collapsible box listing what goes into the prompt |
| **summary card** | One collapsible summary at the top of the chat |
| **accordion** | The shared collapsible box both of those are built from (`ui/accordion.ts`) |
| **turn label** | The mono meta line above a turn |
| **bubble** / **answer body** | A user message / an assistant message (`.p-bubble` / `.p-ai-body`) |
| **mark** | A painted span in an answer: favorite (yellow), fork (accent), merge (dashed), term (dotted), person (solid faint) |
| **anchor** | The card a tapped mark opens inline — one component for fork, merge and term |
| **banner** | The "branched from" / "linked from" line at the top of a fork or link target |
| **sources row** | `Template:` / `Vault:` / `Web:` under an answer |
| **chip** | A small inline control: citation chip, tool-call chip, model hint, history chip |
| **selection strip** | The action bar for selected chat text |
| **composer** | The editable field plus its toolbar (`.p-input-area`); the field is `ComposerField` |
| **composer chip** | A note attached with `#`, drawn in the field; its text is `[[Name]]`, which is what is sent |
| **note picker** | The `#` popup in the composer (`InlineSuggest`) |
| **navigator** | The `#` button's popover — not the note picker |
| **sheet** | The mobile bottom sheet that replaces a popover (`ActionSheet`) |
| **one-send layer** | Something applied to the next send only, never written to the conversation (armed template, model suggestion) |
| **proposal** | An answer that is offered for writing but not written until pressed (rewrite, tool call) |

## 5. Asking for changes

- **Name the surface and the class:** "`.p-history-sub` should show the archive state" beats "the conversation list should say when it's archived". The class leads to one file through section 2 or the spec's map.
- **Separate looks from behaviour:** spacing, colour and hover go to `styles.css` (for a button, its `pb-` role, never a per-button rule); what a label says or which value wins goes to the pure module, with a test; when a surface appears or repaints goes to its controller; what gets called or written goes to `services/`.
- **Mind shared components:** the anchor is one component for fork, merge and term; the accordion serves the context inspector and summary cards; `choicePicker` serves effort and language; the conversation panel serves both search and pick mode; the chart card draws in the panel and in vault notes. Say whether a change should apply everywhere.
- **Say if it is mobile:** pickers become sheets, the search field does not auto-focus, and the keyboard inset (`keyboardInset`) moves the composer. "On the phone, …" narrows the change at once.
- **Name the check:** view-render tests mount the real view headless through `tests/helpers/viewHarness.ts` (e.g. `tests/headerInstructions.test.ts`, `tests/historyPanel.test.ts`); `npm run check:obsidian-cascade` checks buttons against the installed Obsidian's CSS. Anything visual beyond that is checked in Obsidian itself — desktop and phone.
