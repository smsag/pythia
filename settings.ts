import { App, PluginSettingTab, SecretComponent, Setting, TFolder } from "obsidian";
import type PythiaPlugin from "./main";
import type { Provider, EffortLevel } from "./models/types";
import { FolderSuggestModal } from "./suggest/FolderSuggest";
import { FileSuggestModal } from "./suggest/FileSuggest";
import { t } from "./i18n";
import {
	KNOWN_MODELS,
	supportsTemperature,
	supportsEffort,
	isReasoningModel,
	isMistralReasoningModel,
	resolveDefaultModelForProvider,
} from "./models/knownModels";
import { DEFAULT_MAX_TOKENS } from "./services/promptConstants";

// PythiaSettings interface and DEFAULT_SETTINGS live in models/settings.ts so
// that service modules can import them without pulling in the Obsidian UI layer.
export { PythiaSettings, DEFAULT_SETTINGS } from "./models/settings";
import type { PythiaSettings } from "./models/settings";

const ANTHROPIC_MODELS = KNOWN_MODELS.anthropic;
const OPENAI_MODELS = KNOWN_MODELS.openai;
const MISTRAL_MODELS = KNOWN_MODELS.mistral;

export class PythiaSettingTab extends PluginSettingTab {
	private plugin: PythiaPlugin;

