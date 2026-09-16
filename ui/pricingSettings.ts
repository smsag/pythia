import { Setting } from "obsidian";
import type PythiaPlugin from "../main";
import { PRICING_AS_OF } from "../models/modelPricing";
import { t } from "../i18n";

const SOURCE_URL = "https://models.dev";

/**
 * The cost setting (ADR-163): the toggle and, under it, the disclaimer. No
 * price table — the prices come from models.dev through a weekly pull request
 * and a wrong one is fixed there, for everyone, not in one vault's settings.
 *
 * The disclaimer is the point, not decoration: the figures are an estimate
 * Pythia tries to keep current and cannot guarantee. It says so where the
 * feature is switched on, and the label tooltip says so where the numbers
 * are read.
 */
export function renderPricingSettings(containerEl: HTMLElement, plugin: PythiaPlugin): void {
	new Setting(containerEl)
		.setName(t("showCostName"))
		.setDesc(t("showCostDesc", { date: PRICING_AS_OF }))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showCost).onChange(async (value) => {
				plugin.settings.showCost = value;
				await plugin.saveSettings();
			})
		);

	const note = containerEl.createDiv({ cls: "pythia-modal-desc p-pricing-disclaimer" });
	// The source is a link, so "models.dev" is checkable in one tap rather
	// than a name to look up.
	const [before, after] = t("pricingDisclaimer", { date: PRICING_AS_OF }).split("{{source}}");
	note.appendText(before);
	note.createEl("a", { text: "models.dev", href: SOURCE_URL });
	note.appendText(after ?? "");
}
