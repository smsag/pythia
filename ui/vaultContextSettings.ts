import { Setting } from "obsidian";
import { bindNumberSetting } from "./numberSetting";
import type PythiaPlugin from "../main";
import { t } from "../i18n";
import { section } from "./settings/section";

/**
 * Vault context (ADR-116, ADR-224): whether a turn draws notes from the vault
 * by default, from which folders, and how many.
 *
 * Finding them is Schreibstube's search by meaning — Pythia loads no model of
 * its own — so the section opens with whether that search is there. Without
 * it the switch still stores the choice, and turns go out with the notes
 * attached by hand.
 */
export function renderVaultContextSettings(
	containerEl: HTMLElement,
	plugin: PythiaPlugin,
	/** Collects each numeric field's commit so the tab can flush it in `hide()` —
	 *  closing the tab destroys the input before `blur` fires. */
	registerCommit: (commit: () => void) => void = () => {},
): void {
	section(containerEl, t("vaultContextSectionName"), t("vaultContextIntro"));

	new Setting(containerEl)
		.setName(t("vaultContextSourceName"))
		.setDesc(plugin.schreibstube.available() ? t("vaultContextSourceReady") : t("vaultContextSourceMissing"));

	new Setting(containerEl)
		.setName(t("vaultContextEnabledName"))
		.setDesc(t("vaultContextEnabledDesc"))
		.addToggle((tog) =>
			tog
				.setValue(plugin.settings.vaultContextEnabled)
				.onChange(async (value) => {
					plugin.settings.vaultContextEnabled = value;
					await plugin.saveSettings();
				})
		);

	new Setting(containerEl)
		.setName(t("vaultContextFoldersName"))
		.setDesc(t("vaultContextFoldersDesc"))
		.addTextArea((area) =>
			area
				.setPlaceholder("Product Practice\nInsights")
				.setValue(plugin.settings.vaultContextFolders.join("\n"))
				.onChange((value) => {
					plugin.settings.vaultContextFolders = value
						.split("\n")
						.map((s) => s.trim().replace(/\/+$/, ""))
						.filter(Boolean);
					plugin.saveSettingsSoon();
				})
		);

	// How many found notes reach a turn (ADR-183).
	new Setting(containerEl)
		.setName(t("vaultContextNotesPerTurnName"))
		.setDesc(t("vaultContextNotesPerTurnDesc"))
		.addText((txt) => {
			registerCommit(bindNumberSetting(txt, {
				rule: { min: 1, max: 20 },
				read: () => plugin.settings.vaultContextMaxNotes,
				write: (n) => {
					plugin.settings.vaultContextMaxNotes = n;
					plugin.saveSettingsSoon();
				},
			}));
		});
}
