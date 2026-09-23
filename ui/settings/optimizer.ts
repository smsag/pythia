import { Setting } from "obsidian";
import type { PythiaSettings } from "../../models/settings";
import { FileSuggestModal } from "../../suggest/FileSuggest";
import { section, toggleRow, type SettingsContext } from "./context";
import { t } from "../../i18n";

const FRAMEWORKS: PythiaSettings["defaultPromptFramework"][] = ["none", "CO-STAR", "RACE", "RISEN"];

/** Prompt optimizer (ADR-206): the one section that was already a section, kept. */
export function renderOptimizerSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	section(containerEl, t("promptOptimizerSection"), t("promptOptimizerIntro"));
	const { plugin } = ctx;

	let templateField: { setValue(v: string): void } | undefined;
	new Setting(containerEl)
		.setName(t("promptOptimizerTemplateName"))
		.setDesc(t("promptOptimizerTemplateDesc"))
		.addText((text) => {
			templateField = text;
			text.setPlaceholder(t("promptOptimizerTemplateNone"))
				.setValue(plugin.settings.promptOptimizerTemplateId ?? "")
				.onChange((value) => {
					plugin.settings.promptOptimizerTemplateId = value.trim();
					ctx.saveSoon();
				});
		})
		.addButton((btn) => {
			btn.setButtonText(t("browse")).onClick(() => {
				new FileSuggestModal(plugin.app, async (file) => {
					plugin.settings.promptOptimizerTemplateId = file.path;
					await plugin.saveSettings();
					templateField?.setValue(file.path);
				}).open();
			});
		});

	new Setting(containerEl)
		.setName(t("promptFrameworkLabel"))
		.setDesc(t("promptFrameworkDesc"))
		.addDropdown((drop) => {
			drop.addOption("none", t("promptFrameworkNone"));
			for (const f of FRAMEWORKS.slice(1)) drop.addOption(f, f);
			// A value from disk that is not one of the four reads as "none" rather
			// than selecting nothing (principle 1).
			const stored = plugin.settings.defaultPromptFramework;
			drop
				.setValue(FRAMEWORKS.includes(stored) ? stored : "none")
				.onChange(async (value) => {
					plugin.settings.defaultPromptFramework = value as PythiaSettings["defaultPromptFramework"];
					await plugin.saveSettings();
				});
		});

	toggleRow(ctx, containerEl, t("optimizerSuggestsModelName"), t("optimizerSuggestsModelDesc"), "optimizerSuggestsModel");
}
