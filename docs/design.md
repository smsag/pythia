# Pythia — Design System

*Last updated: 2026-08-24 — "Pythia Final" redesign phase 1 (ADR-066/067): **frameless** code blocks and selection toolbar (hairlines + a mono header row replace the grey `--background-secondary` box; the toolbar is a masked horizontal carousel on `--background-primary`), and **per-message turn micro-labels** (`.p-turn-label`, mono 9px/0.08em `--text-faint`) — `DU · HH:MM` above user bubbles, `PYTHIA · MODEL · HH:MM` above AI messages, backed by a new optional `Message.model`. New micro type size: **9px** for mono micro-labels (turn labels, code language, section labels). This supersedes the old "no label per AI message" / "no turn dividers" rules.*

*Previously, 2026-08-24 — specificity fixes (ADR-065): plugin marks are now scoped `.pythia-view mark.p-highlight` / `.pythia-view mark.p-fork-origin` (0,2,1) so Obsidian core/theme `mark` rules stop overriding the fork accent back to yellow; the global reset now covers `button/input/textarea` with `background-color: transparent` so Obsidian desktop's grey form-field background no longer paints plugin controls (buttons opt back into a fill at 0,2,0, e.g. `.p-send:not(.stop)`). **Rule: view chrome must be scoped under `.pythia-view` to out-rank Obsidian core (0,1,1) — a bare element+class tie loses because themes/core load after the plugin.***

