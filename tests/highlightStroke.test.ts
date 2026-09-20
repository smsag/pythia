import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The highlighter stroke keeps its shape (ADR-194).
 *
 * The numbers below ARE the mark: a felt tip laid over the words and lifted
 * off again, square-ended, one stroke per wrapped line. They are Pythia's own
 * and this test is the only thing holding them — a stroke is the kind of thing
 * a later change nudges without noticing.
 *
 * It matters here more than in most panels: the theme's own `==highlight==`
 * renders inside this one whenever an answer contains a highlight, so a drift
 * shows up immediately as two marks in a paragraph leaning different ways.
 * That is exactly what ADR-194 replaced.
 */
const css = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");

/**
 * The declarations of the rule this selector OPENS. A selector that also
 * appears in a grouped rule ("a,\n b {") would otherwise match that one:
 * `.pythia-view pythia-fork {` is the tail of the shared stroke rule as well
 * as a rule of its own, and the ink assertions need the second.
 */
function ruleBody(selector: string): string {
	for (let at = css.indexOf(selector); at !== -1; at = css.indexOf(selector, at + 1)) {
		const before = css.slice(0, at).trimEnd();
		if (!before.endsWith(",")) {
			const open = css.indexOf("{", at);
			return css.slice(open + 1, css.indexOf("}", open));
		}
	}
	expect.fail(`${selector} is missing from styles.css`);
}

const STROKE = ".pythia-view pythia-favorite,\n.pythia-view pythia-fork {";
const FAVORITE = ".pythia-view pythia-favorite {";
const FORK = ".pythia-view pythia-fork {";

describe("the highlighter stroke", () => {
	it("draws both marks with one rule, so they cannot diverge", () => {
		expect(css).toContain(STROKE);
	});

	it.each([
		["--hl-angle", "104deg"],
		["--hl-land-0", "0.2em"],
		["--hl-land-1", "0.7em"],
		["--hl-lift-1", "88%"],
		["--hl-lift-0", "calc(100% - 0.28em)"],
		["--hl-pad-y", "0.14em"],
		["--hl-pad-x", "0.42em"],
	])("keeps %s at %s", (prop, value) => {
		expect(ruleBody(STROKE)).toContain(`${prop}: ${value};`);
	});

	it("lays one stroke per line, so a wrapped mark lands and lifts on each", () => {
		const body = ruleBody(STROKE);
		// Anchored: a bare `toContain` on the unprefixed property is satisfied by
		// the -webkit- one, so dropping the standard property passed silently.
		expect(body).toMatch(/(^|[;\s])box-decoration-break:\s*clone/m);
		expect(body).toMatch(/-webkit-box-decoration-break:\s*clone/);
	});

	it.each([
		["border-radius", "0", "a marker pen has no corners; a rounded end reads as a chip"],
		["text-shadow", "none", "a halo competes with the stroke and inverts between themes"],
		["box-shadow", "none", "a highlight is ink on the page, not an object above it"],
	])("sets %s to %s — %s", (prop, value) => {
		expect(ruleBody(STROKE)).toContain(`${prop}: ${value};`);
	});

	it.each([
		["favorite", FAVORITE, "--color-yellow"],
		["fork", FORK, "--color-accent"],
	])("inks the %s from a named colour composited onto the page", (_name, selector, token) => {
		const body = ruleBody(selector);
		// Never --text-highlight-bg raw: it is rgba(255,200,40,0.30) under
		// one theme and near-solid yellow under another, so the same
		// rule painted at half strength under one of them.
		expect(body).toMatch(
			new RegExp(`--hl-ink:\\s*color-mix\\(in srgb, var\\(${token}\\) \\d+%, var\\(--background-primary\\)\\)`),
		);
		expect(body).not.toContain("var(--text-highlight-bg)");
	});

	it("never reads --text-highlight-bg for a mark's ink", () => {
		for (const selector of [STROKE, FAVORITE, FORK]) {
			expect(ruleBody(selector)).not.toContain("--text-highlight-bg");
		}
	});

	it("flashes on background-color, which interpolates, not on the ink", () => {
		const frames = css.slice(css.indexOf("@keyframes pythia-hl-flash"));
		const body = frames.slice(0, frames.indexOf("\n}"));
		expect(body).toContain("background-color:");
		// A custom property does not interpolate without @property, so animating
		// --hl-ink would step rather than fade; replacing `background` would drop
		// the gradient and change the mark's shape for the duration.
		expect(body).not.toContain("--hl-ink:");
		expect(body).not.toMatch(/(^|[;\s])background:/);
	});
});
