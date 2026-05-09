import { App, DropdownComponent, Modal, Setting } from "obsidian";
import type { Conversation, Provider } from "../models/types";

const MODELS_BY_PROVIDER: Record<Provider, string[]> = {
	anthropic: ["claude-opus-4", "claude-sonnet-4-6", "claude-haiku-3-5"],
	openai: ["gpt-4o", "gpt-4o-mini", "o3", "o3-mini", "o4-mini"],
};

/**
 * A modal that lets the user change the provider and model for a conversation.
 * Changes are applied immediately to the conversation object;
 * the caller is responsible for persistence.
 */
export class ConversationSettingsModal extends Modal {
	private conversation: Conversation;
	private onSave: (conversation: Conversation) => Promise<void>;

	constructor(
		app: App,
		conversation: Conversation,
		onSave: (conversation: Conversation) => Promise<void>
	) {
		super(app);
		this.conversation = conversation;
		this.onSave = onSave;
	}

	onOpen(): void {
		this.modalEl.addClass("pythia-modal");
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Conversation settings" });

		let selectedProvider = this.conversation.provider;
		let selectedModel = this.conversation.model;
		let customInput: HTMLInputElement | null = null;
		let modelDropdown: DropdownComponent | null = null;

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
			const customOpt = selectEl.createEl("option", { text: "Custom…" });
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
			.setName("Provider")
			.addDropdown((drop) => {
				drop.addOption("anthropic", "Anthropic");
				drop.addOption("openai", "OpenAI");
				drop.setValue(selectedProvider);
				drop.onChange((value) => {
					selectedProvider = value as Provider;
					selectedModel = MODELS_BY_PROVIDER[selectedProvider][0];
					if (modelDropdown) {
						rebuildModelOptions(modelDropdown, selectedProvider, selectedModel);
					}
				});
			});

		// Model selection
		const modelSetting = new Setting(contentEl).setName("Model");
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
		});

		// Action buttons
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Save")
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
						await this.onSave(this.conversation);
						this.close();
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.close())
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
