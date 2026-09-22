import { Setting } from "obsidian";
import { bindNumberSetting } from "./numberSetting";
import type PythiaPlugin from "../main";
import { t } from "../i18n";
import {
	EMBEDDING_MODELS, SELECTABLE_EMBEDDING_MODEL_IDS, embeddingModelConfig, effectiveEmbeddingModel,
	type EmbeddingModelId, type SimilarityPreset,
} from "../models/embeddingModels";
import { renderVaultIndexStatus } from "./vaultIndexStatusSetting";

/**
 * On-device embedding settings, extracted from the settings tab (ADR-119): the
 * shared embedding model + "related conversations" similarity, plus the
 * vault-context (semantic RAG) controls — enable-by-default, the folders to index
 * (empty = whole vault), and the live index status with its two actions
 * (ADR-199). Each section opens with a plain explanation of what it does.
 */
export function renderEmbeddingSettings(
	containerEl: HTMLElement,
	plugin: PythiaPlugin,
	/** Collects each numeric field's commit so the tab can flush it in `hide()` —
	 *  closing the tab destroys the input before `blur` fires. */
	registerCommit: (commit: () => void) => void = () => {},
): void {
	new Setting(containerEl).setName(t("embeddingSectionName")).setHeading();
	new Setting(containerEl).setDesc(t("embeddingIntro"));

	// The model row reads the setting — it is the one place that edits it — and
	// says what this device will actually run (ADR-199).
	const modelRow = new Setting(containerEl).setName(t("embeddingModelName"));
	const describeModel = (): void => { modelRow.setDesc(modelDescription(plugin)); };
	describeModel();
	let refreshStatus: () => void = () => {};
	modelRow.addDropdown((drop) => {
		// Variants are never offered: the device picks them (ADR-200).
		for (const id of SELECTABLE_EMBEDDING_MODEL_IDS) drop.addOption(id, EMBEDDING_MODELS[id].label);
		drop
			.setValue(plugin.settings.embeddingModelId)
			.onChange(async (value) => {
				plugin.settings.embeddingModelId = value as EmbeddingModelId;
				await plugin.saveSettings();
				plugin.invalidateRelatedService();
				describeModel();
				refreshStatus();
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
					plugin.settings.relatedSimilarity = value as SimilarityPreset;
					await plugin.saveSettings();
				})
		);

	// ── Vault context (semantic RAG) ──────────────────────────────────────────
	new Setting(containerEl).setName(t("vaultContextSectionName")).setHeading();
	new Setting(containerEl).setDesc(t("vaultContextIntro"));

	// Status first: it is what the rest of the section is about.
	refreshStatus = renderVaultIndexStatus(containerEl, plugin);

	new Setting(containerEl)
		.setName(t("vaultContextEnabledName"))
		.setDesc(t("vaultContextEnabledDesc"))
		.addToggle((tog) =>
			tog
				.setValue(plugin.settings.vaultContextEnabled)
				.onChange(async (value) => {
					plugin.settings.vaultContextEnabled = value;
					await plugin.saveSettings();
					refreshStatus();
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

	// The ONE numeric field that still committed per keystroke, with a rejected
	// entry falling back to 0 — which here means UNLIMITED. Clearing the box to
	// retype therefore uncapped the index (ADR-171's rule, ADR-182's fix).
	new Setting(containerEl)
		.setName(t("vaultContextMaxNotesName"))
		.setDesc(t("vaultContextMaxNotesDesc"))
		.addText((txt) => {
			registerCommit(bindNumberSetting(txt, {
				rule: { min: 0 },
				read: () => plugin.settings.vaultContextMaxIndexedNotes,
				write: (n) => {
					plugin.settings.vaultContextMaxIndexedNotes = n;
					plugin.saveSettingsSoon();
				},
			}));
		});

	// How many retrieved notes reach a turn. Exposed in ADR-183; the strictness
	// preset beside it deliberately is NOT, because `vaultRetrievalMinScore`'s
	// three constants have never been measured (D-13) — a control over a number
	// nobody can justify is worse than no control.
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

/** The model row's explanation: what the two models are, plus — when the chosen
 *  one cannot run on a phone — which one this device uses instead (ADR-199). */
function modelDescription(plugin: PythiaPlugin): string {
	const vars = {
		multiMb: EMBEDDING_MODELS["xenova-paraphrase-multilingual-MiniLM-L12-v2"].downloadMb,
		enMb: EMBEDDING_MODELS["xenova-all-MiniLM-L6-v2"].downloadMb,
	};
	const chosen = embeddingModelConfig(plugin.settings.embeddingModelId);
	const active = embeddingModelConfig(plugin.activeEmbeddingModelId());
	// What a phone runs for this choice — the same answer whichever device shows
	// the note, so the desktop can say what the phone will do (ADR-199/199).
	const onPhone = embeddingModelConfig(effectiveEmbeddingModel(chosen.id, true));
	const names = { model: onPhone.label, chosen: chosen.label };
	const notes: string[] = [t("embeddingModelDesc", vars)];
	if (active.id !== chosen.id) notes.push(t("embeddingModelMobileNote", names));
	else if (onPhone.id !== chosen.id) notes.push(t("embeddingModelDesktopNote", names));
	if (onPhone.id !== chosen.id && onPhone.variantNote === "latinScript") notes.push(t("embeddingModelLatinNote"));
	return notes.join(" ");
}
