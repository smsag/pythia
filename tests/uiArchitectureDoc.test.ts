// docs/ui-architecture.md is the vocabulary a change is asked for by. A map
// that misses a surface cannot be used to ask for it, and a map that names a
// removed one sends the reader to nothing — so the doc is held to the code in
// both directions (principle 3), and every PR that adds, renames or removes a
// surface has to touch it.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const doc = readFileSync(resolve(root, "docs/ui-architecture.md"), "utf8");
const css = readFileSync(resolve(root, "styles.css"), "utf8");
const read = (p: string): string => readFileSync(resolve(root, p), "utf8");
const tsFiles = (dir: string): string[] =>
	readdirSync(resolve(root, dir)).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, ""));

/** Every `backticked` span in the doc. */
const codeSpans = [...doc.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
/** Every identifier-shaped word in the doc — the tree in §2 is a code fence, not code spans. */
const words = new Set(doc.match(/[A-Za-z_]\w*/g) ?? []);
/** Obsidian's own base classes, named as what a modal extends. */
const OBSIDIAN_CLASSES = new Set(["Modal", "SuggestModal"]);

const hint = "— update docs/ui-architecture.md";

describe("docs/ui-architecture.md names every surface", () => {
	it("names every controller in ui/", () => {
		const missing = tsFiles("ui").filter((f) => f.endsWith("Controller") && !words.has(f));
		expect(missing, `controllers missing ${hint}`).toEqual([]);
	});

	it("names every modal class in suggest/", () => {
		const classes = tsFiles("suggest").flatMap((f) =>
			[...read(`suggest/${f}.ts`).matchAll(/export class (\w+)/g)].map((m) => m[1]),
		);
		const missing = classes.filter((c) => !words.has(c));
		expect(missing, `modals missing ${hint}`).toEqual([]);
	});

	it("names every settings section in ui/settings/", () => {
		// section.ts and context.ts are the sections' shared machinery, not sections.
		const sections = tsFiles("ui/settings").filter((f) => f !== "section" && f !== "context");
		const missing = sections.filter((s) => !codeSpans.includes(s));
		expect(missing, `settings sections missing ${hint}`).toEqual([]);
	});
});

describe("docs/ui-architecture.md names nothing that is gone", () => {
	it("every controller it names exists", () => {
		const gone = [...words]
			.filter((w) => /^[A-Z]\w*Controller$/.test(w))
			.filter((c) => !existsSync(resolve(root, `ui/${c}.ts`)));
		expect(gone, `removed controllers still named ${hint}`).toEqual([]);
	});

	it("every modal it names exists", () => {
		const exported = new Set(
			tsFiles("suggest").flatMap((f) =>
				[...read(`suggest/${f}.ts`).matchAll(/export class (\w+)/g)].map((m) => m[1]),
			),
		);
		const gone = [...words]
			.filter((w) => /^[A-Z]\w*Modal$/.test(w) && !OBSIDIAN_CLASSES.has(w))
			.filter((c) => !exported.has(c));
		expect(gone, `removed modals still named ${hint}`).toEqual([]);
	});

	it("every file path it names exists", () => {
		const paths = codeSpans
			.filter((s) => /^[\w./-]+\.(ts|md|mjs)$/.test(s) || /^[\w/-]+\/$/.test(s))
			.filter((p) => !p.includes("*"));
		const gone = paths.filter((p) => !existsSync(resolve(root, p)));
		expect(gone, `missing paths named ${hint}`).toEqual([]);
	});

	it("every p-/pythia- class it names is styled", () => {
		const classes = [...new Set([...doc.matchAll(/\.((?:p|pythia)-[a-z0-9-]+)/g)].map((m) => m[1]))];
		const unstyled = classes.filter((c) => !new RegExp(`\\.${c}(?![a-z0-9-])`).test(css));
		expect(unstyled, `classes not in styles.css ${hint}`).toEqual([]);
	});
});
