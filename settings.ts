import { App, PluginSettingTab, SecretComponent, Setting, TFolder } from "obsidian";
import type PythiaPlugin from "./main";
import type { Provider } from "./models/types";
import { FolderSuggestModal } from "./suggest/FolderSuggest";

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
	/** When true, passes a create_note tool to the LLM so it can write vault notes. */
	enableNoteCreation: boolean;
	/** Vault path for the inbox note used by the "Save to inbox" selection action. */
	inboxNote: string;
	debugMode: boolean;
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
	defaultResumeMode: "summary",
	maxMessagesPerSession: 100,
	enableNoteCreation: true,
	inboxNote: "Pythia/Inbox.md",
	debugMode: false,
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
		containerEl.createEl("h2", { text: "Pythia" });

		containerEl.createEl("h3", { text: "Anthropic" });

		new Setting(containerEl)
			.setName("Anthropic API key")
			.setDesc("Select a secret from Obsidian's secret storage. Keys are never written to data.json.")
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.plugin.settings.anthropicSecretName)
					.onChange(async (secretName) => {
						await this.plugin.setApiKey(secretName);
					})
			);

		this.addModelSetting(
			containerEl,
			"Default Anthropic model",
			"Used when a template does not specify a model.",
			ANTHROPIC_MODELS,
			() => this.plugin.settings.defaultAnthropicModel,
			async (value) => {
				this.plugin.settings.defaultAnthropicModel = value;
				await this.plugin.saveSettings();
			}
		);

		containerEl.createEl("h3", { text: "OpenAI" });

		new Setting(containerEl)
			.setName("OpenAI API key")
			.setDesc("Select a secret from Obsidian's secret storage. Keys are never written to data.json.")
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.plugin.settings.openaiSecretName)
					.onChange(async (secretName) => {
						await this.plugin.setOpenAIKey(secretName);
					})
			);

		this.addModelSetting(
			containerEl,
			"Default OpenAI model",
			"Used when a template does not specify a model.",
			OPENAI_MODELS,
			() => this.plugin.settings.defaultOpenAIModel,
			async (value) => {
				this.plugin.settings.defaultOpenAIModel = value;
				await this.plugin.saveSettings();
			}
		);

		containerEl.createEl("h3", { text: "Defaults" });

		new Setting(containerEl)
			.setName("Default provider")
			.setDesc("Provider used when creating new conversations without a template.")
			.addDropdown((drop) =>
				drop
					.addOption("anthropic", "Anthropic")
					.addOption("openai", "OpenAI")
					.setValue(this.plugin.settings.defaultProvider)
					.onChange(async (value) => {
						this.plugin.settings.defaultProvider = value as Provider;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "Vault folders" });

		this.addFolderSetting(
			containerEl,
			"Templates folder",
			"Vault folder scanned for pythia_template notes.",
			"templatesFolder"
		);

		this.addFolderSetting(
			containerEl,
			"Conversations folder",
			"Where conversation summary notes are saved.",
			"conversationsFolder"
		);

		this.addFolderSetting(
			containerEl,
			"Scratch folder",
			"Where ad-hoc conversation notes are saved.",
			"scratchFolder"
		);

		new Setting(containerEl)
			.setName("Inbox note")
			.setDesc("Note that receives timestamped entries from the 'Save to inbox' selection action.")
			.addText((text) =>
				text
					.setPlaceholder("Pythia/Inbox.md")
					.setValue(this.plugin.settings.inboxNote)
					.onChange(async (value) => {
						this.plugin.settings.inboxNote = value.trim();
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "Behaviour" });

		new Setting(containerEl)
			.setName("Auto-save summary on close")
			.setDesc(
				"Generate and save a summary note when a conversation is closed."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoSaveSummary)
					.onChange(async (value) => {
						this.plugin.settings.autoSaveSummary = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Default resume mode")
			.setDesc("How conversations are resumed unless overridden per-conversation.")
			.addDropdown((drop) =>
				drop
					.addOption("summary", "Summary — lower token cost")
					.addOption("full", "Full history — higher fidelity")
					.setValue(this.plugin.settings.defaultResumeMode)
					.onChange(async (value) => {
						this.plugin.settings.defaultResumeMode = value as
							| "full"
							| "summary";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Message cap per session")
			.setDesc("Maximum messages per conversation before further sends are blocked. Set to 0 for unlimited.")
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
			.setName("Debug mode")
			.setDesc("Log API calls and payloads to the developer console.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debugMode)
					.onChange(async (value) => {
						this.plugin.settings.debugMode = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "Features" });

		new Setting(containerEl)
			.setName("Allow AI to create notes")
			.setDesc(
				"Pass a create_note tool to the AI so it can write vault notes on request. " +
				"When enabled, you can ask Pythia to create a note in plain language."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableNoteCreation)
					.onChange(async (value) => {
						this.plugin.settings.enableNoteCreation = value;
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
				drop.addOption("__custom__", "Custom…");
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
		let displayEl: HTMLSpanElement;

		const setting = new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addButton((btn) => {
				btn.setButtonText("Choose folder")
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
