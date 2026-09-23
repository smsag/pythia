import { Setting } from "obsidian";
import { bindNumberSetting } from "./numberSetting";
import type PythiaPlugin from "../main";
import { t } from "../i18n";
import {
	EMBEDDING_MODELS, SELECTABLE_EMBEDDING_MODEL_IDS, embeddingModelConfig, effectiveEmbeddingModel,
	type EmbeddingModelId, type SimilarityPreset,
} from "../models/embeddingModels";
import { renderVaultIndexStatus } from "./vaultIndexStatusSetting";
import { section } from "./settings/section";

/**
 * On-device embedding settings, extracted from the settings tab (ADR-119): the
 * shared embedding model + "related conversations" similarity, plus the
 * vault-context (semantic RAG) controls — enable-by-default, the folders to index
 * (empty = whole vault), and the live index status with its two actions
 * (ADR-199). Each section opens with a plain explanation of what it does.
 *
 * **Every control here that changes what the index is an index OF refreshes the
 * status row** (#367). The row disables "Build now" while the index is ready and
 * repaints only on index events, so a setting that moves the scope without
 * repainting leaves the user looking at "Ready" with the one non-destructive
 * action greyed out — which is what adding a second folder did. The scope is
 * `VaultRagService.scopeSignature`: the indexed folders, the note cap and the
 * model here; the two skip folders are picked in the tab's own folder section,
 * which are picked in other sections of the tab and reach this refresh through
 * `SettingsContext.refreshIndexStatus` — which is why the refresh is RETURNED
 * (ADR-209, closing review #367's remainder).
 */
export function renderEmbeddingSettings(
	containerEl: HTMLElement,
	plugin: PythiaPlugin,
	/** Collects each numeric field's commit so the tab can flush it in `hide()` —
	 *  closing the tab destroys the input before `blur` fires. */
	registerCommit: (commit: () => void) => void = () => {},
): () => void {
	section(containerEl, t("embeddingSectionName"), t("embeddingIntro"));

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
	section(containerEl, t("vaultContextSectionName"), t("vaultContextIntro"));

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
					// The scope just moved: the index is out of date and Build now has
					// something to do again (#367). Cheap — the status reads a remembered
					// header rather than the index file (#361).
					refreshStatus();
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
					refreshStatus(); // the cap is part of the scope (#367)
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

	return refreshStatus;
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
