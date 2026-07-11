import { App, DropdownComponent, Modal, Setting } from "obsidian";
import type { Conversation, Provider, EffortLevel } from "../models/types";
import { t } from "../i18n";
import {
	KNOWN_MODELS as MODELS_BY_PROVIDER,
	supportsTemperature,
	supportsEffort,
	isReasoningModel,
} from "../models/knownModels";

export class ConversationSettingsModal extends Modal {
	private conversation: Conversation;
	private onSave: (conversation: Conversation) => Promise<void>;
	private defaultTemperature: number | undefined;
	private defaultEffort: EffortLevel | undefined;

	constructor(
		app: App,
		conversation: Conversation,
		onSave: (conversation: Conversation) => Promise<void>,
		defaultTemperature?: number,
		defaultEffort?: EffortLevel
	) {
		super(app);
		this.conversation = conversation;
		this.onSave = onSave;
		this.defaultTemperature = defaultTemperature;
		this.defaultEffort = defaultEffort;
	}

	onOpen(): void {
		this.modalEl.addClass("pythia-modal");
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: t("convSettingsTitle") });

		let selectedProvider = this.conversation.provider;
		let selectedModel = this.conversation.model;
		let customInput: HTMLInputElement | null = null;
		let modelDropdown: DropdownComponent | null = null;
		// Reassigned once the temperature/effort Settings exist below; referenced
		// from the provider/model handlers registered before that point — safe
		// because those handlers only fire later, on user interaction.
		let updateParamAvailability: () => void = () => {};

		const rebuildModelOptions = (
			drop: DropdownComponent,
			provider: Provider,
			currentModel: string
		): void => {
			const selectEl = drop.selectEl;
			selectEl.empty();
			const knownModels = MODELS_BY_PROVIDER[provider];
			for (const m of knownModels) {
				const opt = selectEl.createEl("option", { text: m });
				opt.value = m;
			}
			const customOpt = selectEl.createEl("option", { text: t("customModelOption") });
			customOpt.value = "__custom__";

			const isKnown = knownModels.includes(currentModel);
			selectEl.value = isKnown ? currentModel : "__custom__";
			if (customInput) {
				customInput.value = isKnown ? "" : currentModel;
				customInput.style.display = isKnown ? "none" : "";
			}
		};

		// Provider toggle
		new Setting(contentEl)
			.setName(t("providerLabel"))
			.addDropdown((drop) => {
				drop.addOption("anthropic", t("providerAnthropic"));
				drop.addOption("openai", t("providerOpenAI"));
				drop.setValue(selectedProvider);
				drop.onChange((value) => {
					selectedProvider = value as Provider;
					selectedModel = MODELS_BY_PROVIDER[selectedProvider][0];
					if (modelDropdown) {
						rebuildModelOptions(modelDropdown, selectedProvider, selectedModel);
					}
					updateParamAvailability();
				});
			});

		// Model selection
		const modelSetting = new Setting(contentEl).setName(t("modelLabel"));
		modelSetting.addDropdown((drop) => {
			modelDropdown = drop;
			rebuildModelOptions(drop, selectedProvider, selectedModel);
			drop.onChange((value) => {
				if (value === "__custom__") {
					if (customInput) customInput.style.display = "";
				} else {
					selectedModel = value;
					if (customInput) customInput.style.display = "none";
				}
				updateParamAvailability();
			});
		});

		// Custom model text field
		customInput = modelSetting.controlEl.createEl("input", {
			type: "text",
			placeholder: "model-id",
		} as DomElementInfo & { type: string; placeholder: string });
		const knownModels = MODELS_BY_PROVIDER[selectedProvider];
		const isKnown = knownModels.includes(selectedModel);
		customInput.value = isKnown ? "" : selectedModel;
		customInput.style.display = isKnown ? "none" : "";
		customInput.style.marginLeft = "8px";
		customInput.addEventListener("input", () => {
			if (customInput && customInput.value.trim()) {
				selectedModel = customInput.value.trim();
			}
			updateParamAvailability();
		});

		// Temperature override — defaults to the effective value (conversation override, else global default)
		let temperatureValue =
			this.conversation.temperature ?? this.defaultTemperature ?? 1.0;
		const temperatureSetting = new Setting(contentEl)
			.setName(t("convTemperatureLabel"))
			.setDesc(t("convTemperatureDesc"))
			.addSlider((slider) =>
				slider
					.setLimits(0, 1, 0.05)
					.setValue(temperatureValue)
					.setDynamicTooltip()
					.onChange((value) => {
						temperatureValue = value;
					})
			);

		// Effort override — unlike temperature, defaults to "unset" (not the effective
		// value): a dropdown can represent "no override", so opening/closing this modal
		// without touching effort should not silently pin the current default in place.
		let effortValue: EffortLevel | "" = this.conversation.effort ?? "";
		const effortSetting = new Setting(contentEl)
			.setName(t("convEffortLabel"))
			.setDesc(t("convEffortDesc"))
			.addDropdown((drop) => {
				drop.addOption("", t("effortUnsetOption"));
				drop.addOption("low", t("effortLevelLow"));
				drop.addOption("medium", t("effortLevelMedium"));
				drop.addOption("high", t("effortLevelHigh"));
				drop.setValue(effortValue);
				drop.onChange((value) => {
					effortValue = value as EffortLevel | "";
				});
			});

		updateParamAvailability = (): void => {
			const tempSupported = selectedProvider === "anthropic"
				? supportsTemperature(selectedModel)
				: !isReasoningModel(selectedModel);
			const effortSupported = selectedProvider === "anthropic"
				? supportsEffort(selectedModel)
				: isReasoningModel(selectedModel);

			temperatureSetting.setDisabled(!tempSupported);
			temperatureSetting.setDesc(tempSupported ? t("convTemperatureDesc") : `${t("convTemperatureDesc")} ${t("paramUnsupportedSuffix")}`);

			effortSetting.setDisabled(!effortSupported);
			effortSetting.setDesc(effortSupported ? t("convEffortDesc") : `${t("convEffortDesc")} ${t("paramUnsupportedSuffix")}`);
		};
		updateParamAvailability();

		// Action buttons
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText(t("saveBtn"))
					.setCta()
					.onClick(async () => {
						if (
							customInput &&
							customInput.style.display !== "none" &&
							customInput.value.trim()
						) {
							selectedModel = customInput.value.trim();
						}

						this.conversation.provider = selectedProvider;
						this.conversation.model = selectedModel;
						this.conversation.temperature = temperatureValue;
						this.conversation.effort = effortValue === "" ? undefined : effortValue;
						await this.onSave(this.conversation);
						this.close();
					})
			)
			.addButton((btn) =>
				btn.setButtonText(t("cancelBtn")).onClick(() => this.close())
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
