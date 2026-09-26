// @vitest-environment happy-dom
//
// The settings' resume mode preselects the Resume dialog (ADR-233, D-63).
import { describe, it, expect } from "vitest";
import "./helpers/viewHarness";
import { preselectedResumeMode, resumeChoiceOrder, ResumeModeModal } from "../suggest/ResumeModeModal";
import type { Conversation } from "../models/types";
import { t } from "../i18n";

describe("preselectedResumeMode", () => {
	it("follows the settings for a conversation on full history", () => {
		expect(preselectedResumeMode({ resumeMode: "full" }, "hybrid")).toBe("hybrid");
		expect(preselectedResumeMode({ resumeMode: "full" }, "full")).toBe("full");
	});
	it("keeps a conversation's own summary or hybrid mode", () => {
		expect(preselectedResumeMode({ resumeMode: "summary" }, "full")).toBe("summary");
		expect(preselectedResumeMode({ resumeMode: "hybrid" }, "summary")).toBe("hybrid");
	});
});

describe("the Resume dialog", () => {
	it("puts the preselected choice first, filled, and focused", () => {
		expect(resumeChoiceOrder("full")).toEqual(["full", "summary", "hybrid"]);
		const chosen: string[] = [];
		const modal = new ResumeModeModal({} as never, { name: "C" } as Conversation, "full", (m) => chosen.push(m));
		const m = modal as unknown as { contentEl: HTMLElement; modalEl: HTMLElement; close(): void };
		m.modalEl = document.createElement("div");
		m.contentEl = m.modalEl.createDiv();
		document.body.append(m.modalEl);
		m.close = () => {};
		modal.onOpen();
		const buttons = Array.from(m.contentEl.querySelectorAll("button"));
		expect(buttons.map((b) => b.textContent)).toEqual([t("fullModeBtn"), t("summaryModeBtn"), t("hybridModeBtn")]);
		expect(buttons.filter((b) => b.classList.contains("mod-cta"))).toEqual([buttons[0]]);
		expect(document.activeElement).toBe(buttons[0]);
		buttons[1].click();
		expect(chosen).toEqual(["summary"]);
	});
});
