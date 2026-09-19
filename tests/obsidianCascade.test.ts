// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OBSIDIAN_BUTTON_RULES, SENTINEL } from "./fixtures/obsidianButtonRules";

/**
 * Obsidian's own button rules must not change a Pythia button (ADR-190).
 *
 * The fixture holds the ten rules that can reach one (read from the installed
 * app.css by `npm run check:obsidian-cascade`) with SENTINEL values, loaded
 * before styles.css as Obsidian's are. Every property a role owns is asserted
 * not to carry a sentinel — at rest, on hover, disabled, on a tablet, and in a
 * phone modal's Setting control. happy-dom cannot hover, so `:hover` becomes a
 * class of the same specificity; `(hover: hover)` counts as a mouse,
 * `(pointer: coarse)` as not a phone. Nested var() fallbacks are flattened
 * because happy-dom cannot resolve them.
 */
const HOVER = ".is-hovered";
const prep = (text: string): string => text
	.replace(/@media \(hover: hover\)( and \(prefers-reduced-motion: no-preference\))? \{/g, "@media all {")
	.replace(/@media \(pointer: coarse\) \{/g, "@media (max-width: 1px) {")
	.replace(/:hover/g, HOVER)
	.replace(/var\(--p-on-accent, var\(--text-on-accent\)\)/g, "var(--p-on-accent)")
	.replace(/var\(--text-warning, var\(--color-orange\)\)/g, "var(--text-warning)");
const PYTHIA = prep(readFileSync(resolve(process.cwd(), "styles.css"), "utf8"));
const OBSIDIAN = prep(OBSIDIAN_BUTTON_RULES);

const VARS: Record<string, string> = {
	"--color-accent": "rgb(90, 80, 200)", "--p-on-accent": "rgb(255, 255, 255)", "--text-normal": "rgb(34, 34, 34)",
	"--text-muted": "rgb(92, 92, 92)", "--text-faint": "rgb(171, 171, 171)", "--text-error": "rgb(200, 40, 40)",
	"--text-warning": "rgb(200, 110, 0)", "--color-orange": "rgb(200, 110, 0)", "--background-modifier-hover": "rgb(236, 236, 236)",
	"--background-modifier-border": "rgb(224, 224, 224)", "--background-secondary": "rgb(246, 246, 246)",
	"--s1": "4px", "--s2": "8px", "--font-smaller": "11px",
};

/** Mount `html` (one or more buttons) inside `wrap`, which is nested as Obsidian nests it. */
function mount(bodyCls: string, chain: string[], html: string): HTMLElement {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	document.body.className = bodyCls;
	for (const [k, v] of Object.entries(VARS)) document.body.style.setProperty(k, v);
	for (const text of [OBSIDIAN, PYTHIA]) { // Obsidian's app.css loads first, the plugin after
		const s = document.createElement("style"); s.textContent = text; document.head.appendChild(s);
	}
	let host: HTMLElement = document.body;
	for (const cls of chain) { const d = document.createElement("div"); d.className = cls; host.appendChild(d); host = d; }
	host.innerHTML = html;
	return host;
}
const VIEW = ["workspace-leaf-content", "view-content pythia-view"];
const PHONE_MODAL = ["modal-container", "modal pythia-modal", "modal-content", "setting-item", "setting-item-control", "p-effort-seg"];

const BUTTONS = [
	"pb pb-primary p-send", "pb pb-primary p-send stop", "pb pb-secondary p-trunc-btn", "pb pb-secondary p-model-hint is-accepted",
	"pb pb-quiet p-del-cancel", "pb pb-destructive p-del-confirm", "pb pb-link p-fork-anchor-open", "pb pb-icon p-hdr-btn",
	"pb pb-icon p-tool-btn is-active", "pb pb-icon is-inline p-wikilink-x", "pb pb-icon is-float p-index-trigger",
	"pb pb-seg p-inst-seg", "pb pb-seg p-inst-seg is-pinned", "pb pb-tab p-compare-tab is-active", "pb pb-chip-warn p-ctx-chip",
];

function expectNoLeak(b: HTMLElement, where: string): void {
	const cs = getComputedStyle(b);
	const at = `${b.className} (${where})`;
	expect(cs.height, `${at}: height`).not.toBe(SENTINEL.height);
	expect(`${cs.paddingTop} ${cs.paddingRight}`, `${at}: padding`).not.toBe(SENTINEL.tabletPadding);
	expect(cs.paddingTop, `${at}: padding`).not.toBe(SENTINEL.phonePadding);
	expect(cs.width, `${at}: width`).not.toBe(SENTINEL.phoneWidth);
	expect(cs.borderTopLeftRadius, `${at}: radius`).not.toBe(SENTINEL.radius);
	expect(cs.fontWeight, `${at}: weight`).not.toBe("700");
	expect(cs.boxShadow, `${at}: shadow`).not.toBe(SENTINEL.shadow);
	expect(cs.color, `${at}: label`).not.toBe(SENTINEL.label);
	expect([SENTINEL.fill, SENTINEL.hoverFill], `${at}: fill`).not.toContain(cs.backgroundColor);
}

describe("Obsidian's button rules never reach a Pythia button (ADR-190)", () => {
	for (const [bodyCls, label] of [["is-desktop", "desktop"], ["is-mobile is-tablet", "tablet"]] as const) {
		for (const hovered of [false, true]) {
			it(`${label}${hovered ? ", hovered" : ""}: every role keeps its own box, label and fill`, () => {
				const host = mount(bodyCls, VIEW, BUTTONS.map((c) => `<button class="${c}${hovered ? " is-hovered" : ""}">Label</button>`).join(""));
				for (const b of Array.from(host.querySelectorAll<HTMLElement>("button"))) expectNoLeak(b, label);
			});
		}
	}

	it("phone modal: the effort segments are not stretched or re-padded by the Setting control", () => {
		const host = mount("is-mobile is-phone", PHONE_MODAL, `<button class="pb pb-seg p-effort-seg-btn">Niedrig</button><button class="pb pb-seg p-effort-seg-btn active">Hoch</button>`);
		for (const b of Array.from(host.querySelectorAll<HTMLElement>("button"))) expectNoLeak(b, "phone modal");
	});

	it("a disabled Send is not dimmed by core's button[disabled] (ADR-187)", () => {
		const host = mount("is-desktop", VIEW, `<button class="pb pb-primary p-send" disabled>Optimizing…</button>`);
		expect(getComputedStyle(host.querySelector("button")!).opacity).toBe("1");
	});
});

describe("two things the role base must not break", () => {
	it("`hidden` hides a button even though .pb sets display (search panel's clear ✕)", () => {
		const host = mount("is-desktop", VIEW, `<button class="pb pb-icon p-switcher-clear" hidden>x</button>`);
		expect(getComputedStyle(host.querySelector("button")!).display).toBe("none");
	});
	it("the header's model segment is a block, so its long name ends in an ellipsis", () => {
		const host = mount("is-desktop", [...VIEW, "p-inst"], `<button class="pb pb-seg p-inst-seg p-inst-model">GPT-5.4 mini</button>`);
		const cs = getComputedStyle(host.querySelector("button")!);
		expect(cs.display).toBe("block");
		expect(cs.textOverflow).toBe("ellipsis");
		expect(cs.overflow).toBe("hidden");
	});
});
