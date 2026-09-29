import { App, FuzzySuggestModal } from "obsidian";
import type { PythiaTemplate } from "../models/types";
import { REWRITE_PRESETS, type RewritePreset } from "../ui/rewritePresets";
import { t } from "../i18n";

/** What "Rewrite with Pythia as…" can be asked for (ADR-247). */
export type RewriteChoice =
	| { kind: "preset"; preset: RewritePreset }
	| { kind: "template"; template: PythiaTemplate }
	| { kind: "own" };

/** The picker behind the menu entry: built-in presets, the user's templates
 *  marked `rewrite_preset: true`, and "Own instruction…" — the plain arm. */
export class RewritePresetModal extends FuzzySuggestModal<RewriteChoice> {
	constructor(app: App, private readonly templates: PythiaTemplate[], private readonly onChoose: (choice: RewriteChoice) => void) {
		super(app);
		this.setPlaceholder(t("rewritePresetPlaceholder"));
	}

	getItems(): RewriteChoice[] {
		return [
			...REWRITE_PRESETS.map((preset): RewriteChoice => ({ kind: "preset", preset })),
			...this.templates.filter((tpl) => tpl.rewritePreset).map((template): RewriteChoice => ({ kind: "template", template })),
			{ kind: "own" },
		];
	}

	getItemText(item: RewriteChoice): string {
		if (item.kind === "preset") return item.preset.label();
		if (item.kind === "template") return item.template.name;
		return t("rewritePresetOwn");
	}

	onChooseItem(item: RewriteChoice): void {
		this.onChoose(item);
	}
}
