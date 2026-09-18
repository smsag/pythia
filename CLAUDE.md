# Pythia — Claude Code Instructions

Pythia is an Obsidian sidebar plugin providing a RAG-powered chat interface for querying notes with an LLM.

See `agents.md` for agent workflow conventions (commit style, task decomposition, naming, tool use).

---

## Repository structure

```
/
  main.ts                     ← plugin entry point, onload(), view registration
  sidebar.ts                  ← PythiaSidebarView (ItemView), all UI construction
  settings.ts                 ← PythiaSettings interface, defaults, settings tab UI
  styles.css                  ← all plugin CSS
  models/
    types.ts                  ← shared TypeScript interfaces (Conversation, Message, …)
    settings.ts               ← PythiaSettings interface + DEFAULT_SETTINGS (no Obsidian dependency)
    modelPricing.ts           ← USD list prices per model (GENERATED from models.dev) + PRICING_AS_OF; estimateCost / costSnapshot / messageCost / formatCost / conversationCost (ADR-163)
  services/
    AnthropicService.ts       ← Anthropic streaming + utility calls
    OpenAIProvider.ts         ← OpenAI streaming + utility calls
    BaseProvider.ts           ← abstract base: shared fields, lifecycle, all generate* utility methods
    messageUtils.ts           ← shared: parseTitleAndSummary, normalizeMessages, token estimation, output-language resolution + the three prompt shapes (ADR-148), formatDate/formatClockTime (the only UI date + time formatters — ADR-139)
    pathUtils.ts              ← noteBasename, safeNoteName, normalizeVaultPath, yamlString — the only file-name/path/YAML helpers (ADR-159)
    tokenMatch.ts             ← pure: matchStrength — the ONE token-matching rule (exact · prefix · infix · reverse) + applyRelevanceFloor (ADR-168)
    searchScope.ts            ← pure: parseScope (note:/conv:/all:) + shouldWiden — the search box's grammar and the auto-widen rule (ADR-168)
    conversationSearch.ts     ← pure: buildConversationFields (title ×3 · notes ×2 · summary · body), noteRefs, rankConversations, searchConversations, bestMatchSnippet (ADR-106/168)
    LLMRouter.ts              ← dispatches calls to the active provider
    LLMProvider.ts            ← provider interface
    ConversationStore.ts      ← in-memory store + debounced persistence
    ContextBuilder.ts         ← builds system prompt, attaches vault notes
    NoteWriter.ts             ← vault write operations
    ToolHandler.ts            ← tool definitions (create_note, rewrite_note, prepend_note) + execution
    comparison.ts             ← pure: model comparison on the last exchange — start/keep/cancel/normalize (ADR-160)
    modelRecommendation.ts    ← pure: parseDifficulty + recommendModel — the optimizer rates the task, Pythia picks the cheapest adequate model of the preferred provider (ADR-181)
    settingsAdvice.ts         ← pure: the ONE token-limit rule — maxTokensAdvice (clear | pin | null), effectiveMaxTokens, raisedMaxTokens (ADR-162)
    conversationEdits.ts      ← pure: spliceExchange — the one way to remove an exchange (delete bar, retry) (ADR-162)
    TemplateLoader.ts         ← template discovery + frontmatter parsing
    persistence.ts            ← pure functions: applySettingsMigrations, mergeSettings (validates every value — ADR-159), parseConversations (+ sanitizeConversationFields), mergeConversations, shouldRefuseLoad, partitionEvictions (the ONE eviction rule — ADR-172) + evictConversations/countEvictions through it
    storageSize.ts            ← pure: storageLevel + formatBytes — MEASURED data.json thresholds (warn 25 MB · high 50 MB), ADR-174
    rewriteTarget.ts          ← pure: rangeText · targetState · replaceRange · targetLabel — a captured range PLUS its text, verified exactly before any write (ADR-178)
    pendingTemplate.ts        ← pure: armPendingTemplate + applyPendingTemplate — a template applied to a RUNNING conversation is a one-shot layer, never a write (ADR-177)
    conversationArchive.ts    ← pure: archiveNotePath (never a taken path), archiveNoteContent, archiveFolderOf (the ONE folder resolution) — a conversation as a vault note (ADR-172/173)
    glossary.ts               ← pure: parseGlossary (legacy reader, migration only) + buildTermIndex (ADR-136/137/149)
    glossaryNotes.ts          ← pure: the note-per-entity format — paths, frontmatter mapping, body, mergeEntry, effectiveTheme (ADR-150/151)
    GlossaryService.ts        ← glossary folder I/O + vault-then-model term lookup (ADR-136/150); translate() caches a definition per language in the note (ADR-166)
    languageDetect.ts         ← pure: detectLanguage(text) by function words, null when unsure (ADR-166)
    embedding/warmIndex.ts    ← pure-ish: shouldWarmIndex + warmIndex — the background index warm and its three guards (ADR-169)
    embedding/relatedConversations.ts ← rankRelated + relatedMinScore(preset, modelId) — MEASURED per-model floors; vaultRetrievalMinScore keeps vault RAG on its own, UNMEASURED (ADR-169). The shared label type is `SimilarityPreset` — named for the label, never for either question (ADR-176)
    apiError.ts               ← HTTP error classification
  ui/
    InlineSuggest.ts          ← autocomplete widget for textarea
    turnLabel.ts              ← turn micro-labels: model · template · time · tokens (pure, unit-tested)
    OptimizationController.ts ← inline prompt optimizer state + flow
    NavigatorController.ts    ← # navigator popover logic
    ForkController.ts         ← fork banner, origin marks, inline fork anchor
    MergeController.ts        ← merge-link marks, inline merge anchor, merged-from banner (ADR-130)
    accentContrast.ts         ← readable --p-on-accent for the current theme accent
    longPress.ts              ← shared 450 ms press-and-hold gesture (pure, unit-tested)
    dragToPan.ts              ← shared drag-to-scroll for horizontally overflowing content
    tableDecorator.ts         ← wraps wide markdown tables in a scroll frame (ADR-131)
    renderMarkdown.ts         ← MarkdownRenderer + shared decorations; use for any non-message markdown
    keyboardInset.ts          ← soft-keyboard overlap rule: visualViewport and Obsidian's --keyboard-height, the larger wins (pure, unit-tested) — ADR-132/167
    clampBody.ts              ← five-line clamp + expand control for anchor summaries (ADR-141)
    languageOptions.ts        ← the language dropdown's options, shared by the settings tab and the conversation modal (ADR-148)
    glossarySettings.ts       ← glossary folder + migration controls for the settings tab (ADR-150)
    pricingSettings.ts        ← Show-cost toggle + the estimate-not-bill disclaimer naming models.dev; no price table (ADR-163)
    entitySelection.ts        ← pure: the selection rule shared by Define and Person (ADR-151)
    markTap.ts                ← pure: which nested mark a tap opens — innermost wins (ADR-157)
    GlossaryController.ts     ← glossary term marks + inline definition anchor (ADR-136)
    citationPainter.ts        ← swaps ⟦cite:…⟧ markers for numbered chips
    outsideDismiss.ts         ← the one deferred outside-press / Escape dismisser for popovers and menus (ADR-161)
    emptyState.ts             ← renderNoConversation / renderWelcome — the chat area's two empty surfaces (pure, unit-tested)
    RelatedMode.ts            ← the ADR-109 related-conversations mode: source, in-flight query + abort, chip, loading/empty/results
    historyChip.ts            ← renderHistoryChip — the ONE dismissible chip, shared by related (ADR-109) and widened (ADR-168)
    ExchangeActionsController.ts ← long-press on the last user bubble → delete · ⇄ compare · cancel bar (ADR-160)
    ComparisonController.ts   ← the comparison card: tab per model, sequential candidate runs, keep → forks (ADR-160)
    pluginIcon.ts             ← the plugin's own icon (`pythia-logo`): registered once in onload(), used by the ribbon, entry commands and the view (ADR-164)
    instructionState.ts       ← pure: what the header's effort and language segments show — resolved value, pinned vs inherited, supported (ADR-165)
    choicePicker.ts           ← the one header picker: anchored popover on desktop, ActionSheet on mobile; placeBelow shared with the model popover (ADR-165)
    composerKeys.ts           ← pure: composerKeyAction (Enter = line break, Cmd/Ctrl+Enter = send, never while an IME composes) + composerPlaceholder (ADR-175)
    RewriteController.ts      ← rewriting a passage of a note: arm · decorate the send · proposal card · verified apply (ADR-178)
    referenceEntries.ts       ← pure: which pills the reference row shows and in what order (ADR-178)
    editorSelectionEntries.ts ← the three things a selection in the editor can do (ADR-178)
    numberSetting.ts          ← pure parseNumberSetting + bindNumberSetting: every numeric settings field, committed on blur/Enter (ADR-171)
    conversationCapSetting.ts ← the history-limit field: empty box = no limit, and the confirm dialog before a value that evicts (ADR-172)
    ModelSuggestionController.ts ← the `.p-model-hint` chip beside Send: offer · accept · one-send layer (ADR-181)
    toolbarIcons.ts           ← the attach/save inline SVGs of the input toolbar
    SendHintController.ts     ← the warning beside Send; reads maxTokensAdvice, announces once on mobile (ADR-162)
    TruncationController.ts   ← the card under a cut-off answer: Continue · Retry with raised limit · Compare (ADR-162)
  suggest/                    ← modal dialogs (conversation picker, delete confirm, etc.)
  assets/logo.svg             ← the same icon as a standalone 24×24 SVG, for the README and the store listing
  tests/                      ← Vitest unit tests (npm test) — 1306 tests across 88 files
    helpers/viewHarness.ts    ← shared mount fixture for the view-render tests
  locales/
    en.ts                     ← English i18n strings
    de.ts                     ← German i18n strings
  docs/
    pythia-spec.md            ← product spec: problem, user stories, the UI vocabulary map (every surface → its class → its owner), and the deferred-decision register (D-1…)
    architecture.md           ← system architecture, data flows, component relationships
    design.md                 ← design system, CSS tokens, component specs
    decisions.md              ← architectural decision records (ADRs)
    engineering-review.md     ← improvement suggestions and priority matrix
    briefs/                   ← design briefs handed to Claude Design (standalone HTML); conversation-controls.html → #259/#260, built as ADR-165
  scripts/bench-search.mjs    ← per-keystroke cost of the search panel at three vault sizes (ADR-170)
  scripts/bench-store.mjs     ← what one conversation costs the single-file store: whole-file rewrite per turn, startup parse, list work (ADR-174)
  scripts/measure-related.mjs ← the related-conversations similarity probe: percentiles, preset behaviour, calibrated floor, boilerplate check (ADR-169)
  scripts/update-pricing.mjs  ← models.dev → models/modelPricing.ts (GENERATED block); weekly PR via .github/workflows/update-pricing.yml (ADR-163)
  scripts/update-models.mjs   ← models.dev → contextWindow in models/knownModels.ts (weekly PR) + a report of new/deprecated models for one standing issue, never applied (ADR-179)
  scripts/modelsDev.mjs       ← what both models.dev scripts share: UPSTREAM_IDS, NO_UPSTREAM, readCatalog, the lookup
  eslint.config.mjs           ← ESLint flat config (typescript-eslint)
  vitest.config.ts            ← Vitest coverage configuration
  .github/workflows/ci.yml   ← CI: lint → build → test on push / PR / workflow_dispatch
  .github/workflows/update-pricing.yml ← Mondays: pull models.dev, open a PR when a price changed
  .github/workflows/update-models.yml  ← Mondays: PR when a context window changed; issue "Model catalog: upstream changes" for new/deprecated models
```

