# Pythia — Design System

*Last updated: 2026-07-10 (session) — temperature slider; collapsible input area; summary trigger moved from header to input-area sparkle with a regenerate icon next to the summary timestamp*

Visual reference: `docs/pythia-v3.html` — open in browser before any UI work.

---

## Philosophy

Pythia lives inside the Obsidian sidebar. Every surface must feel like a native Obsidian panel — not an embedded app. The design system enforces this by using only Obsidian CSS variables, following Obsidian's font stack, and keeping layout flat.

---

## CSS token reference

### Colours — always use Obsidian variables, never hex

| Token | Usage |
|---|---|
| `--color-accent` | User bubble background, pill borders, send button |
| `--text-normal` | Primary readable text, AI response body |
| `--text-muted` | Secondary text |
| `--text-faint` | Labels, badges, token counts, inactive icons |
| `--text-on-accent` | Text on accent-coloured surfaces (user bubble) |
| `--background-primary` | Panel background, input area |
| `--background-secondary` | Summary bar background |
| `--background-modifier-border` | All dividers and borders |
| `--background-modifier-hover` | Button hover states |
| `--color-green` | Copied-to-clipboard confirmation on copy button |

For a tinted border: `color-mix(in srgb, var(--color-accent) 60%, black)` with a plain `var(--color-accent)` fallback on the preceding line for Chromium < 111.

### Spacing — 4 px grid, no arbitrary values

```css
--s1: 4px    --s2: 8px    --s3: 12px    --s4: 16px
```

### Typography scale

```css
--font-smaller: 11px   /* labels, token counts, nav items */
--font-small:   12px   /* body text, pills, toolbar, textarea */
```

Font families: `var(--font-interface)` for UI text; `var(--font-monospace)` for labels, badges, token counts, textarea.

---

## Hard rules — never violate

1. **No border-radius on `.pythia-view` root.** The panel fills the sidebar flush.
2. **No imported fonts.** `var(--font-interface)` and `var(--font-monospace)` only.
3. **No custom background colours.** Every surface uses an Obsidian variable.
4. **No box-shadow on panels.** Flat surfaces only. Navigator popover is the only exception.
5. **No emoji icons.** Plugin icons are inline SVG, `stroke-width: 1.6`, `12×12 px`. Obsidian chrome icons use `setIcon`.
6. **Accent is always `var(--color-accent)`.** Never hardcode a hex accent.
7. **iOS safe area on input.** Always: `padding-bottom: max(var(--s2), env(safe-area-inset-bottom, var(--s2)))`.
8. **Never touch `containerEl.children[0]`.** That is the Obsidian leaf header.
9. **No inline modal logic in `sidebar.ts`.** All modals go in `suggest/`.
10. **No raw `addEventListener`.** Always use `registerDomEvent` / `registerEvent`.

---

## Critical CSS constraints discovered in v1.11.5

### Diagram overflow containment

Diagrams (any `.block-language-*` container) must scroll within their own frame — not the whole conversation. Three rules are required together:

```css
/* 1. Hard stop at the chat level — clip without creating a scroll container */
.p-chat { overflow-x: clip; }   /* NB: clip, not hidden — hidden interferes with
                                    nested overflow:auto frames in WebKit/iOS */

/* 2. Flex items must opt out of min-content sizing */
.p-msg-ai { min-width: 0; max-width: 100%; }
.p-ai-body { min-width: 0; max-width: 100%; }

/* 3. Diagram container gets a definite width and local scroll */
.p-ai-body [class*='block-language-'] {
  position: relative;   /* for absolute copy button */
  overflow-x: auto;
  width: 100%;
}
```

Without rule 1: CSS coerces `overflow-x` to `auto` when `overflow-y: auto` is set, making the whole chat scroll sideways. `clip` (not `hidden`) is used because `hidden` creates a scroll container that can swallow inner `overflow: auto` scrollbars in WebKit.
Without rule 2: flex items default to `min-width: auto` (min-content), expanding to accommodate wide SVG content.
Without rule 3's `width: 100%`: the diagram container has no definite width to clip against.

`fixDiagramSvgSize()` stamps explicit pixel dimensions on the SVG using a MutationObserver (for attribute/style mutations) and a ResizeObserver fallback (for layout-only mutations used by Vega and Mermaid v10+). The selector `[class*='block-language-']` covers all renderer plugins, not just Mermaid and PlantUML.

### Touch devices — `@media (hover: none)`

Copy buttons use `opacity: 0` + `:hover` reveal. On iOS/Android (no hover state) they would be invisible without:

```css
@media (hover: none) {
  .p-code-frame .p-code-actions,
  .p-ai-body [class*='block-language-'] .p-diag-copy { opacity: 1; }
}
```

---

## Component inventory

### Header
```
[ Conversation title ▾ ][ ✎ pencil ][ model badge ][ 🔗 link ][ 🗑 trash ][ + plus ]
```
- Title: 12px, `font-weight: 600`, truncated, flex: 1, clickable to switch conversations
- Pencil ✎ (`.p-rename-btn`): visible when a conversation is active; opens inline rename mode
- Model badge: monospace, 10px, `var(--text-faint)`, clickable to change model
- Link 🔗: copies `obsidian://pythia?cmd=resume&id=…` to clipboard; check-mark feedback
- Trash/Plus: standard header actions

