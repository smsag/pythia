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
    messageUtils.ts           ← shared: parseTitleAndSummary, normalizeMessages, token estimation, lang helpers
    LLMRouter.ts              ← dispatches calls to the active provider
    LLMProvider.ts            ← provider interface
    ConversationStore.ts      ← in-memory store + debounced persistence
    ContextBuilder.ts         ← builds system prompt, attaches vault notes
    NoteWriter.ts             ← vault write operations
    ToolHandler.ts            ← tool definitions (create_note, rewrite_note, prepend_note) + execution
    TemplateLoader.ts         ← template discovery + frontmatter parsing
    persistence.ts            ← pure functions: applySettingsMigrations, mergeSettings, parseConversations, shouldRefuseLoad, evictConversations
    apiError.ts               ← HTTP error classification
  ui/
    InlineSuggest.ts          ← autocomplete widget for textarea
    OptimizationController.ts ← inline prompt optimizer state + flow
    NavigatorController.ts    ← # navigator popover logic
  suggest/                    ← modal dialogs (conversation picker, delete confirm, etc.)
  tests/                      ← Vitest unit tests (npm test) — 187 tests across 12 files
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
7. **iOS safe area on input.** Always: `padding-bottom: max(var(--s2), env(safe-area-inset-bottom, var(--s2)))`.
8. **Never touch `containerEl.children[0]`.** That is the Obsidian leaf header.
9. **No inline modal logic in `sidebar.ts`.** All modals go in `suggest/`.
10. **No raw `addEventListener`.** Always use `registerDomEvent` / `registerEvent`.

---

## Component inventory

### Header
```
[ history ][ Title ▾ (grows) ][ pencil ][ link ][ trash ][ model badge ][ plus ]
```
Order left→right (ADR-098): history · name (grows) · rename · link · delete · [ctx chip] · model · new. The name group is the only `flex: 1` region, so the "+" is always the last child and never shifts. See `docs/design.md` for the full spec.
- Title: 12px, `font-weight: 600`, truncated with ellipsis, flex: 1
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

### Token line (below each AI message)
```
★ | ↑151 ↓430
```
- `--font-monospace`, 10px, `--text-faint`
- Star toggles bookmark: inactive `☆ --text-faint` → active `★ #f59e0b`
- Bookmarked messages surface in the `#` navigator under "Starred"

### # Navigator
- Trigger: `#` button, bottom-right, floating above input
- Opens upward as popover, width 260px, max-height 384px
- Two sections: **Starred** (bookmarked messages) → divider → **All prompts** (every user message)
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

