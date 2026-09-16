/**
 * Pythia's own icon: the Python of Delphi, a serpent winding like lines of text.
 *
 * One mark for the ribbon entry, the entry commands and the sidebar tab, so the
 * thing a person clicks and the thing that opens look like each other. It used
 * to borrow Lucide's `bot`, which says "a chatbot" and nothing about Pythia.
 *
 * Drawn on Lucide's 24-unit grid at stroke 2 with round caps, so it sits in a
 * row of Obsidian's built-in icons without standing out. `addIcon` draws inside
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

export const PYTHIA_ICON_SVG =
	`<g transform="scale(${SCALE})" fill="none" stroke="currentColor" stroke-width="2" ` +
	`stroke-linecap="round" stroke-linejoin="round">${ARTWORK}</g>`;

/** Called once in `onload()`, before anything asks for the icon by name. */
export function registerPythiaIcon(): void {
	addIcon(PYTHIA_ICON_ID, PYTHIA_ICON_SVG);
}
