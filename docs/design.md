# Pythia — Design System

*Last updated: 2026-09-15 — the glossary card sits beside its word (ADR-156). `GlossaryController` now inserts the anchor with `markEl.after(anchor)`, the same call `ForkController` and `MergeController` use, instead of after the mark's enclosing block. The paragraph splits at the term while the card is open — the same cost fork already pays — and in exchange the definition is beside the word rather than at the end of a paragraph that may be long. **Placement is part of the component**: the four cards differ only in the stroke of their left rule.*

*Previously, 2026-09-15 — the effort segments no longer transition, and hover is pointer-only (ADR-155). `.p-effort-seg-btn` drops `transition: background-color .1s, color .1s`: a segmented control's fill answers "which one did I just pick", so it must be true at the moment of the tap — on iOS a transitioned background may not paint until the next composite, which is why the segment stayed grey until the sheet was scrolled. `:hover` moves inside `@media (hover: hover)`, because iOS keeps hover on the last-tapped element and `--background-modifier-hover` reads as a selection next to the real one.*

*Previously, 2026-09-15 — on-accent labels are pure black or white (ADR-154). `--p-on-accent` no longer falls back to a theme's `--text-on-accent` when that token happens to clear AA: it is always `#ffffff` or `#000000`, whichever contrasts more with the resolved accent. And every rule setting `color: var(--p-on-accent, …)` now **restates it as `-webkit-text-fill-color`** — these buttons are `all: unset`, `all` resolves that inherited property to `inherit`, and WebKit reads it in preference to `color`, so on iOS the label was inheriting `--text-normal`.*

*Previously, 2026-09-15 — the sources row is run-in, not columnar (ADR-153). `.p-sources-label` loses `min-width: 54px` and reads `Template:` / `Vault:` / `Web:` in the flow ahead of the first entry; row `gap` drops 10px → 8px so the first gap reads as the space after a colon. Vault and template references lose their `[[ ]]` brackets — the run-in label already says the name is a note — keeping accent colour + hover underline as the affordance. The column was not mis-tuned: `.p-sources-row` is `flex-wrap: wrap`, and **a wrapped flex line starts at the container edge, not under the first item**, so it only ever aligned each row's first line while charging 54px of a ~300px sidebar on all of them.*

*Previously, 2026-09-15 — the search row's clear control (ADR-152). `.p-switcher-clear` sits after the input in `.p-switcher-search`: a 20×20 `x` icon button, `--text-faint` → `--text-normal` on hover with the standard hover fill, **hidden until the field has content** so the row is a plain loupe + field at rest. It balances the loupe on the other end of the row. The panel no longer auto-focuses its input on mobile — auto-focus is a keyboard affordance, and on a phone it covered the bottom of the list with the on-screen keyboard.*

*Previously, 2026-09-15 — the person mark (ADR-151). A fifth mark type: `<pythia-person class="p-person">`, a **solid** `--text-faint` underline where a term is dotted. Still faint, because like a term it repeats wherever the name appears; solid rather than dotted because the mark is the only signal of which kind of card a tap opens, and a name is the rarer of the two on a page. The anchor is **not** a second component — it is `.p-term-anchor` plus `.p-term-anchor--person`, which changes only the left rule to `double`, continuing the series: solid fork, dashed merge, dotted term, double person. The selection toolbar gains a **Person** button next to Define.*

*Previously, 2026-09-15 — the theme field (ADR-150). The conversation settings modal gains a **Thema / Theme** text field below the language dropdown; its placeholder is the conversation name, because that is what applies when the field is empty — the same "state the inherited value where the override goes" convention temperature and max tokens already use. Empty is a distinct state from a theme that happens to equal the name: only the empty one keeps following a rename. The settings tab's glossary controls (folder, migration, legacy note path) move into `ui/glossarySettings.ts`, rendered in place — no visual change.*

*Previously, 2026-09-15 — the language dropdown (ADR-148). The settings tab's "Ausgabesprache" is renamed **"Sprache" / "Language"** and now carries six options — Obsidian's language, the conversation's language, German, English, Italian, Spanish — built from `ui/languageOptions.ts`. The conversation settings modal gains the same list with a leading **`Standard (…)`** option naming the global default, sitting below max tokens alongside the other per-conversation overrides. Both are plain Obsidian `Setting` dropdowns — no new tokens, no new chrome.*

*Previously, 2026-09-15 — the panel fills its leaf (ADR-147). Obsidian pads `.view-content` inside `.workspace-leaf-content`, which painted a strip of workspace background **left, right and below** the panel; `.workspace-leaf-content[data-type="pythia"] { padding: 0 }` neutralizes it for our leaf only, and `.pythia-view` sets `padding: 0` explicitly. Diagnostic worth knowing: `.p-history` is `inset: 0` on `.pythia-view`, so **opening the conversation panel outlines the panel's true edges** — that is how the side strips were found after four fixes aimed at the bottom one.*

*Previously, 2026-09-15 — the composer stops reserving a home indicator (ADR-146). `.p-input-area` is `padding: var(--s2) var(--s3) var(--s1)` — no `env(safe-area-inset-bottom)`, no `--p-bottom-inset`. Measured from the reported screenshot, the old rule left **42 CSS px below the send button where 8 was intended** (8 + one 34pt home indicator), because `env()` reports the device's inset wherever the element sits and ADR-134's conditional override did not fire on the device. Now 4px, with the panel ending exactly where its content ends. `env(safe-area-inset-bottom)` remains correct on `.pythia-modal` and the mobile action sheet, which genuinely touch the screen edge.*

*Previously, 2026-09-15 — tables get a hairline grid (ADR-145). Every cell of a rendered table takes `1px solid var(--background-modifier-border)` with `border-collapse: collapse` and `padding: 3px var(--s2)`; the table takes the same rule on the outside and `th` a 2px bottom rule. **A full grid, not row rules** — at sidebar width a cell that wraps to three lines sits beside one that wraps to one, so column tracking is the problem, and a sideways-scrolling table needs a vertical rule to show a column is half off-screen. **No header fill**: a tinted row reads as a card (hard rules 3/4), and the same border token at 2px separates header from body.*

*Previously, 2026-09-15 — two corrections (ADR-144). **Mid-word breaking was Pythia's own doing**, not a theme's: `.p-ai-body { word-break: break-word }` behaves like `overflow-wrap: anywhere` and was inherited into every rendered table cell. It is now `overflow-wrap: break-word` on `.p-ai-body`, `.p-summary-card-md` and the user bubble — long URLs still wrap instead of overflowing, ordinary words stay whole, on every surface rather than only inside `.p-scroll-frame`. **Never use `word-break` for overflow in this stylesheet.** And the **reference row has no label**: this doc and CLAUDE.md described a `REFERENZ` label at 54px that `.p-ref-row` has never rendered. The sources row's 54px column keeps its width for the surviving reason — it clears `TEMPLATE`, measured at 49px.*

*Previously, 2026-09-15 — the link anchor is the fork anchor (ADR-142). `.p-merge-anchor*` is grouped into every `.p-fork-anchor*` rule rather than restating it: same solid 2px accent left rule, same head, title, body and meta typography, identical computed styles and height. Same for `.pythia-merge-banner` and `.pythia-fork-banner` (the fork banner also moves from `--interactive-accent` to `--color-accent`, per the token rules). Only two things differ, both deliberate: the meta line keeps the **unlink** control a fork has no use for, and the header is the **`link` icon + `VERKNÜPFUNG`** (a noun naming the card, like `ABZWEIGUNG`, not the state `VERKNÜPFT`). The **marks stay different** — accent fill for a fork origin, dashed accent underline for a link — because with the cards unified that is the only pre-tap signal left. Stroke now means: solid accent = a conversation, dotted = a glossary term.*

*Previously, 2026-09-15 — summary clamp in the inline anchors (ADR-141). A fork or merge anchor's summary body is bounded at **five lines** (`.p-clamped`, `max-height: 7.75em` at the anchor's 1.55 line-height) with a gradient mask at the cut, so a truncation reads as a truncation rather than as a sentence that stops. A `mehr`/`weniger` control (`.p-anchor-more`, accent, 11px) sits between the body and the meta line and appears **only when the content really overflows**, measured after layout — no affordance without something behind it. Clamp-and-expand, not an inner scroll box: the summary bar can scroll internally because it is sticky chrome, but an inline block mid-transcript must not swallow the page scroll. Summaries are now plain prose by contract, so lists no longer appear here.*

*Previously, 2026-09-15 — the template joins the sources row (ADR-140). The assistant turn label no longer carries a template caption; the template is listed under the answer as the **first** row of the sources block (rows run TEMPLATE → VAULT → WEB, from the user outwards; the vault row is always labelled VAULT), as a `[[wikilink]]` and with **no citation number** (the numbers match the superscript chips in the prose; nothing cites the template). WEB and TEMPLATE are one component: same 9px mono uppercase `--text-faint` label, same 11.5px accent chip, differing only where it means something — numbered + `↗` for a web page that leaves the app, `[[…]]` for a vault note that does not. `.p-sources-label` gains a **54px `min-width`**, the same column the reference row uses, so stacked rows start their chips at one x. Turn label is now strictly `MODEL · time · ↑in ↓out`.*