---

## Engineering principles (ADR-159)

Three rules that every change is measured against. They came out of the 2026-09-16 whole-codebase review, where most of the 55 defects were one of three shapes.

1. **Every boundary validates.** A value from disk (`data.json`), a note, a template's frontmatter, a model's reply or tool-call arguments, or the clipboard is untrusted until a function with a test has said otherwise. The fallback is the default, never the raw value. `mergeSettings`, `sanitizeConversationFields`, `TemplateLoader.loadTemplate` and `parseToolArguments` are the pattern: validate where the value enters, not where it is used.
2. **Silence is a bug.** An empty result, a swallowed catch, a no-op on a missing file must either say something to the user (`Notice`), log something a report can quote (`describeErrorForLog`), or be proven to be the idle case. `catch {}` needs a comment naming why silence is right. `""` from a utility call is never "nothing happened" (ADR-158).
3. **If it is a rule, the tooling enforces it.** A convention worth writing into this file is worth a lint rule, a compiler flag, or a test that fails in the forbidden direction. `tsconfig` is `strict`; ESLint bans `==`, `toLocaleDateString`/`toLocaleTimeString` and `innerHTML`; the file-size ratchet and CI run the same four steps you run locally (`lint`, `check:filesize`, `build`, `test`). Prose is for the reasoning; the guard is for the regression.

Two corollaries: **a write that can destroy content is a distinct operation** (`createNote` refuses an existing path; only `rewrite_note`, confirmed by name, overwrites), and **one builder per fact** (`safeNoteName`, `resumeDeepLink`, `resolveDefaultModelForProvider` — never a second copy of a regex or a ternary).

Three more from the second review (ADR-161), which read the UI layer the first one had only skimmed:

4. **One implementation per interaction.** A gesture, a dismissal, a copy-to-clipboard: the second hand-rolled copy is where the leak lives. `attachLongPress` (five copies before), `attachOutsideDismiss` (five, four of them leaking), `copyWithFeedback`. ESLint now confines raw `document`/`window` listeners to an allow-list; a new surface uses the helper or names its reason in `eslint.config.mjs`.
5. **Pay for the keystroke, not the corpus.** Work triggered by input is proportional to the input. The conversation panel re-tokenized every conversation per keystroke; the `#` picker re-tokenized every vault file; every typed settings character rewrote the whole `data.json`. Cache what the keystroke does not change (`tokensFor`, `noteTokens`), debounce what the disk does not need to see yet (`saveSettingsSoon`), precompute what the loop reads (`countForks`).
6. **Inherited stays inherited.** `undefined` on an override means *follow the default*, and a control may *show* the resolved default but must never *store* it — the conversation modal pinned temperature and max-tokens on every Save, turning "follow the global setting" into "frozen at today's value". Already the rule for `theme` and `outputLanguage`; it is the rule for every override.

The canonical list lives here, because this file is what every session reads first; the reasoning behind each lives in its ADR (159, 161); the guard that stops the regression lives in `eslint.config.mjs`, `tsconfig.json` or a test that fails in the forbidden direction.

---

## Documentation maintenance

**After every session that changes code, update the relevant docs:**

