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
    messageUtils.ts           ← shared: parseTitleAndSummary, normalizeMessages, token estimation, lang helpers, formatDate/formatClockTime (the only UI date + time formatters — ADR-139)
    pathUtils.ts              ← noteBasename: display name for a vault path (last segment, .md stripped)
    LLMRouter.ts              ← dispatches calls to the active provider
    LLMProvider.ts            ← provider interface
    ConversationStore.ts      ← in-memory store + debounced persistence
    ContextBuilder.ts         ← builds system prompt, attaches vault notes
    NoteWriter.ts             ← vault write operations
    ToolHandler.ts            ← tool definitions (create_note, rewrite_note, prepend_note) + execution
    TemplateLoader.ts         ← template discovery + frontmatter parsing
    persistence.ts            ← pure functions: applySettingsMigrations, mergeSettings, parseConversations, mergeConversations, shouldRefuseLoad, evictConversations
    glossary.ts               ← pure: parseGlossary, upsertGlossaryEntry, buildTermIndex (ADR-136/137)
    GlossaryService.ts        ← glossary note I/O + vault-then-model term lookup (ADR-136)
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
    GlossaryController.ts     ← glossary term marks + inline definition anchor (ADR-136)
    citationPainter.ts        ← swaps ⟦cite:…⟧ markers for numbered chips
  suggest/                    ← modal dialogs (conversation picker, delete confirm, etc.)
  tests/                      ← Vitest unit tests (npm test) — 752 tests across 49 files
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

1. **No border-radius on `.pythia-view` root.** The panel fills the sidebar flush.
2. **No imported fonts.** Use `var(--font-interface)` and `var(--font-monospace)` only.
3. **No custom background colors.** Every surface uses an Obsidian CSS variable. No hex codes on backgrounds.
4. **No box-shadow on panels.** Flat surfaces only. Navigator popover is the single exception.
5. **No emoji icons.** Design system icons are inline SVG, `stroke-width: 1.6`, `12×12px`. Obsidian chrome icons use `setIcon`.
6. **Accent is always `var(--color-accent)`.** Never hardcode a hex accent value.
7. **iOS safe area on input.** Always: `padding-bottom: max(var(--s2), var(--p-bottom-inset, env(safe-area-inset-bottom, var(--s2))))`. `env()` reports the device inset wherever the element sits, so the view measures whether the panel really reaches the screen edge and sets `--p-bottom-inset: 0px` when another leaf is below it — otherwise the inset is dead space (ADR-134). Never drop the `env()` default: a full-height leaf still needs it.
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
REFERENZ  [ pill: filename ✕ ]
```
- Label: `--font-monospace`, 10px, uppercase, `--text-faint`, width 54px
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

### Merge links (ADR-130)
- The inverse of Fork. A passage selected in an assistant answer is pointed at an **existing** conversation; that conversation's summary is surfaced inline at the passage
- Created from the selection toolbar's **Merge** button (next to Branch, assistant content only), which opens the conversation search and records a `MergeLink` on the conversation holding the passage
- **Display-only** — a merge never enters the system prompt. Do not add merge content to `ContextBuilder`
- Marks are `<pythia-merge class="p-merge-link">`: a **dashed accent underline**, never a third highlighter fill (yellow favorites and accent fork origins own that treatment)
- The anchor `.p-merge-anchor` mirrors `.p-fork-anchor` with a dashed left rule: target name, conversation summary, `N messages · MODEL · date [· outdated]`, regenerate, unlink, `Open →`
- The link reads from **both ends**, like a fork: the conversation a link points at shows a `.pythia-merge-banner` naming every conversation that merged with it. The inbound list is derived on read via `incomingMergeLinks`, never stored as a back-reference
- Regeneration uses `generateSummary`, never `generateSummaryWithTitle` — merging must not rename the target

### Sources row (under an assistant answer)
```
TEMPLATE  [[Podcast Summary]]
WEB       1 thetransmitter.org ↗  2 sainsburywellcome.org ↗
VAULT     3 [[Some Note]]
```
- Rows in that order, template always first: it is the frame the answer was written in, not one of the passages inside it
- **The template carries no number.** The numbers are citation indices matching the superscript chips in the prose, and nothing cites the template
- Vault references — the template included — render as `[[Name]]` via the shared `renderWikilink`; web chips are numbered and end with `↗`. That is the only axis on which the rows differ
- `.p-sources-label` is a **54px column**, the same width as the reference row's label, so stacked rows start their chips at one x
- A single `SOURCES` row replaces WEB/VAULT when every citation is a vault note

### Dates and micro-label rows (ADR-139)
- **One date format: `15 Sep 2026`**, one clock format: `04:39`. Both locale-independent — use `formatDate` / `formatClockTime` / `formatSummaryTimestamp` from `services/messageUtils.ts`. Never `toLocaleDateString` or `toLocaleTimeString` in the UI: the locale forms differ in order, punctuation and *width*, and these labels are drawn to a fixed mono rhythm. (`NoteWriter`'s ISO stamps are file data, not display — leave them.)
- An icon button sitting in a row of micro-label text needs `vertical-align: middle` **plus `position: relative; top: -0.09em`**. `middle` centres on x-height; these rows are caps and digits, so the icon otherwise sits ~1px low. Measured, and stable across sans/serif/mono faces

### Tables (ADR-131)
- Every rendered markdown table is wrapped in `.p-scroll-frame` by `decorateTables` and scrolls sideways when too wide, like code blocks and diagrams
- The table takes `width: max-content` with `max-width: 32ch` per cell. `max-width: none` alone does NOT widen a table — it sizes itself to its container (ADR-134)
- Cell text **wraps between words but is never split inside one**. `min-width: 8ch` is a floor so short columns are not crushed
- The rules must stay scoped under `.pythia-view`, or Obsidian core and theme `word-break: break-all` on cells wins (ADR-065)
- No sticky first column. The whole table scrolls as one piece
- Render non-message markdown through `renderRichMarkdown` so it gets this treatment too, never a bare `MarkdownRenderer.render`

### Glossary terms (ADR-136)
- Select a term in an answer and press **Define**. The lookup is a utility call, so it never enters the message list: no new prompt, no fork
- Resolution is **vault first, then the model given the passage**. No web tier, no API key
- The definition lives in the glossary note (`glossaryNote` setting), never on the conversation. **Do not add a `Conversation` field for terms** — the note is the only source of truth and terms are matched, not stored
- Every occurrence is marked in every conversation, via `repaintTerms` and a single alternation from `buildTermIndex`
- An entry also carries `aliases` — inflections, plurals and the term's equivalent in the other language of a bilingual conversation (ADR-137). They are **stored, never derived**: a stemmer is language-specific, lossy on German compounds, and cannot be corrected by hand, which the note can. The model returns them alongside the definition in one `DEFINITION:` / `VARIANTS:` reply
- A mark records the **canonical** term in `data-term`, not the form that matched, so tapping "Zählern" opens the entry filed under "Zähler". Use `canonicalTerm`; never assume `match[0]` is the term
- Marks are `<pythia-term class="p-term">`: a **dotted faint underline**, the quietest of the four mark types because it is the only one that repeats. Tap precedence is fork, merge, favorite, then term
- The **anchor** is not quiet: it matches `.p-fork-anchor` exactly (accent left rule, accent icon, `--text-muted` 600 label, 11.5px title, shared `Öffnen →` control). Only the rule's stroke varies across the three — solid fork, dashed merge, dotted term (ADR-138). Quietness belongs to marks, which repeat; not to anchors, which do not
- A glossary definition never enters the system prompt, for the same reason a merge link does not

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

