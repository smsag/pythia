// @vitest-environment happy-dom
//
// ADR-216 on the real view: the pinned strip at the top of the chat — what it
// shows, how it cycles and unpins, that it follows the conversation, that the
// selection strip and a code block pin into it, and that ↗ says so when the
// source is gone.
import { describe, it, expect, beforeEach } from "vitest";
import { Notice } from "obsidian";
import { makePlugin, mountView, seedConversation, userMsg, aiMsg } from "./helpers/viewHarness";
import type PythiaPlugin from "../main";
import type { PythiaSidebarView } from "../sidebar";
import type { Conversation, Pin } from "../models/types";
import { decorateCodeBlocks } from "../ui/CodeBlockDecorator";
import type { PinController } from "../ui/PinController";
import { t } from "../i18n";

const pin = (id: string, source: string, over: Partial<Pin> = {}): Pin =>
	({ id, messageId: "a1", kind: "text", source, createdAt: "", ...over });

let plugin: InstanceType<typeof PythiaPlugin>;
let view: PythiaSidebarView;
let pane: () => Element;

const overlay = (): HTMLElement => pane().querySelector<HTMLElement>(".p-pins")!;
const wrapper = (): HTMLElement => pane().querySelector<HTMLElement>(".pythia-messages-wrapper")!;
const title = (): string => overlay().querySelector(".p-acc-title")?.textContent ?? "";
const action = (tip: string): HTMLButtonElement => overlay().querySelector<HTMLButtonElement>(`.p-pin-action[title="${tip}"]`)!;
const shown = (): string[] => (Notice as unknown as { shown: string[] }).shown;
const pins = (v: PythiaSidebarView): PinController => (v as unknown as { pins: PinController }).pins;

async function open(over: Partial<Conversation>): Promise<Conversation> {
	const conv = await seedConversation(plugin, {
		name: "Pinned", messages: [userMsg("u1", "q"), aiMsg("a1", "The first answer. It has a passage worth keeping.")], ...over,
	} as Partial<Conversation>);
	({ view, pane } = await mountView(plugin));
	await view.setActiveConversation(conv);
	return conv;
}

beforeEach(async () => {
	document.body.innerHTML = "";
	(Notice as unknown as { shown: string[] }).shown = [];
	plugin = await makePlugin();
});

describe("the strip", () => {
	it("is absent when nothing is pinned", async () => {
		await open({});
		expect(overlay().hidden).toBe(true);
		expect(wrapper().classList.contains("has-pins")).toBe(false);
	});

	it("shows one pin, collapsed, with its kind and a one-line excerpt", async () => {
		await open({ pins: [pin("p1", "a passage worth keeping\nsecond line")] });
		expect(overlay().hidden).toBe(false);
		expect(wrapper().classList.contains("has-pins")).toBe(true);
		expect(title()).toBe(`${t("pinKindText")} · a passage worth keeping`);
		expect(overlay().querySelector(".p-acc")?.classList.contains("open")).toBe(false);
		// Plain text, not Markdown: a leading "#" stays a "#".
		expect(overlay().querySelector(".p-pin-text")?.textContent).toBe("a passage worth keeping\nsecond line");
	});

	it("cycles through several with ‹ n/m ›", async () => {
		await open({ pins: [pin("p1", "one"), pin("p2", "two"), pin("p3", "three")] });
		expect(overlay().querySelector(".p-pin-count")?.textContent).toBe("1/3");
		action(t("pinNextTooltip")).click();
		expect(title()).toContain("two");
		expect(overlay().querySelector(".p-pin-count")?.textContent).toBe("2/3");
		action(t("pinPrevTooltip")).click();
		action(t("pinPrevTooltip")).click();
		expect(title()).toContain("three");
	});

	it("shows no ‹ › for a single pin", async () => {
		await open({ pins: [pin("p1", "one")] });
		expect(overlay().querySelector(".p-pin-count")).toBeNull();
	});

	it("collapsed, it keeps ‹ › and ↗; copy and ✕ come with the open pin", async () => {
		await open({ pins: [pin("p1", "one"), pin("p2", "two")] });
		expect(action(t("pinCopyTooltip")).classList.contains("p-pin-action--open")).toBe(true);
		expect(action(t("pinRemoveTooltip")).classList.contains("p-pin-action--open")).toBe(true);
		for (const tip of [t("pinPrevTooltip"), t("pinNextTooltip"), t("pinJumpTooltip")]) {
			expect(action(tip).classList.contains("p-pin-action--open")).toBe(false);
		}
	});

	it("✕ unpins and saves; the last one takes the strip with it", async () => {
		const conv = await open({ pins: [pin("p1", "one"), pin("p2", "two")] });
		action(t("pinRemoveTooltip")).click();
		expect(conv.pins?.map((p) => p.id)).toEqual(["p2"]);
		action(t("pinRemoveTooltip")).click();
		expect("pins" in conv).toBe(false);
		expect(overlay().hidden).toBe(true);
		expect(wrapper().classList.contains("has-pins")).toBe(false);
	});

	it("follows the conversation: another one without pins hides it", async () => {
		await open({ pins: [pin("p1", "one")] });
		const other = await seedConversation(plugin, { name: "Plain", messages: [] } as Partial<Conversation>);
		await view.setActiveConversation(other);
		expect(overlay().hidden).toBe(true);
	});

	it("keeps open-or-closed as view state — nothing about it is written", async () => {
		const conv = await open({ pins: [pin("p1", "one")] });
		overlay().querySelector<HTMLButtonElement>(".p-acc-toggle")!.click();
		expect(overlay().querySelector(".p-acc")?.classList.contains("open")).toBe(true);
		expect(JSON.stringify(conv.pins)).not.toMatch(/open|expanded|shown/);
	});
});

