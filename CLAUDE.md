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
  services/
    AnthropicService.ts       ← Anthropic streaming + utility calls
    OpenAIProvider.ts         ← OpenAI streaming + utility calls
    BaseProvider.ts           ← abstract base: shared fields, lifecycle, all generate* utility methods
    messageUtils.ts           ← shared: parseTitleAndSummary, normalizeMessages, token estimation, output-language resolution + the three prompt shapes (ADR-148), formatDate/formatClockTime (the only UI date + time formatters — ADR-139)
    pathUtils.ts              ← noteBasename: display name for a vault path (last segment, .md stripped)
    LLMRouter.ts              ← dispatches calls to the active provider
    LLMProvider.ts            ← provider interface
    ConversationStore.ts      ← in-memory store + debounced persistence
    ContextBuilder.ts         ← builds system prompt, attaches vault notes
    NoteWriter.ts             ← vault write operations
    ToolHandler.ts            ← tool definitions (create_note, rewrite_note, prepend_note) + execution
    TemplateLoader.ts         ← template discovery + frontmatter parsing
    persistence.ts            ← pure functions: applySettingsMigrations, mergeSettings, parseConversations, mergeConversations, shouldRefuseLoad, evictConversations
    glossary.ts               ← pure: parseGlossary (legacy reader, migration only) + buildTermIndex (ADR-136/137/149)
    glossaryNotes.ts          ← pure: the note-per-term format — paths, frontmatter mapping, body, mergeEntry, effectiveTheme (ADR-150)
    GlossaryService.ts        ← glossary folder I/O + vault-then-model term lookup (ADR-136/150)
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
    keyboardInset.ts          ← soft-keyboard overlap rule (pure, unit-tested) — ADR-132
    clampBody.ts              ← five-line clamp + expand control for anchor summaries (ADR-141)
    languageOptions.ts        ← the language dropdown's options, shared by the settings tab and the conversation modal (ADR-148)
    glossarySettings.ts       ← glossary folder + migration controls for the settings tab (ADR-150)
    GlossaryController.ts     ← glossary term marks + inline definition anchor (ADR-136)
    citationPainter.ts        ← swaps ⟦cite:…⟧ markers for numbered chips
  suggest/                    ← modal dialogs (conversation picker, delete confirm, etc.)
  tests/                      ← Vitest unit tests (npm test) — 823 tests across 53 files
    helpers/viewHarness.ts    ← shared mount fixture for the view-render tests
  locales/
    en.ts                     ← English i18n strings
    de.ts                     ← German i18n strings
  docs/
    architecture.md           ← system architecture, data flows, component relationships
    design.md                 ← design system, CSS tokens, component specs
    decisions.md              ← architectural decision records (ADRs)
    engineering-review.md     ← improvement suggestions and priority matrix
  eslint.config.mjs           ← ESLint flat config (typescript-eslint)
  vitest.config.ts            ← Vitest coverage configuration
  .github/workflows/ci.yml   ← CI: lint → build → test on push / PR / workflow_dispatch
