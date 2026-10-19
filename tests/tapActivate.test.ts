// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { attachTap, TAP_CLICK_ECHO_MS } from "../ui/tapActivate";

// A row that closes its own surface must take a touch where it ends and cancel
// the rest, or iOS applies the tap to what the surface uncovered (ADR-258).

function touch(el: HTMLElement, type: string, x = 5, y = 5): Event {
	const e = new Event(type, { bubbles: true, cancelable: true });
	const list = type === "touchend" || type === "touchcancel" ? [] : [{ clientX: x, clientY: y }];
	Object.defineProperty(e, "touches", { value: list });
	Object.defineProperty(e, "changedTouches", { value: [{ clientX: x, clientY: y }] });
	el.dispatchEvent(e);
	return e;
}

function setup(allow?: () => boolean) {
	let t = 1000;
	const el = document.createElement("div");
	const onTap = vi.fn();
	attachTap(el, onTap, { allow, now: () => t });
	return { el, onTap, advance: (ms: number) => { t += ms; } };
}

describe("attachTap", () => {
	it("opens on the end of a touch and cancels the rest of the gesture", () => {
		const { el, onTap } = setup();
		touch(el, "touchstart");
		const end = touch(el, "touchend");
		expect(onTap).toHaveBeenCalledTimes(1);
		expect(end.defaultPrevented).toBe(true);
	});

	it("does not open twice when the click of the same tap still arrives", () => {
		const { el, onTap, advance } = setup();
		touch(el, "touchstart");
		touch(el, "touchend");
		advance(300);
		el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(onTap).toHaveBeenCalledTimes(1);
		advance(TAP_CLICK_ECHO_MS);
		el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(onTap).toHaveBeenCalledTimes(2);                   // a later click is a click
	});

	it("takes a touch that moved for a scroll, and leaves it alone", () => {
		const { el, onTap } = setup();
		touch(el, "touchstart", 5, 5);
		touch(el, "touchmove", 5, 40);
		const end = touch(el, "touchend", 5, 40);
		expect(onTap).not.toHaveBeenCalled();
		expect(end.defaultPrevented).toBe(false);
	});

	it("opens on a click from a pointer or the keyboard", () => {
		const { el, onTap } = setup();
		el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(onTap).toHaveBeenCalledTimes(1);
	});

	it("swallows a tap its owner refuses, and still cancels its click", () => {
		const { el, onTap } = setup(() => false);
		touch(el, "touchstart");
		const end = touch(el, "touchend");
		expect(onTap).not.toHaveBeenCalled();
		expect(end.defaultPrevented).toBe(true);
	});

	it("ignores a cancelled touch", () => {
		const { el, onTap } = setup();
		touch(el, "touchstart");
		touch(el, "touchcancel");
		touch(el, "touchend");
		expect(onTap).not.toHaveBeenCalled();
	});
});
