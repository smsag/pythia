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

/** The template each assistant turn of `conv` is credited with, "" where none.
 *  Since ADR-140 the credit is rendered by the sources row, not the turn label,
 *  but the rule deciding *which* turns carry it is still this one. */
function captions(conv: Conversation): string[] {
	return conv.messages
		.filter((m) => m.role === "assistant")
		.map((m) => turnTemplateCaption(m, conv) ?? "");
}

describe("turn labels — which turns carry the template (ADR-129/140)", () => {
	beforeEach(() => { document.body.innerHTML = ""; });

	it("captions only the first assistant turn of a templated conversation", () => {
		const tpl = "Templates/Podcast Summary.md";
		const conv = conversation({
			templateId: tpl,
			messages: [user("u1"), ai("a1", { templateId: tpl }), user("u2"), ai("a2", { templateId: tpl })],
		});

		expect(captions(conv)).toEqual([tpl, ""]);
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

		expect(captions(conv)).toEqual([first, second, ""]);
	});

	it("captions the first answer of a legacy conversation whose messages predate templateId", () => {
		const tpl = "Templates/Podcast Summary.md";
		const conv = conversation({
			templateId: tpl,
			messages: [user("u1"), ai("a1"), user("u2"), ai("a2")],
		});

		expect(captions(conv)).toEqual([tpl, ""]);
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

	it("no longer writes the template into the turn label (ADR-140)", () => {
		// It lives in the sources row now; two copies on one turn is noise.
		const row = document.createElement("div");
		renderTurnLabel(row, ai("a1", { templateId: "Templates/Podcast Summary.md" }), conversation());

		expect(row.querySelector(".p-turn-template")).toBeNull();
		expect(row.textContent).not.toContain("PODCAST");
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

describe("turn labels — cost per answer (ADR-163)", () => {
	beforeEach(() => { document.body.innerHTML = ""; });
	const usage = { inputTokens: 1000, outputTokens: 600 };

	it("appends an estimated price after the token counts when enabled", () => {
		const row = document.createElement("div");
		const msg = ai("a1", { tokenUsage: usage });
		renderTurnLabel(row, msg, conversation({ messages: [msg] }), { showCost: true });
		const cost = row.querySelector(".p-turn-cost");
		expect(cost?.textContent).toBe(" · ≈ $0.012"); // sonnet: 1000×3 + 600×15 per million
		expect(cost?.getAttribute("title")).toContain("2026");
		// The counts are still there, ahead of the price.
		expect(row.querySelector(".p-turn-tokens")).not.toBeNull();
	});

	it("appends nothing when the setting is off, or the model has no price row", () => {
		const off = document.createElement("div");
		const msg = ai("a1", { tokenUsage: usage });
		renderTurnLabel(off, msg, conversation({ messages: [msg] }));
		expect(off.querySelector(".p-turn-cost")).toBeNull();

		const custom = document.createElement("div");
		const m2 = ai("a2", { tokenUsage: usage, model: "my-fine-tune" });
		renderTurnLabel(custom, m2, conversation({ messages: [m2] }), { showCost: true });
		expect(custom.querySelector(".p-turn-cost")).toBeNull();
		expect(custom.querySelector(".p-turn-tokens")).not.toBeNull();
	});
});

describe("turn labels — stored cost wins (ADR-163)", () => {
	it("renders the snapshot and its date, not a live estimate", () => {
		const row = document.createElement("div");
		const msg = ai("a1", { tokenUsage: { inputTokens: 1000, outputTokens: 600 }, cost: { usd: 0.5, asOf: "2025-01-01" } });
		renderTurnLabel(row, msg, conversation({ messages: [msg] }), { showCost: true });
		const cost = row.querySelector(".p-turn-cost");
		expect(cost?.textContent).toBe(" · ≈ $0.50");
		expect(cost?.getAttribute("title")).toContain("2025-01-01");
	});
});