```

---

## Documentation maintenance

**After every session that changes code, update the relevant docs:**

| Changed area | Update these docs |
|---|---|
| File structure, services, data flow | `docs/architecture.md` |
| UI components, CSS tokens, design rules | `docs/design.md` |
| Architectural choice or trade-off | `docs/decisions.md` (append a new ADR) |
| Bug found / suggestion resolved / new suggestion | `docs/engineering-review.md` |

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
| `--text-on-accent` | Text on accent-colored surfaces |

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

1. **The panel fills its leaf flush** — no border-radius on the `.pythia-view` root, and **no inset on any side**. Obsidian's `.workspace-leaf-content` pads `.view-content`; `.workspace-leaf-content[data-type="pythia"] { padding: 0 }` neutralizes it for our leaf only (ADR-147). `.p-history` is `inset: 0` on `.pythia-view`, so **opening the conversation panel is the quickest way to see the panel's true edges** — if it stops short of the leaf on any side, the container is inset, not the content.
2. **No imported fonts.** Use `var(--font-interface)` and `var(--font-monospace)` only.
3. **No custom background colors.** Every surface uses an Obsidian CSS variable. No hex codes on backgrounds.
4. **No box-shadow on panels.** Flat surfaces only. Navigator popover is the single exception.
5. **No emoji icons.** Design system icons are inline SVG, `stroke-width: 1.6`, `12×12px`. Obsidian chrome icons use `setIcon`.
6. **Accent is always `var(--color-accent)`.** Never hardcode a hex accent value.
7. **No `env(safe-area-inset-bottom)` on the input area** (ADR-146 — this rule previously said the opposite). **The reasoning below is withdrawn by ADR-147**: the 34px was the *leaf container's* padding, not our `env()` inset. The rule itself stands (4px bottom padding, asked for), but the strip it was blamed for is fixed by `.workspace-leaf-content[data-type="pythia"] { padding: 0 }`. `env()` reports the device's inset wherever the element sits, so a sidebar leaf with anything below it reserved ~34px for a home indicator it was nowhere near. ADR-134's attempt to keep the inset and switch it off by measuring the panel's bottom edge did not fire on the reporter's device — measured at 42px below the send button where 8 was intended, i.e. 8 + exactly one home indicator. The input area is now `padding: var(--s2) var(--s3) var(--s1)`, full stop. Obsidian's own mobile chrome sits between a sidebar leaf and the screen edge. **`env(safe-area-inset-bottom)` is still correct for bottom sheets and modals** (`.pythia-modal`, the mobile action sheet) — those really do touch the screen edge.
8. **Never touch `containerEl.children[0]`.** That is the Obsidian leaf header.
8a. **Never replace `plugin.conversations` wholesale from disk.** Reconcile with `mergeConversations` so a stale data.json cannot roll a conversation back and lose its newest turn (ADR-133).
8b. **Never set an explicit `height` on `containerEl.children[1]`.** It is `overflow: hidden`, so a height below the content silently crops the input area (including its mandated safe-area padding) and uncovers the background behind the panel. Move content with padding instead (ADR-132).
9. **No inline modal logic in `sidebar.ts`.** All modals go in `suggest/`.
10. **No raw `addEventListener`.** Always use `registerDomEvent` / `registerEvent`.

---

## Component inventory

### Header
```
[ search ][ Title (grows) ][ pencil ][ link ][ trash ][ model badge ][ plus ]
```
Order left→right (ADR-098): search · name (grows) · rename · link · delete · [ctx chip] · model · new. The name group is the only `flex: 1` region, so the "+" is always the last child and never shifts. **No template caption** — the template rides the assistant turn label instead (ADR-129). See `docs/design.md` for the full spec.
- Search (far left, `search` loupe icon, ADR-107): opens the `.p-history` conversation panel with its search input focused. The single in-view conversation-search surface.
- Title: 12px, `font-weight: 600`, truncated with ellipsis, flex: 1. Plain, non-interactive text (ADR-107) — no click, no `▾`.
- Model badge: `--font-monospace`, 10px, `--text-faint`
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
AI:    OPUS 4.8 · 22:20 · ↑151 ↓430
```
- `--font-monospace`, 9px, `--text-faint`; rendered by `ui/turnLabel.ts`
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
TEMPLATE  [[Podcast Summary]]
VAULT     1 [[Some Note]]
WEB       2 thetransmitter.org ↗  3 sainsburywellcome.org ↗
```
- Rows always in that order — **from the user outwards**: the template is theirs and framed the answer, the vault notes are their own knowledge, the web is the outside and the only part that can rot. Also the order in which to trust them, and it puts the longest row last
- The vault row is **always** labelled `VAULT`; it is never relabelled when there is no web row. One label per row type
- **The template carries no number.** The numbers are citation indices matching the superscript chips in the prose, and nothing cites the template
- Vault references — the template included — render as `[[Name]]` via the shared `renderWikilink`; web chips are numbered and end with `↗`. That is the only axis on which the rows differ
- `.p-sources-label` is a **54px column** so stacked rows start their chips at one x. 54px clears the widest label (`TEMPLATE`, measured at 49px) with slack for a wider theme monospace — it is NOT, as ADR-140 claimed, borrowed from the reference row, which has no label at all (ADR-144)
- **Words, not icons** (ADR-140): template and vault note have no distinct glyph at 11px, and the column is read once rather than aimed at
- `VAULT` lists the attached/auto-retrieved notes the model *cited*, not everything in context — it is the model's own claim, unlike `TEMPLATE`, which Pythia records

### Dates and micro-label rows (ADR-139)
- **One date format: `15 Sep 2026`**, one clock format: `04:39`. Both locale-independent — use `formatDate` / `formatClockTime` / `formatSummaryTimestamp` from `services/messageUtils.ts`. Never `toLocaleDateString` or `toLocaleTimeString` in the UI: the locale forms differ in order, punctuation and *width*, and these labels are drawn to a fixed mono rhythm. (`NoteWriter`'s ISO stamps are file data, not display — leave them.)
- An icon button sitting in a row of micro-label text needs `vertical-align: middle` **plus `position: relative; top: -0.09em`**. `middle` centres on x-height; these rows are caps and digits, so the icon otherwise sits ~1px low. Measured, and stable across sans/serif/mono faces

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
- **Do not build a flashcard reviewer, a scheduler or an export.** Pythia captures terms; browsing and drilling them is Bases' job. The note format is the integration surface (ADR-149/150)
- A mark records the **canonical** term in `data-term`, not the form that matched, so tapping "Zählern" opens the entry filed under "Zähler". Use `canonicalTerm`; never assume `match[0]` is the term
- Marks are `<pythia-term class="p-term">`: a **dotted faint underline**, the quietest of the four mark types because it is the only one that repeats. Tap precedence is fork, merge, favorite, then term
- The **anchor** is not quiet: it matches `.p-fork-anchor` exactly (accent left rule, accent icon, `--text-muted` 600 label, 11.5px title, shared `Öffnen →` control). Only the rule's stroke varies across the three — solid fork, dashed merge, dotted term (ADR-138). Quietness belongs to marks, which repeat; not to anchors, which do not
- A glossary definition never enters the system prompt, for the same reason a merge link does not

### Output language (ADR-148)
- **One setting, both halves.** `outputLanguage` instructs the chat answer *and* every utility prompt. Adding a new prompt anywhere means routing it through `BaseProvider.languageLabel(conversation?)` — a prompt that skips it is the bug ADR-148 fixed, reintroduced
- Six values: `obsidian` · `auto` · `de` · `en` · `it` · `es`, listed once in `OUTPUT_LANGUAGES` (`models/types.ts`) and labelled once in `ui/languageOptions.ts`. **Never hand-write the option list a second time** — the global setting and the per-conversation override must name the same languages in the same order
- **`auto` adds no instruction at all.** Do not "improve" it into a sentence like "respond in the conversation's language": a model with no language instruction already does that, and one holding a sentence about languages has something to reason about
- `obsidian` follows Obsidian's UI locale into any of its ~30 languages, not just the four offered — `LANG_LABELS` is deliberately wider than the dropdown. An unknown locale falls back to English, never to `auto`
- Resolution is conversation override → global setting; `Conversation.outputLanguage === undefined` means *inherit*, and the modal's `Standard` option must keep writing `undefined` rather than copying the global value in
- The **prompt optimizer is exempt** — it rewrites the user's own prompt, and translating that would destroy what it was asked to improve

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

