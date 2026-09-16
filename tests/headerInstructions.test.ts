// @vitest-environment happy-dom
//
// The header's instruction group (ADR-165): model | effort | language, each
// readable at a glance and changeable in one tap, plus the menu that took over
// rename and copy link.

import { describe, it, expect, beforeEach } from "vitest";
import { makePlugin, mountView, seedConversation, userMsg } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";

const seg = (pane: () => Element, cls: string): HTMLElement =>
	pane().querySelector<HTMLElement>(`.p-header .p-inst-${cls}`)!;
const click = (el: Element): void => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); };
const choiceRows = (pane: () => Element): HTMLElement[] =>
	Array.from(pane().querySelectorAll<HTMLElement>(".p-choice-pop .p-choice-row"));
/** Picker rows select on mousedown, like the model popover. */
const pick = (pane: () => Element, label: string): void => {
	const row = choiceRows(pane).find((r) => r.querySelector(".p-choice-label")?.textContent === label);
	if (!row) throw new Error(`no picker row "${label}"`);
	row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
};

describe("header instructions (ADR-165)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;

	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
		plugin.settings.effort = "high";
		plugin.settings.outputLanguage = "auto";
	});

	async function open(over: Partial<Conversation> = {}) {
		const conv = await seedConversation(plugin, { name: "EZB", messages: [userMsg("m1", "hi")], ...over } as Partial<Conversation>);
		const mounted = await mountView(plugin);
		return { conv, ...mounted };
	}

	it("shows model, resolved effort and language; rename and link left the header", async () => {
		const { pane } = await open({ provider: "anthropic", model: "claude-sonnet-5" });
		expect(seg(pane, "model").textContent).toBe("Sonnet 5");
		expect(seg(pane, "effort").textContent).toBe(t("effortLevelHigh"));
		expect(seg(pane, "lang").textContent).toBe("AUTO");
		expect(seg(pane, "effort").classList.contains("is-pinned")).toBe(false);
		expect(seg(pane, "lang").classList.contains("is-pinned")).toBe(false);
		expect(pane().querySelector(".p-rename-btn")).toBeNull();
		expect(pane().querySelector(".p-header .p-hdr-menu")).not.toBeNull();
	});

	it("tints a value set for this conversation", async () => {
		const { pane } = await open({ provider: "anthropic", model: "claude-sonnet-5", outputLanguage: "de", effort: "low" });
		expect(seg(pane, "lang").textContent).toBe("DE");
		expect(seg(pane, "lang").classList.contains("is-pinned")).toBe(true);
		expect(seg(pane, "effort").textContent).toBe(t("effortLevelLow"));
		expect(seg(pane, "effort").classList.contains("is-pinned")).toBe(true);
	});

	it("picking a language pins it; picking the default stores undefined, never today's value", async () => {
		const { pane, conv } = await open({ provider: "anthropic", model: "claude-sonnet-5" });
		click(seg(pane, "lang"));
		pick(pane, t("outputLanguageGerman"));
		expect(conv.outputLanguage).toBe("de");
		expect(seg(pane, "lang").textContent).toBe("DE");
		expect(seg(pane, "lang").classList.contains("is-pinned")).toBe(true);

		click(seg(pane, "lang"));
		pick(pane, t("convLanguageDefault", { v: t("outputLanguageAuto") }));
		expect(conv.outputLanguage).toBeUndefined();
		expect(seg(pane, "lang").classList.contains("is-pinned")).toBe(false);
	});

	it("picking an effort pins it; the default returns to inherit", async () => {
		const { pane, conv } = await open({ provider: "anthropic", model: "claude-sonnet-5" });
		click(seg(pane, "effort"));
		pick(pane, t("effortLevelLow"));
		expect(conv.effort).toBe("low");

		click(seg(pane, "effort"));
		pick(pane, t("effortSegmentDefaultWith", { v: t("effortLevelHigh") }));
		expect(conv.effort).toBeUndefined();
		expect(seg(pane, "effort").textContent).toBe(t("effortLevelHigh"));
	});

	it("a model without effort shows a dimmed dash and opens no picker", async () => {
		const { pane } = await open({ provider: "openai", model: "gpt-4o", effort: "low" });
		expect(seg(pane, "effort").textContent).toBe("—");
		expect(seg(pane, "effort").classList.contains("is-off")).toBe(true);
		expect(seg(pane, "effort").classList.contains("is-pinned")).toBe(false);
		click(seg(pane, "effort"));
		expect(choiceRows(pane)).toHaveLength(0);
	});

	it("follows a changed global default when the settings tab closes", async () => {
		const { pane, view } = await open({ provider: "anthropic", model: "claude-sonnet-5" });
		plugin.settings.effort = "medium";
		plugin.settings.outputLanguage = "en";
		view.refreshInstructions(); // what onSettingsTabClosed reaches through the view manager
		expect(seg(pane, "effort").textContent).toBe(t("effortLevelMedium"));
		expect(seg(pane, "lang").textContent).toBe("EN");
		expect(seg(pane, "lang").classList.contains("is-pinned")).toBe(false);
	});

	it("the menu holds rename, copy link and conversation settings", async () => {
		const { pane } = await open();
		click(pane().querySelector(".p-header .p-hdr-menu")!);
		const labels = choiceRows(pane).map((r) => r.querySelector(".p-choice-label")?.textContent);
		expect(labels).toEqual([t("renameConvTooltip"), t("copyConvLinkTooltip"), t("openConvSettings")]);

		pick(pane, t("renameConvTooltip"));
		const wrap = pane().querySelector<HTMLElement>(".p-rename-wrap")!;
		expect(wrap.style.display).toBe("");
	});
});
