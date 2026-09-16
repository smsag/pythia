import { App, FuzzySuggestModal } from "obsidian";
import { MODEL_CATALOG, type ModelInfo } from "../models/knownModels";
import type { Provider } from "../models/types";
import { t, getLang } from "../i18n";
import { profileLine } from "../models/modelGuidance";

/**
 * Pick a model to run a comparison on (ADR-160). Lists every catalog model
 * whose provider has an API key, minus the ones already answering — the
 * current model and any candidate already in the comparison. A
 * FuzzySuggestModal rather than the header's model popover: the popover
 * changes the conversation's model, and this must not.
 */
export class ModelSuggestModal extends FuzzySuggestModal<ModelInfo> {
	constructor(
		app: App,
		private readonly hasKey: (provider: Provider) => boolean,
		private readonly excludeIds: string[],
		private readonly onChoose: (model: ModelInfo) => void,
	) {
		super(app);
		this.setPlaceholder(t("searchModels"));
		this.setInstructions([
			{ command: "↑↓", purpose: t("instrNavigate") },
			{ command: "↵",  purpose: t("instrRunModel") },
			{ command: "esc", purpose: t("instrDismiss") },
		]);
	}

	/** The models the picker would offer — exposed so a caller can decline to
	 *  open an empty picker and say why instead. */
	static candidates(hasKey: (provider: Provider) => boolean, excludeIds: string[]): ModelInfo[] {
		const exclude = new Set(excludeIds);
		return MODEL_CATALOG.filter((m) => !m.hidden && hasKey(m.provider) && !exclude.has(m.id));
	}

	getItems(): ModelInfo[] {
		return ModelSuggestModal.candidates(this.hasKey, this.excludeIds);
	}

	getItemText(item: ModelInfo): string {
		const profile = profileLine(item.id, getLang());
		return `${item.abbreviation} — ${item.provider}`
			+ (item.isReasoning || item.isMistralReasoning ? ` · ${t("reasoningTag")}` : "")
			+ (profile ? ` · ${profile}` : "");
	}

	onChooseItem(item: ModelInfo): void {
		this.onChoose(item);
	}
}
