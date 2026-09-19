// @vitest-environment happy-dom
//
// The template button lights up while a template is armed for the next answer
// (ADR-177), with the same active state as the research globe.

import { describe, it, expect, beforeEach } from "vitest";
import { makePlugin, mountView, seedConversation, userMsg } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";

const templateBtn = (pane: () => Element): HTMLElement =>
	pane().querySelector<HTMLElement>(`.p-tool-btn[title="${t("applyTemplateTooltip")}"]`)!;

describe("template toolbar button", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;
	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	it("is plain without an armed template", async () => {
		await seedConversation(plugin, { name: "A", messages: [userMsg("m1", "hi")] } as Partial<Conversation>);
		const { pane } = await mountView(plugin);
		expect(templateBtn(pane).classList.contains("is-active")).toBe(false);
		expect(templateBtn(pane).getAttribute("aria-pressed")).toBe("false");
	});

	it("is active while a template is armed, and clears with its pill", async () => {
		await seedConversation(plugin, {
			name: "A", messages: [userMsg("m1", "hi")],
			pendingTemplate: { id: "T.md", name: "Term Note", systemPrompt: "x" },
		} as Partial<Conversation>);
		const { pane } = await mountView(plugin);
		const btn = templateBtn(pane);
		expect(btn.classList.contains("is-active")).toBe(true);
		expect(btn.getAttribute("aria-pressed")).toBe("true");

		const x = pane().querySelector<HTMLElement>(".p-wikilink--template .p-wikilink-x")!;
		x.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await new Promise((r) => setTimeout(r, 0));
		expect(btn.classList.contains("is-active")).toBe(false);
	});
});
