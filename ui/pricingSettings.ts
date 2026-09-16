import { Setting } from "obsidian";
import type PythiaPlugin from "../main";
import { MODEL_CATALOG } from "../models/knownModels";
import { MODEL_PRICING, PRICING_AS_OF, type PriceOverride } from "../models/modelPricing";
import { t } from "../i18n";

/**
 * The price table in the settings tab (ADR-163): the disclaimer, then one row
 * per catalog model with two fields — input and output USD per million
 * tokens. A field's placeholder is Pythia's built-in list price; typing a
 * value overrides it, clearing the field restores it. Cache prices follow
 * the input price at the built-in ratio and are not shown: two numbers a
 * user can check against a price page beat four they cannot.
 *
 * The disclaimer is the point, not decoration: the built-in prices are an
 * assumption Pythia tries to keep current and cannot guarantee. It says so
 * where the numbers are edited, and the label tooltip says so where they
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

	containerEl.createEl("h3", { text: t("pricingSection") });
	containerEl.createDiv({ cls: "pythia-modal-desc p-pricing-disclaimer", text: t("pricingDisclaimer", { date: PRICING_AS_OF }) });

	const providers: { key: string; label: string }[] = [
		{ key: "anthropic", label: t("providerAnthropic") },
		{ key: "openai",    label: t("providerOpenAI") },
		{ key: "mistral",   label: t("providerMistral") },
	];
	const fieldLabel = { input: t("pricingInputLabel"), output: t("pricingOutputLabel") };
	for (const p of providers) {
		const models = MODEL_CATALOG.filter((m) => m.provider === p.key && !m.hidden && MODEL_PRICING[m.id]);
		if (!models.length) continue;
		containerEl.createEl("h4", { cls: "p-pricing-group", text: p.label });
		for (const m of models) {
			const base = MODEL_PRICING[m.id];
			const row = new Setting(containerEl)
				.setName(m.abbreviation)
				.setDesc(t("pricingRowDesc", { input: String(base.input), output: String(base.output) }));
			row.settingEl.addClass("p-pricing-row");
			for (const field of ["input", "output"] as const) {
				row.addText((text) => {
					text.inputEl.inputMode = "decimal";
					text.inputEl.addClass("p-pricing-field");
					text.inputEl.setAttribute("aria-label", `${m.abbreviation} ${fieldLabel[field]}`);
					const current = plugin.settings.priceOverrides[m.id]?.[field];
					text
						.setPlaceholder(`${fieldLabel[field]} ${base[field]}`)
						.setValue(current !== undefined ? String(current) : "")
						.onChange((value) => {
							const trimmed = value.trim().replace(",", ".");
							const n = trimmed === "" ? undefined : Number(trimmed);
							const valid = n === undefined || (Number.isFinite(n) && n >= 0);
							text.inputEl.toggleClass("p-field-invalid", !valid);
							if (!valid) return;
							const entry: PriceOverride = { ...(plugin.settings.priceOverrides[m.id] ?? {}) };
							if (n === undefined) delete entry[field]; else entry[field] = n;
							const next = { ...plugin.settings.priceOverrides };
							if (entry.input === undefined && entry.output === undefined) delete next[m.id]; else next[m.id] = entry;
							plugin.settings.priceOverrides = next;
							plugin.saveSettingsSoon();
						});
				});
			}
		}
	}
}
