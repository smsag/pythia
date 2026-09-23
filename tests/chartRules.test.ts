import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = process.cwd();

function sourcesUnder(dir: string): string[] {
	return readdirSync(resolve(ROOT, dir), { recursive: true })
		.map(String)
		.filter((f) => f.endsWith(".ts"))
		.map((f) => join(dir, f));
}

const CHART_MODULES = sourcesUnder(join("ui", "chart"));
const ALL_SOURCES = [
	"main.ts", "sidebar.ts", "settings.ts",
	...["ui", "suggest", "services"].flatMap(sourcesUnder),
];

function read(file: string): string {
	return readFileSync(resolve(ROOT, file), "utf8");
}

/** Strip block and line comments, so prose explaining a rule cannot break it. */
function code(file: string): string {
	return read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ── Hard rule 3: no custom colour outside the one module that derives them ────

describe("a chart names no colour (ADR-210, hard rule 3)", () => {
	// ui/chart/palette.ts is the single exception, and it earns it: the swatches
	// are derived against the live theme ground and floored at 3:1, which is what
	// tests/chartPalette.test.ts holds.
	const PALETTE = join("ui", "chart", "palette.ts");

	it("has exactly one module allowed to name a colour", () => {
		expect(CHART_MODULES).toContain(PALETTE);
	});

	it.each(CHART_MODULES.filter((f) => f !== PALETTE))(
		"%s contains no colour literal", (file) => {
			const src = code(file);
			const offenders = [
				...src.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
				...src.matchAll(/\b(?:rgba?|hsla?)\s*\(/g),
			].map((m) => m[0]);
			expect(offenders).toEqual([]);
		},
	);
});

// ── The silent-nothing bug: createEl("svg") makes an HTML element ────────────

describe("a chart is built in the SVG namespace", () => {
	it.each(CHART_MODULES)("%s never calls createEl for an SVG tag", (file) => {
		const src = code(file);
		expect(src).not.toMatch(/createEl\s*\(\s*["'](?:svg|path|rect|circle|line|text|g)["']/);
	});

	it("renders through createElementNS", () => {
		expect(code(join("ui", "chart", "render.ts"))).toContain("createElementNS");
	});
});

// ── Principle 4: one implementation per interaction ──────────────────────────

describe("one clipboard helper (principle 4)", () => {
	const HELPER = join("ui", "clipboard.ts");

	/**
	 * The four surfaces that hand-rolled their own copy while `copyWithFeedback`
	 * sat private inside `ui/CodeBlockDecorator.ts`. ADR-210 extracted the helper
	 * and moved the code blocks onto it; these four are the remainder, recorded
	 * in docs/engineering-review.md.
	 *
	 * This list may only SHRINK. Adding to it means a sixth copy was written.
	 */
	const GRANDFATHERED = [
		join("ui", "SummaryController.ts"),
		join("ui", "SelectionController.ts"),
		join("ui", "HeaderController.ts"),
		join("ui", "RewriteController.ts"),
		join("services", "ConversationService.ts"),
	];

	it("is the only place navigator.clipboard is reached", () => {
		const offenders = ALL_SOURCES.filter(
			(f) => f !== HELPER && !GRANDFATHERED.includes(f) && code(f).includes("navigator.clipboard"),
		);
		expect(offenders).toEqual([]);
	});

	it("keeps every grandfathered site real, so the list cannot rot", () => {
		const stale = GRANDFATHERED.filter((f) => !code(f).includes("navigator.clipboard"));
		expect(stale, "these no longer copy — delete them from the list").toEqual([]);
	});

	it("left no second copy behind in the code blocks", () => {
		expect(code(join("ui", "CodeBlockDecorator.ts"))).not.toContain("navigator.clipboard");
	});

	// Safari spends the user gesture on an await, so the blob must reach
	// ClipboardItem unresolved or the image copy fails on iOS alone.
	it("hands ClipboardItem a promise rather than an awaited blob", () => {
		const src = code(HELPER);
		expect(src).toMatch(/new Item\(\{\s*\[mime\]:\s*blob\s*\}\)/);
		expect(src).not.toMatch(/await\s+blob/);
	});
});

// ── The export's one unavoidable rule ────────────────────────────────────────

describe("the PNG export resolves what a stylesheet would have supplied", () => {
	it("strips the custom properties it replaces", () => {
		const src = code(join("ui", "chart", "export.ts"));
		expect(src).toContain('removeAttribute("style")');
		expect(src).toContain('removeAttribute("class")');
	});

	it("paints a background rather than exporting transparency", () => {
		expect(code(join("ui", "chart", "export.ts"))).toMatch(/bg\.setAttribute\("fill", ground\)/);
	});
});
