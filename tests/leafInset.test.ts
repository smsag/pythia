// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The strip under the composer (ADR-165), measured in Obsidian and reproduced here.
 *
 * Obsidian pads every `.view-content` (12px sides, 32px/safe-area bottom) at (0,2,0);
 * a theme may add a reserve on every phone-drawer view (Klartext: 52px at (0,4,1)).
 * app.css loads first, the plugin next, the theme last — the sheets below are
 * appended in that order. The rules under test win by specificity alone, never
 * `!important`, which would also override the keyboard lift's inline padding.
 */
// happy-dom replaces the global URL, so import.meta.url cannot be resolved here; vitest runs from the repo root.
const css = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");

// Shapes read off app.css 1.13: sides and bottom both sit at (0,2,0) — measured in the
// app, `.pythia-view { padding: 0 }` at (0,1,0) left `12px 12px 32px` in place.
const CORE_LIKE = `
.workspace-leaf-content .view-content { padding: 12px; }
.workspace-leaf-content .view-content { padding-bottom: 32px; }
.workspace-leaf-content[data-type="markdown"] .view-content { padding: 0; }
`;
const THEME_LIKE = `
body.is-phone .workspace-drawer .workspace-leaf-content > .view-content { padding-bottom: 52px; }
`;

function mount(phone = true): { view: HTMLElement; leaf: HTMLElement } {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	document.body.className = phone ? "theme-dark is-mobile is-phone is-floating-nav" : "theme-dark";
	const core = document.createElement("style"); core.textContent = CORE_LIKE; document.head.appendChild(core);
	const plugin = document.createElement("style"); plugin.textContent = css; document.head.appendChild(plugin);
	const theme = document.createElement("style"); theme.textContent = THEME_LIKE; document.head.appendChild(theme);
	const drawer = document.createElement("div"); drawer.className = "workspace-drawer mod-right";
	const leaf = document.createElement("div"); leaf.className = "workspace-leaf-content"; leaf.setAttribute("data-type", "pythia");
	const view = document.createElement("div"); view.className = "view-content pythia-view";
	leaf.appendChild(view); drawer.appendChild(leaf); document.body.appendChild(drawer);
	return { view, leaf };
}

describe("the panel fills its leaf on a desktop (ADR-165)", () => {
	it("out-ranks Obsidian's own .view-content padding the way core exempts its own views", () => {
		const { view } = mount(false);
		expect(getComputedStyle(view).padding).toBe("0px");
	});
});

describe("the composer sits on the drawer's edge on a phone (ADR-165)", () => {
	let view: HTMLElement;
	beforeAll(() => { ({ view } = mount()); });

	it("the core padding and the theme-shaped reserve on .view-content are both out-ranked", () => {
		expect(getComputedStyle(view).padding).toBe("0px");
		expect(getComputedStyle(view).paddingBottom).toBe("0px");
	});

	it("a view that is not ours keeps the theme's reserve — the rule is scoped by data-type", () => {
		const other = document.querySelector(".workspace-leaf-content") as HTMLElement;
		other.setAttribute("data-type", "bookmarks");
		expect(getComputedStyle(view).paddingBottom).toBe("52px");
		expect(getComputedStyle(view).paddingLeft).toBe("12px");
		other.setAttribute("data-type", "pythia");
	});

	it("wins by specificity, so the keyboard lift's inline padding still applies", () => {
		expect(css).not.toMatch(/padding-bottom:\s*0\s*!important/);
		view.style.paddingBottom = "300px";
		expect(getComputedStyle(view).paddingBottom).toBe("300px");
		view.style.paddingBottom = "";
	});

	it("switches Obsidian's floating-nav fade off for our leaf only", () => {
		const rule = /\.is-mobile\.is-floating-nav \.workspace-drawer \.workspace-leaf-content\[data-type="pythia"\]::after\s*\{\s*display:\s*none;?\s*\}/;
		expect(css).toMatch(rule);
	});
});
