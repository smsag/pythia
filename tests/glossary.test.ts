import { describe, it, expect } from "vitest";
import {
	parseGlossary,
	upsertGlossaryEntry,
	normalizeTerm,
	buildTermMatcher,
	type GlossaryEntry,
} from "../services/glossary";

const entry = (over: Partial<GlossaryEntry> = {}): GlossaryEntry => ({
	term: "Sparse Coding",
	definition: "A representation where few neurons are active at once.",
	source: "model",
	updatedAt: "2026-09-15T00:00:00.000Z",
	...over,
});

describe("normalizeTerm", () => {
	it("folds case and collapses whitespace so lookups are stable", () => {
		expect(normalizeTerm("  Sparse   CODING ")).toBe("sparse coding");
	});
});

describe("parseGlossary", () => {
	it("reads terms, definitions and provenance", () => {
		const md = `# Glossary\n\n## Sparse Coding\n%% pythia: source=model updatedAt=2026-09-15T00:00:00.000Z %%\n\nFew neurons active.\n`;
		const [e] = parseGlossary(md);
		expect(e.term).toBe("Sparse Coding");
		expect(e.definition).toBe("Few neurons active.");
		expect(e.source).toBe("model");
		expect(e.updatedAt).toBe("2026-09-15T00:00:00.000Z");
	});

	it("treats a hand-written entry with no marker as manual", () => {
		const [e] = parseGlossary("## Landauer\n\nA thermodynamic bound.\n");
		expect(e.source).toBe("manual");
		expect(e.updatedAt).toBeUndefined();
	});

	it("keeps multi-paragraph definitions intact", () => {
		const [e] = parseGlossary("## Term\n\nFirst para.\n\nSecond para.\n");
		expect(e.definition).toBe("First para.\n\nSecond para.");
	});

	it("ignores a preamble above the first heading", () => {
		const md = "---\ntags: glossary\n---\n\n# My Glossary\nSome intro.\n\n## Term\n\nDef.\n";
		expect(parseGlossary(md).map((e) => e.term)).toEqual(["Term"]);
	});

	it("keeps a heading with no body rather than dropping it", () => {
		// Losing a hand-written entry to a strict parser is worse than an odd one.
		const entries = parseGlossary("## Empty\n\n## Full\n\nDef.\n");
		expect(entries.map((e) => e.term)).toEqual(["Empty", "Full"]);
		expect(entries[0].definition).toBe("");
	});

	it("returns nothing for an empty or heading-less note", () => {
		expect(parseGlossary("")).toEqual([]);
		expect(parseGlossary("just prose, no headings")).toEqual([]);
	});
});

describe("upsertGlossaryEntry", () => {
	it("appends a new term after existing content", () => {
		const out = upsertGlossaryEntry("# Glossary\n\n## Alpha\n\nFirst.\n", entry({ term: "Beta", definition: "Second." }));
		expect(parseGlossary(out).map((e) => e.term)).toEqual(["Alpha", "Beta"]);
		expect(out).toContain("# Glossary");
	});

	it("replaces an existing term without touching the others", () => {
		const md = "## Alpha\n\nOld alpha.\n\n## Beta\n\nBeta stays.\n";
		const out = upsertGlossaryEntry(md, entry({ term: "Alpha", definition: "New alpha." }));
		const parsed = parseGlossary(out);
		expect(parsed.map((e) => e.term)).toEqual(["Alpha", "Beta"]);
		expect(parsed[0].definition).toBe("New alpha.");
		expect(parsed[1].definition).toBe("Beta stays.");
	});

	it("matches an existing term case-insensitively instead of duplicating it", () => {
		const out = upsertGlossaryEntry("## Sparse Coding\n\nOld.\n", entry({ term: "sparse coding", definition: "New." }));
		expect(parseGlossary(out)).toHaveLength(1);
	});

	it("preserves the preamble when replacing the first entry", () => {
		const md = "---\ntags: glossary\n---\n\n# Glossary\n\n## Alpha\n\nOld.\n";
		const out = upsertGlossaryEntry(md, entry({ term: "Alpha", definition: "New." }));
		expect(out).toContain("tags: glossary");
		expect(out).toContain("# Glossary");
		expect(parseGlossary(out)[0].definition).toBe("New.");
	});

	it("round-trips through the parser", () => {
		const e = entry();
		const parsed = parseGlossary(upsertGlossaryEntry("", e));
		expect(parsed).toHaveLength(1);
		expect(parsed[0]).toEqual(e);
	});
});

describe("buildTermMatcher", () => {
	const matches = (re: RegExp, text: string) => text.match(re) ?? [];

	it("returns null for an empty glossary so the painter can skip the walk", () => {
		expect(buildTermMatcher([])).toBeNull();
		expect(buildTermMatcher(["a"])).toBeNull(); // single characters match far too much
	});

	it("matches a term case-insensitively, every occurrence", () => {
		const re = buildTermMatcher(["Neuron"])!;
		expect(matches(re, "A neuron and another Neuron.")).toEqual(["neuron", "Neuron"]);
	});

	it("prefers the longest term when two overlap", () => {
		// First-match alternation would return "Coding"; sorting by length fixes it.
		const re = buildTermMatcher(["Coding", "Sparse Coding"])!;
		expect(matches(re, "See Sparse Coding here.")).toEqual(["Sparse Coding"]);
	});

	it("does not match inside a longer word", () => {
		const re = buildTermMatcher(["Ion"])!;
		expect(matches(re, "Ionisation and Nation")).toEqual([]);
	});

	it("bounds non-ASCII terms correctly, where \\b would fail", () => {
		const re = buildTermMatcher(["Zähler"])!;
		expect(matches(re, "Der Zähler ist undefiniert.")).toEqual(["Zähler"]);
		expect(matches(re, "Zählerstand")).toEqual([]);
	});

	it("treats a term with regex metacharacters literally", () => {
		const re = buildTermMatcher(["C++"])!;
		expect(matches(re, "written in C++ here")).toEqual(["C++"]);
	});

	it("de-duplicates terms differing only by case or spacing", () => {
		const re = buildTermMatcher(["Neuron", "neuron", " NEURON "])!;
		expect(matches(re, "neuron")).toEqual(["neuron"]);
	});
});
