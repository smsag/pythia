// @vitest-environment happy-dom
//
// Turn micro-label rules (ADR-067/081/129). `ui/turnLabel.ts` is a pure function
// of (row, message, conversation), so these run without mounting the view —
// which is the point of the ADR-097 extraction out of `sidebar.ts`.

import { describe, it, expect, beforeEach } from "vitest";
import { renderTurnLabel, turnTemplateCaption, isFirstMessageOfDay } from "../ui/turnLabel";
import type { Conversation, Message } from "../models/types";

// Obsidian extends Element.prototype with these at runtime; happy-dom does not.
function installDomHelpers(): void {
	type Opts = { cls?: string; text?: string; attr?: Record<string, string> };
	const proto = (globalThis as unknown as { Element: { prototype: Record<string, unknown> } }).Element.prototype;
	proto.createEl = function (this: Element, tag: string, o?: Opts): Element {
		const el = document.createElement(tag);
		if (o?.cls) (el as HTMLElement).className = o.cls;
		if (o?.text != null) el.textContent = o.text;
		if (o?.attr) for (const k in o.attr) el.setAttribute(k, o.attr[k]);
		this.appendChild(el);
		return el;
	};
	proto.createDiv = function (this: Element, o?: Opts): Element {
		return (this as unknown as { createEl: (t: string, o?: Opts) => Element }).createEl("div", o);
	};
	proto.createSpan = function (this: Element, o?: Opts): Element {
		return (this as unknown as { createEl: (t: string, o?: Opts) => Element }).createEl("span", o);
	};
}
installDomHelpers();

const TS = "2026-09-12T20:19:00.000Z";
const user = (id: string, over: Partial<Message> = {}): Message =>
	({ id, role: "user", content: "q", timestamp: TS, ...over });
const ai = (id: string, over: Partial<Message> = {}): Message =>
	({ id, role: "assistant", content: "a", timestamp: TS, model: "claude-sonnet-4-6", ...over });

const conversation = (over: Partial<Conversation> = {}): Conversation =>
	({ id: "c1", name: "Test", messages: [], model: "claude-sonnet-4-6", ...over } as Conversation);

/** Render every message of `conv` and return the caption text per assistant turn
 *  (empty string where no caption was rendered). */
function captions(conv: Conversation): string[] {
	const out: string[] = [];
	for (const msg of conv.messages) {
		const row = document.createElement("div");
		document.body.appendChild(row);
		renderTurnLabel(row, msg, conv);
		if (msg.role === "assistant") {
			out.push(row.querySelector(".p-turn-template")?.textContent?.trim() ?? "");
		}
	}
	return out;
}

describe("turn labels — template caption (ADR-129)", () => {
	beforeEach(() => { document.body.innerHTML = ""; });

	it("captions only the first assistant turn of a templated conversation", () => {
		const tpl = "Templates/Podcast Summary.md";
		const conv = conversation({
			templateId: tpl,
			messages: [user("u1"), ai("a1", { templateId: tpl }), user("u2"), ai("a2", { templateId: tpl })],
		});

		expect(captions(conv)).toEqual(["· PODCAST SUMMARY", ""]);
	});

	it("captions again where a second template takes over mid-conversation", () => {
		const first = "Templates/Podcast Summary.md";
		const second = "Templates/Meeting Notes.md";
		const conv = conversation({
			templateId: second,
			messages: [
				user("u1"), ai("a1", { templateId: first }),
				user("u2"), ai("a2", { templateId: second }),
				user("u3"), ai("a3", { templateId: second }),
			],
		});

		expect(captions(conv)).toEqual(["· PODCAST SUMMARY", "· MEETING NOTES", ""]);
	});

	it("captions the first answer of a legacy conversation whose messages predate templateId", () => {
		const conv = conversation({
			templateId: "Templates/Podcast Summary.md",
			messages: [user("u1"), ai("a1"), user("u2"), ai("a2")],
		});

		expect(captions(conv)).toEqual(["· PODCAST SUMMARY", ""]);
	});

	it("renders no caption when the conversation has no template", () => {
		const conv = conversation({ messages: [user("u1"), ai("a1")] });

		expect(captions(conv)).toEqual([""]);
	});

	it("captions a streaming placeholder (not yet in the message array) on the first turn only", () => {
		const tpl = "Templates/Podcast Summary.md";
		const streaming = ai("", { templateId: tpl });

		const empty = conversation({ templateId: tpl, messages: [user("u1")] });
		expect(turnTemplateCaption(streaming, empty)).toBe(tpl);

		const answered = conversation({
			templateId: tpl,
			messages: [user("u1"), ai("a1", { templateId: tpl }), user("u2")],
		});
		expect(turnTemplateCaption(streaming, answered)).toBeUndefined();
	});

	it("carries the full template path as the caption tooltip", () => {
		const row = document.createElement("div");
		renderTurnLabel(row, ai("a1", { templateId: "Templates/Podcast Summary.md" }), conversation());

		expect(row.querySelector(".p-turn-template")?.getAttribute("title")).toContain("Podcast Summary");
	});
});

describe("turn labels — no role captions (ADR-129)", () => {
	beforeEach(() => { document.body.innerHTML = ""; });

	it("labels the model and time but no DU/PYTHIA caption", () => {
		const conv = conversation({ messages: [user("u1"), ai("a1")] });
		const rows = conv.messages.map((msg) => {
			const row = document.createElement("div");
			renderTurnLabel(row, msg, conv);
			return row.querySelector(".p-turn-label")?.textContent ?? "";
		});

		expect(rows.join(" ")).not.toMatch(/PYTHIA|\bDU\b|\bYOU\b/);
		expect(rows[1]).toContain("SONNET 4.6"); // model still labelled
	});

	it("still anchors the day on the first user turn", () => {
		const conv = conversation({ messages: [user("u1")] });
		expect(isFirstMessageOfDay(conv.messages[0], conv)).toBe(true);

		const row = document.createElement("div");
		renderTurnLabel(row, conv.messages[0], conv);
		expect(row.querySelector(".p-turn-label")?.textContent).toMatch(/2026/);
	});
});
