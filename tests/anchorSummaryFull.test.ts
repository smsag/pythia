// @vitest-environment happy-dom
//
// ADR-189: the fork and merge anchors show their summary in full. ADR-141's
// five-line fold ("mehr / weniger") is gone from both — they are one component
// (ADR-142), so a test that checked only one of them would let them drift.

import { describe, it, expect, beforeEach } from "vitest";
import { makePlugin, seedConversation, now } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { ForkController } from "../ui/ForkController";
import { MergeController } from "../ui/MergeController";

// Far past five lines at any width.
const LONG = Array.from({ length: 24 }, (_, i) => `Sentence ${i + 1} of a summary that runs long.`).join(" ");
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function deps(plugin: InstanceType<typeof PythiaPlugin>, current: Conversation, messagesEl: HTMLElement) {
	return {
		plugin,
		getConversation: () => current,
		getMessagesEl: () => messagesEl,
		setActiveConversation: async () => {},
		scrollToMessage: () => {},
		expandBubbleIfCollapsed: () => {},
		renderMarkdown: (md: string, el: HTMLElement) => { el.createEl("p", { text: md }); },
		runFavoritesSummary: async () => "",
		registerDomEvent: (el: HTMLElement, type: string, cb: (ev: Event) => void) => el.addEventListener(type, cb),
	};
}

function expectFull(anchor: Element | null, bodyCls: string): void {
	expect(anchor).not.toBeNull();
	const body = anchor!.querySelector(`.${bodyCls}`)!;
	expect(body.textContent).toBe(LONG);
	expect(body.classList.contains("p-clamped")).toBe(false);
	expect(anchor!.querySelector(".p-anchor-more, .p-anchor-more-wrap")).toBeNull();
}

describe("anchor summaries are shown in full (ADR-189)", () => {
	let plugin: InstanceType<typeof PythiaPlugin>;
	let messagesEl: HTMLElement;
	let row: HTMLElement;
	beforeEach(async () => {
		document.body.innerHTML = "";
		plugin = await makePlugin();
		messagesEl = document.body.createDiv();
		row = messagesEl.createDiv({ attr: { "data-msg-id": "m1" } });
	});

	it("fork anchor: no fold, whole summary", async () => {
		const source = await seedConversation(plugin, { name: "Source" });
		const fork = await seedConversation(plugin, { name: "Fork", summaryText: LONG, forkedFrom: source.id } as Partial<Conversation>);
		const mark = row.createEl("mark", { cls: "p-fork-origin", attr: { "data-fork-id": fork.id } });
		new ForkController(deps(plugin, source, messagesEl)).toggleForkAnchor(fork.id, mark);
		// Synchronously too: happy-dom lays nothing out, so a clamp that measures
		// after a frame would find no overflow and remove itself.
		expectFull(row.querySelector(".p-fork-anchor"), "p-fork-anchor-body");
		await frame(); await frame();
		expectFull(row.querySelector(".p-fork-anchor"), "p-fork-anchor-body");
	});

	it("merge anchor: no fold, whole summary", async () => {
		const target = await seedConversation(plugin, { name: "Target", summaryText: LONG });
		const source = await seedConversation(plugin, {
			name: "Source",
			merges: [{ id: "k1", conversationId: target.id, messageId: "m1", text: "passage", createdAt: now() }],
		} as Partial<Conversation>);
		const mark = document.createElement("pythia-merge");
		mark.className = "p-merge-link";
		mark.setAttribute("data-merge-id", "k1");
		row.appendChild(mark);
		new MergeController(deps(plugin, source, messagesEl)).toggleMergeAnchor("k1", mark);
		expectFull(row.querySelector(".p-merge-anchor"), "p-merge-anchor-body");
		await frame(); await frame();
		expectFull(row.querySelector(".p-merge-anchor"), "p-merge-anchor-body");
	});
});
