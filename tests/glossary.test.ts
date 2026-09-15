import { describe, it, expect } from "vitest";
import {
	parseGlossary,
	upsertGlossaryEntry,
	normalizeTerm,
	buildTermIndex,
	canonicalTerm,
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

describe("buildTermIndex", () => {
	const matches = (re: RegExp, text: string) => text.match(re) ?? [];
	/** Index a list of bare terms — the alias-free case most of these cover. */
	const matcherFor = (terms: string[]) => buildTermIndex(terms.map((term) => ({ term })))?.matcher ?? null;

	it("returns null for an empty glossary so the painter can skip the walk", () => {
		expect(matcherFor([])).toBeNull();
		expect(matcherFor(["a"])).toBeNull(); // single characters match far too much
	});

	it("matches a term case-insensitively, every occurrence", () => {
		const re = matcherFor(["Neuron"])!;
		expect(matches(re, "A neuron and another Neuron.")).toEqual(["neuron", "Neuron"]);
	});

	it("prefers the longest term when two overlap", () => {
		// First-match alternation would return "Coding"; sorting by length fixes it.
		const re = matcherFor(["Coding", "Sparse Coding"])!;
		expect(matches(re, "See Sparse Coding here.")).toEqual(["Sparse Coding"]);
	});

	it("does not match inside a longer word", () => {
		const re = matcherFor(["Ion"])!;
		expect(matches(re, "Ionisation and Nation")).toEqual([]);
	});

	it("bounds non-ASCII terms correctly, where \\b would fail", () => {
		const re = matcherFor(["Zähler"])!;
		expect(matches(re, "Der Zähler ist undefiniert.")).toEqual(["Zähler"]);
		expect(matches(re, "Zählerstand")).toEqual([]);
	});

	it("treats a term with regex metacharacters literally", () => {
		const re = matcherFor(["C++"])!;
		expect(matches(re, "written in C++ here")).toEqual(["C++"]);
	});

	it("de-duplicates terms differing only by case or spacing", () => {
		const re = matcherFor(["Neuron", "neuron", " NEURON "])!;
		expect(matches(re, "neuron")).toEqual(["neuron"]);
	});
});

describe("aliases", () => {
	it("round-trips through the metadata marker, spaces and all", () => {
		const e = entry({ term: "Zähler", aliases: ["Zählers", "Zählern", "sparse counter"] });
		const parsed = parseGlossary(upsertGlossaryEntry("# Glossary\n", e));
		expect(parsed[0].aliases).toEqual(["Zählers", "Zählern", "sparse counter"]);
		expect(parsed[0].updatedAt).toBe(e.updatedAt);
		expect(parsed[0].source).toBe("model");
	});

	it("renders no aliases field when there are none, leaving the old format intact", () => {
		const md = upsertGlossaryEntry("# Glossary\n", entry());
		expect(md).not.toContain("aliases=");
		expect(parseGlossary(md)[0].aliases).toBeUndefined();
	});

	it("strips separators and comment markers out of a form so one item cannot corrupt the entry", () => {
		// `|` would split the item, and a stray `%%` in the body would open an
		// Obsidian comment and swallow the rest of the note (ADR-149).
		const md = upsertGlossaryEntry("# Glossary\n", entry({ aliases: ["a|b", "c%%d"] }));
		expect(md).toContain("**Forms:** a b \u00b7 c d");
		expect(parseGlossary(md)[0].aliases).toEqual(["a b", "c d"]);
	});

	it("matches an alias and resolves it back to the canonical term", () => {
		const ix = buildTermIndex([entry({ term: "Zähler", aliases: ["Zählern", "counter"] })])!;
		expect("Mit den Zählern und dem counter".match(ix.matcher)).toEqual(["Zählern", "counter"]);
		expect(canonicalTerm(ix, "Zählern")).toBe("Zähler");
		expect(canonicalTerm(ix, "COUNTER")).toBe("Zähler");
	});

	it("never lets one entry's alias shadow another entry's own term", () => {
		// "Zähler" is entry two's term but entry one lists it as an alias. Order in
		// the note must not decide which definition the word opens.
		const ix = buildTermIndex([
			entry({ term: "Counter", aliases: ["Zähler"] }),
			entry({ term: "Zähler" }),
		])!;
		expect(canonicalTerm(ix, "Zähler")).toBe("Zähler");
	});

	it("still prefers the longest surface form when an alias overlaps a term", () => {
		const ix = buildTermIndex([
			entry({ term: "Coding" }),
			entry({ term: "Sparse Representation", aliases: ["Sparse Coding"] }),
		])!;
		expect("See Sparse Coding here.".match(ix.matcher)).toEqual(["Sparse Coding"]);
		expect(canonicalTerm(ix, "Sparse Coding")).toBe("Sparse Representation");
	});

	it("drops aliases too short to be useful, like the terms themselves", () => {
		const ix = buildTermIndex([entry({ term: "Neuron", aliases: ["N"] })])!;
		expect("N and Neuron".match(ix.matcher)).toEqual(["Neuron"]);
	});
});

describe("model provenance (ADR-144)", () => {
	it("round-trips the model that wrote the definition", () => {
		const md = upsertGlossaryEntry("# Glossary\n", entry({ model: "claude-haiku-4-5" }));
		expect(md).toContain("model=claude-haiku-4-5");
		expect(parseGlossary(md)[0].model).toBe("claude-haiku-4-5");
	});

	it("stays absent for a hand-written entry, leaving the old note format intact", () => {
		const md = upsertGlossaryEntry("# Glossary\n", entry({ source: "manual" }));
		expect(md).not.toContain("model=");
		expect(parseGlossary(md)[0].model).toBeUndefined();
	});

	it("survives alongside aliases, which run to the closing marker", () => {
		const e = entry({ model: "gpt-5-mini", aliases: ["Zählers", "sparse counter"] });
		const parsed = parseGlossary(upsertGlossaryEntry("# Glossary\n", e))[0];
		expect(parsed.model).toBe("gpt-5-mini");
		expect(parsed.aliases).toEqual(["Zählers", "sparse counter"]);
	});
});

// ── Visible fields (ADR-149) ──────────────────────────────────────────────────

describe("visible fields", () => {
	it("writes forms, translations and context as visible markdown, not inside the comment", () => {
		// The whole point of ADR-149: an Obsidian comment is invisible to every
		// external reader, so card-relevant content cannot live there.
		const md = upsertGlossaryEntry("# Glossary\n", entry({
			aliases: ["Zählers"],
			translations: [{ lang: "en", term: "counter" }],
			context: "Der Zähler wird monatlich abgelesen.",
		}));
		const body = md.replace(/%%[^%]*%%/g, "");
		expect(body).toContain("**Forms:** Zählers");
		expect(body).toContain("**Translations:** en: counter");
		expect(body).toContain("**Context:** Der Zähler wird monatlich abgelesen.");
	});

	it("keeps provenance in the comment, where it is machine state and not card content", () => {
		const md = upsertGlossaryEntry("# Glossary\n", entry({ model: "gpt-5-mini" }));
		expect(md).toContain("%% pythia: source=model");
		expect(md).toContain("model=gpt-5-mini");
		expect(md).not.toContain("**Forms:**");
	});

	it("round-trips forms, translations and context", () => {
		const original = entry({
			aliases: ["Zählers", "Zählern"],
			translations: [{ lang: "en", term: "counter" }, { lang: "it", term: "contatore" }],
			context: "Der Zähler wird monatlich abgelesen.",
		});
		const [parsed] = parseGlossary(upsertGlossaryEntry("# Glossary\n", original));
		expect(parsed.aliases).toEqual(["Zählers", "Zählern"]);
		expect(parsed.translations).toEqual([
			{ lang: "en", term: "counter" },
			{ lang: "it", term: "contatore" },
		]);
		expect(parsed.context).toBe("Der Zähler wird monatlich abgelesen.");
	});

	it("omits a field entirely rather than writing an empty label", () => {
		const md = upsertGlossaryEntry("# Glossary\n", entry());
		expect(md).not.toContain("Forms:");
		expect(md).not.toContain("Translations:");
		expect(md).not.toContain("Context:");
	});

	it("keeps labelled lines out of the definition", () => {
		const md = `## Zähler\n\nEin Gerät, das Ereignisse erfasst.\n\n**Forms:** Zählers\n**Context:** Der Zähler läuft.\n`;
		const [e] = parseGlossary(md);
		expect(e.definition).toBe("Ein Gerät, das Ereignisse erfasst.");
	});

	it("reads a hand-typed label without bold markers", () => {
		// The note is hand-edited, so someone will type the label plainly.
		const md = `## Zähler\n\nEin Gerät.\n\nForms: Zählers · Zählern\nTranslations: en: counter\n`;
		const [e] = parseGlossary(md);
		expect(e.aliases).toEqual(["Zählers", "Zählern"]);
		expect(e.translations).toEqual([{ lang: "en", term: "counter" }]);
	});

	it("accepts | and , as hand-edit separators alongside the written ·", () => {
		const md = `## Zähler\n\nEin Gerät.\n\n**Forms:** Zählers | Zählern\n`;
		expect(parseGlossary(md)[0].aliases).toEqual(["Zählers", "Zählern"]);
	});

	it("drops a translation with no language code rather than guessing one", () => {
		const md = `## Zähler\n\nEin Gerät.\n\n**Translations:** counter · it: contatore\n`;
		expect(parseGlossary(md)[0].translations).toEqual([{ lang: "it", term: "contatore" }]);
	});

	it("still reads aliases from the legacy comment marker", () => {
		// A glossary written before ADR-149 must keep marking its variants.
		const md = `## Zähler\n%% pythia: source=model aliases=Zählers|Zählern %%\n\nEin Gerät.\n`;
		expect(parseGlossary(md)[0].aliases).toEqual(["Zählers", "Zählern"]);
	});

	it("matches a translation and resolves it back to the canonical term", () => {
		// An Italian answer should mark "contatore" and open the German entry.
		const index = buildTermIndex([
			{ term: "Zähler", translations: [{ lang: "it", term: "contatore" }] },
		]);
		expect(index).not.toBeNull();
		expect("Il contatore è rotto.".match(index!.matcher)?.[0]).toBe("contatore");
		expect(canonicalTerm(index!, "contatore")).toBe("Zähler");
	});
});
