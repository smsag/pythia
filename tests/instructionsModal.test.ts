// @vitest-environment happy-dom
//
// "What Pythia sends" (ADR-232, #258): the conversation's instructions, the
// template, the custom instructions, the history and the whole prompt — read
// off the conversation, never a second copy of the prompt builder.
import { describe, it, expect, beforeEach } from "vitest";
import { makePlugin, seedConversation, userMsg, aiMsg } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { InstructionsModal, instructionFacts } from "../suggest/InstructionsModal";
import { previewSystemPrompt } from "../services/sendPreview";
import { t } from "../i18n";

function open(plugin: InstanceType<typeof PythiaPlugin>, conv: Conversation, onChanged = () => {}) {
	const modal = new InstructionsModal(plugin.app, plugin, conv, onChanged);
	const m = modal as unknown as { contentEl: HTMLElement; modalEl: HTMLElement };
	m.modalEl = document.createElement("div");
	m.contentEl = m.modalEl.createDiv();
	modal.onOpen();
	return m.contentEl;
}

describe("instructionFacts", () => {
	it("names the template by its note name and trims the texts", () => {
		const facts = instructionFacts({
			templateId: "Templates/Podcast Summary.md", systemPrompt: "  Be brief.  ", resumeMode: "full", messages: [],
		} as unknown as Conversation, "  Use British English. ");
		expect(facts.template).toBe("Podcast Summary");
		expect(facts.conversationPrompt).toBe("Be brief.");
		expect(facts.customInstructions).toBe("Use British English.");
		expect(facts.omitted).toBe(0);
	});
	it("reports an armed template separately from the one the conversation came from", () => {
		const facts = instructionFacts({
			systemPrompt: "", resumeMode: "full", messages: [],
			pendingTemplate: { id: "T/Critic.md", name: "Critic", systemPrompt: "x" },
		} as unknown as Conversation, "");
		expect(facts.template).toBeNull();
		expect(facts.pendingTemplate).toBe("Critic");
	});
});

describe("InstructionsModal (ADR-232)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;
	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
	});

	it("shows the conversation's and the user's instructions, and the whole prompt as built", async () => {
		plugin.settings.customInstructions = "Always cite the page.";
		const conv = await seedConversation(plugin, { name: "C", systemPrompt: "You are a tax advisor.", messages: [] } as Partial<Conversation>);
		const el = open(plugin, conv);
		const texts = Array.from(el.querySelectorAll("pre")).map((p) => p.textContent);
		expect(texts[0]).toBe("You are a tax advisor.");
		expect(texts[1]).toBe("Always cite the page.");
		expect(texts[2]).toBe(previewSystemPrompt(conv, plugin.settings));
		expect(el.textContent).toContain(t("instrHistoryFull"));
	});

	it("says None for an empty prompt and offers full history on a reduced one", async () => {
		plugin.settings.customInstructions = "";
		let changed = 0;
		const conv = await seedConversation(plugin, {
			name: "R", systemPrompt: "", resumeMode: "summary", resumedAfterId: "m2",
			messages: [userMsg("m1", "q"), aiMsg("m2", "a")],
		} as Partial<Conversation>);
		const el = open(plugin, conv, () => { changed++; });
		expect(el.textContent).toContain(t("instrNone"));
		const btn = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === t("ctxSendFullHistory"));
		expect(btn).toBeDefined();
		btn?.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(conv.resumeMode).toBe("full");
		expect(changed).toBe(1);
		expect(el.textContent).toContain(t("instrHistoryFull"));
	});
});
