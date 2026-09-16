// @vitest-environment happy-dom
//
// The chat area's two empty surfaces (extracted from sidebar.ts under the
// ADR-097 ratchet). Pure renderers: given a container, they build the DOM and
// read nothing from the view.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("obsidian", () => ({ setIcon: (el: HTMLElement, name: string) => { el.setAttribute("data-icon", name); } }));
vi.mock("../i18n", () => ({ t: (key: string) => key }));

import { renderNoConversation, renderWelcome } from "../ui/emptyState";

type Opts = { cls?: string; text?: string };
function installDomHelpers(): void {
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
}
installDomHelpers();

let container: HTMLElement;
beforeEach(() => { container = document.createElement("div"); });

describe("renderNoConversation", () => {
	it("renders the palette hint under the empty-state class", () => {
		renderNoConversation(container);
		const empty = container.querySelector(".pythia-empty");
		expect(empty).not.toBeNull();
		expect(empty?.textContent).toContain("noActiveConversationHint");
		expect(container.querySelector(".pythia-empty-hint")?.textContent).toBe("startFromPaletteHint");
	});
});

describe("renderWelcome", () => {
	it("renders the sparkle, the heading and three keycap hints", () => {
		renderWelcome(container);
		expect(container.querySelector(".p-welcome-spark")?.getAttribute("data-icon")).toBe("sparkles");
		expect(container.querySelector(".p-welcome-title")?.textContent).toBe("emptyHeading");
		const caps = [...container.querySelectorAll(".p-keycap")].map((el) => el.textContent);
		expect(caps).toEqual(["#", "⌘P", "⇧↵"]);
	});
});