*Previously, 2026-09-15 — one date format and cap-height icon centring (ADR-139). **Every date in the UI is `15 Sep 2026`** and every clock `04:39`, both locale-independent, so a mono label's width cannot change under the user; the history view's group headers are `SEP 2026`. The inline anchors' meta row drops explanatory prefixes (`erklärt von` is gone — a bare model name, like fork and merge) and takes the shared `Öffnen →` control everywhere. Icon buttons in a micro-label row use `vertical-align: middle` **plus a `top: -0.09em` nudge**: `middle` centres on x-height, but these rows are caps and digits, so an 11px icon otherwise sits ~1px low. Applies to fork, merge and glossary alike.*

*Previously, 2026-09-15 — the three inline anchors are one component again (ADR-138). The glossary anchor had drifted faint: a `--text-faint` left rule and icon, a faint label, a 12px title, and a long `Im Glossar öffnen` that wrapped the meta row. **The fork anchor is the standard** — 2px accent left rule, accent icon, `--text-muted` 600 micro-label, 11.5px title, `Öffnen →` — and the merge and glossary anchors now match it, differing only in the left rule's stroke: **solid fork, dashed merge, dotted term**. The quiet/loud split is between the mark and the anchor, not between the features: a term *mark* stays the faintest of the four because it repeats many times per screen, while an anchor is opened one at a time by a deliberate tap and carries full weight. `.p-term-anchor-aliases` loses its `margin-top: -2px` and takes the anchor's own 5px gap.*

*Previously, 2026-09-15 — glossary aliases (ADR-137). A term mark now also appears on the term's inflections and cross-language equivalents, so the fourth mark type repeats more than before and its quietness matters more, not less — the dotted `--text-faint` underline is unchanged. The marked text stays exactly as the author wrote it ("Zählern"), while the anchor it opens is titled with the canonical term ("Zähler"); `.p-term-anchor-aliases` names the other forms under that title in 9px monospace `--text-faint`, so the apparent mismatch reads as intended and the user can see which words to correct in the note.*

*Previously, 2026-09-15 — glossary terms, the fourth mark type (ADR-136). A term defined from the selection toolbar's **Define** action is marked at every occurrence, in every conversation, as `<pythia-term class="p-term">`: a **dotted underline in `--text-faint`**, accent only on hover. Its quietness is load-bearing, not a preference — it is the only mark that repeats, often many times per screen, and a loud treatment would wreck the prose it exists to help you read. It also ranks visually and by tap precedence below the three marks the reader placed deliberately (yellow favorite, accent fork origin, dashed-accent merge link). Tapping opens `.p-term-anchor`, matching the fork and merge anchors with a **dotted** left rule, attached after the mark's block rather than inline because a term sits mid-sentence and splicing a block into a sentence reflows the text around it. Toolbar order is now Copy · Favorite · Branch · Merge · Define · Insert · Inbox.*

*Previously, 2026-09-15 — ADR-134, correcting two rules that did not work in practice. **Tables** now take `width: max-content` with `max-width: 32ch` per cell. `max-width: none` alone (ADR-131) did not make a table wider: a table sizes itself to its container, so it kept fitting the panel and turned a long cell into an 18-line, 399px row. With the cap, the same table is 469px in a 296px frame, the long cell is 7 lines and the row 163px. **The input area's bottom inset** is now conditional: `padding-bottom: max(var(--s2), var(--p-bottom-inset, env(safe-area-inset-bottom, var(--s2))))`, with the view setting `--p-bottom-inset: 0px` when the panel does not actually reach the screen edge. `env(safe-area-inset-bottom)` reports the device inset wherever the element sits, so in a stacked sidebar it was reserving 25px of dead space for a home indicator that is nowhere near the composer. Hard rule 7's intent is unchanged — a full-height leaf still clears the indicator — but its literal text now includes the override.*

*Previously, 2026-09-15 — the panel fills its leaf at rest again (ADR-132). A dead strip of ~67px sat below the composer because the view shrank its own content pane on every viewport event, keyboard or not, and `overflow: hidden` then clipped the input area's safe-area padding. The panel is now left untouched unless a soft keyboard is actually open, and keyboard avoidance lifts content with `padding-bottom` so the panel keeps painting its full leaf. **Rule: never set an explicit `height` on the view's content pane.** It is `overflow: hidden`, so any height smaller than the content silently crops the bottom of the input area and uncovers the background behind the panel. Use padding to move content instead.*

*Previously, 2026-09-15 — wide tables scroll instead of squeezing (ADR-131). A rendered markdown table is wrapped in `.p-scroll-frame` (this already happened) and now actually uses it: `.pythia-view .p-scroll-frame > table` gets `max-width: none` so it can exceed the frame, and its `th`/`td` get `overflow-wrap: normal`, `word-break: normal`, `hyphens: none` and `min-width: 8ch`. Net effect: **words are never split** (the reported `Messba / rkeit` is gone), cells still wrap between words, short columns keep a floor width, and a table too wide for the panel scrolls sideways with the same thin scrollbar and drag-to-pan as code blocks and diagrams. No sticky first column: the table scrolls as one piece. Applies on **every** markdown surface now — assistant answers, summary cards, the fork anchor and the merge anchor — via `ui/renderMarkdown.ts`.*

