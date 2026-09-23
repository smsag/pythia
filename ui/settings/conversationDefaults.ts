import { Setting } from "obsidian";
import type { EffortLevel, OutputLanguage, Provider } from "../../models/types";
import type { PythiaSettings } from "../../models/settings";
import { KNOWN_MODELS, parameterSupport, resolveDefaultModelForProvider } from "../../models/knownModels";
import { DEFAULT_MAX_TOKENS } from "../../services/promptConstants";
import { languageOptions } from "../languageOptions";
import { numberRow, overridable, section, toggleRow, type SettingsContext } from "./context";
import { t } from "../../i18n";

/** The setting holding each provider's default model — one mapping, not three copies. */
const MODEL_KEY: Record<Provider, "defaultAnthropicModel" | "defaultOpenAIModel" | "defaultMistralModel"> = {
	anthropic: "defaultAnthropicModel",
	openai: "defaultOpenAIModel",
	mistral: "defaultMistralModel",
};

const PROVIDER_LABEL: Record<Provider, () => string> = {
	anthropic: () => t("providerAnthropic"),
	openai: () => t("providerOpenAI"),
	mistral: () => t("providerMistral"),
};

/**
 * New conversations — what a fresh conversation inherits (ADR-206).
 *
 * This is the section the whole tab is organised around: **every row here can be
 * overridden for one conversation, and no row outside it can.** That is principle
 * 6 ("inherited stays inherited") made visible — it was enforced in the code and
 * stated nowhere, so nothing told a reader that the header's effort and language
 * segments, and the conversation dialog's provider, model, temperature and token
 * limit, sit on top of these values without changing them.
 *
 * `overridable()` writes that sentence onto every row, and `tests/settingsIA.test.ts`
 * fails if a row here loses it or a row elsewhere gains it.
 *
 * The model is ONE row, for the provider chosen above it, rather than one row per
 * provider: three providers with a default model each meant three headings, and
 * the row that decided which of them mattered sat below all of them in a one-row
 * "Defaults" section. Another provider's model is reachable by switching the
 * provider — stated in the row's own description.
 */
export function renderNewConversationsSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	section(containerEl, t("newConvSection"), t("newConvIntro"));
	const { plugin } = ctx;

	// Assigned below, after the temperature and effort rows it gates; the handlers
	// that call it only ever fire on interaction, which is after that point.
	let refreshParamAvailability: () => void = () => {};

	new Setting(containerEl)
		.setName(t("defaultProviderName"))
		.setDesc(overridable(t("defaultProviderDesc")))
		.addDropdown((drop) => {
			for (const p of Object.keys(MODEL_KEY) as Provider[]) drop.addOption(p, PROVIDER_LABEL[p]());
			drop
				.setValue(plugin.settings.defaultProvider)
				.onChange(async (value) => {
					plugin.settings.defaultProvider = value as Provider;
					await plugin.saveSettings();
					paintModelRow();
					refreshParamAvailability();
				});
		});

	// The model row is rebuilt rather than mutated when the provider changes: its
	// option list, its stored value and its custom-id input all belong to one
	// provider, and a half-updated row is how the previous three rows drifted.
	const modelHost = containerEl.createDiv();
	const paintModelRow = (): void => {
		modelHost.empty();
		renderModelRow(modelHost, ctx, () => refreshParamAvailability());
	};
	paintModelRow();

	const effortSetting = new Setting(containerEl)
		.setName(t("effortName"))
		.addDropdown((drop) => {
			drop.addOption("", t("effortUnsetOption"));
			drop.addOption("low", t("effortLevelLow"));
			drop.addOption("medium", t("effortLevelMedium"));
			drop.addOption("high", t("effortLevelHigh"));
			drop.setValue(plugin.settings.effort ?? "");
			drop.onChange(async (value) => {
				plugin.settings.effort = value === "" ? undefined : (value as EffortLevel);
				await plugin.saveSettings();
			});
		});

	const temperatureSetting = numberRow(ctx, containerEl, t("temperatureName"), "", {
		placeholder: "0.0 – 1.0",
		rule: { min: 0, max: 1, decimal: true, allowEmpty: true },
		read: () => plugin.settings.temperature,
		write: (n) => { plugin.settings.temperature = n; ctx.saveSoon(); },
	});

	refreshParamAvailability = (): void => updateParamAvailability(plugin.settings, temperatureSetting, effortSetting);
	refreshParamAvailability();

	numberRow(ctx, containerEl, t("maxTokensName"), overridable(t("maxTokensDesc")), {
		placeholder: String(DEFAULT_MAX_TOKENS),
		rule: { min: 1, allowEmpty: true },
		read: () => plugin.settings.maxTokens,
		write: (n) => { plugin.settings.maxTokens = n; ctx.saveSoon(); },
	});

	new Setting(containerEl)
		.setName(t("outputLanguageName"))
		.setDesc(overridable(t("outputLanguageDesc")))
		.addDropdown((drop) => {
			for (const [value, label] of languageOptions()) drop.addOption(value, label);
			drop
				.setValue(plugin.settings.outputLanguage)
				.onChange(async (value) => {
					plugin.settings.outputLanguage = value as OutputLanguage;
					await plugin.saveSettings();
				});
		});

	new Setting(containerEl)
		.setName(t("resumeModeName"))
		.setDesc(overridable(t("resumeModeDesc")))
		.addDropdown((drop) =>
			drop
				.addOption("summary", t("resumeModeSummaryOpt"))
				.addOption("hybrid", t("resumeModeHybridOpt"))
				.addOption("full", t("resumeModeFullOpt"))
				.setValue(plugin.settings.defaultResumeMode)
				.onChange(async (value) => {
					plugin.settings.defaultResumeMode = value as PythiaSettings["defaultResumeMode"];
					await plugin.saveSettings();
				})
		);

	toggleRow(ctx, containerEl, t("webSearchDefaultName"), overridable(t("webSearchDefaultDesc")), "webSearchDefault");
}

