import { Setting } from "obsidian";
import { t } from "../../i18n";

/**
 * The two pieces of grammar every settings section shares (ADR-209). They live
 * apart from `context.ts` because the embedding section uses them and must not
 * drag the plugin-bound helpers (and their modal imports) in with them.
 */

/**
 * A section heading and the one sentence that says what the section is for.
 *
 * The intro is not decoration: before ADR-209 the embedding block was the only
 * part of the tab that named its own remit, and the two sections that did not —
 * "Behaviour" and "Features" — had become the places rows went when nobody
 * decided where they belonged. A section with no sentence to write has no remit.
 *
 * This is also the ONE way a heading is made. The tab mixed raw `createEl("h3")`
 * with Obsidian's `setHeading()`, which do not render alike, so one idea had two
 * visual tiers; `tests/settingsIA.test.ts` fails on an `h3` in settings code.
 */
export function section(containerEl: HTMLElement, name: string, intro: string): void {
	new Setting(containerEl).setName(name).setHeading();
	// Plain text, not a Setting: Obsidian draws a row with only a description in
	// a box like the settings under it, so the sentence about the section read
	// as one more of its rows.
	containerEl.createDiv({ cls: "setting-item-description pythia-section-intro", text: intro });
}

/**
 * The description of a row a single conversation can override, with the sentence
 * that says so appended.
 *
 * One string, one place: principle 6 ("inherited stays inherited") is enforced in
 * the code and was invisible in the UI — nothing told the reader that the header's
 * effort and language segments, or the conversation dialog's provider, model,
 * temperature and token limit, sit on top of these values without changing them.
 * Every row of the "New conversations" section carries it and no row outside that
 * section may; a test holds both halves.
 */
export function overridable(desc: string): string {
	return `${desc} ${t("overridablePerConv")}`;
}
