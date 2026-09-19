import { App, DropdownComponent, Modal, Setting, SliderComponent } from "obsidian";
import type { Conversation, Provider, EffortLevel, OutputLanguage } from "../models/types";
import { t } from "../i18n";
import {
	KNOWN_MODELS as MODELS_BY_PROVIDER,
	parameterSupport,
} from "../models/knownModels";
import { resolveDefaultMaxTokens } from "../services/promptConstants";
import { maxTokensAdvice } from "../services/settingsAdvice";
import { languageOptions, languageOptionLabel } from "../ui/languageOptions";

export class ConversationSettingsModal extends Modal {
	private conversation: Conversation;
	private onSave: (conversation: Conversation) => Promise<void>;
	private defaultTemperature: number | undefined;
	private defaultEffort: EffortLevel | undefined;
	private defaultMaxTokens: number | undefined;
	private defaultLanguage: OutputLanguage;

	constructor(
		app: App,
		conversation: Conversation,
		onSave: (conversation: Conversation) => Promise<void>,
		defaultTemperature?: number,
		defaultEffort?: EffortLevel,
		defaultMaxTokens?: number,
		defaultLanguage: OutputLanguage = "auto"
	) {
		super(app);
		this.conversation = conversation;
		this.onSave = onSave;
		this.defaultTemperature = defaultTemperature;
		this.defaultEffort = defaultEffort;
		this.defaultMaxTokens = defaultMaxTokens;
		this.defaultLanguage = defaultLanguage;
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
			.setDesc(t("providerDesc"))
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
		const modelSetting = new Setting(contentEl)
			.setName(t("modelLabel"))
			.setDesc(t("modelDesc"));
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
		// True until the user actually moves the slider, so the readout can say
		// whether the number shown is this conversation's own value or the
		// inherited default.
		let temperatureIsDefault = this.conversation.temperature === undefined;
		const temperatureSetting = new Setting(contentEl)
			.setName(t("convTemperatureLabel"))
			.setDesc(t("convTemperatureDesc"));
		let temperatureSlider: SliderComponent | null = null;
		temperatureSetting.addSlider((slider) => {
			temperatureSlider = slider;
			slider
				.setLimits(0, 1, 0.05)
				.setValue(temperatureValue)
				.setDynamicTooltip()
				.onChange((value) => {
					temperatureValue = value;
					temperatureIsDefault = false;
					paintTemperature();
				});
			// The dynamic tooltip only exists mid-drag — and on touch it sits under
			// the finger — so the value is otherwise invisible. Mirror it into a
			// permanent readout, updated from the raw `input` event so it tracks the
			// drag on builds where `onChange` fires on release.
			slider.sliderEl.addEventListener("input", () => {
				temperatureValue = slider.getValue();
				temperatureIsDefault = false;
				paintTemperature();
			});
		});
		const temperatureReadout = temperatureSetting.controlEl.createSpan({ cls: "p-param-readout" });
		function paintTemperature(): void {
			const v = temperatureValue.toFixed(2);
			temperatureReadout.setText(temperatureIsDefault ? t("paramValueDefault", { v }) : v);
		}
		paintTemperature();

		// Effort override — unlike temperature, defaults to "unset" (not the effective
		// value): a dropdown can represent "no override", so opening/closing this modal
		// without touching effort should not silently pin the current default in place.
		let effortValue: EffortLevel | "" = this.conversation.effort ?? "";
		const effortSetting = new Setting(contentEl)
			.setName(t("convEffortLabel"))
			.setDesc(t("convEffortDesc"));
		// Segmented control (F8). Keeps a "Standard" segment for "no override"
		// (the reason the old dropdown carried an empty option).
		// The "no override" segment names the effort that will actually apply, so the
		// control never leaves the user guessing: "Standard · Mittel" when a default
		// exists, plain "Standard" when none is configured. (The long parenthetical
		// `effortUnsetOption` label is a dropdown string — it stays in the settings
		// tab, where a select can carry it, but it does not fit a 4-way segment.)
		const levelLabel: Record<EffortLevel, string> = {
			low: t("effortLevelLow"),
			medium: t("effortLevelMedium"),
			high: t("effortLevelHigh"),
		};
		const defaultSegLabel = this.defaultEffort
			? t("effortSegmentDefaultWith", { v: levelLabel[this.defaultEffort] })
			: t("effortSegmentDefault");
		const effortOptions: { value: EffortLevel | ""; label: string }[] = [
			{ value: "",       label: defaultSegLabel },
			{ value: "low",    label: levelLabel.low },
			{ value: "medium", label: levelLabel.medium },
			{ value: "high",   label: levelLabel.high },
		];
		const effortSeg = effortSetting.controlEl.createDiv({ cls: "p-effort-seg" });
		effortSeg.setAttribute("role", "group");
		const effortBtns: HTMLButtonElement[] = [];
		const paintEffort = () =>
			effortBtns.forEach((b, i) => {
				const on = effortOptions[i].value === effortValue;
				b.toggleClass("active", on);
				b.setAttribute("aria-pressed", String(on));
			});
		for (const opt of effortOptions) {
			const b = effortSeg.createEl("button", { cls: "pb pb-seg p-effort-seg-btn", text: opt.label });
			b.type = "button";
			b.addEventListener("click", () => { effortValue = opt.value; paintEffort(); });
			effortBtns.push(b);
		}
		paintEffort();

		// Max tokens override — like temperature, defaults to the effective value
		// (conversation override, else global default, else the model-aware
		// resolved default); unlike temperature's slider, this is a text field so
		// it can also represent "no override" by being cleared.
		// The default this field falls back to is model-aware, so it has to be read
		// fresh whenever the model changes — not frozen at open.
		const resolvedMaxTokens = (): number =>
			this.defaultMaxTokens ?? resolveDefaultMaxTokens(selectedModel);
		let maxTokensValue: number | undefined = this.conversation.maxTokens ?? resolvedMaxTokens();
		let maxTokensIsDefault = this.conversation.maxTokens === undefined;
		const maxTokensSetting = new Setting(contentEl)
			.setName(t("convMaxTokensLabel"))
			.setDesc(t("convMaxTokensDesc"));
		let maxTokensInput!: HTMLInputElement;
		maxTokensSetting.addText((text) => {
			maxTokensInput = text.inputEl;
			// Numeric keypad on touch without the desktop spinner arrows; keeping
			// type="text" also keeps invalid input visible so it can be flagged
			// (a number input silently reports "" for it).
			maxTokensInput.inputMode = "numeric";
			maxTokensInput.setAttribute("pattern", "[0-9]*");
			text
				.setValue(maxTokensValue !== undefined ? String(maxTokensValue) : "")
				.onChange((value) => {
					const trimmed = value.trim();
					if (trimmed === "") {
						maxTokensValue = undefined;
						maxTokensIsDefault = false;
						paintMaxTokens(false);
						return;
					}
					const n = parseInt(trimmed, 10);
					const valid = !isNaN(n) && n > 0;
					if (valid) {
						maxTokensValue = n;
						maxTokensIsDefault = false;
					}
					// Invalid text was silently ignored before: the field kept showing
					// it while Save committed the last good value.
					paintMaxTokens(!valid);
				});
			maxTokensInput.addEventListener("blur", () => {
				// Leaving the field restores what Save will actually store, so the
				// field can never disagree with the committed value.
				maxTokensInput.value = maxTokensValue !== undefined ? String(maxTokensValue) : "";
				paintMaxTokens(false);
			});
		});
		const maxTokensReadout = maxTokensSetting.controlEl.createSpan({ cls: "p-param-readout" });
		// Advice under the field (ADR-162): the one case a user cannot see coming
		// — a reasoning model whose budget is spent on thinking before it writes.
		// Fires on open when the conflict already exists and follows every model
		// change. The fix is offered, never applied: "use the default" clears the
		// override so it follows the model again (principle 6); only when the
		// global setting itself is the low value does it pin a number.
		const globalMaxTokens = this.defaultMaxTokens;
		const adviceEl = contentEl.createDiv({ cls: "p-param-advice" });
		const adviceText = adviceEl.createSpan({ cls: "p-param-advice-text" });
		const adviceBtn = adviceEl.createEl("button", { cls: "pb pb-secondary p-param-advice-btn" });
		adviceBtn.type = "button";
		adviceBtn.addEventListener("click", () => {
			const advice = maxTokensAdvice(selectedModel, maxTokensIsDefault ? undefined : maxTokensValue, globalMaxTokens);
			if (!advice) return;
			if (advice.kind === "clear") {
				maxTokensIsDefault = true;
				maxTokensValue = resolvedMaxTokens();
			} else {
				maxTokensIsDefault = false;
				maxTokensValue = advice.recommended;
			}
			maxTokensInput.value = String(maxTokensValue);
			paintMaxTokens(false);
		});
		function paintAdvice(): void {
			const advice = maxTokensAdvice(selectedModel, maxTokensIsDefault ? undefined : maxTokensValue, globalMaxTokens);
			adviceEl.style.display = advice ? "" : "none";
			if (!advice) return;
			adviceText.setText(t("convTokensAdvice", { max: String(advice.effective), recommended: String(advice.recommended) }));
			adviceBtn.setText(
				advice.kind === "clear"
					? t("convTokensAdviceClearBtn", { recommended: String(advice.recommended) })
					: t("convTokensAdvicePinBtn", { recommended: String(advice.recommended) })
			);
		}
		function paintMaxTokens(invalid: boolean): void {
			maxTokensInput.toggleClass("p-field-invalid", invalid);
			maxTokensReadout.toggleClass("is-error", invalid);
			maxTokensInput.placeholder = String(resolvedMaxTokens());
			const showsDefault = maxTokensValue === undefined || maxTokensIsDefault;
			maxTokensReadout.setText(
				invalid
					? t("paramInvalidNumber")
					: showsDefault
						? t("paramValueDefault", { v: String(maxTokensValue ?? resolvedMaxTokens()) })
						: ""
			);
			paintAdvice();
		}
		paintMaxTokens(false);

		updateParamAvailability = (): void => {
			const { temperature: tempSupported, effort: effortSupported } = parameterSupport(selectedProvider, selectedModel);

			// `Setting.setDisabled` only marks the row — the control underneath stays
			// draggable — so the slider is disabled directly and the whole control
			// area is dimmed, the same treatment the effort segments get.
			temperatureSetting.setDisabled(!tempSupported);
			temperatureSlider?.setDisabled(!tempSupported);
			temperatureSetting.controlEl.toggleClass("p-param-off", !tempSupported);
			temperatureSetting.setDesc(tempSupported ? t("convTemperatureDesc") : `${t("convTemperatureDesc")} ${t("paramUnsupportedSuffix")}`);

			// An untouched field still shows the model's default, so it has to follow
			// the model: reasoning models resolve to a different max-output default,
			// and the stale number would otherwise be pinned on Save.
			if (maxTokensIsDefault) {
				maxTokensValue = resolvedMaxTokens();
				maxTokensInput.value = String(maxTokensValue);
			}
			paintMaxTokens(false);

			effortSetting.setDisabled(!effortSupported);
			effortSetting.setDesc(effortSupported ? t("convEffortDesc") : `${t("convEffortDesc")} ${t("paramUnsupportedSuffix")}`);
			effortSeg.toggleClass("disabled", !effortSupported);
			effortBtns.forEach((b) => { b.disabled = !effortSupported; });
		};
		updateParamAvailability();

		// Output language override (ADR-148). "Default" is a distinct value, not
		// the global setting pre-selected: a conversation that inherits has to keep
		// inheriting when the global setting later changes.
		const DEFAULT_LANGUAGE_VALUE = "__default__";
		let languageValue: OutputLanguage | undefined = this.conversation.outputLanguage;
		new Setting(contentEl)
			.setName(t("convLanguageLabel"))
			.setDesc(t("convLanguageDesc"))
			.addDropdown((drop) => {
				drop.addOption(
					DEFAULT_LANGUAGE_VALUE,
					t("convLanguageDefault", { v: languageOptionLabel(this.defaultLanguage) })
				);
				for (const [value, label] of languageOptions()) drop.addOption(value, label);
				drop.setValue(languageValue ?? DEFAULT_LANGUAGE_VALUE);
				drop.onChange((value) => {
					languageValue = value === DEFAULT_LANGUAGE_VALUE ? undefined : (value as OutputLanguage);
				});
			});

		// Theme override (ADR-150). The placeholder carries the conversation name
		// because that is what applies when the field is left empty — the same
		// "state the inherited value where the override goes" convention the
		// temperature and max-tokens readouts use.
		let themeValue: string | undefined = this.conversation.theme;
		new Setting(contentEl)
			.setName(t("convThemeLabel"))
			.setDesc(t("convThemeDesc"))
			.addText((text) => {
				text
					.setPlaceholder(this.conversation.name)
					.setValue(themeValue ?? "")
					.onChange((value) => {
						// Empty means "follow the conversation name", which is a distinct
						// state from a theme that happens to equal the name today: only the
						// former keeps following after a rename.
						themeValue = value.trim() || undefined;
					});
			});

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
						// An untouched field stays "inherit": the readout said `· Standard`,
						// and Save must not quietly turn that into a pinned override that
						// stops following the global default the next time it changes.
						this.conversation.temperature = temperatureIsDefault ? undefined : temperatureValue;
						this.conversation.effort = effortValue === "" ? undefined : effortValue;
						this.conversation.maxTokens = maxTokensIsDefault ? undefined : maxTokensValue;
						this.conversation.outputLanguage = languageValue;
						this.conversation.theme = themeValue;
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
