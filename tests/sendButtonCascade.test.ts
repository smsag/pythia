// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Send stays an accent button with a readable label in every state, against
 * Obsidian's own button rules. app.css paints `button:not(.clickable-icon):hover`
 * with --interactive-hover at (0,2,1); that out-ranked `.p-send:not(.stop)`
 * (0,2,0), so on hover the white label sat on light grey — an outline with an
 * unreadable word. CORE_LIKE is that shape with stand-in colours (not read off
 * app.css), and sets a label colour at rest too — stricter than core, so a rule
 * of ours that forgets the label fails here. happy-dom cannot hover, so `:hover` becomes the class
 * `.is-hovered` in both sheets: same specificity, same cascade.
 */
const HOVER = ".is-hovered";
const css = readFileSync(resolve(process.cwd(), "styles.css"), "utf8")
	.replace(/@media \(hover: hover\) \{/g, "@media all {")
	.replace(/:hover/g, HOVER)
	// happy-dom cannot resolve a nested var() fallback; the outer var is the one that applies.
	.replace(/var\(--p-on-accent, var\(--text-on-accent\)\)/g, "var(--p-on-accent)");
const CORE_LIKE = `
button:not(.clickable-icon) { background-color: rgb(240, 240, 240); color: rgb(30, 30, 30); }
button:not(.clickable-icon)${HOVER} { background-color: rgb(225, 225, 225); color: rgb(30, 30, 30); }
`;

function mount(cls = "p-send"): HTMLButtonElement {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	document.body.style.setProperty("--color-accent", "rgb(90, 80, 200)");
	document.body.style.setProperty("--p-on-accent", "rgb(255, 255, 255)");
	document.body.style.setProperty("--text-error", "rgb(200, 40, 40)");
	for (const text of [CORE_LIKE, css]) {
		const s = document.createElement("style"); s.textContent = text; document.head.appendChild(s);
	}
	const view = document.body.appendChild(document.createElement("div"));
	view.className = "pythia-view";
	const btn = document.createElement("button"); btn.className = cls; btn.textContent = "Senden";
	view.appendChild(btn);
	return btn;
}

const fill = (el: Element): string => getComputedStyle(el).backgroundColor;

describe("Send button against Obsidian's button rules", () => {
	beforeEach(() => { document.head.innerHTML = ""; });

	it("keeps the accent fill and on-accent label at rest", () => {
		const btn = mount();
		expect(fill(btn)).not.toBe("rgb(240, 240, 240)");
		expect(getComputedStyle(btn).color).toBe("rgb(255, 255, 255)");
	});

	it("never takes Obsidian's grey hover fill under its white label", () => {
		const btn = mount("p-send is-hovered");
		expect(fill(btn)).not.toBe("rgb(225, 225, 225)");
		expect(getComputedStyle(btn).color).toBe("rgb(255, 255, 255)");
	});

	it("the stop state keeps its error label on hover", () => {
		const btn = mount("p-send stop is-hovered");
		expect(getComputedStyle(btn).color).toBe("rgb(200, 40, 40)");
	});
});