| Changed area | Update these docs |
|---|---|
| File structure, services, data flow | `docs/architecture.md` |
| UI components, CSS tokens, design rules | `docs/design.md` |
| Architectural choice or trade-off | `docs/decisions.md` (append a new ADR) |
| Bug found / suggestion resolved / new suggestion | `docs/engineering-review.md` |
| **A decision postponed, parked or deliberately not done** | `docs/pythia-spec.md` → Deferred & postponed decisions (a `D-n` row, with what would make it worth revisiting) |
| A new surface, or a renamed class | `docs/pythia-spec.md` → UI architecture (the map is the shared vocabulary; a surface missing from it cannot be asked for by name) |

Keep the "Last updated" line at the top of each doc current. Commit docs changes in the same commit as the code change where possible.

---

## Obsidian plugin API patterns

### Entry point

`main.ts` exports a single class:

```ts
export default class PythiaPlugin extends Plugin {
  async onload() { … }
  async onunload() { … }
}
```

`onload()` is responsible for: wiring services, registering the view, adding ribbon icons, registering commands, binding events, and handling the `obsidian://pythia` deep-link.

### View registration

```ts
this.registerView(
  PYTHIA_VIEW_TYPE,           // "pythia" — exported from sidebar.ts
  (leaf) => new PythiaSidebarView(leaf, this)
);
```

`PYTHIA_VIEW_TYPE` is the single source of truth for the view identifier. Never hardcode the string `"pythia"` elsewhere.

### ItemView lifecycle

`PythiaSidebarView extends ItemView` in `sidebar.ts`. Required overrides:

```ts
getViewType(): string           // return PYTHIA_VIEW_TYPE
getDisplayText(): string        // panel title
getIcon(): string               // Obsidian icon id
onOpen(): Promise<void>         // call this.buildUI()
onClose(): Promise<void>        // teardown, remove listeners
```

### UI mounting pattern

**Always use this pattern — do not deviate:**

```ts
private buildUI(): void {
  // [0] is the leaf header — never touch it
  // [1] is the content pane — always target this
  const container = this.containerEl.children[1] as HTMLElement;
  container.empty();
  container.addClass("pythia-view");
  // DOM construction follows
}
```

`onOpen()` calls `buildUI()`. If the view needs to rebuild (e.g. on conversation switch), call `buildUI()` again — it empties and reconstructs.

### DOM construction

**No framework. No JSX. No Svelte.** All UI is built with Obsidian's imperative DOM helpers:

```ts
// Creating elements
const header = container.createDiv({ cls: "pythia-header" });
const btn = header.createEl("button", { cls: "pythia-send", text: "Senden" });

// Obsidian icons — always use setIcon, never inline SVG for Obsidian UI chrome
setIcon(btn, "trash");

// Rendering markdown content in AI messages
await MarkdownRenderer.render(
  this.app,
  markdownString,
  messageEl,
  "",           // source path — empty string for dynamic content
  this
);
```

**Exception:** Icon buttons defined in the design system (attach, save, sparkle ✦, `#` navigator) use inline SVG as specified in `docs/design.md`. Only Obsidian chrome icons (trash, plus, etc.) use `setIcon`.

### Modals and dialogs

Subclass `Modal` or `SuggestModal` from Obsidian. Keep all modal classes in `suggest/`. Do not inline modal logic in `sidebar.ts`.

```ts
import { Modal, SuggestModal } from "obsidian";
```

### Event cleanup

Register all event listeners via Obsidian's `registerDomEvent` or `registerEvent` — never raw `addEventListener` on persistent elements. This ensures automatic cleanup on `onClose()`.

```ts
this.registerDomEvent(inputEl, "keydown", (e) => { … });
this.registerEvent(this.app.vault.on("modify", () => { … }));
```

---

## Design system

**Source of truth:** `docs/design.md` — component inventory, CSS tokens, and spacing/typography rules. Read it before any UI work.

This is an Obsidian sidebar plugin. The UI must feel native to Obsidian — not like a standalone app embedded in a panel.

### Obsidian CSS variables — always use these, never hardcode values

| Token | Purpose |
|---|---|
| `--color-accent` | User bubble, pill borders, send button, sparkle hover, `#` trigger hover |
| `--font-interface` | All UI text |
| `--font-monospace` | Labels, badges, token counts, textarea |
| `--background-primary` | Panel, input area |
| `--background-secondary` | Summary bar |
| `--background-modifier-border` | All dividers and borders |
| `--background-modifier-hover` | Button hover states |
| `--text-normal` | Primary readable text, AI response body |
| `--text-muted` | Secondary text |
| `--text-faint` | Labels, badges, token counts, inactive icons |
| `--text-on-accent` | Only as the CSS fallback behind `--p-on-accent` (see below) |
| `--p-on-accent` | **Text on accent-colored surfaces.** Published by `ui/accentContrast.ts` as pure `#ffffff`/`#000000` by WCAG contrast against the live accent (ADR-154) |

### Spacing — 4px grid, no arbitrary values

```css
--s1: 4px   --s2: 8px   --s3: 12px   --s4: 16px
```

### Typography scale

```css
--font-smaller: 11px   /* labels, token counts, nav items */
--font-small:   12px   /* body text, pills, toolbar */
```

---

## Hard rules — never violate

1. **The panel fills its leaf flush** — no border-radius on the `.pythia-view` root, and **no inset on any side**. Obsidian's `.workspace-leaf-content` pads `.view-content`; `.workspace-leaf-content[data-type="pythia"] { padding: 0 }` neutralizes it for our leaf only (ADR-147). `.p-history` is `inset: 0` on `.pythia-view`, so **opening the conversation panel is the quickest way to see the panel's true edges** — if it stops short of the leaf on any side, the container is inset, not the content. **The inset is Obsidian's own padding on `.view-content`** (12px sides, `max(safe-area, 32px)` bottom, at (0,2,0)) — `.pythia-view { padding: 0 }` never out-ranked it; `.workspace-leaf-content[data-type="pythia"] .view-content { padding: 0 }` does, the way core exempts its own views (ADR-167, measured in Obsidian). On a phone the drawer adds two more, neither ours: a theme may pad `.view-content` (Klartext 1.6.1: 52px), and `.is-floating-nav` paints a 48px sidebar-coloured fade at the foot of every drawer leaf; both are out-ranked for our leaf by specificity in `styles.css` — never `!important` on the view's padding, which would also silence the keyboard lift's inline padding.
2. **No imported fonts.** Use `var(--font-interface)` and `var(--font-monospace)` only.
3. **No custom background colors.** Every surface uses an Obsidian CSS variable. No hex codes on backgrounds.
4. **No box-shadow on panels.** Flat surfaces only. Navigator popover is the single exception.
5. **No emoji icons.** Design system icons are inline SVG, `stroke-width: 1.6`, `12×12px`. Obsidian chrome icons use `setIcon`.
6. **Accent is always `var(--color-accent)`.** Never hardcode a hex accent value.
6a. **Text on an accent fill is `var(--p-on-accent, var(--text-on-accent))`, and every such rule must ALSO set `-webkit-text-fill-color` to the same value** (ADR-154). These controls are `all: unset`; `all` resolves the inherited `-webkit-text-fill-color` to `inherit`, and **WebKit reads it in preference to `color`** — so a `color:` line alone silently loses on iOS and the label inherits `--text-normal`. `--p-on-accent` is always pure black or white; never let a theme token reach the label.
7. **No `env(safe-area-inset-bottom)` on the input area** (ADR-146 — this rule previously said the opposite). **The reasoning below is withdrawn by ADR-147**: the 34px was the *leaf container's* padding, not our `env()` inset. The rule itself stands (4px bottom padding, asked for), but the strip it was blamed for is fixed by `.workspace-leaf-content[data-type="pythia"] { padding: 0 }`. `env()` reports the device's inset wherever the element sits, so a sidebar leaf with anything below it reserved ~34px for a home indicator it was nowhere near. ADR-134's attempt to keep the inset and switch it off by measuring the panel's bottom edge did not fire on the reporter's device — measured at 42px below the send button where 8 was intended, i.e. 8 + exactly one home indicator. The input area is `padding: var(--s2) var(--s3) var(--s3)` — 12px at the bottom on a desktop, where the leaf's edge is the window's (ADR-167: ADR-146's 4px was chosen while core's 32px still sat unseen below it) — and `var(--s1)` in the phone drawer, where the tab selector's pill sits directly below. The keyboard lift reads Obsidian's `--keyboard-height` as well as `visualViewport` and takes the larger: the phone drawer does not shrink with the keyboard, and the viewport estimate falls short on iOS. Obsidian's own mobile chrome sits between a sidebar leaf and the screen edge. **`env(safe-area-inset-bottom)` is still correct for bottom sheets and modals** (`.pythia-modal`, the mobile action sheet) — those really do touch the screen edge.
8. **Never touch `containerEl.children[0]`.** That is the Obsidian leaf header.
8a. **Never replace `plugin.conversations` wholesale from disk.** Reconcile with `mergeConversations` so a stale data.json cannot roll a conversation back and lose its newest turn (ADR-133).
8b. **Never set an explicit `height` on `containerEl.children[1]`.** It is `overflow: hidden`, so a height below the content silently crops the input area (including its mandated safe-area padding) and uncovers the background behind the panel. Move content with padding instead (ADR-132).
9. **No inline modal logic in `sidebar.ts`.** All modals go in `suggest/`.
10. **No raw `addEventListener`.** Always use `registerDomEvent` / `registerEvent`.

