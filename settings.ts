import { App, PluginSettingTab, SecretComponent, Setting, TFolder } from "obsidian";
import type PythiaPlugin from "./main";
import type { Provider } from "./models/types";
import { FolderSuggestModal } from "./suggest/FolderSuggest";
import { FileSuggestModal } from "./suggest/FileSuggest";
import { t } from "./i18n";

export interface PythiaSettings {
	/** Secret ID referencing the Anthropic API key in Obsidian SecretStorage. */
	anthropicSecretName: string;
	/** Secret ID referencing the OpenAI API key in Obsidian SecretStorage. */
	openaiSecretName: string;
	/** Which provider to use when creating new conversations. */
	defaultProvider: Provider;
	/** Default Anthropic model (used when template does not specify one). */
	defaultAnthropicModel: string;
	/** Default OpenAI model (used when template does not specify one). */
	defaultOpenAIModel: string;
	templatesFolder: string;
	conversationsFolder: string;
	scratchFolder: string;
	autoSaveSummary: boolean;
	defaultResumeMode: "full" | "summary";
	/** Soft cap on messages per conversation session. 0 = unlimited. */
	maxMessagesPerSession: number;
	/** Maximum conversations kept in data.json. Oldest non-starred are evicted. 0 = unlimited. */
	maxConversations: number;
	/** When true, passes a create_note tool to the LLM so it can write vault notes. */
	enableNoteCreation: boolean;
	/** When true, the currently active note is injected as context when starting from a template. */
	injectActiveNoteOnTemplate: boolean;
	/** Vault path for the inbox note used by the "Save to inbox" selection action. */
	inboxNote: string;
	/** Language for AI-generated text (titles, summaries, chapter names).
	 *  "auto" = follow the conversation language. Otherwise an ISO 639-1 locale code. */
	outputLanguage: "auto" | "en" | "de";
	debugMode: boolean;
	/** Vault path of the Pythia template used by the "New conversation from prompt" command. */
	promptOptimizerTemplateId: string;
	/** Prompt framework applied by the inline optimizer. */
	defaultPromptFramework: "none" | "RACE" | "COAST" | "RISEN" | "CARE";
}

export const DEFAULT_SETTINGS: PythiaSettings = {
	anthropicSecretName: "pythia-anthropic",
	openaiSecretName: "pythia-openai",
	defaultProvider: "anthropic",
	defaultAnthropicModel: "claude-sonnet-4-6",
	defaultOpenAIModel: "gpt-4o",
	templatesFolder: "Pythia/Templates",
	conversationsFolder: "Pythia/Conversations",
	scratchFolder: "Pythia/Scratch",
	autoSaveSummary: true,
	defaultResumeMode: "full",
	maxMessagesPerSession: 100,
	maxConversations: 200,
	enableNoteCreation: true,
	injectActiveNoteOnTemplate: false,
	inboxNote: "Pythia/Inbox.md",
	outputLanguage: "auto",
	debugMode: false,
	promptOptimizerTemplateId: "",
	defaultPromptFramework: "none",
};

const ANTHROPIC_MODELS = [
	"claude-opus-4",
	"claude-sonnet-4-6",
	"claude-haiku-3-5",
];
const OPENAI_MODELS = ["gpt-4o", "gpt-4o-mini", "o3", "o3-mini", "o4-mini"];

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
			}
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
			}
		);

		containerEl.createEl("h3", { text: t("defaultsSection") });

		new Setting(containerEl)
			.setName(t("defaultProviderName"))
			.setDesc(t("defaultProviderDesc"))
			.addDropdown((drop) =>
				drop
					.addOption("anthropic", t("providerAnthropic"))
					.addOption("openai", t("providerOpenAI"))
					.setValue(this.plugin.settings.defaultProvider)
					.onChange(async (value) => {
						this.plugin.settings.defaultProvider = value as Provider;
						await this.plugin.saveSettings();
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
			.setName(t("enableNoteCreationName"))
			.setDesc(t("enableNoteCreationDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableNoteCreation)
					.onChange(async (value) => {
						this.plugin.settings.enableNoteCreation = value;
						await this.plugin.saveSettings();
					})
			);

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
					.addOption("RACE", "RACE")
					.addOption("COAST", "COAST")
					.addOption("RISEN", "RISEN")
					.addOption("CARE", "CARE")
					.setValue(this.plugin.settings.defaultPromptFramework)
					.onChange(async (value) => {
						this.plugin.settings.defaultPromptFramework = value as PythiaSettings["defaultPromptFramework"];
						await this.plugin.saveSettings();
					})
			);
	}

	private addModelSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		knownModels: string[],
		getValue: () => string,
		setValue: (v: string) => Promise<void>
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
		customInput.addEventListener("change", async () => {
			if (customInput && customInput.value.trim()) {
				await setValue(customInput.value.trim());
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
