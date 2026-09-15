// @vitest-environment happy-dom
//
// The inline anchors' summary clamp (ADR-141). The decision it makes — show an
// expand control or not — depends on layout, which happy-dom does not compute,
// so the two heights are stubbed directly. That is the whole point of the unit:
// everything else here is branching on those two numbers.

import { describe, it, expect, beforeEach } from "vitest";
import { clampSummary } from "../ui/clampBody";

// Obsidian extends Element.prototype at runtime; happy-dom does not.
function installDomHelpers(): void {
	type Opts = { cls?: string; text?: string };
	const proto = (globalThis as unknown as { Element: { prototype: Record<string, unknown> } }).Element.prototype;
	proto.createEl = function (this: Element, tag: string, o?: Opts): Element {
		const el = document.createElement(tag);
		if (o?.cls) (el as HTMLElement).className = o.cls;
		if (o?.text != null) el.textContent = o.text;
		this.appendChild(el);
		return el;
	};
	proto.createDiv = function (this: Element, o?: Opts): Element {
		return (this as unknown as { createEl: (t: string, o?: Opts) => Element }).createEl("div", o);
	};
	proto.addClass = function (this: Element, c: string) { this.classList.add(c); };
	proto.removeClass = function (this: Element, c: string) { this.classList.remove(c); };
	proto.hasClass = function (this: Element, c: string) { return this.classList.contains(c); };
	proto.toggleClass = function (this: Element, c: string, on: boolean) { this.classList.toggle(c, on); };
}
installDomHelpers();

/** A body whose measured overflow we control, plus the mount beside it. */
function setup(scrollHeight: number, clientHeight: number, attached = true) {
	document.body.innerHTML = "";
	const anchor = document.createElement("div");
	if (attached) document.body.appendChild(anchor);
	const body = document.createElement("div");
	anchor.appendChild(body);
	Object.defineProperty(body, "scrollHeight", { value: scrollHeight, configurable: true });
	Object.defineProperty(body, "clientHeight", { value: clientHeight, configurable: true });
	const mount = document.createElement("div");
	anchor.appendChild(mount);
	clampSummary(body, mount);
	return { body, mount };
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

describe("clampSummary (ADR-141)", () => {
	beforeEach(() => { document.body.innerHTML = ""; });

	it("clamps immediately, before anything is measured", () => {
		// The class goes on synchronously so a long summary is never painted at
		// full height for one frame and then snapped shut.
		const { body } = setup(400, 100);
		expect(body.classList.contains("p-clamped")).toBe(true);
	});

	it("offers an expand control when the summary overflows", async () => {
		const { body, mount } = setup(400, 100);
		await nextFrame();
		expect(body.classList.contains("p-clamped")).toBe(true);
		expect(mount.querySelector(".p-anchor-more")).not.toBeNull();
	});

	it("removes the clamp and shows no control when the summary already fits", async () => {
		// No affordance without something behind it.
		const { body, mount } = setup(90, 100);
		await nextFrame();
		expect(body.classList.contains("p-clamped")).toBe(false);
		expect(mount.querySelector(".p-anchor-more")).toBeNull();
	});

	it("treats a two-pixel overhang as fitting, not as overflow", async () => {
		// Sub-pixel rounding at the last line would otherwise offer "more" for
		// nothing the reader can see.
		const { mount } = setup(102, 100);
		await nextFrame();
		expect(mount.querySelector(".p-anchor-more")).toBeNull();
	});

	it("toggles both the clamp and the control's label", async () => {
		const { body, mount } = setup(400, 100);
		await nextFrame();
		const btn = mount.querySelector(".p-anchor-more") as HTMLElement;
		const collapsed = btn.textContent;

		btn.click();
		expect(body.classList.contains("p-clamped")).toBe(false);
		expect(btn.textContent).not.toBe(collapsed);

		btn.click();
		expect(body.classList.contains("p-clamped")).toBe(true);
		expect(btn.textContent).toBe(collapsed);
	});

	it("does nothing when the anchor was torn down before the measuring frame", async () => {
		// A detached node reports 0 for both heights, which would otherwise read as
		// "fits" and quietly unclamp a body that is about to be discarded anyway.
		const { mount } = setup(400, 100, false);
		await nextFrame();
		expect(mount.querySelector(".p-anchor-more")).toBeNull();
	});
});
