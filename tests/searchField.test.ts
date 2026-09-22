import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	GROUNDS_MEASURED_IN,
	THEME_GROUNDS,
	UI_BOUNDARY_CONTRAST,
} from "./fixtures/themeGrounds";

/**
 * The conversation search row has a boundary you can see, and says focus.
 *
 * It was drawn with `--background-modifier-border`, a token meant for the
 * hairline between two surfaces — 1.23:1 under Klartext, 1.19:1 under the
 * default theme, where 3:1 is what a control's boundary is held to. The row is
 * the control: there is no box around the field, so this rule is the whole
 * affordance.
 *
 * The percentages cannot be checked against "the theme", because a plugin does
 * not get one. They are checked against the themes that were measured
 * (`fixtures/themeGrounds.ts`) by recomputing the composite here, so lowering
 * one fails rather than merely looking different.
 */
const css = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");

/** The declarations of the rule a selector opens, comments stripped. */
function ruleBody(selector: string): string {
	const at = css.indexOf(`${selector} {`);
	if (at === -1) expect.fail(`${selector} is missing from styles.css`);
	const open = css.indexOf("{", at);
	return css.slice(open + 1, css.indexOf("}", open)).replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The mix percentage the sheet declares for a mode, as a fraction. */
function declaredMix(mode: "light" | "dark"): number {
	const body = ruleBody(`.theme-${mode} .pythia-view`);
	const m = /--p-field-rule:\s*color-mix\(in srgb, var\(--text-normal\) (\d+)%, transparent\)/.exec(body);
	if (m === null) {
		expect.fail(`.theme-${mode} .pythia-view must mix --p-field-rule from --text-normal`);
	}
	return Number(m[1]) / 100;
}

const rgb = (hex: string): [number, number, number] => {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const channel = (v: number): number => {
	const c = v / 255;
	return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const luminance = ([r, g, b]: [number, number, number]): number =>
	0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function contrast(a: [number, number, number], b: [number, number, number]): number {
	const x = luminance(a), y = luminance(b);
	const [hi, lo] = x > y ? [x, y] : [y, x];
	return (hi + 0.05) / (lo + 0.05);
}

/** `color-mix(… X%, transparent)` over an opaque ground is a plain blend. */
function composite(text: string, ground: string, mix: number): [number, number, number] {
	const t = rgb(text), g = rgb(ground);
	return [0, 1, 2].map((i) => Math.round(mix * t[i] + (1 - mix) * g[i])) as [number, number, number];
}

describe(`the conversation search row, against ${GROUNDS_MEASURED_IN}`, () => {
	for (const mode of ["light", "dark"] as const) {
		for (const [theme, ground] of Object.entries(THEME_GROUNDS[mode])) {
			it(`stands ${UI_BOUNDARY_CONTRAST}:1 clear of ${theme} in ${mode}`, () => {
				const painted = composite(ground.text, ground.background, declaredMix(mode));
				const ratio = contrast(painted, rgb(ground.background));
				expect(
					ratio,
					`rgb(${painted.join(" ")}) on ${ground.background} is ${ratio.toFixed(2)}:1`
				).toBeGreaterThanOrEqual(UI_BOUNDARY_CONTRAST);
			});
		}
	}

	it("mixes a different amount per mode, because one number cannot do both", () => {
		// White is at the end of the scale and a dark ground is not, so the same
		// percentage lands in two different places. A single value here is the
		// bug, not a simplification.
		expect(declaredMix("light")).not.toBe(declaredMix("dark"));
	});

	it("draws the row's boundary with that rule, and no box around the field", () => {
		const row = ruleBody(".p-switcher-search");
		expect(row).toMatch(/border-bottom:\s*1px solid var\(--p-field-rule\);/);
		// A fill or a radius here would be the box the panel already is.
		expect(row).not.toMatch(/background/);
		expect(row).not.toMatch(/border-radius/);
	});

	it("never draws that boundary with --background-modifier-border again", () => {
		const row = ruleBody(".p-switcher-search");
		expect(row).not.toMatch(/--background-modifier-border/);
	});

	it("says focus with the accent on the row, not a ring", () => {
		const focus = ruleBody(".p-switcher-search:focus-within");
		expect(focus).toMatch(/border-bottom:\s*2px solid var\(--color-accent\);/);
		// .p-history clips what leaves it, so a ring loses its top edge.
		expect(focus).not.toMatch(/box-shadow|outline/);
	});

	it("keeps the row's height when focus thickens the rule", () => {
		// The second pixel comes out of the padding, or every row below the
		// field jumps down as the panel opens.
		const rest = /padding:\s*9px 12px 8px;/.test(ruleBody(".p-switcher-search"));
		const focus = /padding-bottom:\s*7px;/.test(ruleBody(".p-switcher-search:focus-within"));
		expect(rest && focus, "8px + 1px rule must equal 7px + 2px rule").toBe(true);
	});

	it("never expresses that state through a transition", () => {
		// ADR-155: a fill or edge that communicates state must be true at the
		// moment of the tap; iOS may not paint a transitioned one until the
		// next composite.
		expect(ruleBody(".p-switcher-search:focus-within")).not.toMatch(/transition/);
	});

	it("draws the loupe in --text-muted, never --text-faint", () => {
		// ADR-188: faint is 2.3:1 on white and is not allowed on a control.
		const icon = ruleBody(".p-switcher-search-icon");
		expect(icon).toMatch(/color:\s*var\(--text-muted\)/);
		expect(icon).not.toMatch(/--text-faint/);
	});
});
