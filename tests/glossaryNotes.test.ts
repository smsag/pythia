import { describe, it, expect } from "vitest";
import {
	sanitizeFileName,
	folderOf,
	termPath,
	themePath,
	translationKey,
	themeLink,
	themeName,
	entryFrontmatter,
	entryFromFrontmatter,
	renderBody,
	parseBody,
	stripFrontmatter,
	mergeEntry,
	effectiveTheme,
	definitionKey,
	definitionHash,
	cachedTranslation,
	applyTranslation,
	displayLanguage,
	needsTranslation,
} from "../services/glossaryNotes";
import type { GlossaryEntry } from "../services/glossary";
import type { Conversation } from "../models/types";

const entry = (over: Partial<GlossaryEntry> = {}): GlossaryEntry => ({
	term: "Zähler",
	definition: "Ein Gerät, das diskrete Ereignisse erfasst.",
	source: "model",
	updatedAt: "2026-09-15T00:00:00.000Z",
	...over,
});

// ── Paths ─────────────────────────────────────────────────────────────────────

describe("sanitizeFileName", () => {
	it("replaces characters no vault can carry in a file name", () => {
		expect(sanitizeFileName("AC/DC: live?")).toBe("AC-DC- live-");
	});

	it("strips Obsidian's own link and heading characters", () => {
		// `#` and `[]` would break `[[Term]]` links to the note.
		expect(sanitizeFileName("C# [draft]")).toBe("C- -draft-");
	});

	it("refuses a leading dot, which would make a hidden file", () => {
		expect(sanitizeFileName("..env")).toBe("env");
	});

	it("keeps non-ASCII letters, which are legal and are most of the vocabulary", () => {
		expect(sanitizeFileName("Zähler")).toBe("Zähler");
	});
});

describe("paths", () => {
	it("puts terms and themes in their own subfolders", () => {
		expect(termPath("Glossary", "Zähler")).toBe("Glossary/Terms/Zähler.md");
		expect(themePath("Glossary", "Mietrecht 2026")).toBe("Glossary/Themes/Mietrecht 2026.md");
	});

	it("returns the folder part for ensureFolder, which takes a folder not a file", () => {
		expect(folderOf("Glossary/Terms/Zähler.md")).toBe("Glossary/Terms");
		expect(folderOf("top.md")).toBe("");
	});
});

describe("theme links", () => {
	it("round-trips a theme name through its wikilink form", () => {
		expect(themeName(themeLink("Mietrecht 2026"))).toBe("Mietrecht 2026");
	});

	it("accepts a bare name, since the property is hand-editable", () => {
		expect(themeName("Mietrecht")).toBe("Mietrecht");
	});
});

// ── Frontmatter ───────────────────────────────────────────────────────────────

describe("entryFrontmatter", () => {
	it("writes aliases as Obsidian's own property rather than a custom key", () => {
		const fm = entryFrontmatter(entry({ aliases: ["Zählers"] }));
		expect(fm.aliases).toEqual(["Zählers"]);
		expect(fm.type).toBe("term");
	});

	it("writes one flat property per language, so each is a Base column", () => {
		const fm = entryFrontmatter(entry({
			translations: [{ lang: "en", term: "counter" }, { lang: "it", term: "contatore" }],
		}));
		expect(fm[translationKey("en")]).toBe("counter");
		expect(fm.term_it).toBe("contatore");
	});

	it("writes themes as links, so the theme note gets backlinks", () => {
		expect(entryFrontmatter(entry({ theme: ["Mietrecht 2026"] })).theme).toEqual(["[[Mietrecht 2026]]"]);
	});

	it("omits the model for a hand-written entry", () => {
		expect(entryFrontmatter(entry({ source: "manual" })).model).toBeUndefined();
	});
});

