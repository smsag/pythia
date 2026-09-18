import { App, PluginSettingTab, SecretComponent, Setting, TFolder } from "obsidian";
import type PythiaPlugin from "./main";
import type { Provider, EffortLevel, OutputLanguage } from "./models/types";
import { FolderSuggestModal } from "./suggest/FolderSuggest";
import { FileSuggestModal } from "./suggest/FileSuggest";
import { renderEmbeddingSettings } from "./ui/embeddingSettings";
import { renderGlossarySettings } from "./ui/glossarySettings";
import { languageOptions } from "./ui/languageOptions";
import { t } from "./i18n";
import { renderPricingSettings } from "./ui/pricingSettings";
import { bindNumberSetting } from "./ui/numberSetting";
import { renderConversationCapSetting } from "./ui/conversationCapSetting";
import {
	KNOWN_MODELS,
	parameterSupport,
	resolveDefaultModelForProvider,
} from "./models/knownModels";
import { DEFAULT_MAX_TOKENS } from "./services/promptConstants";

// PythiaSettings interface and DEFAULT_SETTINGS live in models/settings.ts so
// that service modules can import them without pulling in the Obsidian UI layer.
export { PythiaSettings, DEFAULT_SETTINGS } from "./models/settings";
import type { PythiaSettings } from "./models/settings";

/** The settings a folder picker can set. */
type FolderSettingKey = "templatesFolder" | "conversationsFolder" | "scratchFolder" | "archiveFolder";

/** The settings a plain on/off toggle can flip. */
type BooleanSettingKey = { [K in keyof PythiaSettings]-?: PythiaSettings[K] extends boolean ? K : never }[keyof PythiaSettings];

const ANTHROPIC_MODELS = KNOWN_MODELS.anthropic;
const OPENAI_MODELS = KNOWN_MODELS.openai;
const MISTRAL_MODELS = KNOWN_MODELS.mistral;

export class PythiaSettingTab extends PluginSettingTab {
	private plugin: PythiaPlugin;
	/** Typed fields save a beat after the last keystroke (every save rewrites the
	 *  whole data.json); toggles and dropdowns still save at once. */
	private readonly saveSoon = (): void => this.plugin.saveSettingsSoon();
	/** Commit functions of the numeric fields on screen (ADR-171). They fire on
	 *  blur, which closing the tab never gives them — `hide()` runs them instead. */
	private numberCommits: (() => void)[] = [];

