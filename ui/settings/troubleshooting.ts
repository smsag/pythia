import { section, toggleRow, type SettingsContext } from "./context";
import { t } from "../../i18n";

/**
 * Troubleshooting (ADR-209) — last, and deliberately small.
 *
 * One row is fine here in a way it was not for the old one-row "Defaults"
 * section: this one sits at the end and governs nothing above it, whereas
 * "Defaults" held the single choice that decided which of the three provider
 * sections *preceding* it mattered.
 *
 * Debug mode was previously emitted after the embedding block, so it read as a
 * vault-context setting. It belongs with the other answer to "it is not working",
 * and the intro points at the index status row for the case that actually
 * generates most of those questions.
 */
export function renderTroubleshootingSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	section(containerEl, t("troubleshootingSection"), t("troubleshootingIntro"));
	toggleRow(ctx, containerEl, t("debugModeName"), t("debugModeDesc"), "debugMode");
}