describe("entryFromFrontmatter", () => {
	it("reads back everything entryFrontmatter wrote", () => {
		const original = entry({
			aliases: ["Zählers"],
			translations: [{ lang: "en", term: "counter" }],
			theme: ["Mietrecht 2026"],
			model: "gpt-5-mini",
		});
		const back = entryFromFrontmatter("Zähler", entryFrontmatter(original), {
			definition: original.definition,
			contexts: [],
		});
		expect(back).toEqual({ ...original, kind: "term", contexts: undefined });
	});

	it("survives a note with no frontmatter at all", () => {
		const e = entryFromFrontmatter("Zähler", undefined);
		expect(e.term).toBe("Zähler");
		expect(e.source).toBe("manual");
		expect(e.aliases).toBeUndefined();
	});

	it("accepts a scalar where a list is expected, because the property is hand-edited", () => {
		expect(entryFromFrontmatter("X", { aliases: "solo" }).aliases).toEqual(["solo"]);
	});

	it("reads a theme property whether it is a link or a bare name", () => {
		expect(entryFromFrontmatter("X", { theme: ["[[A]]", "B"] }).theme).toEqual(["A", "B"]);
	});
});

// ── Body ──────────────────────────────────────────────────────────────────────

describe("body", () => {
	it("round-trips the definition and every context quote", () => {
		const e = entry({ contexts: ["Erster Satz.", "Zweiter Satz."] });
		expect(parseBody(renderBody(e))).toEqual({
			definition: e.definition,
			contexts: ["Erster Satz.", "Zweiter Satz."],
		});
	});

	it("keeps a multi-paragraph definition whole", () => {
		const e = entry({ definition: "Erster Absatz.\n\nZweiter Absatz." });
		expect(parseBody(renderBody(e)).definition).toBe("Erster Absatz.\n\nZweiter Absatz.");
	});

	it("flattens a newline inside a context, which would otherwise end the quote", () => {
		expect(renderBody(entry({ contexts: ["Zeile eins\nZeile zwei"] }))).toContain("> Zeile eins Zeile zwei");
	});

	it("strips a leading frontmatter block before parsing", () => {
		expect(stripFrontmatter("---\ntype: term\n---\nDef.\n")).toBe("Def.\n");
	});

	it("leaves a body without frontmatter untouched", () => {
		expect(stripFrontmatter("Def.\n")).toBe("Def.\n");
	});
});

// ── Merge ─────────────────────────────────────────────────────────────────────

describe("mergeEntry", () => {
	it("returns the incoming entry when the term is new", () => {
		expect(mergeEntry(null, entry())).toEqual(entry());
	});

	it("unions themes, so a term met in a second conversation joins both decks", () => {
		const merged = mergeEntry(entry({ theme: ["A"] }), entry({ theme: ["B"] }));
		expect(merged.theme).toEqual(["A", "B"]);
	});

	it("accumulates contexts rather than replacing them", () => {
		const merged = mergeEntry(entry({ contexts: ["Erst."] }), entry({ contexts: ["Dann."] }));
		expect(merged.contexts).toEqual(["Erst.", "Dann."]);
	});

	it("does not duplicate a theme or context already recorded", () => {
		const merged = mergeEntry(entry({ theme: ["A"], contexts: ["X."] }), entry({ theme: ["a"], contexts: ["X."] }));
		expect(merged.theme).toEqual(["A"]);
		expect(merged.contexts).toEqual(["X."]);
	});

	it("keeps a hand-written definition when the model is consulted again", () => {
		// The user corrected it; a re-lookup must not silently undo that.
		const existing = entry({ source: "manual", definition: "Von Hand korrigiert." });
		const merged = mergeEntry(existing, entry({ definition: "Vom Modell." }));
		expect(merged.definition).toBe("Von Hand korrigiert.");
		expect(merged.source).toBe("manual");
	});

	it("still collects new themes and contexts onto a hand-written entry", () => {
		const existing = entry({ source: "manual", definition: "Von Hand." });
		const merged = mergeEntry(existing, entry({ theme: ["Neu"], contexts: ["Satz."] }));
		expect(merged.definition).toBe("Von Hand.");
		expect(merged.theme).toEqual(["Neu"]);
	});

	it("replaces a hand-written definition when the user explicitly regenerates", () => {
		const existing = entry({ source: "manual", definition: "Von Hand." });
		const merged = mergeEntry(existing, entry({ definition: "Neu generiert." }), true);
		expect(merged.definition).toBe("Neu generiert.");
		expect(merged.source).toBe("model");
	});

	it("keeps the existing term's spelling, since the note name is the identity", () => {
		const merged = mergeEntry(entry({ term: "Zähler" }), entry({ term: "zähler" }));
		expect(merged.term).toBe("Zähler");
	});

	it("adds a translation for a language not recorded yet, keeping the existing one", () => {
		const merged = mergeEntry(
			entry({ translations: [{ lang: "en", term: "counter" }] }),
			entry({ translations: [{ lang: "en", term: "meter" }, { lang: "it", term: "contatore" }] })
		);
		expect(merged.translations).toEqual([
			{ lang: "en", term: "counter" },
			{ lang: "it", term: "contatore" },
		]);
	});
});

