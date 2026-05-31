# Pythia — Design System

*Last updated: 2026-05-31 at v1.11.2*

Visual reference: `docs/pythia-v3.html` — open in browser before any UI work.

---

## Philosophy

Pythia lives inside the Obsidian sidebar. Every surface must feel like a native Obsidian panel — not an embedded app. The design system enforces this by:

- Using only Obsidian CSS variables for colours, backgrounds, and borders
- Following Obsidian's font stack and size conventions
- Using `setIcon` for Obsidian chrome icons; inline SVG only for custom plugin icons
- Keeping layout flat: no shadows, no rounded panel edges, no cards

---

## CSS token reference

### Colours — always use Obsidian variables, never hex

| Token | Usage |
|---|---|
| `--color-accent` | User bubble background, pill borders, send button, active sparkle |
| `--text-normal` | Primary readable text, AI response body |
| `--text-muted` | Secondary text |
| `--text-faint` | Labels, badges, token counts, inactive icons |
| `--text-on-accent` | Text on accent-coloured surfaces (user bubble) |
| `--background-primary` | Panel background, input area |
| `--background-secondary` | Summary bar background |
| `--background-modifier-border` | All dividers and borders |
| `--background-modifier-hover` | Button hover states |
| `--color-green` | Copied-to-clipboard confirmation on copy button |

For a tinted border derived from the accent, use `color-mix()`:
```css
border: 1px solid color-mix(in srgb, var(--color-accent) 60%, black);
```
Note: requires Chromium 111+. See engineering-review.md #19.

### Spacing — 4 px grid, no arbitrary values

```css
--s1: 4px    /* tight: icon padding, micro gaps */
--s2: 8px    /* default: toolbar gaps, small padding */
--s3: 12px   /* medium: message gaps, section padding */
--s4: 16px   /* loose: outer container padding */
```

### Typography scale

```css
--font-smaller: 11px   /* labels, token counts, nav items */
--font-small:   12px   /* body text, pills, toolbar, textarea */
```

Font families: `var(--font-interface)` for all UI text; `var(--font-monospace)` for labels, badges, token counts, and the textarea.

---

## Hard rules — never violate

1. **No border-radius on `.pythia-view` root.** The panel fills the sidebar flush.
2. **No imported fonts.** `var(--font-interface)` and `var(--font-monospace)` only.
3. **No custom background colours.** Every surface uses an Obsidian variable. No hex on backgrounds.
4. **No box-shadow on panels.** Flat surfaces only. Navigator popover is the only exception.
5. **No emoji icons.** Plugin icons are inline SVG, `stroke-width: 1.6`, `12×12 px`. Obsidian chrome icons use `setIcon`.
6. **Accent is always `var(--color-accent)`.** Never hardcode a hex accent.
7. **iOS safe area on input.** Always: `padding-bottom: max(var(--s2), env(safe-area-inset-bottom, var(--s2)))`.
8. **Never touch `containerEl.children[0]`.** That is the Obsidian leaf header.
9. **No inline modal logic in `sidebar.ts`.** All modals go in `suggest/`.
10. **No raw `addEventListener`.** Always use `registerDomEvent` / `registerEvent`.

---

## Component inventory

### Header
```
[ Conversation title ▾ ][ model badge ][ ⚡ sparkle ][ 🗑 trash ][ + plus ]
```
- Title: `var(--font-small)`, `font-weight: 600`, truncated with ellipsis, `flex: 1`, clickable to rename
- Model badge: `var(--font-monospace)`, 10 px, `var(--text-faint)`, clickable to change provider/model
- Sparkle ⚡: shows only when a summary exists; triggers regeneration
- Icons: `setIcon`, 20×20 px hit area, `var(--text-faint)` → `var(--text-normal)` on hover

### Reference / fork / favorites rows
```
REFERENZ  [ pill: filename.md ✕ ][ + ]
FORKS     [ pill: fork name ✕ ]
FAVORITEN [ pill: starred title ✕ ]
```
- Row label: `var(--font-monospace)`, 10 px, uppercase, `var(--text-faint)`, fixed 54 px wide
- Pills: `var(--color-accent)` border + text, 10 px mono, `border-radius: 10px`
- Context notes also show estimated token count in the pill

### Summary bar (sticky, always visible when summary exists)
- `background: var(--background-secondary)`
- `border-bottom: 1px solid var(--background-modifier-border)`
- Chevron `▸` / `▾` toggles body — body is **fixed height 72 px, `overflow-y: auto`** (never expands)
- Sparkle ✦ bottom-right of open body — triggers summary regeneration
- Auto-saved on view close when `autoSaveSummary` is enabled

### Fork banner (when conversation was forked)
```
↗ Forked from: [source conversation link]
  "The selected text that triggered the fork, truncated to 220 chars…"
```
- Banner background: `var(--background-secondary)`
- Excerpt: italic, `var(--text-normal)`, left border `2px solid var(--background-modifier-border)`

### Chat scroll area
- `flex: 1`, `overflow-y: auto`, padding `var(--s3)`
- Gap between turns: `var(--s3)`
- No divider lines, no AI avatar or label per turn

### User message bubble
- `background: var(--color-accent)`, `color: var(--text-on-accent)`
- `border-radius: 10px 10px 2px 10px` (sharp bottom-right corner)
- `max-width: 86%`, right-aligned
- Long-press (desktop: 600 ms hold) shows delete-exchange button

### AI message
- Plain text, no container background
- Rendered via `MarkdownRenderer.render()`
- Code blocks: wrapped in `.p-code-frame` with copy button, `border: 1px solid var(--background-modifier-border)`, horizontal scroll
- Mermaid/PlantUML: `overflow-x: auto`, MutationObserver stamps natural SVG pixel size so wide diagrams scroll rather than scale; sibling `.p-diag-toolbar` with copy button sits above the scrolling container

### Token line (below each AI message)
```
☆  |  ↑~4.2k ↓430
```
- `var(--font-monospace)`, 10 px, `var(--text-faint)`
- Star `☆` → `★` toggles favourite; name reused from preceding user turn's chapter name
- Send button shows estimated next-send input tokens: `last inputTokens + last outputTokens + draft_chars / 4`, updates live as user types

### Chapter navigator (`#`)
- Trigger: floating `#` button above input, bottom-right
- Popover opens upward, width 200 px, `box-shadow` (only element with shadow)
- Two sections: **Starred** → divider → **All prompts**
- Closes on outside click (listener tracked as `navigatorOutsideCleanup`, removed on view close and conversation switch)

### Input area
```
[ textarea — auto-expands 1 line → 3 lines desktop / 2 lines mobile ]
[ 📎 attach ][ 💾 save ]  ─────────  [ Senden · ↑~4.2k ]
```
- Textarea: transparent, no border, `var(--font-monospace)`, 12 px, `min-height: calc(--font-small * 4.65)` desktop
- Toolbar icons: inline SVG, 22×22 px hit area
- Send button: `var(--color-accent)` fill, `var(--font-monospace)`, 10 px, `border-radius: 3px`; `color-mix` tinted border only in Send state (not Stop)
- IME-aware: Enter key guarded by `e.isComposing` to prevent CJK candidate confirmation from sending

---

## What not to build

- No Favorites row in the header — fully consolidated in `#` navigator
- No avatar or "Pythia" label per AI message
- No turn divider lines
- No blockquote for the summary — it is a sticky panel
- No sparkle in the toolbar — sparkle is in the summary bar only
- No card shadows on summary or reference rows
- No framework mount (no React root, no Svelte, no shadow DOM)
- No hardcoded colours — every colour token must be an Obsidian CSS variable
