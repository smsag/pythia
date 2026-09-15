import { t } from "../i18n";
import { OUTPUT_LANGUAGES, type OutputLanguage } from "../models/types";

/**
 * The language dropdown's options, shared by the global setting and the
 * per-conversation override (ADR-148).
 *
 * One list, one order, in one module: the override's job is to name the same
 * languages as the default it overrides, and two hand-maintained copies is how
 * that stops being true.
 *
 * Each entry is a thunk rather than a string so the labels are translated when
 * the dropdown is built, not when this module is first imported — and so the
 * `t("…")` calls stay literal for the dead-key check in tests/i18n.test.ts.
 */
const OPTION_LABELS: Record<OutputLanguage, () => string> = {
	obsidian: () => t("outputLanguageObsidian"),
	auto: () => t("outputLanguageAuto"),
	de: () => t("outputLanguageGerman"),
	en: () => t("outputLanguageEnglish"),
	it: () => t("outputLanguageItalian"),
	es: () => t("outputLanguageSpanish"),
};

/** Translated label for one language setting value. */
export function languageOptionLabel(lang: OutputLanguage): string {
	return OPTION_LABELS[lang]();
}

/** The options in display order, as `[value, label]` pairs. */
export function languageOptions(): [OutputLanguage, string][] {
	return OUTPUT_LANGUAGES.map((lang) => [lang, languageOptionLabel(lang)]);
}
