import { Setting } from "obsidian";
import { renderGlossarySettings } from "../glossarySettings";
import { folderRow, section, type SettingsContext } from "./context";
import { t } from "../../i18n";

/**
 * Notes Pythia writes — the places in the vault the user goes on to read and edit
 * themselves (ADR-209).
 *
 * This replaces the old "Vault folders" section, which grouped by value *type*:
 * every folder picker in one place, which is why the archive folder had to be
 * exiled into "Behaviour" next to the toggle that uses it, and why the glossary's
 * three rows arrived here with no heading at all and read as folder settings.
 *
 * The rule now is that **a folder lives with the feature that writes to it**. The
 * conversations and archive folders are therefore in "History and storage", and
 * the indexed folders stay in the vault-context block.
 *
 * The default-notes folder is one of the vault index's two skip folders, so moving
 * it changes what the index is an index of and repaints the status row (#367) —
 * which is what `ctx.refreshIndexStatus` exists for.
 */
export function renderNotesSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	section(containerEl, t("notesSection"), t("notesIntro"));

	folderRow(ctx, containerEl, t("templatesFolderName"), t("templatesFolderDesc"), "templatesFolder");
	folderRow(ctx, containerEl, t("scratchFolderName"), t("scratchFolderDesc"), "scratchFolder", ctx.refreshIndexStatus);

	new Setting(containerEl)
		.setName(t("inboxNoteName"))
		.setDesc(t("inboxNoteDesc"))
		.addText((text) =>
			text
				.setPlaceholder("Pythia/Inbox.md")
				.setValue(ctx.plugin.settings.inboxNote)
				.onChange((value) => {
					ctx.plugin.settings.inboxNote = value.trim();
					ctx.saveSoon();
				})
		);

	// The glossary is its own heading now; it used to be three unlabelled rows at
	// the end of the folder section.
	section(containerEl, t("glossarySection"), t("glossaryIntro"));
	renderGlossarySettings(containerEl, ctx.plugin);
}
