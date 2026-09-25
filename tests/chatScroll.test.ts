// @vitest-environment happy-dom
//
// ADR-215: a card that appears in the conversation — above all the write
// confirmation, which the answer waits on — must be fully in view. It used to be
// scrolled to while still empty, so at rest its buttons sat below the fold.
import { describe, it, expect, vi, beforeEach } from "vitest";
import "./helpers/viewHarness"; // Obsidian's DOM helpers (createDiv, empty, …)
import { ChatScroll, JUMP_GAP, REVEAL_MARGIN, coveredTop, revealDelta, scrollChatTo } from "../ui/chatScroll";
import { ToolCallController, type ToolCallDeps } from "../ui/ToolCallController";
import type { Conversation, ToolCall } from "../models/types";

const view = { top: 100, bottom: 500 }; // a 400px viewport

describe("revealDelta — how far to scroll so the whole card shows", () => {
	it("does not move for a card already in view", () => {
		expect(revealDelta(view, { top: 200, bottom: 300 })).toBe(0);
	});

	it("scrolls down just enough to show the card's bottom, with the margin", () => {
		// The confirm card at rest: label visible, buttons below the fold.
		expect(revealDelta(view, { top: 460, bottom: 560 })).toBe(560 + REVEAL_MARGIN - 500);
	});

	it("scrolls up for a card above the view", () => {
		expect(revealDelta(view, { top: 40, bottom: 90 })).toBe(40 - REVEAL_MARGIN - 100);
	});

	it("shows the top of a card taller than the view — the label says what the buttons are for", () => {
		expect(revealDelta(view, { top: 300, bottom: 900 })).toBe(300 - REVEAL_MARGIN - 100);
	});
});

/** A scroller whose geometry the test controls: `content` is how tall its
 *  content is, `cardAt` where the card sits in it. */
function fakeScroller(content = 2000, clientHeight = 400): HTMLElement {
	const el = document.createElement("div");
	let top = 0;
	Object.defineProperty(el, "scrollHeight", { get: () => content });
	Object.defineProperty(el, "clientHeight", { get: () => clientHeight });
	Object.defineProperty(el, "scrollTop", { get: () => top, set: (v: number) => { top = v; } });
	el.getBoundingClientRect = () => ({ top: 0, bottom: clientHeight } as DOMRect);
	return el;
}
function cardAt(scroller: HTMLElement, contentTop: number, height: number): HTMLElement {
	const card = document.createElement("div");
	card.getBoundingClientRect = () => {
		const top = contentTop - scroller.scrollTop;
		return { top, bottom: top + height } as DOMRect;
	};
	return card;
}

describe("ChatScroll — following the answer, and revealing a card", () => {
	let scroller: HTMLElement;
	let scroll: ChatScroll;
	beforeEach(() => {
		vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { cb(); return 0; });
		scroller = fakeScroller();
		scroll = new ChatScroll(() => scroller);
	});

	it("a user scrolling up stops the following; Pythia's own moves do not", () => {
		scroll.toBottom();
		expect(scroll.following).toBe(true);
		scroller.scrollTop = 100; // the user, far from the bottom
		scroll.onScroll();
		expect(scroll.following).toBe(false);
	});

	it("an unforced reveal follows a user who is following", () => {
		scroller.scrollTop = 1600 - 400;
		const card = cardAt(scroller, 1560, 100);            // 60px below the fold
		scroll.reveal(card);
		expect(card.getBoundingClientRect().bottom).toBe(400 - REVEAL_MARGIN);
	});

	it("an unforced reveal leaves a user who scrolled up to read where they are", () => {
		scroll.following = false;
		scroller.scrollTop = 200;
		scroll.reveal(cardAt(scroller, 1560, 100));
		expect(scroller.scrollTop).toBe(200);
	});

	it("a forced reveal shows a card the answer waits on even then — and following resumes", () => {
		scroll.following = false;
		scroller.scrollTop = 200;
		const card = cardAt(scroller, 1560, 100);
		scroll.reveal(card, true);
		const r = card.getBoundingClientRect();
		expect(r.top).toBeGreaterThanOrEqual(0);
		expect(r.bottom).toBeLessThanOrEqual(400);
		expect(scroll.following).toBe(true);
	});
});