**Rename mode** replaces the title + pencil with `.p-rename-input` (inline `<input>`, flex: 1, accent border, 20px height) and `.p-rename-llm-btn` (sparkle, accent colour). Enter/blur confirms and saves; Escape cancels. The LLM sparkle generates a name immediately from the first user+assistant message pair and exits rename mode on success.

### Reference / fork / favorites rows

Pills: `var(--color-accent)` border + text, 10px mono, `border-radius: 10px`

### Summary bar

Triggered from the sparkle in the input-area toolbar (`.p-toolbar-left`), not the header: no summary yet → generates one and auto-opens the panel; summary already exists → toggles the panel open/closed showing the latest summary. Sticky, only rendered when a summary exists. Fixed-height body (`max-height: 170px`, `overflow-y: auto`). A refresh icon (`.p-summary-refresh`, `refresh-cw`) sits next to the timestamp at the bottom of the open body and regenerates the summary in place — the sole way to start a new summary once one exists. Auto-saved on view close when `autoSaveSummary` is enabled.

### Chat scroll area

`.p-chat`: `flex: 1; overflow-y: auto; overflow-x: clip`. Messages gap `var(--s3)`. Conversation view scrolls to **top** on every conversation switch; new messages sent during a session scroll to the bottom as usual.

### User message bubble

`background: var(--color-accent)`, `border-radius: 10px 10px 2px 10px`, max-width 86%, right-aligned.

Messages longer than **280 characters** render collapsed to ~3 lines with a fade-out mask (`-webkit-mask-image` gradient). A chevron-down toggle button (`.p-bubble-toggle`) appears below the bubble; clicking it toggles `.p-bubble-collapsed` / `.p-bubble-expanded` on the bubble and flips the icon to chevron-up. Short messages render normally with no toggle.

### AI message

Plain text, no background. Rendered via `MarkdownRenderer.render()`. Code blocks wrapped in `.p-code-frame` with `position: relative` for the copy button overlay.

### Code block copy button

`.p-code-actions`: `position: absolute; top: 4px; right: 4px` on the frame. Opacity 0, reveals on `.p-code-frame:hover`. On touch: always visible via `@media (hover: none)`.

### Diagram blocks (Mermaid, PlantUML, Vega, …)

Selector: `[class*='block-language-']` — catches all renderer plugins. Container: `position: relative; overflow-x: auto; width: 100%`.

JS (`fixDiagramSvgSize`) stamps explicit pixel dimensions on the SVG from `viewBox`, HTML attributes, or inline `style.width`. A MutationObserver catches attribute/style mutations; a ResizeObserver fallback catches Mermaid v10 and Vega which resize via layout rather than mutations.

Copy button `.p-diag-copy`: `position: absolute; top: 6px; right: 6px; z-index: 2`. Opacity 0, reveals on container hover. On touch: always visible. Stays pinned in the top-right corner while the user pans — does not scroll with the SVG.

### Token line (below each AI message)

```
☆  |  ↑~4.2k ↓430
```

Send button shows **estimated next-send cost**: `lastInputTokens + lastOutputTokens + round(draft.length/4)`. Updates live as user types.

### Chapter navigator (`#`)

Trigger button: 24×24 px, `--color-accent`, monospace, bottom-right of the message area. Popover 200 px wide, opens upward. Closes on outside click (listener tracked as `navigatorOutsideCleanup`, removed on view close and conversation switch).

Three collapsible sections — **Forks** (collapsed by default), **Starred**, **Chapters** — each with a ▸/▾ chevron, item count badge, and italic empty-state message. On open, the popover auto-scrolls to the **Chapters** section so it is immediately visible regardless of how many Forks or Starred items sit above it.

### Input area

Textarea: min 3 lines desktop / 2 lines mobile, max 72–150 px. IME guard: `e.isComposing` prevents CJK candidate confirmation from sending.

**Collapsed state:** a toolbar toggle button (`arrow-down`, `setIcon`) collapses the whole input area — textarea and toolbar both hide, replaced by a thin `.p-input-collapsed-bar` with a single expand button (same `arrow-down` icon, reused rather than swapped) — reclaiming vertical space for the chat scroll area. Instant `display` swap on a `collapsed` class, mirroring the summary panel's toggle pattern; no animation. State is ephemeral (not persisted to `data.json`) and survives conversation switches for the session.

### Conversation settings modal (temperature)

Per-conversation temperature is a `SliderComponent` (0–1, step 0.05, dynamic tooltip), defaulting to the effective value (`conversation.temperature ?? settings.temperature ?? 1.0`). Follows the modal's existing draft-until-Save convention — dragging updates a local value; Save commits it alongside provider/model, Cancel discards it.

---

## What not to build

- No Favorites row in the header — merged into `#` navigator
- No avatar or label per AI message
- No turn divider lines
- No sparkle in the toolbar — the header sparkle handles both generation and panel toggle
- No card shadows on summary or reference rows
- No framework mount (no React, Svelte, shadow DOM)
- No hardcoded colours — every colour token must be an Obsidian CSS variable