*Previously, 2026-08-24 — the fork-origin snippet (`mark.p-fork-origin`) now uses the same highlighter mechanism as favorites: a translucent `color-mix(var(--color-accent) 40%, transparent)` (mirroring favorites' `--text-highlight-bg` alpha) instead of a 32% tint, with the readable `--text-highlight-bg` as the no-`color-mix` fallback (never a solid accent fill). Forks and favorites now read as the same kind of highlighter, differing only by hue (accent vs. yellow). See ADR-064.*

*Previously, 2026-08-24 — a max-tokens warning (`.p-send-hint`, `alert-triangle` icon in `var(--text-warning)`) sits just left of the Send button when the effective max-tokens looks too low for the selected reasoning model; its tooltip explains the truncation risk and clicking it opens the provider/model settings. Hidden otherwise. See ADR-063.*

*Previously, 2026-08-24 — the fork anchor's "Open fork" button (right-aligned) now long-presses to open a generate-summary menu (`.p-fork-menu`, reusing `.p-send-menu` styling, above the button via `.p-fork-open-wrap`): "Summarize conversation" always, "Summarize favorites" only when the fork carries favorites. Short press opens the fork; the standalone "Summarize fork" button is gone. See ADR-059.*

*Previously, 2026-08-23 — fork "branch-back": in the source, a forked snippet is highlighted in `--color-accent` (`mark.p-fork-origin`, distinct from favorites); tapping it expands an inline quote (`.p-fork-anchor`) right after the snippet with the fork's summary + "Open fork". The fork's "Forked from" link returns to and expands that anchor. See ADR-058.*

*Previously, 2026-08-23 — summaries reworked into top-of-conversation "Speisekarte" cards: both conversation and favorites summaries render as collapsible in-scroll cards (`.p-summary-card`) generated only via a long-press on the Send button (Obsidian `Menu`); cards auto-collapse when scrolled out of view; the pinned summary panel, input-toolbar sparkle, panel refresh icon, navigator ✦ action, and `FavoritesSummaryModal` are removed; nav Favorites label links to the favorites card. See ADR-057.*

*Previously, 2026-08-23 — highlight-favorite interaction fixes: tapping a highlight now selects its span and shows the toolbar with a **Unfavorite** button; removal is surgical (`removeHighlightById`) so other highlights keep their color; navigator jump lands on the first tap (deferred measure + collapsed-bubble expand); selection toolbar reordered to Copy · Favorite/Unfavorite · Branch · Insert · Inbox. See ADR-056.*

*Previously, 2026-08-23 — summarize favorites: the navigator Favorites section header gains a ✦ `.p-nav-action` trigger (shown only when favorites exist) that synthesizes the highlights into a Key-learnings + Action-items summary, shown in `FavoritesSummaryModal` (rendered Markdown, scrollable `.pythia-fav-summary-body`, Copy / Save-to-note / Regenerate). See ADR-055.*

*Previously, 2026-08-23 — favorite highlights: per-message ☆ star replaced by span-level favoriting from the selection toolbar. Favorited text is wrapped in `mark.p-highlight` and re-painted after every render (`ui/HighlightPainter.ts`); navigator "Starred" section renamed "Favorites", lists each highlight by its first words with a hover ✕ delete, and jumps to the span start. See ADR-054.*

*Previously, 2026-07-17 — code-block/blockquote design-system fix: `.p-code-frame` background unified to `var(--background-secondary)` (matching the tool-call chip/optimizer-result "framed box" convention), new blockquote styling, new persistent code-type icon, copy-confirmed icon color changed from green to accent. See ADR-046.*

*Previously, 2026-07-10 — temperature slider; input-area minimize reworked (persistent toolbar, reference row folded in, expand-and-act icons); summary trigger moved from header to input-area sparkle with a regenerate icon next to the summary timestamp*

This document is the source of truth for Pythia's design system — component inventory, CSS tokens, spacing/typography rules. Read it before any UI work.

---

## Philosophy

Pythia lives inside the Obsidian sidebar. Every surface must feel like a native Obsidian panel — not an embedded app. The design system enforces this by using only Obsidian CSS variables, following Obsidian's font stack, and keeping layout flat.

---

## CSS token reference

### Colours — always use Obsidian variables, never hex

| Token | Usage |
|---|---|
| `--color-accent` | User bubble background, pill borders, send button, copy-confirmed icon |
| `--text-normal` | Primary readable text, AI response body |
| `--text-muted` | Secondary text, blockquote text |
| `--text-faint` | Labels, badges, token counts, inactive icons, code-block type icon |
| `--text-on-accent` | Text on accent-coloured surfaces (user bubble) |
| `--background-primary` | Panel background, input area |
| `--background-secondary` | Summary bar background; framed content boxes (tool-call chip, optimizer result, code blocks, inline code) |
| `--background-modifier-border` | All dividers and borders, including the blockquote left bar |
| `--background-modifier-hover` | Button hover states |
| `--color-green` | Tool-call "done" link text (a persistent semantic state — not used for momentary click feedback like copy-confirmation) |

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
- **Context-budget bar** (`.p-ctx-bar`, ADR-069): 3px track (`--background-modifier-border`) directly under the header row; `.p-ctx-bar-fill` width = context usage / model window (`--color-accent`, → `--text-warning` under `.warn` at ≥80%). Click scrolls to top. A header `.p-ctx-chip` (mono 9px, warning-tinted) shows the percentage only at ≥80%.
- **Send estimate** (`.p-send-estimate`): mono next-send token estimate ("nächste ~Xk") sits left of the Send button; the Send button label is just `Senden`/`Stopp`.

**Rename mode** replaces the title + pencil with `.p-rename-input` (inline `<input>`, flex: 1, accent border, 20px height) and `.p-rename-llm-btn` (sparkle, accent colour). Enter/blur confirms and saves; Escape cancels. The LLM sparkle generates a name immediately from the first user+assistant message pair and exits rename mode on success.

### Reference / fork / favorites rows

Note references render as **wikilinks** (`.p-wikilink`, ADR-068): faint `[[`/`]]` brackets (`--text-faint`), accent clickable name (`.md` stripped), optional mono `~tokens` estimate (`--text-faint`, 9px), faint `×` remove (`--text-error` on hover). The add affordance is a `+ Notiz` text link (`.pythia-pill-add`, faint → accent on hover). The bordered `.p-pill` chip is retired.

### Summary cards ("Speisekarten")

Both summaries — conversation and favorites — are surfaced as collapsible cards (`.p-summary-card`) inside a `.p-summary-cards` container prepended to the **top of the message list** (`.p-chat`), so they scroll with the conversation. A card exists only when its summary exists (`summaryText` / `favoritesSummary.text`); none otherwise.

- **Header** (`.p-summary-card-header`): `setIcon` glyph (`align-left` for conversation, `star` for favorites) + title (`conversationSummaryTitle` / `favoritesSummaryTitle`) + a ▸/▾ chevron. Click toggles expand/collapse.
- **Collapsed by default.** Body (`.p-summary-card-body`) reveals on `.open`; the rendered markdown (`.p-summary-card-md`, shares `.p-ai-body` typography, `max-height: 40vh` internal scroll) plus a footer with the timestamp and **Copy** / **Save-to-note** actions. Saved notes (`NoteWriter.saveSummaryNote` / `saveFavoritesSummaryNote`) carry frontmatter `type: "LLM Note"` and a clickable `source:` deep link (`obsidian://pythia?…&cmd=resume&id=…`) that reopens Pythia with the conversation active — no `tags: [pythia]`.
- **Auto-collapse on scroll-out:** an `IntersectionObserver` (root = `.p-chat`) collapses an expanded card once it leaves the viewport.

**Generation is button-only:** long-pressing the **Send** button opens a small popover (`.p-send-menu`) stacked **directly above the button** (the Send button is wrapped in a relatively-positioned `.p-send-wrap`; the menu opens upward, right-aligned, dismissed on outside click) with **Summarize Conversation** and **Summarize Favorites** (the latter greyed with no favorites); choosing one generates or regenerates that summary with current context and reveals its card. A native Obsidian `Menu` is deliberately **not** used — on mobile it renders as a bottom sheet rather than at the button. There is no sparkle/refresh icon and no auto-generation on close or note-injection.

### Chat scroll area

`.p-chat`: `flex: 1; overflow-y: auto; overflow-x: clip`. Messages gap `var(--s3)`. Conversation view scrolls to **top** on every conversation switch; new messages sent during a session scroll to the bottom as usual.

### User message bubble

`background: var(--color-accent)`, `border-radius: 10px 10px 2px 10px`, max-width 86%, right-aligned.

Messages longer than **280 characters** render collapsed to ~3 lines with a fade-out mask (`-webkit-mask-image` gradient). A chevron-down toggle button (`.p-bubble-toggle`) appears below the bubble; clicking it toggles `.p-bubble-collapsed` / `.p-bubble-expanded` on the bubble and flips the icon to chevron-up. Short messages render normally with no toggle.

### AI message

Plain text, no background. Rendered via `MarkdownRenderer.render()`. Code blocks wrapped in `.p-code-frame` with `position: relative` for the copy button overlay.

### Blockquote

LLM-quoted text: `border-left: 3px solid var(--background-modifier-border)` (neutral divider token — **not** `--color-accent`, which is reserved for interactive/active elements), `padding-left: var(--s3)`, `color: var(--text-muted)`, `font-style: normal` (overrides Obsidian's default italic — this app never uses italics). No background/box on the wrapper itself, consistent with "AI message: plain text, no container." Content nested inside (e.g. a fenced code block) still gets its own `.p-code-frame` box, unaffected by the blockquote's own styling.

### Turn micro-label (`.p-turn-label`)

Mono, **9px**, `letter-spacing: 0.08em`, `--text-faint`, as the first child of every message row. User turns read `DU · HH:MM` (right-aligned, since `.p-msg-user` is `align-items: flex-end`); AI turns read `PYTHIA · <MODEL> · HH:MM` (left-aligned). The model comes from `Message.model` (recorded at generation time) and falls back to the conversation's current model for legacy messages. Time via the pure `formatClockTime()` helper (24h, locale-independent).

### Code block frame (`.p-code-frame`) — frameless (ADR-066)

No background fill, border, or radius. Structure comes from **top/bottom hairlines** (`--background-modifier-border`) plus a header row `.p-code-head`: a `.p-code-type-icon` (Lucide `code-2`, `--text-faint`), the language name `.p-code-lang` (mono 9px `--text-faint`), and — right-aligned — the copy button in `.p-code-actions`. `font-family: var(--font-monospace)` set explicitly on the `<pre>`, which carries only horizontal scroll + drag-to-pan (no box, no reserved top padding). Copy stays hover-reveal on desktop and always-visible under `@media (hover: none)`. Outline cards (summaries, context inspector) remain the only components that keep the filled-box formula.

### Code block copy button

`.p-code-actions`: `position: absolute; top: 4px; right: 4px` on the frame. Opacity 0, reveals on `.p-code-frame:hover`. On touch: always visible via `@media (hover: none)`. The icon glyph itself is fixed at `14×14px` (`.p-code-btn svg`) so the "copy" and "check" (copy-confirmed) icons render at identical size when swapped. Copy-confirmed color is `var(--color-accent)` — not green; green is reserved elsewhere in this app for a few persistent semantic states (tool error/done), not a momentary click acknowledgment.

### Diagram blocks (Mermaid, PlantUML, Vega, …)

Selector: `[class*='block-language-']` — catches all renderer plugins. Container: `position: relative; overflow-x: auto; width: 100%`.

JS (`fixDiagramSvgSize`) stamps explicit pixel dimensions on the SVG from `viewBox`, HTML attributes, or inline `style.width`. A MutationObserver catches attribute/style mutations; a ResizeObserver fallback catches Mermaid v10 and Vega which resize via layout rather than mutations.

Copy button `.p-diag-copy`: `position: absolute; top: 6px; right: 6px; z-index: 2`. Opacity 0, reveals on container hover. On touch: always visible. Stays pinned in the top-right corner while the user pans — does not scroll with the SVG.

### Token line (below each AI message)

```
↑~4.2k ↓430
```

Only rendered when the message carries `tokenUsage`; no per-message star button (favoriting moved to text selection — see below). Send button shows **estimated next-send cost**: `lastInputTokens + lastOutputTokens + round(draft.length/4)`. Updates live as user types.

### Favorite highlights (`mark.p-highlight`)

Any text selection inside a message can be favorited via the **Favorite** button in the selection toolbar. Toolbar order (left → right): **Copy · Favorite/Unfavorite · Branch (Fork) · Insert into note · Save to inbox**. The favorited span is wrapped in `mark.p-highlight` (`background: var(--text-highlight-bg)`, `border-radius: 2px`) and stays visibly highlighted. Highlights are re-painted after every markdown render by `ui/HighlightPainter.ts`, which re-finds the stored text among the body's text nodes (offsets are not stored — the DOM is re-created on each render).

**Unfavorite:** *tapping* a highlight (no drag) selects its whole span (`rangeForHighlight`) and opens the toolbar with the Favorite button relabeled **Unfavorite**; pressing it removes exactly that highlight (`removeHighlightById` — surgical, never touches other highlights). A *dragged* selection always creates a new favorite, even overlapping an existing highlight — dragging never removes one. A brief `p-highlight-flash` animation plays when the navigator jumps to a highlight.

### Chapter navigator (`#`)

Trigger button: 24×24 px, `--color-accent`, monospace, bottom-right of the message area. Popover 200 px wide, opens upward. Closes on outside click (listener tracked as `navigatorOutsideCleanup`, removed on view close and conversation switch).

Three collapsible sections — **Forks** (collapsed by default), **Favorites**, **Chapters** — each with a ▸/▾ chevron, item count badge, and italic empty-state message. **Favorites** lists each highlight by the first words of its text; clicking scrolls to the start of the highlighted span; a hover-revealed `.p-nav-del` (✕) removes it. The Favorites section **label** links to the favorites summary card (`.p-nav-group-name.p-nav-link`) when a favorites summary exists — clicking it closes the popover and scrolls to + expands that card; with no favorites summary the label is greyed and non-clickable (`.p-nav-disabled`). Legacy message-level favorites list the same way but jump to the message top. On open, the popover auto-scrolls to the **Chapters** section so it is immediately visible regardless of how many Forks or Favorites sit above it.

### Input area

Textarea: min 3 lines desktop / 2 lines mobile, max 72–150 px. IME guard: `e.isComposing` prevents CJK candidate confirmation from sending.

**Collapsed state:** a toolbar toggle button collapses the whole input area — the textarea, the reference row (attached-note pills), and the Send button all hide, reclaiming vertical space for the chat scroll area. The toolbar itself (`.p-toolbar`/`.p-toolbar-left`) stays visible in both states — it *is* the minimized row, so every action icon (attach/save/sparkle/optimize/template) stays reachable and in the same order whether expanded or collapsed. Clicking any of those action icons while collapsed expands the input area and performs that icon's action in the same click; the toggle button itself only expands/collapses, no side effect. The toggle icon swaps direction on each toggle — `arrow-down` when expanded, `arrow-up` when collapsed — rather than reusing one icon for both. Instant `display` swap on a `collapsed` class, mirroring the summary panel's toggle pattern; no animation. State is ephemeral (not persisted to `data.json`) and survives conversation switches for the session; the reference row's own visibility (shown only when there are attached notes) composes with the collapse state rather than being overridden by it.

### Conversation settings modal (temperature)

Per-conversation temperature is a `SliderComponent` (0–1, step 0.05, dynamic tooltip), defaulting to the effective value (`conversation.temperature ?? settings.temperature ?? 1.0`). Follows the modal's existing draft-until-Save convention — dragging updates a local value; Save commits it alongside provider/model, Cancel discards it.

---

## What not to build

- No Favorites row in the header — merged into `#` navigator
- ~~No avatar or label per AI message~~ → superseded: every turn now carries a mono micro-label (`.p-turn-label`, ADR-067)
- No turn *divider lines* (the mono turn label replaces them — still no horizontal rules between turns)
- No avatar images or role icons per message — the label is text only
- No sparkle in the toolbar — the header sparkle handles both generation and panel toggle
- No card shadows on summary or reference rows
- No framework mount (no React, Svelte, shadow DOM)
- No hardcoded colours — every colour token must be an Obsidian CSS variable
