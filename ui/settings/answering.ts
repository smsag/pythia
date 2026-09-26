import { TAVILY_MAX_RESULTS } from "../../services/WebSearchService";
import { numberRow, section, toggleRow, type SettingsContext } from "./context";
import { Setting } from "obsidian";
import { renderPricingSettings } from "../pricingSettings";
import { t } from "../../i18n";

/**
 * While answering — the global rules (ADR-209).
 *
 * The counterpart to "New conversations": nothing here can be set for a single
 * conversation, so no row carries the inheritance sentence. That is the whole
 * distinction the tab is built on, and it is why `customInstructions` sits here
 * rather than with the defaults — it applies to conversations already underway,
 * not only to new ones.
 *
 * It is also where two orphans landed: before ADR-209 `customInstructions` and
 * "Debug mode" were emitted AFTER the embedding block, which creates its own
 * headings, so both read on screen as vault-context settings.
 */
export function renderAnsweringSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	section(containerEl, t("answeringSection"), t("answeringIntro"));
	const { plugin } = ctx;

	new Setting(containerEl)
		.setName(t("customInstructionsName"))
		.setDesc(t("customInstructionsDesc"))
		.addTextArea((text) => {
			text
				.setPlaceholder(t("customInstructionsPlaceholder"))
				.setValue(plugin.settings.customInstructions)
				.onChange((value) => {
					plugin.settings.customInstructions = value;
					ctx.saveSoon();
				});
			text.inputEl.rows = 4;
			text.inputEl.addClass("pythia-settings-textarea");
		});

	toggleRow(ctx, containerEl, t("webSearchAutoArmName"), t("webSearchAutoArmDesc"), "webSearchAutoArm");

	numberRow(ctx, containerEl, t("webSearchMaxResultsName"), t("webSearchMaxResultsDesc"), {
		placeholder: "5",
		// Tavily's own ceiling, named in the description and refused here rather
		// than clamped behind the user's back (ADR-228).
		rule: { min: 0, max: TAVILY_MAX_RESULTS },
		read: () => plugin.settings.webSearchMaxResults,
		write: (n) => { plugin.settings.webSearchMaxResults = n ?? 0; ctx.saveSoon(); },
	});

	numberRow(ctx, containerEl, t("maxAttachedNotesTokensName"), t("maxAttachedNotesTokensDesc"), {
		placeholder: "8000",
		rule: { min: 0 },
		read: () => plugin.settings.maxAttachedNotesTokens,
		write: (n) => { plugin.settings.maxAttachedNotesTokens = n ?? 0; ctx.saveSoon(); },
	});

	toggleRow(ctx, containerEl, t("injectActiveNoteOnTemplateName"), t("injectActiveNoteOnTemplateDesc"), "injectActiveNoteOnTemplate");

	// The cost toggle carries its own disclaimer (ADR-163) — estimate, not bill.
	renderPricingSettings(containerEl, plugin);
}
