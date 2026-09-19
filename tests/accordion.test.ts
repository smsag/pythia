// @vitest-environment happy-dom
//
// ADR-192: the context inspector and the summary cards are ONE accordion.
// Same structure (so the same CSS), a real <button> header with aria-expanded,
// and actions beside the toggle rather than inside it.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { makePlugin, mountView, seedConversation, userMsg } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { buildAccordion, setAccordionOpen } from "../ui/accordion";

describe("buildAccordion", () => {
	beforeEach(() => { document.body.innerHTML = ""; });

	it("is a button header that toggles, reports its state and controls its body", () => {
		let seen: boolean | null = null;
		const acc = buildAccordion(document.body, { cls: "x", icon: "star", title: "T", onToggle: (o) => { seen = o; } });
		expect(acc.toggle.tagName).toBe("BUTTON");
		expect(acc.toggle.getAttribute("aria-expanded")).toBe("false");
		expect(acc.toggle.getAttribute("aria-controls")).toBe(acc.body.id);
		acc.toggle.click();
		expect(acc.root.classList.contains("open")).toBe(true);
		expect(acc.toggle.getAttribute("aria-expanded")).toBe("true");
		expect(seen).toBe(true);
		setAccordionOpen(acc.root, false);
		expect(acc.toggle.getAttribute("aria-expanded")).toBe("false");
	});

	it("keeps actions outside the toggle (a button inside a button is invalid)", () => {
		const acc = buildAccordion(document.body, { cls: "x", icon: "star", title: "T" });
		const act = acc.actions.createEl("button", { text: "↻" });
		expect(acc.toggle.contains(act)).toBe(false);
		act.click();
		expect(acc.root.classList.contains("open")).toBe(false);
	});
});

describe("both boxes use it", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;
	beforeEach(async () => { document.body.innerHTML = ""; plugin = await makePlugin(); });

	it("the summary card is an accordion with its regenerate beside the toggle", async () => {
		await seedConversation(plugin, { name: "C", summaryText: "S.", summaryUpdatedAt: "2026-09-01T10:00:00.000Z", messages: [userMsg("m1", "q")] } as Partial<Conversation>);
		const { pane } = await mountView(plugin);
		const card = pane().querySelector<HTMLElement>(".p-summary-card")!;
		expect(card.classList.contains("p-acc")).toBe(true);
		const toggle = card.querySelector<HTMLButtonElement>(".p-acc-head > .p-acc-toggle")!;
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(card.querySelector(".p-acc-actions .p-summary-card-regen")).not.toBeNull();
		expect(toggle.querySelector("button")).toBeNull();
		toggle.click();
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
	});

	it("no hand-built header survives in either controller", () => {
		for (const f of ["ui/SummaryController.ts", "ui/ContextInspectorController.ts"]) {
			const src = readFileSync(resolve(process.cwd(), f), "utf8");
			expect(src, f).toContain("buildAccordion(");
			expect(src, f).not.toMatch(/p-(summary-card|inspector)-(header|chevron)/);
			expect(src, f).not.toMatch(/"[▸▾]"/);
		}
	});
});
