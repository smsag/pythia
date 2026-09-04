import { Setting } from "obsidian";
import type PythiaPlugin from "../main";
import { t } from "../i18n";
import { EMBEDDING_MODELS, type EmbeddingModelId, type RelatedSimilarity } from "../models/embeddingModels";

/**
 * On-device embedding settings, extracted from the settings tab (ADR-119): the
 * shared embedding model + "related conversations" similarity, plus the
 * vault-context (semantic RAG) controls — enable-by-default, the folders to index
 * (empty = whole vault), and a "Rebuild index" action with a live status line.
 */
export function renderEmbeddingSettings(containerEl: HTMLElement, plugin: PythiaPlugin): void {
	new Setting(containerEl)
		.setName(t("embeddingModelName"))
		.setDesc(t("embeddingModelDesc"))
		.addDropdown((drop) => {
			for (const m of Object.values(EMBEDDING_MODELS)) drop.addOption(m.id, m.label);
			drop
				.setValue(plugin.settings.embeddingModelId)
				.onChange(async (value) => {
					plugin.settings.embeddingModelId = value as EmbeddingModelId;
					await plugin.saveSettings();
					plugin.invalidateRelatedService();
				});
		});

	new Setting(containerEl)
		.setName(t("relatedSimilarityName"))
		.setDesc(t("relatedSimilarityDesc"))
		.addDropdown((drop) =>
			drop
				.addOption("strict", t("relatedSimilarityStrict"))
				.addOption("balanced", t("relatedSimilarityBalanced"))
				.addOption("loose", t("relatedSimilarityLoose"))
				.setValue(plugin.settings.relatedSimilarity)
				.onChange(async (value) => {
					plugin.settings.relatedSimilarity = value as RelatedSimilarity;
					await plugin.saveSettings();
				})
		);

	// ── Vault context (semantic RAG) ──────────────────────────────────────────
	new Setting(containerEl).setName(t("vaultContextSectionName")).setHeading();

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
				.onChange(async (value) => {
					plugin.settings.vaultContextFolders = value
						.split("\n")
						.map((s) => s.trim())
						.filter(Boolean);
					await plugin.saveSettings();
				})
		);

	new Setting(containerEl)
		.setName(t("vaultContextMaxNotesName"))
		.setDesc(t("vaultContextMaxNotesDesc"))
		.addText((txt) =>
			txt
				.setPlaceholder("5000")
				.setValue(String(plugin.settings.vaultContextMaxIndexedNotes))
				.onChange(async (value) => {
					const n = Number.parseInt(value, 10);
					plugin.settings.vaultContextMaxIndexedNotes = Number.isFinite(n) && n >= 0 ? n : 0;
					await plugin.saveSettings();
				})
		);

	// Rebuild action + a status line that reflects the current index state.
	const status = new Setting(containerEl)
		.setName(t("vaultContextReindexName"))
		.setDesc(plugin.getVaultIndexStatus());
	status.addButton((btn) =>
		btn
			.setButtonText(t("vaultContextReindexBtn"))
			.onClick(() => {
				void plugin.reindexVault();
				// Reflect the new status shortly after the rebuild kicks off.
				window.setTimeout(() => status.setDesc(plugin.getVaultIndexStatus()), 400);
			})
	);
}