*Previously, 2026-09-14 — Merge links (ADR-130), the inverse of Fork. A sixth selection-toolbar button, **Merge**, sits next to **Branch** (assistant content only, same endpoint rule). A merged passage is marked `<pythia-merge class="p-merge-link">`: a **dashed `--color-accent` underline** (solid + an 8% accent wash on hover) — deliberately **not** a third highlighter sweep, because favorites (yellow ink) and fork origins (accent ink) already own that treatment and a third fill would be illegible beside them, and because a merge link can sit on top of a favorite. Tapping it opens `.p-merge-anchor`, the mirror of the fork anchor: frameless, but with a **dashed** 2px accent left-rule so the two inline anchors are told apart at a glance. Structure: `.p-merge-anchor-head` (`git-merge` icon + `VERKNÜPFT` mono 9px label), `.p-merge-anchor-title` (target conversation name), `.p-merge-anchor-body` (its conversation summary; `.p-merge-anchor-empty` italic placeholder when none), and `.p-merge-anchor-meta` — `N Nachrichten · Model · <date> [· veraltet] · ↻ · ⛓ · Öffnen →` with regenerate (`rotate-cw`, `.is-stale` accent per ADR-128's rule), unlink (`unlink`) and open. The `#` navigator gains a **Verknüpft** section between Forks and Favorites, collapsed by default and **omitted entirely when empty**. The link reads from **both ends**, as a fork's does: the conversation a link points at carries a `.pythia-merge-banner` at the top (dashed accent left-rule, `git-merge` icon, `VERKNÜPFT VON` label, then one `.pythia-merge-entry` per inbound link with the source conversation's name and a 120-char passage excerpt; clicking opens that conversation and expands the passage's anchor). It renders only when inbound links exist.*

*Previously, 2026-09-12 — the template moved from the header into the assistant turn label (ADR-129). The absolutely-positioned `.pythia-template-label` caption under the header title is **gone**; the template name now rides the meta line of the answer it produced (`.p-turn-template`, mono 9px `--text-faint`, truncated at 18ch with the full name as `title`), and only on the turn where a template *starts* applying — the first answer, and again where a second template takes over. The `DU`/`PYTHIA` role captions are dropped from every turn label: the accent bubble vs. the plain body already distinguishes the two. AI meta line is now `SONNET 4.6 · PODCAST SUMMARY · 14:32 · ↑7.028 ↓125`; user turns are `[27 Aug 2026 ·] 14:31`.*

*Previously, 2026-09-10 — fork anchor: always-current summary + visible refresh (ADR-128). The origin-side `.p-fork-anchor` now carries a visible one-tap **regenerate** button (`.p-fork-anchor-refresh`, `rotate-cw`, faint → accent on hover) in the meta line — always present (also generates the first summary), so the preview can be brought to the fork's latest state without the long-press menu (which stays, for choosing conversation vs favorites). When the fork has activity newer than the shown summary, the meta line appends an `outdated`/`veraltet` marker and the refresh button tints accent (`.is-stale`). Meta line: `N Nachrichten · Model · <date> [· outdated] · ↻ · Öffnen →`.*

*Previously, 2026-09-10 — conversation panel on touch: the auto-focused search field raises the on-screen keyboard, which overlays the webview rather than resizing it, so the last conversations were unreachable under it. The list now pads itself by the covered height, measured from `window.visualViewport`.*

*Previously, 2026-09-10 — locale pass over `locales/de.ts` against this doc. Parity is clean (380/380 keys) and every literal specified here matches; three wording fixes landed: the prompt optimizer's Send-button label `Wird optimiert…` → `Optimiere…` (the pill carries short labels only), the history subtitle `Zweig` → `Abzweigung` (the fork family is Abzweigung / Verzweigen / Verzweigt von everywhere else), and the Favorites wording — empty state `Noch keine Markierungen` → `Noch keine Favoriten` (English `No highlights yet` → `No favorites yet`, same drift) and the selection toolbar's `Entfernen` → `Defavorisieren` (paired with `Favorisieren`).*

*Previously, 2026-09-10 — streaming toolbar row no longer collides with the panel edge: the German stop label is `Stopp` (it was the sentence "Anfrage abbrechen", against this doc's own `Senden`/`Stopp` spec), the next-send estimate hides under `.p-input-area.streaming`, and the row is made unable to overflow (`min-width: 0` on `.p-toolbar-left`, `flex-shrink: 0` on `.p-send-wrap`).*

*Previously, 2026-09-10 — the model popover stays open after a selection (ADR-127): the list repaints in place instead of closing, so a model switch followed by conversation settings (its footer) no longer needs a reopen. Dismissal is outside click, Escape, the badge, or the footer.*

*Previously, 2026-09-10 — max-tokens field (conversation settings): invalid text is flagged (`.p-field-invalid` + reason in the readout) instead of silently ignored, `blur` restores what Save will store, the `.p-param-readout` tag says when the number is the inherited default, the placeholder carries the default that applies when the field is cleared, the keypad is numeric on touch, and an untouched field re-resolves when the model changes rather than pinning a stale default.*

*Previously, 2026-09-10 — temperature slider (conversation settings): a permanent mono readout (`.p-param-readout`) right of the slider states the value, tagged `· Standard` while the conversation has no override — the dynamic tooltip only existed mid-drag and hid under the finger on touch. An unsupported temperature (any reasoning model) now really is inert: the component is disabled and the control area carries `.p-param-off`, because `Setting.setDisabled` marks only the row.*

*Previously, 2026-09-10 — effort segmented control (conversation settings): selection was hard to read. Segment rules are now scoped to `.pythia-modal` so they outrank Obsidian core's `button:not(.clickable-icon)` fill, the active segment adds weight 600 and `aria-pressed` to the accent fill, and the leading segment reads `Standard · Mittel` (the effort that actually applies) instead of the dropdown-era `(nicht gesetzt – Modellstandard verwenden)`.*

*Previously, 2026-09-10 — model popover legibility pass: every 9px label moved onto the documented scale (`--font-smaller`), provider headers are `--text-muted` and **sticky** while the list scrolls, model names are `--text-normal` at weight 500, the `Reasoning` marker became a neutral chip (orange is reserved for warnings), the context window is a fixed right-aligned column, the active row gained a 2px accent left rail, rows are ≥44px on touch, and the popover widens with the panel (226 → up to 300px).*

*Previously, 2026-09-10 — minimized input area: the send-adjacent **token estimate** (`.p-send-estimate`) and the **max-tokens warning** (`.p-send-hint`) now hide together with the textarea and Send when `.p-input-area` carries `collapsed`. Previously they stayed on the toolbar row while the Send button they annotate was gone, leaving a dangling token count.*

*Previously, 2026-09-02 — mobile bottom action sheet (ADR-114): on touch, the Send long-press opens a full-width **bottom sheet** (`.p-sheet` behind a `.p-sheet-scrim`) instead of the `.p-send-menu` popover — drag handle, swipe-down / scrim-tap / Escape to dismiss, 48px rows, `env(safe-area-inset-bottom)` padding, rounded top corners. Elevation is the scrim + a top border (no `box-shadow`, per the flat-panel rule). Desktop keeps the popover. New tokens: `.p-sheet*` in `styles.css`; built by `ui/ActionSheet.ts`.*

*Previously, 2026-09-02 — Upvoty toggle removed (ADR-113): the `megaphone` input-toolbar button and the "Upvoty" settings section added in ADR-111 are gone (the integration was pulled — see decisions.md). The input toolbar returns to its prior set; the research `globe` is again the last read-only toggle.*

*Previously, 2026-08-28 — AI-message vertical rhythm: rendered-markdown **headings** are normalized (`.p-ai-body`/`.p-summary-card-md` `:is(h1…h6)` → `margin: var(--s4) 0 var(--s1)`, `line-height: 1.3`, chat-scaled sizes h1 1.25em / h2 1.12em / h3+ 1em) instead of inheriting Obsidian's jumpy document-scale defaults; lists + blockquotes share the paragraphs' 6px rhythm; `.p-msg-ai` gap → `var(--s2)`. Fixes the uneven heading-to-body spacing in chat answers.*

*Previously, 2026-08-28 — ADR-109 M3: "related conversations" in the `.p-history` panel — a hover-revealed (long-press on touch) **relate icon** (`.p-history-relate`, `git-compare`) opens a **"Related to X" chip** (`.p-history-chip`) above a semantically-ranked, min-score-filtered list; clearing the chip or typing exits.*

*Previously, 2026-08-28 — ADR-108: search-panel polish. The panel is now **headerless** — the back button moved into the search row (left of the loupe) and the "+" was dropped; the row delete is a **trash-can** icon; the **accent tint marks the focused row** (hover or ↑/↓ selection) while the **active conversation** shows only a grey `.p-history-active` label (no accent background).*

*Previously, 2026-08-28 — ADR-107: one conversation-search surface. The header far-left icon is now a **search loupe** that opens the `.p-history` panel with its search input focused and ↑/↓/Enter keyboard nav; the header **title is plain, non-interactive text** (click + `▾` removed). The anchored quick switcher (`.p-switcher` popover) was folded into the panel and deleted.*

*Previously, 2026-08-27 — fork branch-back fix (ADR-096): the fork selection is now trimmed at storage and search, so the source-side accent fork-origin mark (`<pythia-fork>` / `.p-fork-origin`) re-finds and paints — restoring the blue highlight, the tap-to-open inline summary anchor, and the "Forked from" scroll-to-span, which had silently broken when a fork selection carried edge whitespace / a block-boundary newline.*

*Previously, 2026-08-27 — the optimizer output is now the **bare rewritten prompt** (ADR-094): a shared `OUTPUT_ONLY_INSTRUCTION` forbids conversational wrapper and a pure `cleanOptimizedOutput()` strips residual preamble / code fences / `---` rules, so "Sure! Here's…" no longer lands in the input box.*

*Previously, 2026-08-27 — the prompt optimizer now rewrites the input textarea **in place** (ADR-093) instead of showing preview/result bubbles with Use-this/Discard/Retry: it optimizes the current input with the settings framework and replaces it via `execCommand("insertText")` so ⌘Z / iOS shake-to-undo revert; the Send button doubles as the "Optimizing…" indicator. Removed the `.p-msg-optimize-*` / `.p-optimize-*` CSS and four now-dead i18n keys.*

*Previously, 2026-08-27 — on-accent labels (Send button etc.) now guarantee readability: `--p-on-accent` keeps a theme on-accent token only when it clears WCAG AA on the user's accent, else forces pure black/white (ADR-092, extracted to the tested `readableOnAccent()` in `services/color.ts`). Fixes the still-unreadable "Senden" label on pale/mid accents where ADR-082's better-of-two-tokens pick was insufficient.*

*Previously, 2026-08-27 — prompt optimization moved from an input-toolbar wand icon to a third item ("Optimize prompt", `sparkles`) in the Send long-press menu, greyed when the input is empty or no optimizer template is configured (ADR-091). Removed the toolbar button, its `optimizeBtnTooltip` string, and the dead `.p-optimize-btn` pulse CSS.*

*Previously, 2026-08-27 — two UI fixes: the summary "Speisekarte" cards gain `margin-bottom: var(--s4)` (≈28px section break) so they no longer crowd the first message bubble; and the selection toolbar's Favorite/Fork buttons now show only when the whole selection sits inside one `.p-msg-ai` (endpoint check on `anchorNode`/`focusNode`), fixing a case where an overshooting drag re-showed them over a user prompt (ADR-085 refinement).*

*Previously, 2026-08-27 — favorite/fork highlights adopt smsag.de's "highlighter marker" look (ADR-090): asymmetric `1em 0 1em 0` corners, a diagonal `linear-gradient(-100deg)` ink sweep, and a theme-adaptive `--background-primary` text-shadow. Colors unchanged (favorite yellow / fork accent); always-visible, not hover-gated.*

*Previously, 2026-08-27 — favorites and fork origins are now wrapped in dedicated custom elements (`<pythia-favorite>` / `<pythia-fork>`) instead of `<mark>`, so the fork's accent tint no longer loses to Obsidian's theme `mark` rules: forks read as an accent highlighter, favorites stay yellow (ADR-086, supersedes ADR-064/065).*

*Previously, 2026-08-27 — the selection toolbar hides **Favorite** and **Branch (Fork)** when the selection is inside a user prompt bubble; both apply to assistant content only (Copy / Insert / Inbox remain), enforced in the handlers too (ADR-085).*

*Previously, 2026-08-27 — on a fork, the fork banner ("branched from…") now renders above the summary cards instead of below them: conversation-view order is context inspector → fork banner → summary cards → messages (ADR-084).*

*Previously, 2026-08-27 — the fork banner's "branched from" link is now a `<span>` (not an `<a>`), matching the extension's standard clickable-link pattern (`--color-accent`, underline only on hover) and dropping the stray Obsidian-core anchor underline (ADR-083).*

*Previously, 2026-08-27 — solid accent-filled labels (Send button, active tool/effort pills) now use a plugin-computed `--p-on-accent` that auto-picks the higher-contrast of Obsidian's `--text-on-accent` / `--text-on-accent-inverted` for the user's accent, fixing unreadable labels on pale/mid accents (ADR-082).*

*Previously, 2026-08-27 — turn labels now anchor the day: the first user turn of each new calendar day (and the first message of the conversation) shows an absolute date between `DU` and the time (`DU · 27 Aug 2026 · HH:MM`); same-day turns stay time-only (ADR-081).*

*Previously, 2026-08-27 — the fork anchor's meta line now shows the summary's generation date after the model (`N Nachrichten · Model · <date> · Öffnen →`), matching whichever summary is displayed; model + date are hidden until a summary exists (ADR-080).*

*Previously, 2026-08-24 — "Pythia Final" redesign phase 1 (ADR-066/067): **frameless** code blocks and selection toolbar (hairlines + a mono header row replace the grey `--background-secondary` box; the toolbar is a masked horizontal carousel on `--background-primary`), and **per-message turn micro-labels** (`.p-turn-label`, mono 9px/0.08em `--text-faint`) — `DU · HH:MM` above user bubbles, `PYTHIA · MODEL · HH:MM` above AI messages, backed by a new optional `Message.model`. New micro type size: **9px** for mono micro-labels (turn labels, code language, section labels). This supersedes the old "no label per AI message" / "no turn dividers" rules.*

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
| `--text-on-accent` | Text on accent-coloured surfaces — fallback only; prefer `--p-on-accent` (see below) |
| `--p-on-accent` | Plugin-computed on-accent label color for solid accent fills (Send button, active tool/effort pills); keeps a theme on-accent token when it clears WCAG AA on the user's accent, else forces pure black/white (ADR-082, ADR-092) |
| `--background-primary` | Panel background, input area |
| `--background-secondary` | Summary bar background; framed content boxes (tool-call chip, code blocks, inline code) |
| `--background-modifier-border` | All dividers and borders, including the blockquote left bar |
| `--background-modifier-hover` | Button hover states |
| `--color-green` | Tool-call "done" link text (a persistent semantic state — not used for momentary click feedback like copy-confirmation) |

For a tinted border: `color-mix(in srgb, var(--color-accent) 60%, black)` with a plain `var(--color-accent)` fallback on the preceding line for Chromium < 111.

**On-accent text (ADR-082, ADR-092):** any element with a **solid `--color-accent` fill** must set its text `color: var(--p-on-accent, var(--text-on-accent))` — never bare `--text-on-accent`. Obsidian's `--text-on-accent` is static (white in the default theme) and doesn't adapt to a customized accent, so a pale/mid accent renders those labels low-contrast. `PythiaSidebarView.applyAccentContrast()` resolves the accent and the theme's on-accent tokens to rgb (via a probe span) and delegates to the pure `readableOnAccent()` (`services/color.ts`): it keeps the highest-contrast theme token **only when it clears WCAG AA (4.5)** on the accent — respecting a theme that deliberately tints its label — and otherwise forces pure black or white, whichever contrasts more. This closes the gap ADR-082 left: picking the *less bad* of two theme tokens still fails when **both** read poorly on the accent (the reported unreadable "Senden" label). It sets `--p-on-accent` on `.pythia-view` and re-runs on Obsidian's `css-change` event. Accent *tints* (e.g. the user bubble's 12% `color-mix` with `--text-normal`) are unaffected — this is only for solid fills.

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
[ 🔍 search ][ Conversation title ……grows…… ][ ✎ pencil ][ 🔗 link ][ 🗑 trash ][ model badge ][ + plus ]
```
Order left→right (ADR-098): **search · name (grows) · rename · link · delete · [ctx chip] · model · new**. The name's `.p-title-group` is the only `flex: 1` region, so it absorbs all free space and the action cluster + **"+" stay pinned to the right edge**; the "+" is always the header's last flex child so its x never shifts as other controls show/hide. Empty state (no active conversation) shows only **search · name · +** (rename/link/delete `display:none`, model badge hidden by `updateModelBadge`).
- Search 🔍 (`search` loupe icon, far left, ADR-107): opens the in-panel conversation overlay (`.p-history`) with its search input focused. The overlay is headerless (ADR-108) — its first row is the search field, with the back button on its left.
- Title: 12px, `font-weight: 600`, truncated, flex: 1. **Plain, non-interactive text** (ADR-107) — no click, no `▾`; the old title-click quick switcher was folded into the search panel.
- Pencil ✎ (`.p-rename-btn`): visible when a conversation is active; opens inline rename mode
- Link 🔗: copies `obsidian://pythia?cmd=resume&id=…` to clipboard; check-mark feedback
- Model badge: monospace, 10px, `var(--text-faint)`, clickable to open the **model popover** (`.p-model-pop`, F7/ADR-074): provider groups (ANTHROPIC/OPENAI/MISTRAL), rows of model name (`--text-normal`, weight 500) + a fixed right-aligned context-window column (1M/200k/128k, `min-width: 32px`), a neutral `Reasoning` chip on reasoning models (`--background-modifier-border` on `--text-muted` — **not** warning-orange, which belongs to `.p-send-hint`), an accent check **and** a 2px accent left rail on the active row, and a footer `Gesprächseinstellungen…` → full settings modal. Selecting applies provider+model immediately **and keeps the popover open** (ADR-127): it is a panel, not a one-shot menu, so switching a model and then opening conversation settings through the footer no longer needs a reopen. The list repaints in place — every row owns a check element whose visibility the repaint toggles — and a confirmed touch selection clears the armed row. It closes on outside click, Escape, the badge, or the footer; the footer stays the only route to the settings modal. The chip shows an accent inset border (`.p-model.open`) while open. Each row also carries a **"good for" example line** (`.p-model-pop-good`, `--font-smaller` `--text-faint`, ADR-102) — hidden by default, revealed on `:hover` on desktop (gated `@media (hover: hover)`) and by a first tap on touch, which *arms* the row (`.armed`) and shows a `.p-model-pop-taphint` ("Tap again to select") accent hint; a second tap confirms. Row markup is a `.p-model-pop-line` (name/tag/ctx/check) plus the good/hint lines, so the row is a flex **column**. Strings come from `models/modelGuidance.ts` (en/de, keyed by model id). Provider headers are `position: sticky` inside the scrolling popover; every row carries a transparent 2px left rail so text stays on one baseline; rows are `min-height: 44px` under `@media (pointer: coarse)`; the popover width is `min(300, max(226, panelWidth − 24))`. All popover labels use `--font-smaller` — no off-scale 9px type.
- Trash/Plus: standard header actions
- **No template caption.** The template lives on the assistant turn label (`.p-turn-template`, ADR-129) — the header says what the conversation *is*, the turn label says what produced a given answer. `.p-header` no longer needs `position: relative`.
- **Context-budget bar** (`.p-ctx-bar`, ADR-069): 3px track (`--background-modifier-border`) directly under the header row; `.p-ctx-bar-fill` width = context usage / model window (`--color-accent`, → `--text-warning` under `.warn` at ≥80%). Click scrolls to top. A header `.p-ctx-chip` (mono 9px, warning-tinted) shows the percentage only at ≥80%.
- **Send estimate** (`.p-send-estimate`): mono next-send token estimate ("nächste ~Xk") sits left of the Send button; the Send button label is just `Senden`/`Stopp` (plus `Optimiere…` while the prompt optimizer runs) — a button pill at 10px mono is not a place for a sentence, and a wider label is what pushed the streaming row into the panel edge. **While streaming** (`.p-input-area.streaming`) the estimate is hidden: it describes a send that cannot happen yet, and it frees the toolbar row at the moment the button is at its widest. The row also cannot overflow any more — `.p-toolbar-left` carries `min-width: 0` so the icon group yields first, and `.p-send-wrap` carries `flex-shrink: 0` so the button keeps its size.

**Rename mode** replaces the title + pencil with `.p-rename-input` (inline `<input>`, flex: 1, accent border, 20px height) and `.p-rename-llm-btn` (sparkle, accent colour). Enter/blur confirms and saves; Escape cancels. The LLM sparkle generates a name immediately from the first user+assistant message pair and exits rename mode on success.

### Reference / fork / favorites rows

Note references render as **wikilinks** (`.p-wikilink`, ADR-068): faint `[[`/`]]` brackets (`--text-faint`), accent clickable name (`.md` stripped), optional mono `~tokens` estimate (`--text-faint`, 9px), faint `×` remove (`--text-error` on hover). The add affordance is a `+ Notiz` text link (`.pythia-pill-add`, faint → accent on hover). The bordered `.p-pill` chip is retired.

**Standard clickable-link pattern (ADR-083):** in-panel links are a **`<span>`** (built with `createSpan`) styled `color: var(--color-accent); cursor: pointer;` with underline **only on `:hover`** — e.g. `.p-source-web`, `.p-wikilink-name`, `.pythia-fork-source-link` (the fork banner's "branched from" link). Never use an `<a>` element for these: Obsidian core underlines anchors at a specificity that out-ranks a plugin `text-decoration: none`, so an `<a>` shows a permanent underline the design doesn't want. Spans have no default underline, so the rest state is clean without a scoping workaround.

### Fork anchor (`.p-fork-anchor`, frameless, F1)

The inline branch-back anchor (expands when a `mark.p-fork-origin` snippet is tapped) is **frameless** (ADR-066): a 2px `--color-accent` left-rule, 12px left padding, **no fill or radius**. Structure, top to bottom: `.p-fork-anchor-head` (`git-branch` icon in accent + `ABZWEIGUNG` mono 9px/600 label), `.p-fork-anchor-title` (11.5px/600 `--text-normal` = fork name), one or more `.p-fork-anchor-body` summary paragraphs (11px/1.55 `--text-muted`, **not clamped**), and a `.p-fork-anchor-meta` line `N Nachrichten · Model · <generated date> [· outdated] · ↻ · Öffnen →` — the model and the summary's generation date (`formatSummaryTimestamp`, matching whichever summary is displayed; ADR-080) appear only when a summary exists, so an un-summarized fork reads `N Nachrichten · ↻ · Öffnen →` (the accent `.p-fork-anchor-open` short-presses to open the fork, long-presses for the summary-generate menu). The `.p-fork-anchor-refresh` button (`rotate-cw`) is always shown and regenerates the displayed summary type (conversation by default) in one tap; when the fork has activity newer than the shown summary the meta appends an `outdated` marker and the button tints accent (`.is-stale`) — so the origin preview always reflects, or can be one-tapped to, the fork's latest state (ADR-127). Previously this was a grey `--background-secondary` box with only the summary + an open button; regenerate was long-press-only.


### Merge anchor (`.p-merge-anchor`, frameless, ADR-130)

The inline anchor that expands when a `<pythia-merge class="p-merge-link">` passage is tapped — the mirror of the fork anchor, for a passage that points **at** an existing conversation rather than one that spawned a new one. Frameless like its counterpart, but the 2px `--color-accent` left-rule is **dashed**, matching the mark's dashed underline and letting the reader tell the two inline anchors apart without reading either. Structure, top to bottom: `.p-merge-anchor-head` (`git-merge` icon in accent + `VERKNÜPFT` mono 9px/0.08em `--text-faint` label), `.p-merge-anchor-title` (12px/600 `--text-normal` = the target conversation's name), `.p-merge-anchor-body` (its **conversation** summary, 11px/1.55 `--text-muted`, not clamped) or `.p-merge-anchor-empty` (italic `--text-faint` placeholder, only reachable if generation failed — creating a merge generates the summary first), and `.p-merge-anchor-meta`: `N Nachrichten · Model · <date> [· veraltet] · ↻ · ⛓ · Öffnen →`. Model and date appear only once a summary exists. `.p-merge-anchor-refresh` (`rotate-cw`) regenerates in one tap and tints accent (`.is-stale`) when the target has activity newer than the shown summary — ADR-128's staleness rule verbatim. `.p-merge-anchor-unlink` (`unlink`) removes the link, its marks and the anchor. `.p-merge-anchor-open` opens the target.

Two deliberate differences from the fork anchor: only the **conversation** summary is shown (the fork anchor prefers a favorites summary; a merge target is an independently named conversation and its own recap is what was asked for), and there is **no long-press menu** — with one summary type to offer, the visible ↻ is the whole affordance.


### Merged-from banner (`.pythia-merge-banner`, ADR-130)

The far half of a merge link, and the counterpart to the fork banner. A fork announces itself twice — the child shows "Verzweigt von …" and the source paints the origin passage — so a merge does the same, reflected: the painted passage lives in the conversation that made the link, and this banner lives in the conversation it points at. Rendered directly below the fork banner and above the summary cards (extending ADR-084's order to: context inspector → fork banner → merged-from banner → summary cards → messages), and **only when inbound links exist**, so an unlinked conversation is unchanged.

Styling mirrors `.pythia-fork-banner` with one deliberate difference: the 2px `--color-accent` left-rule is **dashed**, matching the merge mark's dashed underline and the merge anchor's dashed rule, so all three merge surfaces read as one family and none is mistaken for a fork. Structure: `.pythia-merge-header` (`git-merge` icon + `VERKNÜPFT VON` uppercase micro-label), then one `.pythia-merge-entry` per inbound link — a `.pythia-merge-source-link` accent span carrying the source conversation's name (a span, not an `<a>`, per ADR-083) and a `.pythia-merge-selection` italic excerpt of the linked passage, truncated at **120 characters** rather than the fork banner's 220 because a conversation can be merged with from many passages and each row must stay one or two lines. Clicking the name opens the source conversation, scrolls to the passage and expands its merge anchor, falling back to the message when the mark cannot be located.

The list is derived on read from every conversation's `merges`, never stored on the target, so no banner can outlive the link it describes.


### Tables (`.p-scroll-frame`, ADR-131)

Every rendered markdown table is wrapped in a `.p-scroll-frame`: `overflow-x: auto`, `max-width: 100%`, a 4px thin scrollbar in `rgba(128,128,128,0.25)`, `cursor: grab` and drag-to-pan, identical to the treatment code blocks and diagrams get. The wrapper is applied by `decorateTables` and is idempotent.

The frame alone does nothing, because a table with automatic layout shrinks to its container instead of overflowing it. Two scoped rules make it real:

- `.pythia-view .p-scroll-frame > table` gets `width: max-content` and `max-width: none`, so the table takes the width its columns want rather than shrinking to the frame. `max-width: none` alone is not enough (ADR-134): lifting a cap does not make a table want to be wider.
- `.pythia-view .p-scroll-frame > table th, td` get `overflow-wrap: normal`, `word-break: normal`, `hyphens: none`, `min-width: 8ch` and `max-width: 32ch`. The cap is what makes `max-content` usable: without it one very long cell sets the table's width and its row becomes a single endless line.

The `.pythia-view` scope is required, not decorative: Obsidian core and themes load after the plugin, so an unscoped plugin rule loses a specificity tie (ADR-065). **What these cell rules actually override, though, is Pythia's own** `.p-ai-body { … }`, inherited into every cell — see ADR-144. The scope is still right; the theme is not the thing being beaten here.

**The rule for cell text: wrap between words, never inside one.** A long prose cell still wraps and stays compact; a single long word such as `Messbarkeit` or `Stoffwechselenergie` is never split. `min-width: 8ch` is a floor so a short column (`gut`, `mittel`) is not crushed to one character per line by a wide neighbour; it is expressed in `ch` so it follows the cell's font rather than assuming a pixel size, and a column whose longest word is wider still takes that greater width.

**No sticky first column.** The whole table scrolls together, matching code blocks and diagrams.

### Summary cards ("Speisekarten")

Both summaries — conversation and favorites — are surfaced as collapsible cards (`.p-summary-card`) inside a `.p-summary-cards` container near the **top of the message list** (`.p-chat`), so they scroll with the conversation. The conversation-view vertical order is: context inspector → **fork banner** (on a fork) → summary cards → messages (ADR-084 — the fork's "branched from" orientation sits above the summaries and next to the first message). A card exists only when its summary exists (`summaryText` / `favoritesSummary.text`); none otherwise. `.p-summary-cards` carries `margin-bottom: var(--s4)` on top of the chat's `gap: var(--s3)` (≈28px total) so this menu zone reads as a distinct section separated from the first message bubble — the plain flex gap was too tight a seam, most visible on forks where the cards sit under the fork banner. The margin only takes effect when cards are present (the container is `display:none` when empty).

- **Header** (`.p-summary-card-header`): `setIcon` glyph (`align-left` for conversation, `star` for favorites) + title (`conversationSummaryTitle` / `favoritesSummaryTitle`) + a ▸/▾ chevron. Click toggles expand/collapse.
- **Collapsed by default.** Body (`.p-summary-card-body`) reveals on `.open`; the rendered markdown (`.p-summary-card-md`, shares `.p-ai-body` typography, `max-height: 40vh` internal scroll) plus a footer with the timestamp and **Copy** / **Save-to-note** actions. Saved notes (`NoteWriter.saveSummaryNote` / `saveFavoritesSummaryNote`) carry frontmatter `type: "LLM Note"` and a clickable `source:` deep link (`obsidian://pythia?…&cmd=resume&id=…`) that reopens Pythia with the conversation active — no `tags: [pythia]`.
- **Auto-collapse on scroll-out:** an `IntersectionObserver` (root = `.p-chat`) collapses an expanded card once it leaves the viewport.

**The Send long-press menu:** long-pressing the **Send** button opens a small popover (`.p-send-menu`) stacked **directly above the button** (the Send button is wrapped in a relatively-positioned `.p-send-wrap`; the menu opens upward, right-aligned, dismissed on outside click) with **three** items (`setIcon` glyph + label, greyed via `.p-send-menu-item-disabled` when unavailable): **Summarize conversation** (`align-left`, greyed with no messages), **Summarize favorites** (`star`, greyed with no favorites), and **Optimize prompt** (`sparkles`, greyed when the input is empty **or** no optimizer template is configured — ADR-091). The first two generate/regenerate that summary with current context and reveal its card; the third runs the **in-place prompt optimizer** (ADR-093): it rewrites the textarea's current content with the framework from settings and replaces it **in place** — no preview/result bubbles or Use-this/Discard/Retry UI. While the call runs (~1–3 s) the textarea and Send are disabled and the Send button doubles as the "Optimizing…" indicator; the replacement uses `document.execCommand("insertText")` so ⌘Z (desktop) and iOS shake-to-undo revert to the original. The user keeps it by pressing Send, or reverts and (optionally) runs the optimizer again for another version. The result is the **bare rewritten prompt** — a shared `OUTPUT_ONLY_INSTRUCTION` is appended to the request and a pure `cleanOptimizedOutput()` strips any residual preamble ("Sure! Here's…"), code fence, or surrounding `---` rules (ADR-094), so no conversational wrapper lands in the input box. A native Obsidian `Menu` is deliberately **not** used — on mobile it renders as a bottom sheet rather than at the button. Summary generation stays button-only otherwise: no sparkle/refresh icon, no auto-generation on close or note-injection.

### Context inspector (`.p-inspector`, F2/F3)

Outline card (`--background-primary`, 1px border, radius 6) rendered in `.p-inspector-wrap` as the **first element of the conversation view** (above the summary cards); `fillContextInspector()` builds it and is re-called from `renderReferencePills()` on note add/remove. Shown only when there are context notes **or** usage ≥80%. Header: `file-text` icon + `Kontext · ~Xk` (or `Kontext · used / window` when tight) + a warning percent + ▸/▾ chevron (collapsed by default; open state persists in-session). **Normal body:** context notes as wikilink rows with `~tokens` + `×` remove, a `+ Notiz hinzufügen` link, and a `+ Systemprompt ~est` label. **Budget-breakdown body** (≥80%): a conversation-history row (message count), each note, and the system prompt — each with a 64px `.p-ins-bar` mini-bar + token value — then a warning row (`alert-triangle` + "Fast voll — …") with an outlined-accent `Zusammenfassen` button. Outline cards (summaries + this inspector) are the only components that keep a filled/bordered box.

### Conversation search / history panel (`.p-history`)

The single in-view conversation surface (ADR-107): a full-panel overlay (`position:absolute; inset:0`) opened from the header **loupe** with its **search input auto-focused**. There is **no separate header row** (ADR-108) — the first row is the search field (`.p-switcher-search`), which hosts the `arrow-left` **back button on its left**, then the loupe icon and the input. No "+" new-conversation button here (use the main header's "+").
- **Empty box → browse:** a date-grouped list (`.p-history-group` HEUTE/GESTERN/DIESE WOCHE/"Month YYYY"); rows show a title + mono `Model · N Nachr. · ⑂ forks · ★ favorites` sub-line; forks indent under their source with a `git-branch` icon.
- **Query → search:** a flat, relevance-ranked list (TF-IDF, ADR-106) with a mono `.p-history-snippet` match line under each row.
- **Focus vs. active (ADR-108):** the **accent tint** now marks the *focused* row — hover **or** the ↑/↓ `.selected` row. The **active** conversation is no longer accent-tinted; it's shown only by a grey mono **`.p-history-active`** label (localized "aktiv"/"active"). Hover/selection reveals a **trash-can** delete icon (`.p-switcher-del`, `setIcon("trash")`).
- **Keyboard:** ↑/↓ move the focused row, Enter opens it, Esc or Back closes.
- **On-screen keyboard (touch):** the auto-focused search field raises the keyboard, which **overlays** the webview instead of resizing it — the overlay keeps its full height and its last rows end up underneath. `window.visualViewport` reports what is actually visible, so the panel pads `.p-history-list` by the covered height (+8px) on every `resize`/`scroll` of the visual viewport, and once on open; the padding is scroll space, so every conversation can be brought clear of the keyboard. It resets to the stylesheet's 8px when nothing is covered (Android, where the webview does resize, and desktop), and the listeners are removed when the panel closes.
- **Related mode (ADR-109):** each row has a **relate icon** (`.p-history-relate`, `git-compare`) revealed on hover → switches the panel to a **"Related to ‹name›" chip** (`.p-history-chip`, accent-tinted, with an `x` clear) above a list of only the semantically-related conversations (min-score-filtered, most-similar first). Clearing the chip or typing in the search box returns to browse/search. On **touch** (no hover) a **long-press** on the row opens an Obsidian **context menu** with both hover-only actions — **Show similar** and **Delete** (delete omitted for the active conversation). The similarity floor is a **settings preset** — *Strict / Balanced / Loose* (`relatedSimilarity` → cosine 0.5 / 0.35 / 0.2) — so users tune "how close counts as similar" without touching raw scores.
- The command-palette `ConversationSuggestModal` is the other entry point. The former quick switcher (title-click popover) was folded into this panel.

### Chat scroll area

`.p-chat`: `flex: 1; overflow-y: auto; overflow-x: clip`. Messages gap `var(--s3)`. Conversation view scrolls to **top** on every conversation switch; new messages sent during a session scroll to the bottom as usual.

### User message bubble

`background: var(--color-accent)`, `border-radius: 10px 10px 2px 10px`, max-width 86%, right-aligned.

Messages longer than **280 characters** render collapsed to ~3 lines with a fade-out mask (`-webkit-mask-image` gradient). A chevron-down toggle button (`.p-bubble-toggle`) appears below the bubble; clicking it toggles `.p-bubble-collapsed` / `.p-bubble-expanded` on the bubble and flips the icon to chevron-up. Short messages render normally with no toggle.

### AI message

Plain text, no background. Rendered via `MarkdownRenderer.render()`. Code blocks wrapped in `.p-code-frame` with `position: relative` for the copy button overlay. The first rendered block has its top margin collapsed (`.p-ai-body > :first-child { margin-top: 0 }`) so an answer that opens with a heading sits directly under the turn label instead of leaving a large gap from the heading's default `margin-block-start`; the `.p-msg-ai` flex `gap` still gives a small, consistent separation. Same rule applies to `.p-summary-card-md`.

**Vertical rhythm (rendered markdown).** Obsidian's theme applies *document-scale* heading margins/sizes, which make the chat's vertical spacing jump (a big gap after a heading, tiny gaps between paragraphs). We normalize it so the answer reads on a steady beat:
- **Headings** (`.p-ai-body :is(h1…h6)`, and the same for `.p-summary-card-md`): `margin: var(--s4) 0 var(--s1)` — **more space above** (a section break) than **below** (heading binds to its own text), `line-height: 1.3`, `font-weight: 600`. Sizes are scaled for the narrow column, not a document: **h1 1.25em · h2 1.12em · h3+ 1em** (h3 and deeper differentiate by weight/spacing, not size). The `:first-child { margin-top: 0 }` rule still wins for a leading heading (higher specificity), so it keeps hugging the turn label.
- **Even block spacing.** Paragraphs, lists, and blockquotes all use a **6px** vertical rhythm (`p` `margin: 0 0 6px`; `ul/ol` and `blockquote` `margin: 6px 0`) so inter-block gaps are uniform (adjacent margins collapse to 6px).
- **`.p-msg-ai` gap** is `var(--s2)` (8px) — label → body → token line — so each answer starts with a little room rather than glued to its meta line.

### Blockquote

LLM-quoted text: `border-left: 3px solid var(--background-modifier-border)` (neutral divider token — **not** `--color-accent`, which is reserved for interactive/active elements), `padding-left: var(--s3)`, `color: var(--text-muted)`, `font-style: normal` (overrides Obsidian's default italic — this app never uses italics). No background/box on the wrapper itself, consistent with "AI message: plain text, no container." Content nested inside (e.g. a fenced code block) still gets its own `.p-code-frame` box, unaffected by the blockquote's own styling.

### Turn micro-label (`.p-turn-label`)

Mono, **9px**, `letter-spacing: 0.08em`, `--text-faint`, as the first child of every message row. User turns read `HH:MM` (right-aligned, since `.p-msg-user` is `align-items: flex-end`); AI turns read `<MODEL> · HH:MM` (left-aligned). **No role captions** (ADR-129, supersedes ADR-067's `DU`/`PYTHIA`): the accent bubble vs. the plain body already tells the two apart, and the caption was the least informative token on the line. The model comes from `Message.model` (recorded at generation time) and falls back to the conversation's current model for legacy messages. Time via the pure `formatClockTime()` helper (24h, locale-independent). Rendered by `ui/turnLabel.ts` (extracted from `sidebar.ts`, ADR-097).

**Template caption (`.p-turn-template`, ADR-129):** on an assistant turn, the template name sits between the model and the time — `SONNET 4.6 · PODCAST SUMMARY · 14:32`. Same mono 9px `--text-faint` as the rest of the label, uppercased, `max-width: 18ch` with `text-overflow: ellipsis` so a long template name can never push the model, time, or token counts off a narrow sidebar; the full `Vorlage: X` string is the `title`. Shown **only where a template starts applying** — the first answer of the conversation, and again wherever a second template takes over — never repeated on every turn. Backed by `Message.templateId` (stamped at generation time), falling back to `Conversation.templateId` for legacy messages, which captions exactly the first answer of an old conversation.

**Day anchor (ADR-081):** the first user turn of each new calendar day — and the very first message of the conversation — prefixes the time with an absolute date (`27 Aug 2026 · HH:MM`); same-day turns stay time-only. `isFirstMessageOfDay(msg)` compares a message's local day to the previous message's (any role); `formatTurnDate()` renders `day numeric · short month · numeric year` via `toLocaleDateString`. Deliberately **absolute** (not `formatConvDate`'s relative "Heute/Gestern"), so labels stay correct when a conversation is reopened later. User turns only.

### Code block frame (`.p-code-frame`) — frameless (ADR-066)

No background fill, border, or radius. Structure comes from **top/bottom hairlines** (`--background-modifier-border`) plus a header row `.p-code-head`: a `.p-code-type-icon` (Lucide `code-2`, `--text-faint`), the language name `.p-code-lang` (mono 9px `--text-faint`), and — right-aligned — the copy button in `.p-code-actions`. `font-family: var(--font-monospace)` set explicitly on the `<pre>`, which carries only horizontal scroll + drag-to-pan (no box, no reserved top padding). Copy stays hover-reveal on desktop and always-visible under `@media (hover: none)`. The `<pre>` (and its `code`) **must explicitly set `background: var(--background-primary); border: none`, scoped under `.pythia-view`** (0,2,1) — otherwise Obsidian core's default grey `pre` fill/border wins the tie and the block looks boxed again (ADR-065). Outline cards (summaries, context inspector) remain the only components that keep the filled-box formula.

### Code block copy button

`.p-code-actions`: `position: absolute; top: 4px; right: 4px` on the frame. Opacity 0, reveals on `.p-code-frame:hover`. On touch: always visible via `@media (hover: none)`. The icon glyph itself is fixed at `14×14px` (`.p-code-btn svg`) so the "copy" and "check" (copy-confirmed) icons render at identical size when swapped. Copy-confirmed color is `var(--color-accent)` — not green; green is reserved elsewhere in this app for a few persistent semantic states (tool error/done), not a momentary click acknowledgment.

### Diagram blocks (Mermaid, PlantUML, Vega, …)

Selector: `[class*='block-language-']` — catches all renderer plugins. Container: `position: relative; overflow-x: auto; width: 100%`.

JS (`fixDiagramSvgSize`) stamps explicit pixel dimensions on the SVG from `viewBox`, HTML attributes, or inline `style.width`. A MutationObserver catches attribute/style mutations; a ResizeObserver fallback catches Mermaid v10 and Vega which resize via layout rather than mutations.

Copy button `.p-diag-copy`: `position: absolute; top: 6px; right: 6px; z-index: 2`. Opacity 0, reveals on container hover. On touch: always visible. Stays pinned in the top-right corner while the user pans — does not scroll with the SVG.

### Citations & sources (`.p-cite`, `.p-sources`, F2/F11)

Model-declared citations (ADR-072). The model emits `⟦cite:note:<path>⟧` / `⟦cite:web:<domain>⟧` markers (instructed only when notes are attached / research is on); `services/citations.ts` parses them into a numbered, deduped `Message.sources`. `paintCitations()` re-paints markers into `.p-cite` superscript chips (mono 9px accent on `color-mix(accent 10%)`) after every render; `renderSourcesRow()` adds a sources row under the message — a single `QUELLEN` row of `[[wikilinks]]`, or split `WEB` (accent `domain ↗`) + `VAULT` rows when any web source is present. Chips/links open the note or the source URL. `stripCitationMarkers()` keeps raw markers out of saved notes. **Web sources (research mode, ADR-077) are deterministic:** they're parsed from the actual Tavily `web_search` result (`parseWebSourcesFromResult` → `appendWebSources`), not from model markers, so the `WEB` row always reflects the real sources; the model's own `【…†source】`-style markers are stripped from the text (`stripForeignCitations`). Vault citations remain model-declared.

**Sources row layout (ADR-153).** Each row opens with a **run-in `Label:`** — `Template:` / `Vault:` / `Web:` — in the flow ahead of the first entry, never a fixed label column. The 54px `min-width` ADR-140 specified could not do what it promised: the row is `display: flex; flex-wrap: wrap`, and a wrapped flex line starts at the container edge rather than under the first item, so the column aligned only each row's first line while costing 54px of a ~300px sidebar on every line. The colon is added in code, not in the string tables, so a translation cannot drop it and leave the row reading as a heading. Vault and template entries are a **bare accent-coloured name with no `[[ ]]`**; the label states what they are, so the brackets repeated it. Web entries keep `domain ↗`, which is the one mark separating them from notes. The context inspector's note list keeps its brackets — it has no label, so there they are the only signal.

```
Template: Podcast Summary
Vault: 1 Some Note
Web: 2 thetransmitter.org ↗  3 sainsburywellcome.org ↗
```

Tokens, top to bottom: rule `--background-modifier-border`; labels `--font-monospace` 9px `--text-faint`; citation numbers `--font-monospace` 9px `--text-faint`; note names and web domains 11.5px `--color-accent`, underlined on hover.

### Token counts (inline in the AI turn label)

Input/output token counts render **inline in the AI turn micro-label**, not as a separate footer: `MODEL · [TEMPLATE ·] HH:MM · ↑7.028 ↓125` (appended by `appendTokensToTurnLabel`, only when the message carries `tokenUsage`). No per-message star button (favoriting moved to text selection — see below). Send button shows **estimated next-send cost**: `lastInputTokens + lastOutputTokens + round(draft.length/4)`. Updates live as user types.

### Favorite & fork highlights (`<pythia-favorite>` / `<pythia-fork>`)

Any text selection **inside an assistant message** can be favorited via the **Favorite** button in the selection toolbar. Toolbar order (left → right): **Copy · Favorite/Unfavorite · Branch (Fork) · Merge · Define · Insert into note · Save to inbox** — Merge sits beside Branch because the two are inverses (ADR-130). **Favorite, Branch (Fork) and Merge apply to assistant content only** (ADR-085): `handleSelectionChange` shows both buttons **only when the whole selection sits inside a single `.p-msg-ai`** — it resolves the owning assistant message from each selection *endpoint* (`anchorNode` and `focusNode`) and requires them to be the same `.p-msg-ai`; otherwise (selection in a user prompt bubble, or crossing a message boundary) all three are hidden and only Copy / Insert / Inbox remain. This endpoint check replaced an earlier `range.commonAncestorContainer.closest(".p-msg-user")` test, which bubbled up to `.p-chat` when a drag overshot a bubble's text and then wrongly re-showed both buttons over a user prompt. The `onFavoriteSelection` / `onForkConversation` / `onMergeConversation` handlers still guard independently (single owning message, assistant-only), so it's not possible even if a button leaks through.

**Highlight elements (ADR-086):** favorited text is wrapped in a **`<pythia-favorite class="p-highlight">`** custom element; a fork-origin snippet is wrapped in **`<pythia-fork class="p-fork-origin">`**; a merged passage is wrapped in **`<pythia-merge class="p-merge-link">`** (ADR-130). Custom elements (not `<mark>`) are used deliberately: `<mark>` is styled by Obsidian core / theme `.markdown-rendered mark` rules that load after the plugin and kept forcing the fork mark back to yellow; a custom element carries no theme rules, so `.pythia-view pythia-fork` wins with no specificity contest. This supersedes the accent-on-`<mark>` mechanism of ADR-064/065. Highlights are re-painted after every markdown render by `ui/HighlightPainter.ts` (shared `paintRange(range, id, className, dataAttr, tagName)`), which re-finds the stored text among the body's text nodes (offsets are not stored — the DOM is re-created on each render). JS queries are class-based (`.p-highlight` / `.p-fork-origin` / `.p-merge-link`), element-agnostic. Tap precedence where marks overlap: **fork origin → merge link → favorite**.

**Highlighter marker style (ADR-090):** both highlights render as a **"highlighter marker"** — the effect ported from smsag.de's `a:hover` rule: an asymmetric `border-radius: 1em 0 1em 0` (hand-drawn corners), a diagonal, uneven `linear-gradient(-100deg, …)` ink sweep, and `text-shadow: 1px 1px 1px var(--background-primary)` for legibility over the ink. **Colors are unchanged:** the favorite sweep is built from `--text-highlight-bg` (yellow, with its full value as the gradient's peak stop) and the fork sweep from `--color-accent` (peak ≈ 30% — matching the prior 25% accent tint). Each keeps a plain `background: …` line *before* the gradient as the no-`color-mix` fallback (an unsupported gradient falls back to the original solid). The text-shadow is **theme-adaptive** by using `--background-primary`: a white halo in light themes (as on smsag.de), a dark halo in dark themes. The marker is **always visible** (persistent), not hover-gated — favorited/forked spans must stay findable in the transcript. `box-decoration-break: clone` keeps the ink and corners clean across line wraps. The `p-highlight-flash` navigator-jump pulse still momentarily fills solid accent → `--text-highlight-bg` before settling back to the marker.

**Unfavorite:** *tapping* a highlight (no drag) selects its whole span (`rangeForHighlight`) and opens the toolbar with the Favorite button relabeled **Unfavorite**; pressing it removes exactly that highlight (`removeHighlightById` — surgical, never touches other highlights). A *dragged* selection always creates a new favorite, even overlapping an existing highlight — dragging never removes one. A brief `p-highlight-flash` animation plays when the navigator jumps to a highlight.

### Chapter navigator (`#`)

Trigger button: 24×24 px, `--color-accent`, monospace, bottom-right of the message area. Popover 200 px wide, opens upward. Closes on outside click (listener tracked as `navigatorOutsideCleanup`, removed on view close and conversation switch).

Collapsible sections — **Forks** (collapsed by default; rendered as a **branch tree**, F5/ADR-073: a `.p-nav-tree-source` root row with a `Quelle` tag, `.p-nav-tree-children` indented under a 1px left rule, each `.p-nav-tree-item` a `.p-nav-dot` status dot + name + `aktiv` tag/message count; the current conversation's row is accent-tinted `.active`), **Merged** (ADR-130 — collapsed by default and **shown only when the conversation has merge links**, so users who never merge gain no permanent row; each item is the target conversation's name with a jump-to-passage click and a hover ✕ that unlinks), **Favorites**, **Chapters** — each with a ▸/▾ chevron, item count badge, and italic empty-state message. **Favorites** lists each highlight by the first words of its text; clicking scrolls to the start of the highlighted span; a hover-revealed `.p-nav-del` (✕) removes it. The Favorites section **label** links to the favorites summary card (`.p-nav-group-name.p-nav-link`) when a favorites summary exists — clicking it closes the popover and scrolls to + expands that card; with no favorites summary the label is greyed and non-clickable (`.p-nav-disabled`). Legacy message-level favorites list the same way but jump to the message top. On open, the popover auto-scrolls to the **Chapters** section so it is immediately visible regardless of how many Forks or Favorites sit above it.

### Input area

Textarea: min 3 lines desktop / 2 lines mobile, max 72–150 px. IME guard: `e.isComposing` prevents CJK candidate confirmation from sending.

**Collapsed state:** a toolbar toggle button collapses the whole input area — the textarea, the reference row (attached-note pills), the Send button, and everything that annotates Send — the next-send token estimate (`.p-send-estimate`) and the max-tokens warning (`.p-send-hint`) — all hide, reclaiming vertical space for the chat scroll area. The toolbar itself (`.p-toolbar`/`.p-toolbar-left`) stays visible in both states — it *is* the minimized row, so every action icon (attach/save/apply-template/research/collapse) stays reachable and in the same order whether expanded or collapsed. (Prompt optimization is no longer a toolbar icon — it moved to the Send long-press menu, ADR-091.) Clicking any of those action icons while collapsed expands the input area and performs that icon's action in the same click; the toggle button itself only expands/collapses, no side effect. The toggle icon swaps direction on each toggle — `arrow-down` when expanded, `arrow-up` when collapsed — rather than reusing one icon for both. Instant `display` swap on a `collapsed` class, mirroring the summary panel's toggle pattern; no animation. State is ephemeral (not persisted to `data.json`) and survives conversation switches for the session; the reference row's own visibility (shown only when there are attached notes) composes with the collapse state rather than being overridden by it.

### Empty / welcome state (`.p-welcome`, F6)

Empty conversations render a centered welcome via `renderWelcome()`: an accent `sparkles` icon (22px), a 13px/600 heading (`emptyHeading`), and three mono keycap hints (`.p-welcome-hint` with `.p-keycap` chips): `#` attach note, `⌘P` commands, `⇧↵` newline. Used for a new conversation and after the last exchange is deleted. It is removed as soon as the first message is sent (the send + append paths clear `.pythia-empty, .p-welcome`), so it never lingers above a started conversation. The distinct *no-active-conversation* fallback keeps the plain `.pythia-empty` hint.

### Effort segmented control (`.p-effort-seg`, F8)

The conversation-settings Effort control is a segmented control: **Standard · Niedrig · Mittel · Hoch**. The active segment gets `.active` — accent fill, `--p-on-accent`, **and weight 600**, so selection never rests on colour alone — plus `aria-pressed`; the group carries `role="group"`. The leading **Standard** segment means "no override" and names the effort that will actually apply (`Standard · Mittel`) when a global default is configured, plain `Standard` otherwise; the long parenthetical `effortUnsetOption` string stays in the settings-tab dropdown, which can carry it. Every segment rule is **scoped to `.pythia-modal`**: `all: unset` alone is (0,1,0) and loses to Obsidian core's `button:not(.clickable-icon)` fill at (0,1,1) — the modal has no equivalent of the `.pythia-view` reset at the top of `styles.css`, so the segments inherited core's grey and the selected one was hard to pick out. Segments are ≥28px tall, ≥36px under `@media (pointer: coarse)`. When the selected model doesn't support effort, the whole control is greyed + disabled (`.disabled`).

### Conversation settings modal (temperature, max tokens, language, theme)

Per-conversation temperature is a `SliderComponent` (0–1, step 0.05, dynamic tooltip), defaulting to the effective value (`conversation.temperature ?? settings.temperature ?? 1.0`). Follows the modal's existing draft-until-Save convention — dragging updates a local value; Save commits it alongside provider/model, Cancel discards it. A **permanent mono readout** (`.p-param-readout`, `--font-smaller`/`--text-muted`) sits right of the slider: Obsidian's dynamic tooltip only exists mid-drag and on touch hides under the finger, so it is the only always-visible statement of the value. It reads `0.70 · Standard` while the conversation has no override of its own and drops the tag to plain `0.70` the moment the slider moves; it is fed by the raw `input` event on `slider.sliderEl`, not only `onChange`, so it tracks the drag on builds where `onChange` fires on release. **Unsupported parameters:** `Setting.setDisabled` only marks the row — the control underneath stays draggable — so the slider is additionally disabled through the component and the control area carries `.p-param-off` (opacity 0.5, `pointer-events: none`), matching what the effort segments already did by hand. This matters on reasoning models, where temperature is unsupported precisely when effort is.

**Max tokens** is a text field (numeric `inputMode`, `[0-9]*` pattern — a numeric keypad on touch without desktop spinner arrows, and invalid text stays visible so it can be flagged). It prefills the effective value and shares the `.p-param-readout` tag: `8192 · Standard` while the conversation has no override of its own, blank once a number is typed, and the rejection reason (`paramInvalidNumber`) in `--text-error` while the text is not a positive whole number, with `.p-field-invalid` on the input. Clearing the field means "no override", so the placeholder carries the default that will apply. Two rules keep the field honest: `blur` rewrites it to the value Save will store (invalid text used to sit there while Save committed the last good number), and an **untouched** field follows the model — the default is model-aware, so switching to a reasoning model re-resolves it instead of pinning the stale number on Save.

**Language** is a dropdown of the same six options as the global setting, from the shared `ui/languageOptions.ts`, preceded by a `Standard (…)` option that names the global default in its label (`Standard (Sprache des Gesprächsverlaufs)`). It follows the readout convention the other two overrides established — the row states which value applies when the conversation has none of its own — but does it in the option label rather than a `.p-param-readout`, because a dropdown's selected option is already always visible where a slider's value is not. `Standard` is its own value, not the global's current value pre-selected: a conversation that inherits keeps inheriting when the global setting changes later.

**Theme** is a plain text field, not a dropdown: themes are created by typing one, and the set is open. Its placeholder is the conversation name — the value that applies while the field is empty — rather than a `.p-param-readout`, because an empty input already reads as "nothing set" where an untouched slider does not. Clearing it restores "follow the conversation name", which is why the placeholder has to name that behaviour rather than merely show a default.

---

## What not to build

- No Favorites row in the header — merged into `#` navigator
- ~~No avatar or label per AI message~~ → superseded: every turn carries a mono micro-label (`.p-turn-label`, ADR-067) — but **no role caption** in it (ADR-129: no `DU`/`PYTHIA`)
- No template caption in the header → it belongs to the answer it produced, on the turn label (ADR-129)
- No turn *divider lines* (the mono turn label replaces them — still no horizontal rules between turns)
- No avatar images or role icons per message — the label is text only
- No sparkle in the toolbar — the header sparkle handles both generation and panel toggle
- No card shadows on summary or reference rows
- No framework mount (no React, Svelte, shadow DOM)
- No hardcoded colours — every colour token must be an Obsidian CSS variable