describe("the write confirmation is revealed once it has its buttons (the regression)", () => {
	it("reveals the card forced, and only after the label and both buttons are in it", async () => {
		const messages = document.createElement("div");
		const seen: Array<{ buttons: number; label: string; force: boolean }> = [];
		const deps: ToolCallDeps = {
			app: {} as ToolCallDeps["app"],
			plugin: {} as ToolCallDeps["plugin"],
			messagesEl: () => messages,
			registerDomEvent: (el, type, cb) => el.addEventListener(type, cb),
			reveal: (card, force) => seen.push({
				buttons: card.querySelectorAll("button").length,
				label: card.querySelector(".pythia-tool-call-label")?.textContent ?? "",
				force,
			}),
		};
		const calls = new ToolCallController(deps);
		const conv = { contextNotes: [], writeMode: "all" } as unknown as Conversation;
		const call = { id: "t1", name: "create_note", input: { path: "Out/Answer.md", content: "x" } } as ToolCall;

		const pending = calls.handler(conv, false)(call);
		await Promise.resolve();

		expect(seen).toHaveLength(1);
		expect(seen[0].buttons).toBe(2);   // never scrolled to while empty
		expect(seen[0].label).not.toBe("");
		expect(seen[0].force).toBe(true);  // the answer waits on it: shown even to a user who scrolled up

		messages.querySelectorAll<HTMLButtonElement>("button")[1].click(); // cancel
		expect(await pending).toMatch(/declined/i);
	});

	it("a search status is revealed only for a user who is following", async () => {
		const messages = document.createElement("div");
		const forces: boolean[] = [];
		const calls = new ToolCallController({
			app: {} as ToolCallDeps["app"],
			plugin: { toolHandler: { execute: async () => "[]" } } as unknown as ToolCallDeps["plugin"],
			messagesEl: () => messages,
			registerDomEvent: (el, type, cb) => el.addEventListener(type, cb),
			reveal: (_card, force) => forces.push(force),
		});
		await calls.handler({ contextNotes: [] } as unknown as Conversation, true)({ id: "s", name: "web_search", input: { query: "q" } } as ToolCall);
		expect(forces).toEqual([false]);
	});
});

describe("scrollChatTo — the one jump, clear of what floats over the chat (ADR-216)", () => {
	function chat(coverBottom: number | null): { scroller: HTMLElement; calls: ScrollToOptions[] } {
		const wrap = document.createElement("div");
		const scroller = wrap.appendChild(document.createElement("div"));
		scroller.getBoundingClientRect = () => ({ top: 100, bottom: 500 } as DOMRect);
		const calls: ScrollToOptions[] = [];
		scroller.scrollTo = ((o: ScrollToOptions) => { calls.push(o); }) as HTMLElement["scrollTo"];
		if (coverBottom !== null) {
			const pins = wrap.appendChild(document.createElement("div"));
			pins.className = "p-pins";
			pins.getBoundingClientRect = () => ({ top: 108, bottom: coverBottom } as DOMRect);
		}
		return { scroller, calls };
	}

	it("with nothing pinned, it is the jump every surface used: 8px above the target", () => {
		const { scroller, calls } = chat(null);
		scrollChatTo(scroller, 400);
		expect(calls).toEqual([{ top: 400 - JUMP_GAP, behavior: "smooth" }]);
	});

	it("with a pin, the target lands below it — its measured height, collapsed or expanded", () => {
		const collapsed = chat(140);
		scrollChatTo(collapsed.scroller, 400);
		expect(collapsed.calls[0].top).toBe(400 - JUMP_GAP - 40);
		const expanded = chat(300);
		scrollChatTo(expanded.scroller, 400);
		expect(expanded.calls[0].top).toBe(400 - JUMP_GAP - 200);
	});

	it("a hidden pin covers nothing", () => {
		const { scroller } = chat(140);
		(scroller.parentElement!.querySelector(".p-pins") as HTMLElement).hidden = true;
		expect(coveredTop(scroller)).toBe(0);
	});

	it("never scrolls above the top, and can jump instantly", () => {
		const { scroller, calls } = chat(300);
		scrollChatTo(scroller, 10, false);
		expect(calls[0]).toEqual({ top: 0, behavior: "instant" });
	});
});