/**
 * The default model for the provider chosen above, with a free-text field for a
 * model id the catalog does not know yet.
 */
function renderModelRow(containerEl: HTMLElement, ctx: SettingsContext, onChanged: () => void): void {
	const { settings } = ctx.plugin;
	const provider = settings.defaultProvider;
	const key = MODEL_KEY[provider];
	const known = KNOWN_MODELS[provider];
	const current = settings[key];
	const isCustom = !known.includes(current);

	let customInput: HTMLInputElement | null = null;

	const setting = new Setting(containerEl)
		.setName(t("defaultModelName"))
		.setDesc(overridable(t("defaultModelDesc", { provider: PROVIDER_LABEL[provider]() })))
		.addDropdown((drop) => {
			for (const m of known) drop.addOption(m, m);
			drop.addOption("__custom__", t("customModelOption"));
			drop.setValue(isCustom ? "__custom__" : current);
			drop.onChange(async (value) => {
				if (value === "__custom__") {
					if (customInput) customInput.style.display = "";
					return;
				}
				if (customInput) customInput.style.display = "none";
				settings[key] = value;
				await ctx.plugin.saveSettings();
				onChanged();
			});
		});

	customInput = setting.controlEl.createEl("input", {
		type: "text",
		placeholder: "model-id",
		cls: "pythia-custom-model",
	} as DomElementInfo & { type: string; placeholder: string });
	customInput.value = isCustom ? current : "";
	customInput.style.display = isCustom ? "" : "none";
	// A direct listener: the input is discarded with the row, whereas a
	// plugin-level registerDomEvent held one dead listener per settings open
	// until the plugin unloaded.
	customInput.addEventListener("change", async () => {
		const typed = customInput?.value.trim();
		if (!typed) return;
		settings[key] = typed;
		await ctx.plugin.saveSettings();
		onChanged();
	});
}

/**
 * Advisory only: gates temperature and effort against the provider plus its
 * default model. A conversation can still override provider and model
 * independently, so this reflects the pairing a NEW conversation gets from the
 * values on screen — not every runtime combination.
 *
 * The descriptions are set here rather than at construction because the suffix is
 * part of what the row says: a control that is live but silently ignored by the
 * chosen model was the original defect (#87).
 */
function updateParamAvailability(settings: PythiaSettings, temperature: Setting, effort: Setting): void {
	const provider = settings.defaultProvider;
	const model = resolveDefaultModelForProvider(provider, settings);
	const support = parameterSupport(provider, model);

	temperature.setDisabled(!support.temperature);
	temperature.setDesc(paramDesc(t("temperatureDesc"), support.temperature));
	effort.setDisabled(!support.effort);
	effort.setDesc(paramDesc(t("effortDesc"), support.effort));
}

function paramDesc(desc: string, supported: boolean): string {
	return supported ? overridable(desc) : `${desc} ${t("paramUnsupportedSuffix")}`;
}
