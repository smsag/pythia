// @vitest-environment happy-dom
//
// ADR-193: a reference leads with the icon of its source type — the icon of the
// toolbar control that brings it in — instead of [[ ]] brackets, bold, or a
// trailing ↗. One map (SOURCE_ICONS in ui/icons.ts) feeds the toolbar, the
// reference row, the sources row and the context box.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { makePlugin, mountView, seedConversation, userMsg } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { SOURCE_ICONS } from "../ui/icons";
import { t } from "../i18n";

const root = process.cwd();
const uiSources = ["sidebar.ts", "main.ts", ...readdirSync(resolve(root, "ui")).filter((f) => f.endsWith(".ts")).map((f) => join("ui", f))];

describe("one source icon per type (ADR-193)", () => {
	it("no UI code draws a link with brackets or a trailing ↗", () => {
		const offenders: string[] = [];
		for (const f of uiSources) {
			if (f === join("ui", "icons.ts")) continue;
			const src = readFileSync(resolve(root, f), "utf8");
			if (/text:\s*["`]\[\[["`]|text:\s*["`]\]\]["`]/.test(src)) offenders.push(`${f}: [[ ]] brackets`);
			if (/["`][^"`\n]*↗[^"`\n]*["`]/.test(src)) offenders.push(`${f}: ↗`);
		}
		expect(offenders).toEqual([]);
	});

	it("the source icons are named only in ui/icons.ts — the toolbar reads them from there too", () => {
		const offenders: string[] = [];
		for (const f of uiSources) {
			if (f === join("ui", "icons.ts")) continue;
			const src = readFileSync(resolve(root, f), "utf8");
			for (const id of Object.values(SOURCE_ICONS)) {
				if (id === "save") continue; // too common a word to scan for; the save button is inline SVG
				if (src.includes(`"${id}"`)) offenders.push(`${f}: "${id}"`);
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe("the reference row", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;
	beforeEach(async () => { document.body.innerHTML = ""; plugin = await makePlugin(); });

	it("leads every pill with its source icon, and shows no brackets", async () => {
		await seedConversation(plugin, {
			name: "C",
			messages: [userMsg("m1", "q")],
			pendingTemplate: { id: "Templates/Podcast.md", name: "Podcast Summary", systemPrompt: "x" },
			contextNotes: ["Notes/Karussell.md"],
			savedNotePath: "Out/Answer.md",
		} as Partial<Conversation>);
		const { pane } = await mountView(plugin);
		const pills = Array.from(pane().querySelectorAll<HTMLElement>(".p-pills .p-wikilink"));
		const icons = pills.map((p) => p.querySelector(".p-source-icon")?.getAttribute("data-icon"));
		expect(icons).toEqual([SOURCE_ICONS.template, SOURCE_ICONS.note, SOURCE_ICONS.output]);
		expect(pills.map((p) => p.textContent).join(" ")).not.toMatch(/\[\[|\]\]/);
		// The icon is decoration; the name stays the link.
		expect(pills[1].querySelector(".p-source-icon")?.getAttribute("aria-hidden")).toBe("true");
		expect(pills[1].querySelector(".p-wikilink-name")?.textContent).toBe("Karussell");
	});

	it("the toolbar's template, web and vault buttons carry the same icons as the pills", async () => {
		await seedConversation(plugin, { name: "C", messages: [] } as Partial<Conversation>);
		const { pane } = await mountView(plugin);
		const iconOf = (title: string) => pane().querySelector(`.p-tool-btn[title="${title}"]`)?.getAttribute("data-icon");
		expect(iconOf(t("applyTemplateTooltip"))).toBe(SOURCE_ICONS.template);
		expect(iconOf(t("researchToggleTooltip"))).toBe(SOURCE_ICONS.web);
		expect(iconOf(t("vaultContextTooltip"))).toBe(SOURCE_ICONS.auto);
	});
});
