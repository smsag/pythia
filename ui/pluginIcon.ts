/**
 * Pythia's own icon: the Python of Delphi, a serpent winding like lines of text.
 *
 * One mark for the ribbon entry, the entry commands and the sidebar tab, so the
 * thing a person clicks and the thing that opens look like each other. It used
 * to borrow Lucide's `bot`, which says "a chatbot" and nothing about Pythia.
 *
 * Drawn on Lucide's 24-unit grid with round caps, so it sits in a row of
 * Obsidian's built-in icons without standing out. The stroke width is
 * Obsidian's, inherited, not ours (see below). `addIcon` draws inside
 * a `0 0 100 100` box, so the group scales the artwork rather than the paths
 * being rewritten: the file keeps the coordinates the design hands over, and
 * the stroke scales with them. `currentColor` throughout — the icon follows the
 * theme and the accent, never a colour of its own.
 */
import { addIcon } from "obsidian";

export const PYTHIA_ICON_ID = "pythia-logo";

/** 100 / 24 — Lucide's grid into the box `addIcon` draws in. */
const SCALE = (100 / 24).toFixed(4);

/** The artwork as designed; the geometry is final and is not edited here. */
const ARTWORK = [
	'<path d="M5 19c-2.5 0-2.5-4.5 0-4.5h13c2.5 0 2.5-4.5 0-4.5H6c-2.5 0-2.5-4.5 0-4.5h9.5"/>',
	'<circle cx="17.5" cy="5.5" r="1.5"/>',
].join("");

/**
 * No `stroke-width` here, deliberately (ADR-168). Obsidian's `.svg-icon` sets
 * `stroke-width: var(--icon-stroke)` — 1.75px in a sidebar tab, other values in
 * the ribbon and menus — and a Lucide icon has no attribute of its own, so it
 * inherits that. A presentation attribute on this group would block it: the
 * group's `scale()` multiplies the stroke along with the geometry, so a
 * hardcoded 2 rendered at 8.33% of the icon's width where every neighbour sat
 * at 7.29%, and 14% of extra weight reads as a darker glyph, not a bolder one.
 * Inheriting makes the icon behave exactly like core's at every size.
 * `assets/logo.svg` keeps its `stroke-width="2"`: a standalone file has no
 * stylesheet to inherit from, and 2 on the 24-unit grid is Lucide's own value.
 */
export const PYTHIA_ICON_SVG =
	`<g transform="scale(${SCALE})" fill="none" stroke="currentColor" ` +
	`stroke-linecap="round" stroke-linejoin="round">${ARTWORK}</g>`;

/** Called once in `onload()`, before anything asks for the icon by name. */
export function registerPythiaIcon(): void {
	addIcon(PYTHIA_ICON_ID, PYTHIA_ICON_SVG);
}
