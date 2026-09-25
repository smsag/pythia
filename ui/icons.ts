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
 * The ONE icon for a Markdown note from the vault, however it got into the
 * conversation (ADR-212). Attached with `#` or the paperclip, pulled in by vault
 * context, cited under an answer, written by this conversation, or linked in a
 * sent message: it is a note from your vault, and it looks like one.
 *
 * ADR-193 gave each a different glyph — the icon of the control that brought it
 * in — which made the same file look like three different things depending on
 * the route it took. What a reference IS outranks how it arrived. Where the
 * route still matters, it is carried by style, not by the glyph: an
 * auto-retrieved pill is `.p-wikilink--auto` and has no ×.
 */
export const VAULT_NOTE_ICON = "library";

/**
 * Where a reference comes from, as one icon per source type (ADR-193, ADR-212).
 *
 * Every vault note — `note`, `auto`, `output` — is `VAULT_NOTE_ICON`. The kinds
 * stay separate keys because the callers still mean different things by them
 * (removable or not, delete the file or detach it); only the glyph is shared.
 * The template, the web and the rewrite target are not vault notes in that
 * sense and keep the icon of the control that brings them in. Brackets
 * (`[[ ]]`), bold-for-template and a trailing `↗` did this job three different
 * ways; tests/linkIcons.test.ts fails if one of them returns.
 *
 * The toolbar buttons read their icons from here too, so the two cannot drift.
 */
export const SOURCE_ICONS = {
	/** A note the user attached (and a cited vault note). */
	note: VAULT_NOTE_ICON,
	/** A note vault search pulled in — the vault-context toggle. */
	auto: VAULT_NOTE_ICON,
	/** A template — the template button. */
	template: "layout-template",
	/** A web page — the web-search toggle. */
	web: "globe",
	/** A note this conversation wrote. */
	output: VAULT_NOTE_ICON,
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

/**
 * Lead every note link in a rendered user message with the vault-note icon
 * (ADR-212). The stored text stays `[[Name]]` — that is what the model reads and
 * what a saved or archived note keeps as a link — so this is drawing only. The
 * icon adds no text, so the favorite and fork painters, which match on text,
 * see the bubble exactly as before.
 */
export function decorateNoteLinks(root: HTMLElement): void {
	for (const link of Array.from(root.querySelectorAll<HTMLElement>("a.internal-link"))) {
		if (link.querySelector(".p-source-icon")) continue;
		const icon = appendSourceIcon(link, "note");
		link.prepend(icon);
		link.addClass("p-note-link");
	}
}
