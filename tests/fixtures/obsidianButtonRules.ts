/**
 * The shapes of Obsidian's own rules that reach a Pythia button — the
 * selectors and the properties they set, read from Obsidian 1.13.7's app.css
 * by `npm run check:obsidian-cascade` (scripts/obsidian-button-rules.mjs).
 *
 * The VALUES are sentinels, not Obsidian's: a test can then tell "our rule
 * won" from "theirs leaked in" by value alone. Keep the selector list in step
 * with the script's output; the script exits non-zero when they drift.
 */
export const OBSIDIAN_VERSION = "1.13.7";

export const SENTINEL = {
	height: "37px",
	tabletPadding: "17px 19px",
	phonePadding: "13px",
	phoneWidth: "333px",
	opacity: "0.7",
	fill: "rgb(240, 240, 240)",
	hoverFill: "rgb(225, 225, 225)",
	label: "rgb(30, 30, 30)",
	radius: "11px",
	shadow: "rgb(1, 2, 3) 0px 0px 0px 3px",
} as const;

/** One entry per rule, as `selector { properties }` with sentinel values. `:hover`
 *  appears as written; the test swaps it for a class of equal specificity. */
export const OBSIDIAN_BUTTON_RULES = `
button { display: inline-flex; align-items: center; justify-content: center; color: ${SENTINEL.label}; font-size: 13px; border-radius: ${SENTINEL.radius}; border: 0; padding: 4px 12px; height: ${SENTINEL.height}; font-weight: 700; cursor: pointer; font-family: inherit; outline: none; user-select: none; white-space: nowrap; }
button:not(.clickable-icon) { color: ${SENTINEL.label}; background-color: ${SENTINEL.fill}; box-shadow: ${SENTINEL.shadow}; }
@media (hover: hover) { button:hover { background-color: ${SENTINEL.hoverFill}; box-shadow: ${SENTINEL.shadow}; } }
button:focus-visible { box-shadow: ${SENTINEL.shadow}; }
button[disabled] { cursor: not-allowed; opacity: ${SENTINEL.opacity}; }
button[aria-disabled="true"] { cursor: not-allowed; opacity: ${SENTINEL.opacity}; }
button[disabled="true"] { cursor: not-allowed; opacity: ${SENTINEL.opacity}; }
.is-tablet button:not(.clickable-icon) { padding: ${SENTINEL.tabletPadding}; }
.is-phone .modal .setting-item-control button:not(.clickable-icon) { width: ${SENTINEL.phoneWidth}; margin: 0; }
.is-phone .modal .setting-item-control button { padding: ${SENTINEL.phonePadding}; }
`;

/** The selectors above, for the drift check. */
export const OBSIDIAN_BUTTON_SELECTORS = [
	"button",
	"button:not(.clickable-icon)",
	"button:hover",
	"button:focus-visible",
	"button[disabled]",
	"button[aria-disabled=\"true\"]",
	"button[disabled=\"true\"]",
	".is-tablet button:not(.clickable-icon)",
	".is-phone .modal .setting-item-control button:not(.clickable-icon)",
	".is-phone .modal .setting-item-control button",
];
