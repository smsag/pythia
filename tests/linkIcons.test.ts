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
import { decorateNoteLinks, SOURCE_ICONS, VAULT_NOTE_ICON } from "../ui/icons";
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
				if (src.includes(`"${id}"`)) offenders.push(`${f}: "${id}"`);
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe("a vault note looks like a vault note, however it arrived (ADR-212)", () => {
	it("attached, auto-retrieved and saved notes share one icon — and it is the library", () => {
		expect(VAULT_NOTE_ICON).toBe("library");
		expect([SOURCE_ICONS.note, SOURCE_ICONS.auto, SOURCE_ICONS.output]).toEqual([VAULT_NOTE_ICON, VAULT_NOTE_ICON, VAULT_NOTE_ICON]);
	});

	it("what is not a vault note keeps its own icon", () => {
		for (const k of ["template", "web", "rewrite"] as const) expect(SOURCE_ICONS[k]).not.toBe(VAULT_NOTE_ICON);
	});

	it("a note link in a sent message leads with the icon and keeps its text", () => {
		const bubble = document.createElement("div");
		bubble.innerHTML = 'Compare <a class="internal-link" data-href="Q3 revenue" href="Q3 revenue">Q3 revenue</a> with <a class="external-link" href="https://x.org">x</a>';
		decorateNoteLinks(bubble);
		const note = bubble.querySelector<HTMLElement>("a.internal-link")!;
		expect(note.firstElementChild?.classList.contains("p-source-icon")).toBe(true);
		expect(note.firstElementChild?.getAttribute("data-icon")).toBe(VAULT_NOTE_ICON);
		expect(note.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
		// The painters match on text: the icon must add none.
		expect(bubble.textContent).toBe("Compare Q3 revenue with x");
		// A web link is not a vault note.
		expect(bubble.querySelector("a.external-link .p-source-icon")).toBeNull();
		// A re-render of the same bubble does not stack icons.
		decorateNoteLinks(bubble);
		expect(note.querySelectorAll(".p-source-icon")).toHaveLength(1);
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
		expect(pane().querySelector(".p-research-btn")?.getAttribute("data-icon")).toBe(SOURCE_ICONS.web);
		expect(iconOf(t("vaultContextTooltip"))).toBe(SOURCE_ICONS.auto);
	});
});
