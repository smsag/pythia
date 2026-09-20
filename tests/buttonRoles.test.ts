// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Buttons have one look per role (ADR-188), and each role keeps its label and
 * fill against a button rule stricter than Obsidian's own.
 *
 * `styles.css` is loaded after rules with stand-in colours: a plain button
 * gets a fill, and a hovered one a grey fill at (0,2,1). That is the shape
 * inferred in #183; Obsidian 1.13.7's real hover is `button:hover` at (0,1,1)
 * (ADR-190, tests/obsidianCascade.test.ts). The stricter shape stays because
 * a theme may well write it. happy-dom cannot hover, so `:hover` becomes the class
 * `.is-hovered` in both sheets (same specificity); `(hover: hover)` counts as
 * a mouse, `(pointer: coarse)` as not a phone. The nested var() fallback is
 * flattened because happy-dom cannot resolve it.
 */
const HOVER = ".is-hovered";
const root = process.cwd();
const css = readFileSync(resolve(root, "styles.css"), "utf8")
	.replace(/@media \(hover: hover\)( and \(prefers-reduced-motion: no-preference\))? \{/g, "@media all {")
	.replace(/@media \(pointer: coarse\) \{/g, "@media (max-width: 1px) {")
	.replace(/:hover/g, HOVER)
	// The roles reach their colour contract as `var(--btn-X, <Obsidian token>)`.
	// happy-dom does not resolve a var() whose fallback is
	// another var(), so both levels are flattened to the token the stand-in
	// palette below defines. The label on an accent fill is the one Pythia
	// overrides, so it flattens to --p-on-accent rather than the default.
	.replace(/var\(--btn-on-accent, var\(--text-on-accent\)\)/g, "var(--p-on-accent)")
	.replace(/var\(--btn-[\w-]+, (var\(--[\w-]+\))\)/g, "$1")
	.replace(/var\(--p-on-accent, var\(--text-on-accent\)\)/g, "var(--p-on-accent)")
	.replace(/var\(--text-warning, var\(--color-orange\)\)/g, "var(--text-warning)");
const CORE_FILL = "rgb(240, 240, 240)", CORE_HOVER = "rgb(225, 225, 225)", CORE_LABEL = "rgb(30, 30, 30)";
const CORE_LIKE = `
button:not(.clickable-icon) { background-color: ${CORE_FILL}; color: ${CORE_LABEL}; }
button:not(.clickable-icon)${HOVER} { background-color: ${CORE_HOVER}; color: ${CORE_LABEL}; }
`;
const T = {
	accent: "rgb(90, 80, 200)", onAccent: "rgb(255, 255, 255)", normal: "rgb(34, 34, 34)",
	muted: "rgb(92, 92, 92)", faint: "rgb(171, 171, 171)", error: "rgb(200, 40, 40)", warning: "rgb(200, 110, 0)",
};

function mount(cls: string, scope = "pythia-view"): HTMLButtonElement {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	const vars: Record<string, string> = {
		"--color-accent": T.accent, "--p-on-accent": T.onAccent, "--text-normal": T.normal,
		"--text-muted": T.muted, "--text-faint": T.faint, "--text-error": T.error, "--text-warning": T.warning,
		"--color-orange": T.warning, "--background-modifier-hover": "rgb(236, 236, 236)",
		"--background-modifier-border": "rgb(224, 224, 224)", "--background-secondary": "rgb(246, 246, 246)",
		"--s1": "4px", "--s2": "8px", "--font-smaller": "11px",
	};
	for (const [k, v] of Object.entries(vars)) document.body.style.setProperty(k, v);
	for (const text of [CORE_LIKE, css]) {
		const s = document.createElement("style"); s.textContent = text; document.head.appendChild(s);
	}
	const view = document.body.appendChild(document.createElement("div"));
	view.className = scope;
	const btn = document.createElement("button"); btn.className = cls; btn.textContent = "Label";
	view.appendChild(btn);
	return btn;
}
const label = (el: Element): string => getComputedStyle(el).color;
const fill = (el: Element): string => getComputedStyle(el).backgroundColor;

// [classes, expected label] — at rest and hovered the label must be the role's own.
const CASES: [string, string, string][] = [
	["primary", "pb pb-primary p-send", T.onAccent],
	["primary (tool call)", "pb pb-primary pythia-tool-call-btn pythia-tool-call-btn--action", T.onAccent],
	["Send while it reads Stop", "pb pb-primary p-send stop", T.error],
	["secondary", "pb pb-secondary p-trunc-btn", T.accent],
	["secondary, accepted", "pb pb-secondary p-model-hint is-accepted", T.onAccent],
	["destructive", "pb pb-destructive p-del-confirm", T.error],
	["link", "pb pb-link p-fork-anchor-open", T.accent],
	["icon, on", "pb pb-icon p-tool-btn is-active", T.onAccent],
	["icon, warning", "pb pb-icon is-warning p-send-hint", T.warning],
	["segment, pinned", "pb pb-seg p-inst-seg is-pinned", T.accent],
	["tab, open", "pb pb-tab p-compare-tab is-active", T.normal],
	["chip", "pb pb-chip-warn p-ctx-chip", T.normal],
];
// Muted at rest, normal on hover — never faint (2.3:1 on white).
const QUIET: [string, string][] = [
	["quiet", "pb pb-quiet p-del-cancel"],
	["quiet (tool-call Cancel, was red)", "pb pb-quiet pythia-tool-call-btn"],
	["icon", "pb pb-icon p-hdr-btn"],
	["segment", "pb pb-seg p-inst-seg"],
	["tab", "pb pb-tab p-compare-tab"],
];

describe("button roles against Obsidian's button rules (ADR-188)", () => {
	for (const [name, cls, want] of CASES) {
		it(`${name}: label and fill hold at rest and on hover`, () => {
			const rest = mount(cls);
			expect(label(rest)).toBe(want);
			expect(fill(rest)).not.toBe(CORE_FILL);
			const hov = mount(`${cls} is-hovered`);
			expect(label(hov)).toBe(want);
			expect(fill(hov)).not.toBe(CORE_HOVER);
		});
	}
	for (const [name, cls] of QUIET) {
		it(`${name}: muted at rest, normal on hover, never core's fill`, () => {
			const rest = mount(cls);
			expect(label(rest)).toBe(T.muted);
			expect(fill(rest)).not.toBe(CORE_FILL);
			const hov = mount(`${cls} is-hovered`);
			expect(label(hov)).toBe(T.normal);
			expect(fill(hov)).not.toBe(CORE_HOVER);
		});
	}
	it("a primary keeps its accent fill at rest (Pythia's own reset once stripped it)", () => {
		expect(fill(mount("pb pb-primary p-rewrite-btn"))).toBe(T.accent);
		expect(fill(mount("pb pb-primary p-compare-keep"))).toBe(T.accent);
	});
	it("the settings modal gets the same roles", () => {
		const seg = mount("pb pb-seg p-effort-seg-btn active", "pythia-modal");
		expect(label(seg)).toBe(T.accent);
		expect(fill(seg)).not.toBe(CORE_FILL);
		expect(label(mount("pb pb-secondary p-param-advice-btn", "pythia-modal"))).toBe(T.accent);
	});
});

/**
 * Every button Pythia creates carries a role, so a new one cannot quietly bring
 * its own look back. Obsidian's own dialog buttons (mod-cta / mod-warning /
 * plain) stay Obsidian's; the mobile sheet's trailing icon matches the sheet's
 * 18px rows; the conversation picker lives in Obsidian's suggestion modal; the
 * accordion header is a full-width row, not a button look (ADR-192).
 */
describe("every button has a role", () => {
	const ALLOWED = [/^mod-cta$/, /^mod-warning$/, /^p-sheet-item-trailing$/, /^pythia-conv-suggest-delete$/, /^p-acc-toggle$/];
	const ROLE = /(^|\s)pb pb-(primary|secondary|quiet|destructive|link|icon|seg|tab|chip-warn)(\s|$|\$)/;
	const files = ["sidebar.ts", ...["ui", "suggest"].flatMap((d) => readdirSync(resolve(root, d)).filter((f) => f.endsWith(".ts")).map((f) => join(d, f)))];
	it("createEl(\"button\") always names a role class", () => {
		const missing: string[] = [];
		for (const f of files) {
			const src = readFileSync(resolve(root, f), "utf8");
			for (const m of src.matchAll(/createEl\(\s*"button"\s*(?:,\s*\{([\s\S]{0,300}?)\}\s*)?\)/g)) {
				const cls = /cls:\s*([`"])([\s\S]*?)\1/.exec(m[1] ?? "")?.[2];
				if (cls === undefined) {
					if (f.startsWith("suggest/")) continue; // Obsidian's plain dialog button
					missing.push(`${f}: (no cls)`);
					continue;
				}
				if (ROLE.test(cls) || ALLOWED.some((a) => a.test(cls))) continue;
				missing.push(`${f}: ${cls}`);
			}
		}
		expect(missing).toEqual([]);
	});
});
