import { t } from "../i18n";

/**
 * The built-in rewrite presets (ADR-247): a label and the instruction sent
 * with the passage, both in the UI's language — read when the picker opens,
 * so a language switch applies. The user's own presets are templates with
 * `rewrite_preset: true`.
 */
export interface RewritePreset {
	id: string;
	label: () => string;
	instruction: () => string;
}

export const REWRITE_PRESETS: readonly RewritePreset[] = [
	{ id: "shorter", label: () => t("rewritePresetShorter"), instruction: () => t("rewritePresetShorterDo") },
	{ id: "clearer", label: () => t("rewritePresetClearer"), instruction: () => t("rewritePresetClearerDo") },
	{ id: "formal",  label: () => t("rewritePresetFormal"),  instruction: () => t("rewritePresetFormalDo") },
	{ id: "english", label: () => t("rewritePresetEnglish"), instruction: () => t("rewritePresetEnglishDo") },
];
