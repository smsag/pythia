// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("obsidian", () => ({ Notice: class {}, Platform: { isMobile: false } }));
vi.mock("../i18n", () => ({ t: (key: string) => key, getLang: () => "en" }));

import { ModelSuggestionController } from "../ui/ModelSuggestionController";
import { DEFAULT_SETTINGS, type PythiaSettings } from "../models/settings";
import type { Conversation } from "../models/types";

type Opts = { cls?: string; text?: string };
const proto = (globalThis as unknown as { Element: { prototype: Record<string, unknown> } }).Element.prototype;
proto.createEl = function (this: Element, tag: string, o?: Opts): Element {
	const el = document.createElement(tag);
	if (o?.cls) (el as HTMLElement).className = o.cls;
	if (o?.text != null) el.textContent = o.text;
	this.appendChild(el);
	return el;
};
proto.createSpan = function (this: Element, o?: Opts): Element {
	return (this as unknown as { createEl: (t: string, o?: Opts) => Element }).createEl("span", o);
};
proto.empty = function (this: Element) { this.replaceChildren(); };
proto.toggleClass = function (this: Element, cls: string, on: boolean) { this.classList.toggle(cls, on); };

function conv(over: Partial<Conversation> = {}): Conversation {
	return {
		id: "c1", name: "C", provider: "anthropic", model: "claude-opus-5", messages: [], contextNotes: [],
		createdAt: "", updatedAt: "", ...over,
	} as Conversation;
}

let settings: PythiaSettings;
let current: Conversation;
let hasKey: boolean;
let chip: HTMLButtonElement;
let ctrl: ModelSuggestionController;

beforeEach(() => {
	settings = { ...DEFAULT_SETTINGS, defaultProvider: "anthropic", optimizerSuggestsModel: true };
	current = conv();
	hasKey = true;
	const clicks: (() => void)[] = [];
	ctrl = new ModelSuggestionController({
		getSettings: () => settings,
		getConversation: () => current,
		hasApiKeyFor: () => hasKey,
		registerDomEvent: (_el, _type, cb) => { clicks.push(cb); },
	});
	const toolbar = document.createElement("div");
	ctrl.mount(toolbar);
	chip = toolbar.querySelector(".p-model-hint")!;
	chip.onclick = () => clicks.forEach((cb) => cb());
});

describe("ModelSuggestionController (ADR-181)", () => {
	it("offers a cheaper model for a light task, and applies nothing until tapped", () => {
		ctrl.consider("light");
		expect(chip.style.display).toBe("");
		expect(chip.textContent).toContain("→");
		expect(ctrl.layer(current)).toBe(current);
	});

	it("an accepted offer layers the model over a clone for one send — the conversation is never written", () => {
		ctrl.consider("light");
		chip.click();
		const turn = ctrl.layer(current);
		expect(turn).not.toBe(current);
		expect(turn.model).not.toBe("claude-opus-5");
		expect(current.model).toBe("claude-opus-5");
		expect(chip.classList.contains("is-accepted")).toBe(true);
	});

	it("a second tap withdraws it", () => {
		ctrl.consider("light");
		chip.click();
		chip.click();
		expect(ctrl.layer(current)).toBe(current);
	});

	it("an offer nobody accepted is dropped on send; an accepted one survives until the answer commits", () => {
		ctrl.consider("light");
		ctrl.sent();
		expect(chip.style.display).toBe("none");

		ctrl.consider("light");
		chip.click();
		ctrl.sent();
		expect(ctrl.layer(current).model).not.toBe("claude-opus-5");
		ctrl.spent("c1");
		expect(ctrl.layer(current)).toBe(current);
		expect(chip.style.display).toBe("none");
	});

	it("never applies to another conversation", () => {
		ctrl.consider("light");
		chip.click();
		expect(ctrl.layer(conv({ id: "c2" })).id).toBe("c2");
		expect(ctrl.layer(conv({ id: "c2" })).model).toBe("claude-opus-5");
	});

	it("says nothing when the setting is off, the rating is missing, or the preferred provider has no key", () => {
		settings.optimizerSuggestsModel = false;
		ctrl.consider("light");
		expect(chip.style.display).toBe("none");

		settings.optimizerSuggestsModel = true;
		ctrl.consider(null);
		expect(chip.style.display).toBe("none");

		hasKey = false;
		ctrl.consider("light");
		expect(chip.style.display).toBe("none");
	});

	it("shows the cost as a tier, never as dollars (ADR-163)", () => {
		ctrl.consider("light");
		expect(chip.querySelector(".p-model-hint-cost")?.textContent).toMatch(/^[●○]{3}$/);
		expect(chip.textContent).not.toContain("$");
	});
});