---

## Component inventory

### Header
```
[ search ][ Title (grows) ][ Sonnet 5 | Hoch | DE ][ ⌄ ][ trash ][ plus ]
```
Order left→right (ADR-165, revising ADR-098): search · name (grows) · [ctx chip] · **model | effort | language** · menu · delete · new. The name group is the only `flex: 1` region, so the "+" is always the last child and never shifts. **No template caption** — the template rides the assistant turn label instead (ADR-129). See `docs/design.md` for the full spec.
- Search (far left, `search` loupe icon, ADR-107): opens the `.p-history` conversation panel with its search input focused. The single in-view conversation-search surface.
- Title: 12px, `font-weight: 600`, truncated with ellipsis, flex: 1. Plain, non-interactive text (ADR-107) — no click, no `▾`.
- **Instructions `.p-inst`** (ADR-165): one bordered mono group of three segments, each its own tap target. **Model** opens the model popover; **effort** and **language** open a choice picker (`ui/choicePicker.ts` — anchored popover on desktop, bottom sheet on mobile). What they show comes from `ui/instructionState.ts` only — never re-derive the resolution in the header
- **A segment shows what the send uses, resolved** (`Hoch`, `DE`, `AUTO`), never a bare "Standard". **Accent tint (`.is-pinned`) = set for this conversation; plain = follows the plugin settings.** Every picker's first row returns to the default and stores `undefined` (principle 6); a test fails if it stores the value
- `AUTO` = no language instruction (ADR-148's `auto`). `obsidian` shows the resolved locale code. A model without effort shows a dimmed `—` (`.is-off`) and tapping says so; a stored effort on such a model is kept, not tinted
- Temperature and token limit stay out of the header (settings dialog; the token warning stays beside Send)
- **Menu `⌄`** (`.p-hdr-menu`): rename · copy link · conversation settings. Rename and link no longer have header buttons
- The header repaints on a global default change via `plugin.onSettingsTabClosed()` → `view.refreshInstructions()`
- Icons: `setIcon`, 20×20px hit area, `--text-faint` → `--text-normal` on hover

### Reference row
```
[ pill: filename ✕ ][ pill: filename ✕ ]
```
- **No label.** This spec described a `REFERENZ` label in a 54px column for a long time; `.p-ref-row` holds only `.p-pills` and no such element has ever been created (flagged in the 2026-09-10 locale audit, corrected in ADR-144). Removed rather than built: the pills carry an ✕ and read as attachments on their own
- Pills: `--color-accent` border + text, 10px mono, `border-radius: 10px`

### Summary bar (sticky, always visible)
- `background: var(--background-secondary)`
- `border-bottom: 1px solid var(--background-modifier-border)`
- Chevron toggles body visibility — body is **fixed height 72px, `overflow-y: auto`**
- Body never expands — internal scroll only
- Sparkle ✦ bottom-right corner of body, visible only when body is open
- Sparkle triggers summary regeneration — not a bookmark action

### Chat scroll area
- `flex: 1`, `overflow-y: auto`, padding `--s3`
- Gap between turns: `--s3`
- No divider lines, no AI avatar/label per turn

### User message bubble
- `background: var(--color-accent)`, `color: var(--text-on-accent)`
- `border-radius: 10px 10px 2px 10px`, max-width 86%, right-aligned

### AI message
- Plain text, no container, no background
- Rendered via `MarkdownRenderer.render()`

### Turn label (above each message)
```
user:  [ 27 Aug 2026 · ] 22:19
AI:    OPUS 4.8 · 22:20 · ↑151 ↓430 · ≈ $0.012
```
- `--font-monospace`, 9px, `--text-faint`; rendered by `ui/turnLabel.ts`
- **The cost is snapshotted on the message at generation** (`Message.cost { usd, asOf }`, ADR-163 addendum 2) with the prices in force then; the label prefers it and prices a legacy message live from `models/modelPricing.ts`. A later table update never rewrites a snapshot. A model with no price row adds nothing; never show a wrong number. **Off by default** (`settings.showCost`). **Prices are generated**: the block between the GENERATED markers is rewritten by `npm run update:pricing` from models.dev and a weekly workflow opens a PR — edit the mapping in `scripts/update-pricing.mjs`, not the rows by hand, and never fetch prices at build or run time. **No test hard-codes a price**: arithmetic is tested on synthetic rows through `priceUsage`, and anything that reads the real table computes its expectation from `MODEL_PRICING` — a literal `2.5` breaks the weekly workflow on the first real price change. **No price table and no per-user overrides in the settings** (ADR-163 addendum 3): a wrong price is fixed upstream on models.dev and arrives with the weekly PR. **The disclaimer under the toggle is part of the feature** — estimate, not bill; source models.dev with a link; the provider's invoice is authoritative — never shorten it into a footnote
- **No next-send estimate beside Send** (removed in ADR-163). Do not bring it back; the label answers the question after the fact
- **No role caption** — no `DU`/`PYTHIA` (ADR-129); the accent bubble vs. plain body distinguishes them
- **No template here** (ADR-140) — the template is a reference, not a fact about the generation; it rides the sources row under the answer. `turnTemplateCaption` still decides which turns carry it
- No per-message star button — favoriting moved to text selection (ADR-085); favorites still surface in the `#` navigator under "Starred"

### Merge links / Verknüpfungen (ADR-130/142)
- The inverse of Fork. A passage selected in an assistant answer is pointed at an **existing** conversation; that conversation's summary is surfaced inline at the passage
- **The link anchor IS the fork anchor** (ADR-142). `.p-merge-anchor*` is grouped into every `.p-fork-anchor*` rule — never restate a rule for one of them, or they drift (they already have, twice). Same for the two banners
- Only two things differ, both deliberate: the meta line keeps the **unlink** control (a link can be removed; a fork cannot be un-forked), and the header is the **`link` icon + `VERKNÜPFUNG`/`LINK`** — a noun naming the card, like `ABZWEIGUNG`, never the state `VERKNÜPFT`
- Created from the selection toolbar's **Merge** button (next to Branch, assistant content only), which opens the conversation search and records a `MergeLink` on the conversation holding the passage
- **Never open a modal to choose a conversation** (ADR-143). Use `view.pickConversation({ excludeId, placeholder, onPick })` — the same `.p-history` panel the header loupe opens, in pick mode. ADR-107 made it the single in-view conversation search; a `ConversationSuggestModal` is only for command-palette entry points, which can run with no view open
- **Display-only** — a merge never enters the system prompt. Do not add merge content to `ContextBuilder`
- Marks are `<pythia-merge class="p-merge-link">`: a **dashed accent underline**, never a third highlighter fill (yellow favorites and accent fork origins own that treatment). Keep it — since ADR-142 unified the cards, the mark is the ONLY signal of which kind of thing a tap will open
- The anchor `.p-merge-anchor` is `.p-fork-anchor`, solid accent rule included: target name, conversation summary, `N messages · MODEL · date [· outdated]`, regenerate, unlink, `Öffnen →`
- The link reads from **both ends**, like a fork: the conversation a link points at shows a `.pythia-merge-banner` naming every conversation that merged with it. The inbound list is derived on read via `incomingMergeLinks`, never stored as a back-reference
- Regeneration uses `generateSummary`, never `generateSummaryWithTitle` — merging must not rename the target

### Sources row (under an assistant answer)
```
Template: Podcast Summary
Vault: 1 Some Note
Web: 2 thetransmitter.org ↗  3 sainsburywellcome.org ↗
```
- Rows always in that order — **from the user outwards**: the template is theirs and framed the answer, the vault notes are their own knowledge, the web is the outside and the only part that can rot. Also the order in which to trust them, and it puts the longest row last
- The vault row is **always** labelled `VAULT`; it is never relabelled when there is no web row. One label per row type
- **The template carries no number.** The numbers are citation indices matching the superscript chips in the prose, and nothing cites the template
- Vault references — the template included — render as a **bare accent-coloured name, no `[[ ]]`** (ADR-153): the run-in label already says it is a note. Web chips are numbered and end with `↗`, the one mark separating them from notes. The **context inspector keeps its brackets** — it has no label, so there they are the only signal
- `.p-sources-label` is a **run-in prefix, never a column** (ADR-153): `Template:` / `Vault:` / `Web:` in the flow ahead of the first entry, colon added in code so a translation cannot drop it. **Do not reintroduce a label column** — `.p-sources-row` wraps, flex wrapping has no hanging indent, so a column aligns only each row's first line while charging its width on every line
- **Words, not icons** (ADR-140): template and vault note have no distinct glyph at 11px, and the column is read once rather than aimed at
- `VAULT` lists the attached/auto-retrieved notes the model *cited*, not everything in context — it is the model's own claim, unlike `TEMPLATE`, which Pythia records

### Dates and micro-label rows (ADR-139)
- **One date format: `15 Sep 2026`**, one clock format: `04:39`. Both locale-independent — use `formatDate` / `formatClockTime` / `formatSummaryTimestamp` from `services/messageUtils.ts`. Never `toLocaleDateString` or `toLocaleTimeString` in the UI: the locale forms differ in order, punctuation and *width*, and these labels are drawn to a fixed mono rhythm. (`NoteWriter`'s ISO stamps are file data, not display — leave them.)
- An icon button sitting in a row of micro-label text needs `vertical-align: middle` **plus `position: relative; top: -0.09em`**. `middle` centres on x-height; these rows are caps and digits, so the icon otherwise sits ~1px low. Measured, and stable across sans/serif/mono faces

### Utility calls (`callUtility`) — ADR-158
- **A provider response is a list of content blocks.** Collect every `type === "text"` block and join; **never read `content[0]`** and infer from it. With extended thinking the first block is `thinking`, and a server-side tool use can precede the answer — both returned `""` and looked like "the model said nothing"
- `generateSummary`, `generateSummaryWithTitle` and `generateFavoritesSummary` are the only utility calls that run on the **conversation's** model rather than `fastModel`, so they are the ones that meet reasoning models and their leading thinking blocks
- `callUtility` returns `""` for *both* "no text" and "it failed". **A caller must never treat `""` as a silent no-op** — say something, or the next bug of this kind is unreportable

### Conversation summaries (ADR-141)
- Both summary prompts share ONE `SUMMARY_RULES` block in `services/BaseProvider.ts`. Never edit one prompt's rules without the other — that is why they are shared
- The contract: **substance, never the session** (no narrating what was done, produced, saved or inserted; no file names; no "as requested" — if the conversation produced a document, summarize what it *says*), **at most 5 sentences / 100 words**, **plain prose** (no headings, lists, bold or code)
- Do NOT lower `maxTokens` to force brevity — that truncates rather than shortens, and on a reasoning model the same budget pays for hidden reasoning. The sentence count is the contract; the cap is a safety valve
- `generateFavoritesSummary` is deliberately exempt — its `## Key learnings` structure is the point
- The fork and merge anchors clamp the summary to five lines via `clampSummary`, because a prompt is a request and summaries already on disk will never be regenerated

### Tables (ADR-131)
- Every rendered markdown table is wrapped in `.p-scroll-frame` by `decorateTables` and scrolls sideways when too wide, like code blocks and diagrams
- The table takes `width: max-content` with `max-width: 32ch` per cell. `max-width: none` alone does NOT widen a table — it sizes itself to its container (ADR-134)
- Cell text **wraps between words but is never split inside one**. `min-width: 8ch` is a floor so short columns are not crushed
- The rules must stay scoped under `.pythia-view` (ADR-065: core and themes load after the plugin and win a tie). What they actually override is Pythia's own `.p-ai-body` inherited into the cells — themes were blamed for the mid-word breaking for three ADRs and were never the cause (ADR-144)
- No sticky first column. The whole table scrolls as one piece
- **Hairline grid** (ADR-145): `1px solid var(--background-modifier-border)` on every cell, `border-collapse: collapse`, `padding: 3px var(--s2)`, and a 2px bottom rule on `th`. A full grid, not row rules — ragged multi-line rows make column tracking the problem, and a sideways-scrolling table needs vertical rules. **No header background**: a tinted row reads as a card (hard rules 3/4)
- Render non-message markdown through `renderRichMarkdown` so it gets this treatment too, never a bare `MarkdownRenderer.render`

### Glossary terms (ADR-136)
- Select a term in an answer and press **Define**. The lookup is a utility call, so it never enters the message list: no new prompt, no fork
- Resolution is **vault first, then the model given the passage**. No web tier, no API key
- The definition lives in the glossary note (`glossaryNote` setting), never on the conversation. **Do not add a `Conversation` field for terms** — the note is the only source of truth and terms are matched, not stored
- Every occurrence is marked in every conversation, via `repaintTerms` and a single alternation from `buildTermIndex`
- An entry also carries `aliases` — inflections and plurals **in the term's own language** (ADR-137). They are **stored, never derived**: a stemmer is language-specific, lossy on German compounds, and cannot be corrected by hand, which the note can
- Cross-language equivalents are `translations`, not aliases (ADR-149) — each tagged with its ISO 639-1 code, because a flat list cannot say which language a form belongs to, and ADR-148 made that six languages rather than two. Matched and marked exactly like an alias. An entry also carries `context`: one verbatim sentence from the passage, because `defineTerm` explains "the sense that applies here" and the entry otherwise keeps nothing of the here. The model returns all four in one `DEFINITION:` / `VARIANTS:` / `TRANSLATIONS:` / `CONTEXT:` reply
- **One note per term** (ADR-150), in `<glossaryFolder>/Terms/`. Not a preference — **Bases rows are files** ("each row is a file, and each column is a property of that file") and Dataview inline fields attach to the *page*, so a term inside a shared note is invisible as a row, and a theme-filtered deck is exactly a per-term view. ADR-149's visible `Forms:`/`Translations:`/`Context:` labels are superseded; that format survives only in `parseGlossary`, the migration reader
- **Properties, not our own labels.** `aliases` is Obsidian's native property; translations are flat `term_<lang>` keys (properties have no object type, and a flat key is a Base column); `theme` holds `[[links]]` so the theme note gets backlinks. Never re-introduce a custom label for something a property can carry
- **`Conversation.theme === undefined` means *follow the conversation name*** — never a copy of it. Only the undefined case gets renamed when the LLM titles the conversation. Resolve with `effectiveTheme()`; a fork pins the source's resolved theme, so "inherited but changeable" is true
- **Rename conversations only through `plugin.renameConversation(conv, name)`** — the old name is needed before the assignment, and the theme note moves via `fileManager.renameFile` (which rewrites the `[[links]]`; `vault.rename` does not)
- **Writes merge, never overwrite.** A re-lookup adds themes and contexts and keeps a `manual` definition; only the anchor's regenerate replaces it. This is what makes a term met in several conversations one note
- **People are entries too** (ADR-151): `GlossaryEntry.kind` is `"term" | "person"`, undefined reads as term. One index matches both in a single alternation — never add a second pass or a second painter. People live in `<glossaryFolder>/People/` with `type: person`; only the folder, the resolver and the mark differ
- **The person mark is a solid faint underline; the person anchor is `.p-term-anchor` + `.p-term-anchor--person`** (double left rule, `user` icon, `PERSON` label). Never restate a `.p-term-anchor-*` rule for a person
- **`describePerson` leads with the passage and must decline rather than guess.** A person the model has never met is the normal case in a working vault, and a generated biography reads later as a recorded fact — which is why model-sourced person entries carry `source: model` visibly. Vault-first-then-model is a user decision (ADR-151), not a default to loosen
- **Do not build a flashcard reviewer, a scheduler or an export.** Pythia captures terms; browsing and drilling them is Bases' job. The note format is the integration surface (ADR-149/150)
- A mark records the **canonical** term in `data-term`, not the form that matched, so tapping "Zählern" opens the entry filed under "Zähler". Use `canonicalTerm`; never assume `match[0]` is the term
- Marks are `<pythia-term class="p-term">`: a **dotted faint underline**, the quietest of the four mark types because it is the only one that repeats
- **Marks nest, and the innermost one owns the tap** (ADR-157). A term may sit inside a favorite, fork origin or merge link — only term-inside-term is refused. Resolution lives in `ui/markTap.ts`: never reintroduce a fixed type order, because the outer mark stays tappable along the rest of its span while the inner one has nowhere else to be tapped. `resolveMarkTap` matches `.p-term, .p-person` — a person mark opens the same anchor
- `repaintTerms` calls `body.normalize()` after unwrapping: a term is matched **within one text node**, and unwrapping a mark leaves its text split, so a term straddling the seam would silently stop matching
- The anchor opens **immediately after the tapped mark** (`markEl.after(anchor)`), exactly as the fork and merge anchors do (ADR-156) — never after the mark's paragraph. Placement is part of being the same component; a card at the end of a paragraph is a footnote, and a repeating mark makes the distance ambiguous as well as long
- The **anchor** is not quiet: it matches `.p-fork-anchor` exactly (accent left rule, accent icon, `--text-muted` 600 label, 11.5px title, shared `Öffnen →` control). Only the rule's stroke varies across the three — solid fork, dashed merge, dotted term (ADR-138). Quietness belongs to marks, which repeat; not to anchors, which do not
- A glossary definition never enters the system prompt, for the same reason a merge link does not
- **The anchor shows the definition in the conversation's language** (ADR-166): the instructed language, or under `auto` the language of the tapped answer (`displayLanguage`). The stored definition is never rewritten for this — a translation is cached in the note as `definition_<lang>`, valid while `translated_from` equals `definitionHash(definition)`; an edit or regenerate makes every cached language stale and the next translation clears them (`applyTranslation`). The anchor never shows the untranslated text first: a faint `Translating to EN…` placeholder, then the translation with `translated from DE` in the meta line — for a hand-written definition too. Term titles and context quotes are never translated: one is the word in the text, the other a verbatim attestation
- Language detection is local and returns `null` rather than guess (`services/languageDetect.ts`, function words, winner needs ≥2 hits and 1.5× the runner-up). A new entry records `language`; an old one is detected when needed

### Output language (ADR-148)
- **One setting, both halves.** `outputLanguage` instructs the chat answer *and* every utility prompt. Adding a new prompt anywhere means routing it through `BaseProvider.languageLabel(conversation?)` — a prompt that skips it is the bug ADR-148 fixed, reintroduced
- Six values: `obsidian` · `auto` · `de` · `en` · `it` · `es`, listed once in `OUTPUT_LANGUAGES` (`models/types.ts`) and labelled once in `ui/languageOptions.ts`. **Never hand-write the option list a second time** — the global setting and the per-conversation override must name the same languages in the same order
- **`auto` adds no instruction at all.** Do not "improve" it into a sentence like "respond in the conversation's language": a model with no language instruction already does that, and one holding a sentence about languages has something to reason about
- **One exception: `defineTerm` and `describePerson`** (ADR-166). Their prompt is English, so silence made the model answer in English whatever the passage said, and the note kept it. Under `auto` they say "write the definition in the language the passage is written in" (`BaseProvider.definitionLanguage`). Do not extend the exception to chat or to other utility prompts without the same reason
- `obsidian` follows Obsidian's UI locale into any of its ~30 languages, not just the four offered — `LANG_LABELS` is deliberately wider than the dropdown. An unknown locale falls back to English, never to `auto`
- Resolution is conversation override → global setting; `Conversation.outputLanguage === undefined` means *inherit*, and the modal's `Standard` option must keep writing `undefined` rather than copying the global value in
- The **prompt optimizer is exempt** — it rewrites the user's own prompt, and translating that would destroy what it was asked to improve

### State fills on touch (ADR-155)
- **Never `transition` a fill that communicates state** — a selected segment, an active toggle, a pressed control. It must be true at the moment of the tap; on iOS WebKit a transitioned `background-color` started from a class toggle in a touch handler may not paint until the next composite, and the user sees the old state until they scroll. Decorative transitions (opacity on a hover-revealed control) are fine
- **`:hover` rules belong in `@media (hover: hover)`.** iOS keeps `:hover` on the last-tapped element, so a hover fill sticks to exactly the control the user just pressed — and `--background-modifier-hover` next to an accent selection reads as a second selection

### Related conversations (ADR-109/169)

- **The floors are measured, not chosen.** They live on the model (`EMBEDDING_MODELS[...].relatedFloors`) because cosine distributions are a property of the model: the multilingual model scores every pair ~0.08 hotter than the English one. **Never share one constant across models** — that made "Balanced" mean 19 of 23 neighbours on one and 11 on the other. Re-measure with `scripts/measure-related.mjs` before changing a floor, and record the numbers
- **Vault RAG is a different question and keeps its own constants.** `vaultRetrievalMinScore` (0.5 / 0.35 / 0.2) scores a query against note chunks; ADR-169 measured conversation pairs. **Do not merge the two maps** — a test fails if you do. Measure query-to-note retrieval separately first (engineering-review #273)
- **A floor is a quality gate; `RELATED_RESULT_LIMIT` is the screenful.** The number of pairs clearing a fixed cosine grows linearly with the vault, so without the cap the list length tracks vault size rather than relevance
- **`maxPairwiseCosine` stays max, not a mean of top-k.** Measured: the lead (title+summary) chunk decides only 2.2% of matches, and mean-of-top-3 changes the top neighbour for 0 of 24 conversations. The boilerplate argument for it was tested and refuted
- **The warm never surprises**: desktop only, only when a `.bin` already exists (no unrequested ~100 MB model download at launch), ≥2 conversations, silent provider construction, fail-open into the debug log. Guards live in `warmIndex.ts` with tests, because `main.ts` has no coverage
- **A cold sync is cancellable and commits partial progress before rethrowing** — a cancelled build must leave the next one less to do. The panel aborts on close, on leaving related mode and on the first keystroke; an abort is the panel's own doing and reports nothing

### Conversation search (ADR-168)

- **One matching rule, in `services/tokenMatch.ts`.** `matchStrength` is graded (exact 1 · prefix .9 · infix .6 · reverse .5), never boolean — the caller multiplies IDF by it. The length floors are load-bearing: without them a 2-char stopword reverse-matches every long query and the result set becomes the corpus. **Never hand-roll a second comparison** — `bestMatchSnippet` shares it, or a row surfaces on a compound hit with no snippet to explain it
- **A loosened rule needs `applyRelevanceFloor`.** `score > 0` is not a filter once weak matches exist. The floor is **relative** (15% of the best) — IDF moves with corpus size, so an absolute cut-off means different things in different vaults
- **Results are always conversations.** Widening adds a *field* (`notes`), never a second corpus: scores from two corpora are not comparable, and a note row would have to answer to pick mode, the fork indent and the delete control. **Do not add vault notes, glossary entries or templates as result rows** — Obsidian's own search is one keystroke away
- The note dimension is `attachedNotes` + vault `sources` + `templateId`, **deduped, attached and cited weighted the same**, and it costs **no vault I/O** — the paths are already in `data.json`. Note *bodies* are deliberately not searched (engineering-review #266)
- **`Conversation.name` has no special case any more.** The old "title hit ×3" is `FIELD_WEIGHTS.title`; a new field is a weight, not an `if`
- **The chip announces what the user did NOT ask for.** Auto-widening (< 3 hits, non-empty query, not picking, no typed scope) shows the group header, a `via <note>` line per row and the ADR-109 chip; a typed `note:` shows the `via` line only. Never widen silently — a widened row does not contain the query anywhere the user can see
- An unknown `word:` prefix is **literal text, never a failed command** — a colon in ordinary search text must not become a silent filter
- **The snippet is the expensive part, not the ranking** (ADR-170, `scripts/bench-search.mjs`). Ranking the whole corpus costs <1ms; re-tokenizing message lines for every rendered row cost 398ms per keystroke at 500 conversations. Line tokens are cached lazily on `ConversationFields.lines`, and `bestMatchSnippet` **requires** the fields — never add an overload that takes only a conversation, or the uncached path survives
- **`SEARCH_RESULT_LIMIT` caps rendered rows at 20**, applied in `searchConversations` so the panel and the palette modal inherit it together. A short query matches a share of the corpus, so an uncapped list makes cost a function of vault size. The cap is applied AFTER the widen decision and can never change it
- **`ScoredField` names the keys that are scored**; `lines` is a cache and must never join `FIELD_WEIGHTS`. The compiler enforces it

### Conversation panel search row (ADR-152)
- `.p-switcher-clear` (✕) sits after the input and is **hidden until the field has content**. It prevents `mousedown` so it cannot steal focus from the input — on a phone that dismisses the keyboard mid-search
- **Auto-focus the input on desktop only.** On mobile the soft keyboard overlays the webview, so focusing on open hides the last conversations behind it. `Platform.isMobile` gates it
- Pad `.p-history-list` with `keyboardOverlap()` from `ui/keyboardInset.ts` — **never re-derive that arithmetic locally**. The copy that did dropped `MIN_KEYBOARD_INSET` and padded the list at rest (ADR-152)

### Model comparison (ADR-160)
- Entry point is the **long-press on the last user bubble**: the bar reads `✕ Delete · ⇄ Compare · Cancel`. There is no other entry point and it only ever re-runs the **last** user turn — never the input draft
- **The invariant: while a comparison is pending, the conversation ends with the user turn.** `startComparison` moves the existing answer out of `messages` into candidate 0. Never add a "pending" flag to `Message` or filter history at send time — the send path works unchanged *because* the answer is not in `messages`
- Candidates run **sequentially** through `llmRouter.streamMessage` on a `{ ...conv, provider, model, writeMode: "none" }` clone, using the view's normal streaming state (Stop works). Do not add parallel runs without giving `BaseProvider` a per-request abort controller first
- **Keep** appends the chosen candidate (its id becomes the message id) and forks the rest via `keepCandidate` → `ConversationService.createComparisonFork`. Fork name is `forkNameFor(conv.name, model)`; branch point is the kept message; no `forkedFromSelection`. Favorites and merge links on a non-kept answer move into its fork — never delete them
- **Send is blocked** while `conv.comparison` is set (`comparePending`). Discard restores candidate 0 verbatim
- The card reuses the fork anchor's grammar (accent rule, mono caps label); the active tab's fill is state — no transition (ADR-155). Model picking uses `suggest/ModelSuggest.ts`, never the header popover, which would change the conversation's model

### Token limit support (ADR-162)
- **The stop reason is a fact, not a detail.** Every provider sets `RoundResult.truncated` (`max_tokens` / `length`) and `BaseProvider` passes `StreamFinish` to `onComplete`. A new provider that maps every stop to `"done"` reintroduces the bug: a cut-off reply that looks finished
- **One rule: `maxTokensAdvice` in `services/settingsAdvice.ts`.** The modal's advice line, `SendHintController` and `TruncationController` all read it. Never compare against `DEFAULT_MAX_TOKENS_REASONING` in a controller
- **The fix is offered, never applied.** `clear` (drop the conversation's override so it follows the model again — principle 6) when that is enough; `pin` only when the global setting is the low value. No auto-bump on model switch
- **Actions only on the last answer.** Continue and Retry rewrite what comes next, not history. Retry is withheld when a star or merge link sits on the answer; it goes through `spliceExchange`, the one exchange-removal function
- **An empty reply always says something** (`noticeEmptyReply`). An empty *truncated* reply names the budget — that is the reasoning-model case
- Model rows show `MODEL_PROFILE` tiers (speed · depth · cost, 1–3) — tiers, not prices; the test requires one per catalog entry

### The conversation history limit (ADR-171/172/174)

- **The cost is bytes, not conversations** (ADR-174). The whole `data.json` is rewritten after every message and a synced vault moves all of it again, so a hundred long conversations outweigh a thousand short ones. Thresholds live in `services/storageSize.ts` and are **measured** — re-run `scripts/bench-store.mjs` before changing one, and record the numbers. The settings tab always prints the size under the limit; the `Notice` fires once per load and only at `high`, because a warning repeated after the user has acted on it is how people learn to dismiss warnings
- **The browse listing pages at `BROWSE_PAGE_ROWS = 50`** and `show more` **appends** — search has been capped since ADR-170, and the empty-query listing was the one surface whose length was the whole corpus. A source and its forks are always drawn together, so a page may overshoot; the fork indent means nothing across a page break
- **`forksBySource` is built once per list build** and both readers share it — the ⑂ badge is its `length`. Never re-introduce a `filter` over the corpus inside the row loop: that is what made drawing the list quadratic (528ms at 5 000 conversations)

- **The limit archives before it deletes, and the order is the rule** (ADR-172). `applyCap` writes each removed conversation to a note through `NoteWriter.archiveConversationNote`, and drops **only what was written** — a failed write keeps the conversation and leaves the list over the cap. Never reorder this into drop-then-archive, and never let a failure fall through to the delete
- **`archiveBeforeEviction` is ON by default.** The user this protects is the one who never opens the settings. `createNote` (which refuses an existing path) plus `archiveNotePath`'s suffixing means the archive can never overwrite a note — two conversations may share a name and a day
- **The delete dialog offers it too** (ADR-173): `Archive` (`mod-cta`, leading) · `Delete` · `Cancel`, both one tap. A choice in the dialog, never a remembered setting — `archiveBeforeEviction` is for the automatic path, where nobody is present to be asked. `ConversationService.archiveConversation` returns false when the note could not be written, and the caller then does **not** delete
- **Every eviction outcome speaks**: archived · removed-because-archiving-is-off · could-not-archive, each a `Notice`. Silent eviction is the bug these two ADRs are about
- **"No limit" is an empty field, not 0** (ADR-172). `0` stays the stored form; `capFieldValue` and the field's `read` in `ui/conversationCapSetting.ts` are the only two places that know it. The message cap follows the same convention — never let one pane carry two "unlimited" spellings
- **`maxConversations` deletes conversations. It is not a cache size.** Only `saveConversations()` applies it: `persist({ evict })` defaults to **off**, so a settings write or a secret write can never evict. Never flip that default back
- **Lowering the limit asks first.** `ConversationCapModal` names the count from `countEvictions` — read from `evictConversations` itself, never a second copy of its protection rules — and what survives (starred · open in a leaf · merge target). Escape and the outside press are "no"; a cancelled dialog restores the stored number in the field
- **No numeric settings field commits per keystroke.** `onChange` fires per character, so lowering "200" to "0" passes through 20 and 2 — that is what deleted a vault's conversations. Every numeric field goes through `bindNumberSetting` (`ui/numberSetting.ts`), which commits on blur or Enter and restores the stored value on a rejected entry; `PythiaSettingTab.hide()` flushes the field the user is standing in, because closing the tab destroys the input before `blur` fires. `settings.ts` holds no `parseInt`, and a new field is a rule object, not another hand-rolled parse
- A rejected entry never clamps. Storing a number the user did not type is how "0 means unlimited" became "2"

### Templates (ADR-177)

- **Creating a conversation from a template writes its fields onto the conversation** — that conversation *is* the template. Unchanged, and correct
- **Applying a template to a conversation that is already running writes NOTHING.** `armPendingTemplate` snapshots it onto `conv.pendingTemplate`; `applyPendingTemplate` layers it over a clone for one send; the layer clears on a committed answer. Never go back to assigning `conv.model`/`conv.systemPrompt`/… on this path — nine permanent fields for a one-turn instruction is the bug this ADR fixed
- **A snapshot, not the template's path**: an edit to the template file between arming and sending must not change the turn (same reasoning as ADR-163's cost snapshot)
- **Cleared on a committed answer, not at send start** — an errored or empty reply leaves it armed so the retry is the same shape
- `resume_mode` deliberately does **not** apply on this path: history selection is a property of the conversation, not of one answer
- The armed template is visible as the leading `.p-wikilink--template` pill, and `Message.templateId` records the template that actually shaped that answer — which is what the field always claimed to mean

### Rewriting a passage (ADR-178)

- **The user picks the target, never the model.** There is no `rewrite_selection` tool and there must not be one: a tool means re-finding the passage by its text at write time, which is how the wrong paragraph gets overwritten. The range is captured from the editor when armed
- **A target is a range PLUS the text that was in it**, and `targetState` compares them **exactly** — no trimming, no whitespace normalization. `stale` and `gone` refuse the write and say which; the answer stays on screen to paste by hand
- **The answer is a proposal.** Nothing is written when it arrives; *Replace in note* is a separate press. A write that can destroy content is its own operation, and here it would destroy the user's own prose
- **Write through the open editor when possible** — `editor.replaceRange` is one undo step, and undo is the real safety net. A closed note is opened first, never written blind
- **Armed until applied or dismissed**, unlike ADR-177's one-shot template: a rewrite is iterated ("shorter"), so every answer while it is armed is another proposal for the same passage
- The passage rides in the **message**, not the system prompt, so a follow-up turn can still see what is being rewritten

### Model suggestion (ADR-181)

- **The model rates, Pythia picks.** The optimizer reply ends with `DIFFICULTY: light | standard | deep` (same call, no second request); `recommendModel` maps it to the cheapest adequate model of `settings.defaultProvider` by `MODEL_PROFILE` + `MODEL_PRICING`. **Never let a model name a model** — it does not know the catalog, the prices or the keys
- **Offered, never applied; one send, never written.** `.p-model-hint` beside Send; tap accepts, tap again withdraws. `layer(conv)` clones for the next send and `applyPendingTemplate` runs over it, so a template's model wins. Spent on a committed answer, like ADR-177. Never assign the suggestion to `conv.model`
- **Cost as a tier, never dollars** (ADR-163) — the chip carries `tierDots`, not `≈ $`
- **No suggestion** when a template pins the model, a PDF meets Mistral, the current model is adequate and not dearer, or a downgrade's cold send costs more than staying on the cached model (`sendCost`) — measured from the price table, not guessed
- **The answer names the model that answered**: `turnConv.model`, never `conv.model`, for the message, its cost snapshot and a stream error (#305)

### # Navigator
- Trigger: `#` button, bottom-right, floating above input
- Opens upward as popover, width 260px, max-height 384px
- Sections: **Forks** → **Merged** (only when the conversation has merge links) → **Starred** (bookmarked messages) → **All prompts** (every user message)
- Closes on outside click or item tap
- No separate Favorites row anywhere — fully consolidated here

### Input area
```
[ textarea auto-expand 1→72px max ]
[ attach ][ save ] ______________ [ Senden ]
```
- **Enter writes a line break; Cmd/Ctrl+Enter sends** (ADR-175). The rule lives once, in `ui/composerKeys.ts` — never re-derive it in a keydown handler, and never let a send fire while `isComposing` is true. The placeholder names the shortcut on desktop only
- Textarea: transparent, no border, `--font-monospace`, 12px
- Toolbar icons: inline SVG, 22×22px hit area
- Send: `--color-accent`, `--font-monospace`, 10px, `border-radius: 3px`

---

## What not to build

- No Favorites row in the header — merged into `#` navigator
- No avatar or "Pythia" label per AI message
- No turn divider lines
- No blockquote for the summary — it is a sticky panel
- No sparkle in the toolbar — sparkle is in the summary bar only
- No card shadows on summary or reference rows
- No framework mount (no React root, no Svelte component, no shadow DOM)

