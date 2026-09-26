// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import "./helpers/viewHarness"; // Obsidian's DOM helpers (createDiv, empty, …)
import { Notice } from "obsidian";
import { AnswerTabsController, type AnswerTabsDeps } from "../ui/AnswerTabsController";
import type { Conversation, Message } from "../models/types";

const shown = (): string[] => (Notice as unknown as { shown: string[] }).shown;

const kept = (): Message => ({
	id: "a1", role: "assistant", content: "KEPT", timestamp: "2026-09-25T10:00:00Z", model: "claude-sonnet-5",
	alternatives: [
		{ id: "b1", provider: "openai", model: "gpt-4o", content: "ANSWER B", timestamp: "2026-09-25T10:00:10Z" },
		{ id: "c1", provider: "mistral", model: "mistral-large-latest", content: "ANSWER C", timestamp: "" },
	],
});

function harness(messages: Message[], opts: { streaming?: boolean } = {}) {
	const conv = { id: "conv", messages, provider: "anthropic", model: "claude-sonnet-5" } as unknown as Conversation;
	const save = vi.fn().mockResolvedValue(undefined);
	const deps: AnswerTabsDeps = {
		plugin: { app: {}, settings: { showCost: false }, conversationStore: { save } } as unknown as AnswerTabsDeps["plugin"],
		getConversation: () => conv,
		isStreaming: () => opts.streaming ?? false,
		renderAnswer: async (md, el) => { el.textContent = md; },
		paintMarks: vi.fn(),
		rerender: vi.fn(),
	};
	const tabs = new AnswerTabsController(deps);
	const draw = (msg: Message) => {
		const row = document.createElement("div");
		const body = row.createDiv({ cls: "p-ai-body" });
		body.textContent = msg.content;
		row.createDiv({ cls: "p-sources" });
		tabs.paint(row, body, msg);
		return { row, body };
	};
	return { conv, deps, tabs, draw, save };
}

beforeEach(() => { shown().length = 0; });

describe("AnswerTabsController — a kept comparison keeps its tabs (ADR-219)", () => {
	it("draws nothing for an answer without tabs", () => {
		const { draw } = harness([]);
		const { row } = draw({ id: "x", role: "assistant", content: "plain", timestamp: "" });
		expect(row.querySelector(".p-answer-tabs")).toBeNull();
	});

	it("puts the kept tab first, marked, and shows the kept answer", () => {
		const msg = kept();
		const { draw } = harness([msg]);
		const { row, body } = draw(msg);
		const tabs = [...row.querySelectorAll<HTMLElement>(".p-answer-tab")];
		expect(tabs.map((t) => t.textContent)).toEqual(["Sonnet 5", "GPT-4o", "Mistral Large"]);
		expect(tabs[0].classList.contains("is-kept")).toBe(true);
		expect(tabs[0].getAttribute("aria-current")).toBe("true");
		expect(tabs[0].classList.contains("is-active")).toBe(true);
		expect(body.hidden).toBe(false);
		expect(row.querySelector<HTMLElement>(".p-answer-alt")!.hidden).toBe(true);
	});

	it("shows another answer in place and hides what belongs to the kept one", async () => {
		const msg = kept();
		const { draw, deps } = harness([msg]);
		const { row, body } = draw(msg);
		row.querySelectorAll<HTMLElement>(".p-answer-tab")[1].click();
		await Promise.resolve();
		expect(body.hidden).toBe(true);
		expect(row.querySelector<HTMLElement>(":scope > .p-sources")!.hidden).toBe(true);
		const alt = row.querySelector<HTMLElement>(".p-answer-alt")!;
		expect(alt.hidden).toBe(false);
		expect(alt.querySelector(".p-answer-alt-body")?.textContent).toBe("ANSWER B");
		expect(deps.paintMarks).toHaveBeenCalledWith(expect.any(HTMLElement), "b1");
		// Back to the kept tab.
		row.querySelectorAll<HTMLElement>(".p-answer-tab")[0].click();
		expect(body.hidden).toBe(false);
		expect(alt.hidden).toBe(true);
	});

	it("offers 'Use this answer' on the last answer, and switching makes that tab the kept one", async () => {
		const msg = kept();
		const { draw, conv, save, deps } = harness([{ id: "u1", role: "user", content: "q", timestamp: "" }, msg]);
		const { row } = draw(msg);
		row.querySelectorAll<HTMLElement>(".p-answer-tab")[2].click();
		const use = row.querySelector<HTMLButtonElement>(".p-answer-use");
		expect(use).not.toBeNull();
		use!.click();
		await Promise.resolve(); await Promise.resolve();
		expect(conv.messages[1]).toMatchObject({ id: "c1", content: "ANSWER C" });
		expect(conv.messages[1].alternatives?.map((c) => c.id)).toEqual(["b1", "a1"]);
		expect(save).toHaveBeenCalled();
		expect(deps.rerender).toHaveBeenCalled();
		expect(shown()[0]).toMatch(/Mistral Large/);
	});

	it("does not offer the switch once a later turn exists, or while streaming", () => {
		const msg = kept();
		const later = harness([msg, { id: "u2", role: "user", content: "more", timestamp: "" }]);
		const r1 = later.draw(msg).row;
		r1.querySelectorAll<HTMLElement>(".p-answer-tab")[1].click();
		expect(r1.querySelector(".p-answer-use")).toBeNull();

		const streaming = harness([msg], { streaming: true });
		const r2 = streaming.draw(msg).row;
		r2.querySelectorAll<HTMLElement>(".p-answer-tab")[1].click();
		expect(r2.querySelector(".p-answer-use")).toBeNull();
	});

	it("remembers the tab on screen across a re-render, for the session", () => {
		const msg = kept();
		const { draw } = harness([msg]);
		draw(msg).row.querySelectorAll<HTMLElement>(".p-answer-tab")[1].click();
		const again = draw(msg);
		expect(again.body.hidden).toBe(true);
		expect(again.row.querySelector(".p-answer-alt-body")?.textContent).toBe("ANSWER B");
	});
});
