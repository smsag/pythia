// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachOutsideDismiss } from "../ui/outsideDismiss";

const press = (target: EventTarget, type = "mousedown") =>
	target.dispatchEvent(new Event(type, { bubbles: true }));

describe("attachOutsideDismiss", () => {
	let inside: HTMLElement;
	beforeEach(() => {
		vi.useFakeTimers();
		inside = document.createElement("div");
		document.body.appendChild(inside);
	});
	afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

	it("does not fire for the press that opened the surface (same tick)", () => {
		const onDismiss = vi.fn();
		attachOutsideDismiss((t) => inside.contains(t), onDismiss);
		press(document.body);
		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("fires on a press outside after the tick, never on one inside", () => {
		const onDismiss = vi.fn();
		attachOutsideDismiss((t) => inside.contains(t), onDismiss);
		vi.advanceTimersByTime(0);
		press(inside);
		expect(onDismiss).not.toHaveBeenCalled();
		press(document.body);
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("disposing before the tick cancels the registration — the leak the copies had", () => {
		const onDismiss = vi.fn();
		const dispose = attachOutsideDismiss(() => false, onDismiss);
		dispose();
		vi.advanceTimersByTime(0);
		press(document.body);
		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("disposing after arming removes the listeners", () => {
		const onDismiss = vi.fn();
		const dispose = attachOutsideDismiss(() => false, onDismiss, { touch: true, escape: true });
		vi.advanceTimersByTime(0);
		dispose();
		press(document.body);
		press(document.body, "touchstart");
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("escape-only mode ignores pointer presses", () => {
		const onDismiss = vi.fn();
		attachOutsideDismiss(() => true, onDismiss, { escape: true, pointer: false });
		vi.advanceTimersByTime(0);
		press(document.body);
		expect(onDismiss).not.toHaveBeenCalled();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});
