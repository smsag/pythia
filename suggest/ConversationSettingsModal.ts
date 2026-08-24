import { App, DropdownComponent, Modal, Setting } from "obsidian";
import type { Conversation, Provider, EffortLevel } from "../models/types";
import { t } from "../i18n";
import {
	KNOWN_MODELS as MODELS_BY_PROVIDER,
	supportsTemperature,
	supportsEffort,
	isReasoningModel,
	isMistralReasoningModel,
} from "../models/knownModels";
import { resolveDefaultMaxTokens } from "../services/promptConstants";

export class ConversationSettingsModal extends Modal {
	private conversation: Conversation;
	private onSave: (conversation: Conversation) => Promise<void>;
	private defaultTemperature: number | undefined;
	private defaultEffort: EffortLevel | undefined;
	private defaultMaxTokens: number | undefined;

	constructor(
		app: App,
		conversation: Conversation,
		onSave: (conversation: Conversation) => Promise<void>,
		defaultTemperature?: number,
		defaultEffort?: EffortLevel,
		defaultMaxTokens?: number
	) {
		super(app);
		this.conversation = conversation;
		this.onSave = onSave;
		this.defaultTemperature = defaultTemperature;
		this.defaultEffort = defaultEffort;
		this.defaultMaxTokens = defaultMaxTokens;
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
				drop.addOption("mistral", t("providerMistral"));
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
			.setDesc(t("convEffortDesc"));
		// Segmented control (F8). Keeps a "Standard" segment for "no override"
		// (the reason the old dropdown carried an empty option).
		const effortOptions: { value: EffortLevel | ""; label: string }[] = [
			{ value: "",       label: t("effortUnsetOption") },
			{ value: "low",    label: t("effortLevelLow") },
			{ value: "medium", label: t("effortLevelMedium") },
			{ value: "high",   label: t("effortLevelHigh") },
		];
		const effortSeg = effortSetting.controlEl.createDiv({ cls: "p-effort-seg" });
		const effortBtns: HTMLButtonElement[] = [];
		const paintEffort = () =>
			effortBtns.forEach((b, i) => b.toggleClass("active", effortOptions[i].value === effortValue));
		for (const opt of effortOptions) {
			const b = effortSeg.createEl("button", { cls: "p-effort-seg-btn", text: opt.label });
			b.type = "button";
			b.addEventListener("click", () => { effortValue = opt.value; paintEffort(); });
			effortBtns.push(b);
		}
		paintEffort();

		// Max tokens override — like temperature, defaults to the effective value
		// (conversation override, else global default, else the model-aware
		// resolved default); unlike temperature's slider, this is a text field so
		// it can also represent "no override" by being cleared.
		let maxTokensValue: number | undefined =
			this.conversation.maxTokens ?? this.defaultMaxTokens ?? resolveDefaultMaxTokens(selectedModel);
		new Setting(contentEl)
			.setName(t("convMaxTokensLabel"))
			.setDesc(t("convMaxTokensDesc"))
			.addText((text) =>
				text
					.setValue(maxTokensValue !== undefined ? String(maxTokensValue) : "")
					.onChange((value) => {
						const trimmed = value.trim();
						if (trimmed === "") {
							maxTokensValue = undefined;
							return;
						}
						const n = parseInt(trimmed, 10);
						if (!isNaN(n) && n > 0) {
							maxTokensValue = n;
						}
					})
			);

		updateParamAvailability = (): void => {
			let tempSupported: boolean;
			let effortSupported: boolean;
			switch (selectedProvider) {
				case "anthropic":
					tempSupported = supportsTemperature(selectedModel);
					effortSupported = supportsEffort(selectedModel);
					break;
				case "openai":
					tempSupported = !isReasoningModel(selectedModel);
					effortSupported = isReasoningModel(selectedModel);
					break;
				case "mistral":
					tempSupported = !isMistralReasoningModel(selectedModel);
					effortSupported = true;
					break;
				default: {
					const exhaustiveCheck: never = selectedProvider;
					throw new Error(`Unknown provider: ${String(exhaustiveCheck)}`);
				}
			}

			temperatureSetting.setDisabled(!tempSupported);
			temperatureSetting.setDesc(tempSupported ? t("convTemperatureDesc") : `${t("convTemperatureDesc")} ${t("paramUnsupportedSuffix")}`);

			effortSetting.setDisabled(!effortSupported);
			effortSetting.setDesc(effortSupported ? t("convEffortDesc") : `${t("convEffortDesc")} ${t("paramUnsupportedSuffix")}`);
			effortSeg.toggleClass("disabled", !effortSupported);
			effortBtns.forEach((b) => { b.disabled = !effortSupported; });
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
						this.conversation.maxTokens = maxTokensValue;
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
