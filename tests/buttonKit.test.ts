import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The button block in `styles.css` IS `kit/button.css`, instantiated.
 *
 * Pythia is the baseline for the family's buttons, so the kit is the canonical
 * text and another plugin copies it. A copy drifts unless something holds it,
 * and the drift that matters is here: if the block is edited in place, the kit
 * stops being what this plugin actually renders, and the copy in the next
 * plugin is a copy of nothing.
 *
 * So the check is exact: substitute the kit's placeholders and the result must
 * be the block, byte for byte. Edit the kit, then re-instantiate.
 */
const root = process.cwd();
const kit = readFileSync(resolve(root, "kit/button.css"), "utf8");
const css = readFileSync(resolve(root, "styles.css"), "utf8");

const BANNER = "/* ── Buttons: one rule set per role (ADR-188)";
const END = ":is(.pythia-view, .pythia-modal) [hidden] { display: none !important; }";

/** The kit without its own header comment: the rules a host instantiates. */
function kitRules(): string {
	const at = kit.indexOf("*/");
	expect(at, "kit/button.css must open with its header comment").toBeGreaterThan(-1);
	return kit.slice(at + 2).replace(/^\n+/, "").trimEnd();
}

/** The instantiated block, from the banner's end to the last rule. */
function instantiated(): string {
	const from = css.indexOf(BANNER);
	expect(from, "the ADR-188 banner is missing from styles.css").toBeGreaterThan(-1);
	const to = css.indexOf(END, from);
	expect(to, "the button block's last rule is missing").toBeGreaterThan(-1);
	const block = css.slice(from, to + END.length);
	// Everything after the banner comment and Pythia's own contract override.
	const afterBanner = block.slice(block.indexOf("*/") + 2);
	const rulesStart = afterBanner.indexOf(":is(.pythia-view, .pythia-modal) .pb {");
	expect(rulesStart, "the base rule is missing from the block").toBeGreaterThan(-1);
	return afterBanner.slice(rulesStart).trimEnd();
}

describe("the button kit", () => {
	it("still carries all three placeholders", () => {
		for (const ph of ["%%P%%", "%%SCOPE%%", "%%MODAL%%"]) {
			expect(kitRules(), `${ph} is gone — the kit is no longer portable`).toContain(ph);
		}
	});

	it("names no plugin of its own", () => {
		// A plugin name in the rules means the kit was edited in its instantiated
		// form and copied back.
		expect(kitRules()).not.toMatch(/\.pythia|\bpb\b/);
	});

	it("reaches every colour through the contract, never a token directly", () => {
		const rules = kitRules();
		for (const [token, prop] of [
			["--color-accent", "--btn-accent"],
			["--text-error", "--btn-error"],
		]) {
			// The token may appear ONLY as the fallback inside its own contract var.
			const bare = new RegExp(`var\\(${token}\\)`, "g");
			const viaContract = new RegExp(`var\\(${prop}, var\\(${token}\\)\\)`, "g");
			const total = (rules.match(bare) || []).length;
			const wrapped = (rules.match(viaContract) || []).length;
			expect(total, `${token} is read outside var(${prop}, …)`).toBe(wrapped);
		}
	});

	it("is what styles.css renders, byte for byte", () => {
		const expected = kitRules()
			.replace(/%%SCOPE%%/g, ":is(.pythia-view, .pythia-modal)")
			.replace(/%%MODAL%%/g, ".modal.pythia-modal")
			.replace(/\.%%P%%/g, ".pb");
		expect(instantiated()).toBe(expected);
	});

	it("lets Pythia override only the label on an accent fill (ADR-154)", () => {
		// The contrast-computed token is Pythia's, not the family's: a plugin
		// without one takes the kit's Obsidian default.
		expect(css).toContain("--btn-on-accent: var(--p-on-accent, var(--text-on-accent));");
		expect(kitRules()).not.toContain("--p-on-accent");
	});
});
