import { Notice, Setting } from "obsidian";
import type PythiaPlugin from "../main";
import { t } from "../i18n";

/**
 * Glossary settings, extracted from the settings tab (ADR-150, following the
 * `renderEmbeddingSettings` precedent of ADR-119).
 *
 * Three controls, in the order a user meets them: where the glossary folder is,
 * the one-off migration out of the pre-2.14 single note, and the path of that
 * old note — last, because it is only still here to be read from.
 */
export function renderGlossarySettings(containerEl: HTMLElement, plugin: PythiaPlugin): void {
	new Setting(containerEl)
		.setName(t("glossaryFolderName"))
		.setDesc(t("glossaryFolderDesc"))
		.addText((text) =>
			text
				.setPlaceholder("Glossary")
				.setValue(plugin.settings.glossaryFolder)
				.onChange((value) => {
					plugin.settings.glossaryFolder = value.trim();
					plugin.saveSettingsSoon();
					// The service caches entries read from the old folder.
					plugin.glossaryService?.invalidate();
				})
		);

	new Setting(containerEl)
		.setName(t("glossaryMigrateName"))
		.setDesc(t("glossaryMigrateDesc"))
		.addButton((btn) =>
			btn.setButtonText(t("glossaryMigrateBtn")).onClick(async () => {
				// Disabled for the duration: the migration writes one note per term
				// and a second concurrent run would race its own merges.
				btn.setDisabled(true);
				try {
					const { migrated, total } = await plugin.glossaryService.migrateLegacyNote();
					new Notice(t("glossaryMigrateDone", { migrated, total }));
				} catch (e) {
					new Notice(t("glossaryMigrateFailed", { error: e instanceof Error ? e.message : String(e) }));
				} finally {
					btn.setDisabled(false);
				}
			})
		);

	new Setting(containerEl)
		.setName(t("glossaryNoteName"))
		.setDesc(t("glossaryNoteDesc"))
		.addText((text) =>
			text
				.setPlaceholder("Pythia/Glossary.md")
				.setValue(plugin.settings.glossaryNote)
				.onChange((value) => {
					plugin.settings.glossaryNote = value.trim();
					plugin.saveSettingsSoon();
					plugin.glossaryService?.invalidate();
				})
		);
}