// ── Theme resolution (ADR-150) ────────────────────────────────────────────────

describe("effectiveTheme", () => {
	const conv = (over: Partial<Conversation> = {}): Conversation =>
		({ name: "Mietrecht 2026", ...over }) as Conversation;

	it("follows the conversation name when no theme is pinned", () => {
		expect(effectiveTheme(conv())).toBe("Mietrecht 2026");
	});

	it("uses the pinned theme when one is set", () => {
		expect(effectiveTheme(conv({ theme: "Immobilienrecht" }))).toBe("Immobilienrecht");
	});

	it("treats an empty pinned theme as no theme rather than as an empty one", () => {
		// The settings field writes undefined for a cleared input; a stray "" must
		// not produce a note called ".md".
		expect(effectiveTheme(conv({ theme: "   " }))).toBe("");
	});

	it("survives a conversation with no name", () => {
		expect(effectiveTheme({ } as Conversation)).toBe("");
	});
});

// ── Person entities (ADR-151) ─────────────────────────────────────────────────

describe("person entries", () => {
	const person = (over: Partial<GlossaryEntry> = {}): GlossaryEntry =>
		entry({ term: "Anna Weber", kind: "person", definition: "Maklerin im Team Nord.", ...over });

	it("files people in their own folder, terms in theirs", () => {
		expect(termPath("Glossary", "Anna Weber", "person")).toBe("Glossary/People/Anna Weber.md");
		expect(termPath("Glossary", "Zähler", "term")).toBe("Glossary/Terms/Zähler.md");
	});

	it("defaults to the term folder when no kind is given", () => {
		expect(termPath("Glossary", "Zähler")).toBe("Glossary/Terms/Zähler.md");
	});

	it("writes the kind as the type property, which is what a Base filters on", () => {
		expect(entryFrontmatter(person()).type).toBe("person");
		expect(entryFrontmatter(entry()).type).toBe("term");
	});

	it("reads the kind back, defaulting to term for a note written before people existed", () => {
		expect(entryFromFrontmatter("Anna Weber", { type: "person" }).kind).toBe("person");
		expect(entryFromFrontmatter("Zähler", { source: "model" }).kind).toBe("term");
	});

	it("round-trips a person through frontmatter", () => {
		const original = person({ aliases: ["Weber"], theme: ["Mietrecht 2026"] });
		const back = entryFromFrontmatter("Anna Weber", entryFrontmatter(original), {
			definition: original.definition,
			contexts: [],
		});
		expect(back).toEqual({ ...original, contexts: undefined, translations: undefined });
	});

	it("merges a person like any other entry, keeping a hand-written description", () => {
		const existing = person({ source: "manual", definition: "Von Hand." });
		const merged = mergeEntry(existing, person({ definition: "Vom Modell.", theme: ["Neu"] }));
		expect(merged.definition).toBe("Von Hand.");
		expect(merged.theme).toEqual(["Neu"]);
	});
});

describe("entryFrontmatter — the real term survives a sanitized file name", () => {
	it("writes a `term` property only when the file name had to change", () => {
		expect(entryFrontmatter(entry({ term: "Zähler" })).term).toBeUndefined();
		expect(entryFrontmatter(entry({ term: "C#" })).term).toBe("C#");
		expect(entryFrontmatter(entry({ term: "A/B testing" })).term).toBe("A/B testing");
	});

	it("reads the real term back in preference to the basename", () => {
		const fm = entryFrontmatter(entry({ term: "C#" }));
		expect(entryFrontmatter(entry({ term: "C#" })).term).toBe("C#");
		expect(entryFromFrontmatter("C-", fm).term).toBe("C#");
		expect(entryFromFrontmatter("Zähler", {}).term).toBe("Zähler");
	});
});