	constructor(app: App, plugin: PythiaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: t("settingsTitle") });

		containerEl.createEl("h3", { text: t("anthropicSection") });

		// Populated once the temperature/effort Settings are created below;
		// referenced from the model/provider dropdowns registered before that
		// point — safe because those handlers only fire later, on interaction.
		// eslint-disable-next-line prefer-const -- forward reference: assigned after the dropdowns that close over it
		let temperatureSetting: Setting | undefined;
		// eslint-disable-next-line prefer-const -- forward reference: assigned after the dropdowns that close over it
		let effortSetting: Setting | undefined;
		const refreshTempEffortAvailability = (): void => {
			if (temperatureSetting && effortSetting) {
				this.updateTempEffortAvailability(temperatureSetting, effortSetting);
			}
		};

		new Setting(containerEl)
			.setName(t("anthropicKeyName"))
			.setDesc(t("anthropicKeyDesc"))
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.plugin.settings.anthropicSecretName)
					.onChange(async (secretName) => {
						await this.plugin.setApiKey(secretName);
					})
			);

		this.addModelSetting(
			containerEl,
			t("defaultAnthropicModel"),
			t("defaultAnthropicModelDesc"),
			ANTHROPIC_MODELS,
			() => this.plugin.settings.defaultAnthropicModel,
			async (value) => {
				this.plugin.settings.defaultAnthropicModel = value;
				await this.plugin.saveSettings();
			},
			refreshTempEffortAvailability
		);

		containerEl.createEl("h3", { text: t("openaiSection") });

		new Setting(containerEl)
			.setName(t("openaiKeyName"))
			.setDesc(t("openaiKeyDesc"))
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.plugin.settings.openaiSecretName)
					.onChange(async (secretName) => {
						await this.plugin.setOpenAIKey(secretName);
					})
			);

		this.addModelSetting(
			containerEl,
			t("defaultOpenAIModel"),
			t("defaultOpenAIModelDesc"),
			OPENAI_MODELS,
			() => this.plugin.settings.defaultOpenAIModel,
			async (value) => {
				this.plugin.settings.defaultOpenAIModel = value;
				await this.plugin.saveSettings();
			},
			refreshTempEffortAvailability
		);

		containerEl.createEl("h3", { text: t("mistralSection") });

		new Setting(containerEl)
			.setName(t("mistralKeyName"))
			.setDesc(t("mistralKeyDesc"))
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.plugin.settings.mistralSecretName)
					.onChange(async (secretName) => {
						await this.plugin.setMistralKey(secretName);
					})
			);

		this.addModelSetting(
			containerEl,
			t("defaultMistralModel"),
			t("defaultMistralModelDesc"),
			MISTRAL_MODELS,
			() => this.plugin.settings.defaultMistralModel,
			async (value) => {
				this.plugin.settings.defaultMistralModel = value;
				await this.plugin.saveSettings();
			},
			refreshTempEffortAvailability
		);

		containerEl.createEl("h3", { text: t("defaultsSection") });

		new Setting(containerEl)
			.setName(t("defaultProviderName"))
			.setDesc(t("defaultProviderDesc"))
			.addDropdown((drop) =>
				drop
					.addOption("anthropic", t("providerAnthropic"))
					.addOption("openai", t("providerOpenAI"))
					.addOption("mistral", t("providerMistral"))
					.setValue(this.plugin.settings.defaultProvider)
					.onChange(async (value) => {
						this.plugin.settings.defaultProvider = value as Provider;
						await this.plugin.saveSettings();
						refreshTempEffortAvailability();
					})
			);

		containerEl.createEl("h3", { text: t("vaultFoldersSection") });

		this.addFolderSetting(
			containerEl,
			t("templatesFolderName"),
			t("templatesFolderDesc"),
			"templatesFolder"
		);

		this.addFolderSetting(
			containerEl,
			t("convsFolderName"),
			t("convsFolderDesc"),
			"conversationsFolder"
		);

		this.addFolderSetting(
			containerEl,
			t("scratchFolderName"),
			t("scratchFolderDesc"),
			"scratchFolder"
		);

		new Setting(containerEl)
			.setName(t("inboxNoteName"))
			.setDesc(t("inboxNoteDesc"))
			.addText((text) =>
				text
					.setPlaceholder("Pythia/Inbox.md")
					.setValue(this.plugin.settings.inboxNote)
					.onChange(async (value) => {
						this.plugin.settings.inboxNote = value.trim();
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: t("behaviourSection") });

		new Setting(containerEl)
			.setName(t("autoSaveName"))
			.setDesc(t("autoSaveDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoSaveSummary)
					.onChange(async (value) => {
						this.plugin.settings.autoSaveSummary = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("resumeModeName"))
			.setDesc(t("resumeModeDesc"))
			.addDropdown((drop) =>
				drop
					.addOption("summary", t("resumeModeSummaryOpt"))
					.addOption("full", t("resumeModeFullOpt"))
					.setValue(this.plugin.settings.defaultResumeMode)
					.onChange(async (value) => {
						this.plugin.settings.defaultResumeMode = value as
							| "full"
							| "summary";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("maxTokensName"))
			.setDesc(t("maxTokensDesc"))
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_MAX_TOKENS))
					.setValue(this.plugin.settings.maxTokens?.toString() ?? "")
					.onChange(async (value) => {
						const trimmed = value.trim();
						if (trimmed === "") {
							this.plugin.settings.maxTokens = undefined;
							await this.plugin.saveSettings();
							return;
						}
						const n = parseInt(trimmed, 10);
						if (!isNaN(n) && n > 0) {
							this.plugin.settings.maxTokens = n;
							await this.plugin.saveSettings();
						}
					})
			);

		temperatureSetting = new Setting(containerEl)
			.setName(t("temperatureName"))
			.setDesc(t("temperatureDesc"))
			.addText((text) =>
				text
					.setPlaceholder("0.0 – 1.0")
					.setValue(this.plugin.settings.temperature?.toString() ?? "")
					.onChange(async (value) => {
						const trimmed = value.trim();
						if (trimmed === "") {
							this.plugin.settings.temperature = undefined;
							await this.plugin.saveSettings();
							return;
						}
						const n = parseFloat(trimmed);
						if (!isNaN(n) && n >= 0 && n <= 1) {
							this.plugin.settings.temperature = n;
							await this.plugin.saveSettings();
						}
					})
			);

		effortSetting = new Setting(containerEl)
			.setName(t("effortName"))
			.setDesc(t("effortDesc"))
			.addDropdown((drop) => {
				drop.addOption("", t("effortUnsetOption"));
				drop.addOption("low", t("effortLevelLow"));
				drop.addOption("medium", t("effortLevelMedium"));
				drop.addOption("high", t("effortLevelHigh"));
				drop.setValue(this.plugin.settings.effort ?? "");
				drop.onChange(async (value) => {
					this.plugin.settings.effort = value === "" ? undefined : (value as EffortLevel);
					await this.plugin.saveSettings();
				});
			});

		refreshTempEffortAvailability();

		new Setting(containerEl)
			.setName(t("messageCapName"))
			.setDesc(t("messageCapDesc"))
			.addText((text) =>
				text
					.setPlaceholder("100")
					.setValue(String(this.plugin.settings.maxMessagesPerSession))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n >= 0) {
							this.plugin.settings.maxMessagesPerSession = n;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName(t("maxConversationsName"))
			.setDesc(t("maxConversationsDesc"))
			.addText((text) =>
				text
					.setPlaceholder("200")
					.setValue(String(this.plugin.settings.maxConversations))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n >= 0) {
							this.plugin.settings.maxConversations = n;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName(t("maxAttachedNotesTokensName"))
			.setDesc(t("maxAttachedNotesTokensDesc"))
			.addText((text) =>
				text
					.setPlaceholder("8000")
					.setValue(String(this.plugin.settings.maxAttachedNotesTokens))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n >= 0) {
							this.plugin.settings.maxAttachedNotesTokens = n;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName(t("outputLanguageName"))
			.setDesc(t("outputLanguageDesc"))
			.addDropdown((drop) =>
				drop
					.addOption("auto", t("outputLanguageAuto"))
					.addOption("en", t("outputLanguageEnglish"))
					.addOption("de", t("outputLanguageGerman"))
					.setValue(this.plugin.settings.outputLanguage)
					.onChange(async (value) => {
						this.plugin.settings.outputLanguage = value as "auto" | "en" | "de";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("debugModeName"))
			.setDesc(t("debugModeDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debugMode)
					.onChange(async (value) => {
						this.plugin.settings.debugMode = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: t("featuresSection") });

		new Setting(containerEl)
			.setName(t("injectActiveNoteOnTemplateName"))
			.setDesc(t("injectActiveNoteOnTemplateDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.injectActiveNoteOnTemplate)
					.onChange(async (value) => {
						this.plugin.settings.injectActiveNoteOnTemplate = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: t("promptOptimizerSection") });

		this.addPromptOptimizerTemplateSetting(containerEl);
		this.addPromptFrameworkSetting(containerEl);
	}

	private addPromptOptimizerTemplateSetting(containerEl: HTMLElement): void {
		let textComponent: { setValue(v: string): void };
		new Setting(containerEl)
			.setName(t("promptOptimizerTemplateName"))
			.setDesc(t("promptOptimizerTemplateDesc"))
			.addText((text) => {
				textComponent = text;
				text.setPlaceholder(t("promptOptimizerTemplateNone"))
					.setValue(this.plugin.settings.promptOptimizerTemplateId ?? "")
					.onChange(async (value) => {
						this.plugin.settings.promptOptimizerTemplateId = value;
						await this.plugin.saveSettings();
					});
			})
			.addButton((btn) => {
				btn.setButtonText(t("browse"))
					.onClick(() => {
						new FileSuggestModal(this.app, async (file) => {
							this.plugin.settings.promptOptimizerTemplateId = file.path;
							await this.plugin.saveSettings();
							textComponent.setValue(file.path);
						}).open();
					});
			});
	}

	private addPromptFrameworkSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t("promptFrameworkLabel"))
			.setDesc(t("promptFrameworkDesc"))
			.addDropdown((drop) =>
				drop
					.addOption("none", t("promptFrameworkNone"))
					.addOption("CO-STAR", "CO-STAR")
					.addOption("RACE", "RACE")
					.addOption("RISEN", "RISEN")
					.setValue(["none", "CO-STAR", "RACE", "RISEN"].includes(this.plugin.settings.defaultPromptFramework)
						? this.plugin.settings.defaultPromptFramework
						: "none")
					.onChange(async (value) => {
						this.plugin.settings.defaultPromptFramework = value as PythiaSettings["defaultPromptFramework"];
						await this.plugin.saveSettings();
					})
			);
	}

	// Advisory only: gates the global temperature/effort defaults against
	// defaultProvider + the corresponding default*Model setting. Any given
	// conversation can still override provider/model independently, so this
	// doesn't reflect every possible runtime combination — just the pairing
	// new conversations get when created with current defaults.
	private updateTempEffortAvailability(temperatureSetting: Setting, effortSetting: Setting): void {
		const provider = this.plugin.settings.defaultProvider;
		const model = resolveDefaultModelForProvider(provider, this.plugin.settings);

		let tempSupported: boolean;
		let effortSupported: boolean;
		switch (provider) {
			case "anthropic":
				tempSupported = supportsTemperature(model);
				effortSupported = supportsEffort(model);
				break;
			case "openai":
				tempSupported = !isReasoningModel(model);
				effortSupported = isReasoningModel(model);
				break;
			case "mistral":
				tempSupported = !isMistralReasoningModel(model);
				effortSupported = true;
				break;
			default: {
				const exhaustiveCheck: never = provider;
				throw new Error(`Unknown provider: ${String(exhaustiveCheck)}`);
			}
		}

		temperatureSetting.setDisabled(!tempSupported);
		temperatureSetting.setDesc(tempSupported ? t("temperatureDesc") : `${t("temperatureDesc")} ${t("paramUnsupportedSuffix")}`);

		effortSetting.setDisabled(!effortSupported);
		effortSetting.setDesc(effortSupported ? t("effortDesc") : `${t("effortDesc")} ${t("paramUnsupportedSuffix")}`);
	}

	private addModelSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		knownModels: string[],
		getValue: () => string,
		setValue: (v: string) => Promise<void>,
		onAnyChange?: () => void
	): void {
		const currentValue = getValue();
		const isCustom = !knownModels.includes(currentValue);

		let customInput: HTMLInputElement | null = null;

		const setting = new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addDropdown((drop) => {
				for (const m of knownModels) drop.addOption(m, m);
				drop.addOption("__custom__", t("customModelOption"));
				drop.setValue(isCustom ? "__custom__" : currentValue);

				drop.onChange(async (val) => {
					if (val === "__custom__") {
						if (customInput) customInput.style.display = "";
					} else {
						if (customInput) customInput.style.display = "none";
						await setValue(val);
						onAnyChange?.();
					}
				});
			});

		customInput = setting.controlEl.createEl("input", {
			type: "text",
			placeholder: "model-id",
		} as DomElementInfo & { type: string; placeholder: string });
		customInput.value = isCustom ? currentValue : "";
		customInput.style.display = isCustom ? "" : "none";
		customInput.style.marginLeft = "8px";
		this.plugin.registerDomEvent(customInput, "change", async () => {
			if (customInput && customInput.value.trim()) {
				await setValue(customInput.value.trim());
				onAnyChange?.();
			}
		});
	}

	private addFolderSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: "templatesFolder" | "conversationsFolder" | "scratchFolder"
	): void {
		// eslint-disable-next-line prefer-const -- forward reference: assigned after the Setting that closes over it
		let displayEl: HTMLSpanElement;

		const setting = new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addButton((btn) => {
				btn.setButtonText(t("chooseFolderBtn"))
					.setCta()
					.onClick(() => {
						new FolderSuggestModal(
							this.app,
							async (folder: TFolder) => {
								const path = folder.isRoot() ? "/" : folder.path;
								this.plugin.settings[key] = path;
								await this.plugin.saveSettings();
								displayEl.setText(path);
							}
						).open();
					});
			});

		displayEl = setting.controlEl.createEl("span", {
			cls: "pythia-folder-display",
			text: this.plugin.settings[key] || "—",
		});
	}
}
