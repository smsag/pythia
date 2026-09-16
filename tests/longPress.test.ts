// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { attachLongPress, LONG_PRESS_MS } from "../ui/longPress";

function makeEl(): HTMLElement {
	const el = document.createElement("button");
	document.body.appendChild(el);
	return el;
}

/** Dispatch a bare event of `type` — enough for the touch listeners, which read
 *  nothing off the event. */
function fire(el: HTMLElement, type: string): void {
	el.dispatchEvent(new Event(type));
}

function mouseDown(el: HTMLElement, button = 0): void {
	el.dispatchEvent(new MouseEvent("mousedown", { button }));
}

describe("attachLongPress", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		document.body.innerHTML = "";
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("fires after the hold delay on touch", () => {
		const el = makeEl();
		const onFire = vi.fn();
		attachLongPress(el, onFire);

		fire(el, "touchstart");
		vi.advanceTimersByTime(LONG_PRESS_MS - 1);
		expect(onFire).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onFire).toHaveBeenCalledTimes(1);
	});

	it("fires after the hold delay on a left mouse press", () => {
		const el = makeEl();
		const onFire = vi.fn();
		attachLongPress(el, onFire);

		mouseDown(el);
		vi.advanceTimersByTime(LONG_PRESS_MS);
		expect(onFire).toHaveBeenCalledTimes(1);
	});

	it("ignores a non-left mouse button, so a right-click never arms the gesture", () => {
		const el = makeEl();
		const onFire = vi.fn();
		attachLongPress(el, onFire);

		mouseDown(el, 2);
		vi.advanceTimersByTime(LONG_PRESS_MS * 2);
		expect(onFire).not.toHaveBeenCalled();
	});

	it.each(["touchend", "touchcancel", "touchmove", "mouseup", "mouseleave"])(
		"cancels a pending press on %s — a tap or a scroll that starts on the control never fires it",
		(cancelEvent) => {
			const el = makeEl();
			const onFire = vi.fn();
			attachLongPress(el, onFire);

			fire(el, "touchstart");
			vi.advanceTimersByTime(LONG_PRESS_MS - 10);
			fire(el, cancelEvent);
			vi.advanceTimersByTime(LONG_PRESS_MS * 2);
			expect(onFire).not.toHaveBeenCalled();
		}
	);

	it("honours a custom delay", () => {
		const el = makeEl();
		const onFire = vi.fn();
		attachLongPress(el, onFire, { delayMs: 1000 });

		fire(el, "touchstart");
		vi.advanceTimersByTime(999);
		expect(onFire).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onFire).toHaveBeenCalledTimes(1);
	});

	it("restarts the timer on a second press rather than firing twice", () => {
		const el = makeEl();
		const onFire = vi.fn();
		attachLongPress(el, onFire);

		fire(el, "touchstart");
		vi.advanceTimersByTime(LONG_PRESS_MS - 10);
		fire(el, "touchstart");
		vi.advanceTimersByTime(LONG_PRESS_MS - 10);
		expect(onFire).not.toHaveBeenCalled();
		vi.advanceTimersByTime(10);
		expect(onFire).toHaveBeenCalledTimes(1);
	});

	it("cleanup cancels a pending press and detaches the listeners", () => {
		const el = makeEl();
		const onFire = vi.fn();
		const cleanup = attachLongPress(el, onFire);

		fire(el, "touchstart");
		cleanup();
		vi.advanceTimersByTime(LONG_PRESS_MS * 2);
		expect(onFire).not.toHaveBeenCalled();

		// Detached: a fresh press after cleanup does nothing either.
		fire(el, "touchstart");
		vi.advanceTimersByTime(LONG_PRESS_MS * 2);
		expect(onFire).not.toHaveBeenCalled();
	});

	it("registers through a supplied binder and leaves removal to it", () => {
		const el = makeEl();
		const onFire = vi.fn();
		const bound: string[] = [];
		const bind = (
			target: HTMLElement,
			type: string,
			cb: (ev: Event) => void,
			options?: boolean | AddEventListenerOptions,
		) => {
			bound.push(type);
			target.addEventListener(type, cb, options);
		};
		const removeSpy = vi.spyOn(el, "removeEventListener");

		const cleanup = attachLongPress(el, onFire, { bind });
		expect(bound).toEqual([
			"touchstart", "touchend", "touchcancel", "touchmove",
			"mousedown", "mouseup", "mouseleave",
		]);

		fire(el, "touchstart");
		cleanup();
		vi.advanceTimersByTime(LONG_PRESS_MS * 2);
		// The pending press is still cancelled…
		expect(onFire).not.toHaveBeenCalled();
		// …but the binder (Obsidian's registerDomEvent) owns detaching.
		expect(removeSpy).not.toHaveBeenCalled();
	});
});

describe("attachLongPress — preventTouchDefault", () => {
	it("prevents the default touch action only when asked", () => {
		vi.useFakeTimers();
		const el = document.createElement("div");
		const fired = vi.fn();
		attachLongPress(el, fired, { preventTouchDefault: true });
		const ev = new Event("touchstart", { cancelable: true });
		el.dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(true);
		vi.advanceTimersByTime(450);
		expect(fired).toHaveBeenCalledTimes(1);

		const el2 = document.createElement("div");
		attachLongPress(el2, vi.fn());
		const ev2 = new Event("touchstart", { cancelable: true });
		el2.dispatchEvent(ev2);
		expect(ev2.defaultPrevented).toBe(false);
		vi.useRealTimers();
	});
});

describe("attachLongPress — press point and touchOnly", () => {
	it("hands the press position to onFire (touch) so a menu can open at the finger", () => {
		vi.useFakeTimers();
		const el = document.createElement("div");
		const fired = vi.fn();
		attachLongPress(el, fired);
		const ev = new Event("touchstart") as Event & { touches: { clientX: number; clientY: number }[] };
		Object.defineProperty(ev, "touches", { value: [{ clientX: 12, clientY: 34 }] });
		el.dispatchEvent(ev);
		vi.advanceTimersByTime(LONG_PRESS_MS);
		expect(fired).toHaveBeenCalledWith({ x: 12, y: 34 });
		vi.useRealTimers();
	});

	it("touchOnly never arms on a mouse press", () => {
		vi.useFakeTimers();
		const el = document.createElement("div");
		const fired = vi.fn();
		attachLongPress(el, fired, { touchOnly: true });
		el.dispatchEvent(new MouseEvent("mousedown", { button: 0 }));
		vi.advanceTimersByTime(LONG_PRESS_MS);
		expect(fired).not.toHaveBeenCalled();
		el.dispatchEvent(new Event("touchstart"));
		vi.advanceTimersByTime(LONG_PRESS_MS);
		expect(fired).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});
});