// ── Translated definitions (ADR-166) ──────────────────────────────────────────

describe("translated definitions", () => {
	const def = "Ein Gerät, das diskrete Ereignisse erfasst.";

	it("reads definition_<lang>, translated_from and language from the frontmatter", () => {
		const e = entryFromFrontmatter("Zähler", {
			type: "term", source: "model", language: "DE",
			definition_en: "A device that records discrete events.", translated_from: "abc", definition_x1: "no",
		});
		expect(e.language).toBe("de");
		expect(e.definitionTranslations).toEqual({ en: "A device that records discrete events." });
		expect(e.translatedFrom).toBe("abc");
	});

	it("drops a language value that is not an ISO code", () => {
		expect(entryFromFrontmatter("Zähler", { language: "German" }).language).toBeUndefined();
	});

	it("writes the language but never a translation — those are the cache's alone", () => {
		const fm = entryFrontmatter(entry({ language: "de", definitionTranslations: { en: "x" }, translatedFrom: "h" }));
		expect(fm.language).toBe("de");
		expect(fm[definitionKey("en")]).toBeUndefined();
		expect(fm.translated_from).toBeUndefined();
	});

	it("a translation is valid only for the definition it was made from", () => {
		const e = entry({ definition: def, definitionTranslations: { en: "A device." }, translatedFrom: definitionHash(def) });
		expect(cachedTranslation(e, "en")).toBe("A device.");
		expect(cachedTranslation(e, "it")).toBeNull();
		expect(cachedTranslation({ ...e, definition: "Ein anderes Gerät." }, "en")).toBeNull();
	});

	it("the hash ignores surrounding whitespace and changes with the text", () => {
		expect(definitionHash(`  ${def}\n`)).toBe(definitionHash(def));
		expect(definitionHash(def)).not.toBe(definitionHash(`${def} Neu.`));
		expect(definitionHash(def)).toMatch(/^[0-9a-f]{8}$/);
	});

	it("applyTranslation sets the language and hash, and clears stale languages", () => {
		const fm: Record<string, unknown> = { definition_it: "vecchio", translated_from: "stale", aliases: [] };
		applyTranslation(fm, "en", "A device.", def, "de");
		expect(fm).toEqual({ aliases: [], definition_en: "A device.", translated_from: definitionHash(def), language: "de" });
	});

	it("applyTranslation keeps fresh languages beside a new one", () => {
		const fm: Record<string, unknown> = { definition_it: "Un dispositivo.", translated_from: definitionHash(def), language: "de" };
		applyTranslation(fm, "en", "A device.", def, "de");
		expect(fm.definition_it).toBe("Un dispositivo.");
		expect(fm.definition_en).toBe("A device.");
	});

	it("shows the instructed language, or under AUTO the passage's", () => {
		expect(displayLanguage({ instructed: true, code: "EN" }, "Der Zähler wird abgelesen und die Rechnung folgt.")).toBe("en");
		expect(displayLanguage({ instructed: false, code: "AUTO" }, "Der Zähler wird abgelesen und die Rechnung folgt.")).toBe("de");
		expect(displayLanguage({ instructed: false, code: "AUTO" }, "Zähler")).toBeNull();
	});

	it("translates only into a known language other than the definition's", () => {
		expect(needsTranslation(entry({ definition: def }), "de")).toBe(false);
		expect(needsTranslation(entry({ definition: def }), "en")).toBe(true);
		expect(needsTranslation(entry({ definition: def }), null)).toBe(false);
		expect(needsTranslation(entry({ definition: "" }), "en")).toBe(false);
		// A recorded language wins over detection.
		expect(needsTranslation(entry({ definition: def, language: "en" }), "en")).toBe(false);
	});

	it("merge: the language follows the definition that is kept; translations survive", () => {
		const existing = entry({ source: "manual", language: "de", definitionTranslations: { en: "A device." }, translatedFrom: "h" });
		const kept = mergeEntry(existing, entry({ definition: "The counter.", language: "en" }));
		expect(kept.language).toBe("de");
		expect(kept.definitionTranslations).toEqual({ en: "A device." });
		const replaced = mergeEntry(existing, entry({ definition: "The counter.", language: "en" }), true);
		expect(replaced.language).toBe("en");
	});
});