	constructor(app: App, plugin: PythiaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		// Commit the number field the user is still standing in, then flush what was
		// typed in the last few hundred ms and repaint the header's defaults (ADR-165).
		for (const commit of this.numberCommits) commit();
		this.plugin.onSettingsTabClosed();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.numberCommits = [];
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

		containerEl.createEl("h3", { text: t("webSearchSection") });

		new Setting(containerEl)
			.setName(t("searchKeyName"))
			.setDesc(t("searchKeyDesc"))
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.plugin.settings.searchSecretName)
					.onChange(async (secretName) => {
						await this.plugin.setSearchKey(secretName);
					})
			);

		this.addToggle(containerEl, t("webSearchDefaultName"), t("webSearchDefaultDesc"), "webSearchDefault");

		this.addToggle(containerEl, t("webSearchAutoArmName"), t("webSearchAutoArmDesc"), "webSearchAutoArm");

		new Setting(containerEl)
			.setName(t("webSearchMaxResultsName"))
			.setDesc(t("webSearchMaxResultsDesc"))
			.addText((text) => {
				text.setPlaceholder("5");
				this.numberCommits.push(bindNumberSetting(text, { rule: { min: 0 },
					read: () => this.plugin.settings.webSearchMaxResults,
					write: (n) => { this.plugin.settings.webSearchMaxResults = n; this.saveSoon(); } }));
			});

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
					.onChange((value) => {
						this.plugin.settings.inboxNote = value.trim();
						this.saveSoon();
					})
			);

		renderGlossarySettings(containerEl, this.plugin);

		containerEl.createEl("h3", { text: t("behaviourSection") });

		new Setting(containerEl)
			.setName(t("resumeModeName"))
			.setDesc(t("resumeModeDesc"))
			.addDropdown((drop) =>
				drop
					.addOption("summary", t("resumeModeSummaryOpt"))
					.addOption("hybrid", t("resumeModeHybridOpt"))
					.addOption("full", t("resumeModeFullOpt"))
					.setValue(this.plugin.settings.defaultResumeMode)
					.onChange(async (value) => {
						this.plugin.settings.defaultResumeMode = value as
							| "full"
							| "summary"
							| "hybrid";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("maxTokensName"))
			.setDesc(t("maxTokensDesc"))
			.addText((text) => {
				text.setPlaceholder(String(DEFAULT_MAX_TOKENS));
				this.numberCommits.push(bindNumberSetting(text, { rule: { min: 1, allowEmpty: true },
					read: () => this.plugin.settings.maxTokens,
					write: (n) => { this.plugin.settings.maxTokens = n; this.saveSoon(); } }));
			});

		temperatureSetting = new Setting(containerEl)
			.setName(t("temperatureName"))
			.setDesc(t("temperatureDesc"))
			.addText((text) => {
				text.setPlaceholder("0.0 – 1.0");
				this.numberCommits.push(bindNumberSetting(text, { rule: { min: 0, max: 1, decimal: true, allowEmpty: true },
					read: () => this.plugin.settings.temperature,
					write: (n) => { this.plugin.settings.temperature = n; this.saveSoon(); } }));
			});

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
			.addText((text) => {
				// Empty = no limit, like the conversation cap below it (ADR-172).
				text.setPlaceholder(t("noLimitPlaceholder"));
				this.numberCommits.push(bindNumberSetting(text, { rule: { min: 0, allowEmpty: true },
					read: () => (this.plugin.settings.maxMessagesPerSession > 0 ? this.plugin.settings.maxMessagesPerSession : undefined),
					write: (n) => { this.plugin.settings.maxMessagesPerSession = n ?? 0; this.saveSoon(); } }));
			});

		renderConversationCapSetting(containerEl, this.plugin, {
			register: (commit) => this.numberCommits.push(commit),
			saveSoon: this.saveSoon,
		});

		this.addToggle(containerEl, t("archiveBeforeEvictionName"), t("archiveBeforeEvictionDesc"), "archiveBeforeEviction");
		this.addFolderSetting(containerEl, t("archiveFolderName"), t("archiveFolderDesc"), "archiveFolder");

		new Setting(containerEl)
			.setName(t("maxAttachedNotesTokensName"))
			.setDesc(t("maxAttachedNotesTokensDesc"))
			.addText((text) => {
				text.setPlaceholder("8000");
				this.numberCommits.push(bindNumberSetting(text, { rule: { min: 0 },
					read: () => this.plugin.settings.maxAttachedNotesTokens,
					write: (n) => { this.plugin.settings.maxAttachedNotesTokens = n; this.saveSoon(); } }));
			});

		new Setting(containerEl)
			.setName(t("outputLanguageName"))
			.setDesc(t("outputLanguageDesc"))
			.addDropdown((drop) => {
				for (const [value, label] of languageOptions()) drop.addOption(value, label);
				drop
					.setValue(this.plugin.settings.outputLanguage)
					.onChange(async (value) => {
						this.plugin.settings.outputLanguage = value as OutputLanguage;
						await this.plugin.saveSettings();
					});
			});

		renderEmbeddingSettings(containerEl, this.plugin);

		new Setting(containerEl)
			.setName(t("customInstructionsName"))
			.setDesc(t("customInstructionsDesc"))
			.addTextArea((text) => {
				text
					.setPlaceholder(t("customInstructionsPlaceholder"))
					.setValue(this.plugin.settings.customInstructions)
					.onChange((value) => {
						this.plugin.settings.customInstructions = value;
						this.saveSoon();
					});
				text.inputEl.rows = 4;
				text.inputEl.addClass("pythia-settings-textarea");
			});

		this.addToggle(containerEl, t("debugModeName"), t("debugModeDesc"), "debugMode");

		containerEl.createEl("h3", { text: t("featuresSection") });

		renderPricingSettings(containerEl, this.plugin);

		this.addToggle(containerEl, t("injectActiveNoteOnTemplateName"), t("injectActiveNoteOnTemplateDesc"), "injectActiveNoteOnTemplate");

		containerEl.createEl("h3", { text: t("promptOptimizerSection") });
		this.addPromptOptimizerTemplateSetting(containerEl);
		this.addPromptFrameworkSetting(containerEl);
		this.addToggle(containerEl, t("optimizerSuggestsModelName"), t("optimizerSuggestsModelDesc"), "optimizerSuggestsModel");
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
					.onChange((value) => {
						this.plugin.settings.promptOptimizerTemplateId = value.trim();
						this.saveSoon();
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
		const { temperature: tempSupported, effort: effortSupported } = parameterSupport(provider, model);

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
		// A direct listener: the input is discarded with the tab, whereas a
		// plugin-level registerDomEvent held one dead listener per settings open
		// until the plugin unloaded.
		customInput.addEventListener("change", async () => {
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
		key: FolderSettingKey
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

	/** One boolean setting: name, description, the settings key it flips. Five
	 *  toggles used to spell out the same eleven lines each (ADR-097 ratchet). */

	private addToggle(containerEl: HTMLElement, name: string, desc: string, key: BooleanSettingKey): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
					this.plugin.settings[key] = value;
					await this.plugin.saveSettings();
				})
			);
	}
}
