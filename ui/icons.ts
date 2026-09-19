/**
 * Obsidian icon ids that carry one meaning across the plugin.
 *
 * Every control that re-runs a generation or a rebuild — rename with AI,
 * regenerate a summary on the card or on a fork/merge anchor, define a term
 * again, rebuild the vault index — shows the same glyph, so the same verb
 * looks the same wherever it sits. Two glyphs (`refresh-cw` and `rotate-cw`)
 * had crept in for it; tests/icons.test.ts fails if a second one returns.
 */
export const REGENERATE_ICON = "refresh-cw";
