import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Pythia's design tokens reach every surface it draws, and never shadow
 * Obsidian's own.
 *
 * Pythia draws outside `.pythia-view`: modals, the note-anchor card in
 * Obsidian's hover popover, a chart card in a vault note. A `var(--s3)` with
 * nothing declaring `--s3` drops its whole declaration, silently — the card
 * lost its margin and padding that way, and the chart in a note still had.
 * So every token the stylesheet reads is declared on `body`.
 *
 * Obsidian declares `--font-smaller` and `--font-small` itself, and core and
 * themes read them; Pythia's type scale is `--p-font-*`, so declaring it
 * never resizes one of Obsidian's elements.
 */
const css = readFileSync(resolve(process.cwd(), "styles.css"), "utf8")
	.replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the rule whose selector list includes `body` alone. */
function bodyTokens(): Set<string> {
	const names = new Set<string>();
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selectors = m[1].split(",").map((s) => s.trim());
		if (!selectors.includes("body")) continue;
		for (const d of m[2].matchAll(/(--[\w-]+)\s*:/g)) names.add(d[1]);
	}
	return names;
}

describe("design tokens", () => {
	it("declares every spacing and type token the stylesheet reads on body", () => {
		const read = new Set([...css.matchAll(/var\((--(?:s\d|p-font-[\w-]+))[,)]/g)].map((m) => m[1]));
		expect(read.size).toBeGreaterThan(0);
		const declared = bodyTokens();
		expect([...read].filter((name) => !declared.has(name))).toEqual([]);
	});

	it("never reads or declares Obsidian's own --font-smaller / --font-small", () => {
		expect(css.match(/--font-small(?:er)?\b/g) ?? []).toEqual([]);
	});
});
