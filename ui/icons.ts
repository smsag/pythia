import { setIcon } from "obsidian";

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

/**
 * Where a reference comes from, as one icon per source type (ADR-193).
 *
 * A reference leads with the icon of the control that brings it in: the
 * template button, the vault-context toggle, the web-search toggle, the save
 * button — so the toolbar and every place a reference is listed (reference row,
 * sources under an answer, context box) speak the same language. Brackets
 * (`[[ ]]`), bold-for-template and a trailing `↗` did this job three different
 * ways; tests/linkIcons.test.ts fails if one of them returns.
 *
 * The toolbar buttons read their icons from here too, so the two cannot drift.
 */
export const SOURCE_ICONS = {
	/** A note the user attached (and a cited vault note). */
	note: "file-text",
	/** A note vault search pulled in — the vault-context toggle. */
	auto: "library",
	/** A template — the template button. */
	template: "layout-template",
	/** A web page — the web-search toggle. */
	web: "globe",
	/** A note this conversation wrote — the save button's floppy. */
	output: "save",
	/** The passage a rewrite will replace. */
	rewrite: "pencil-line",
} as const;

export type SourceKind = keyof typeof SOURCE_ICONS;

/** The leading 12px icon of a reference; decorative, the name next to it is the link. */
export function appendSourceIcon(parent: HTMLElement, kind: SourceKind): HTMLElement {
	const el = parent.createSpan({ cls: "p-source-icon", attr: { "aria-hidden": "true" } });
	setIcon(el, SOURCE_ICONS[kind]);
	return el;
}