describe("pinning", () => {
	it("from the selection strip: the selected passage, and which occurrence it is", async () => {
		const conv = await open({});
		const body = pane().querySelector<HTMLElement>('[data-msg-id="a1"] .p-ai-body')!;
		const text = body.firstChild as Text;
		const start = text.data.indexOf("a passage");
		const range = document.createRange();
		range.setStart(text, start);
		range.setEnd(text, start + "a passage".length);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);

		const pinBtn = Array.from(pane().querySelectorAll<HTMLButtonElement>(".pythia-sel-btn")).find((b) => b.textContent === t("pinBtn"))!;
		pinBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

		expect(conv.pins).toHaveLength(1);
		expect(conv.pins?.[0]).toMatchObject({ kind: "text", messageId: "a1", source: "a passage", occurrenceIndex: 0 });
		expect(overlay().hidden).toBe(false);
	});

	it("from a code block's own pin button", async () => {
		const conv = await open({});
		const body = pane().querySelector<HTMLElement>('[data-msg-id="a1"] .p-ai-body')!;
		const holder = body.createDiv();
		holder.innerHTML = '<pre><code class="language-js">let x = 1;\n</code></pre>';
		decorateCodeBlocks(holder, new WeakMap(), pins(view).pinBlock);
		holder.querySelector<HTMLButtonElement>(".p-pin-btn")!.click();
		expect(conv.pins?.[0]).toMatchObject({ kind: "code", messageId: "a1", source: "```js\nlet x = 1;\n```" });
		expect(title()).toBe(`${t("pinKindCode")} · let x = 1;`);
	});

	it("says so, and pins nothing, beyond the limit", async () => {
		const conv = await open({ pins: [1, 2, 3, 4, 5].map((i) => pin(`p${i}`, `s${i}`)) });
		pins(view).pinText("one more", "a1", 0);
		expect(conv.pins).toHaveLength(5);
		expect(shown()).toContain(t("pinLimit", { limit: 5 }));
		expect(shown().at(-1)).toMatch(/\b5\b/);   // the number is in the sentence, not a placeholder
		expect(shown().at(-1)).not.toMatch(/[{}]/);
	});

	it("a block in an answer that is still streaming says to wait", async () => {
		await open({});
		const streaming = pane().querySelector(".p-chat")!.createDiv({ cls: "p-msg-ai" });
		const holder = streaming.createDiv({ cls: "p-ai-body" });
		holder.innerHTML = "<pre><code>x\n</code></pre>";
		decorateCodeBlocks(holder, new WeakMap(), pins(view).pinBlock);
		holder.querySelector<HTMLButtonElement>(".p-pin-btn")!.click();
		expect(shown()).toContain(t("pinNotYet"));
	});
});

describe("↗ back to the source", () => {
	it("says so when the message is no longer in the conversation", async () => {
		await open({ pins: [pin("p1", "gone", { messageId: "deleted" })] });
		action(t("pinJumpTooltip")).click();
		expect(shown()).toContain(t("pinGone"));
	});

	it("collapses the pin before jumping, so what it jumps to is not under it", async () => {
		await open({ pins: [pin("p1", "a passage", { occurrenceIndex: 0 })] });
		overlay().querySelector<HTMLButtonElement>(".p-acc-toggle")!.click();
		action(t("pinJumpTooltip")).click();
		expect(overlay().querySelector(".p-acc")?.classList.contains("open")).toBe(false);
		expect(shown()).not.toContain(t("pinGone"));
		// The passage is flashed in place.
		expect(pane().querySelector('[data-msg-id="a1"] pythia-pin-flash')?.textContent).toBe("a passage");
	});
});

describe("pins belong to their conversation", () => {
	it("a fork does not inherit them", async () => {
		const source = await open({ pins: [pin("p1", "a passage")] });
		const before = new Set(plugin.conversationStore.getAll().map((c) => c.id));
		// The fork is built and stored first; opening it in a panel is what the
		// harness cannot do, and is not what is under test.
		await plugin.cmdForkConversation(source.id, "a passage", "a1", 0).catch(() => undefined);
		const fork = plugin.conversationStore.getAll().find((c) => !before.has(c.id));
		expect(fork).toBeDefined();
		expect(fork?.forkedFromId).toBe(source.id);
		expect(fork?.pins).toBeUndefined();
		expect(source.pins).toHaveLength(1);
	});
});
