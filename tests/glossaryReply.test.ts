// The glossary's reply parsers (ADR-136/149/206) — split out of
// tests/messageUtils.test.ts alongside the module they cover.

import { describe, it, expect } from "vitest";
import { parseDefinitionReply, parseTranslationReply, cleanSurfaceForm } from "../services/glossaryReply";

describe("parseDefinitionReply — translations and context (ADR-149)", () => {
	const reply = [
		"DEFINITION:",
		"Ein Gerät, das diskrete Ereignisse erfasst.",
		"VARIANTS: Zählers | Zählern",
		"TRANSLATIONS: en: counter | it: contatore",
		"CONTEXT: Der Zähler wird monatlich abgelesen.",
	].join("\n");

	it("separates same-language forms from language-tagged translations", () => {
		const { variants, translations } = parseDefinitionReply(reply);
		expect(variants).toEqual(["Zählers", "Zählern"]);
		expect(translations).toEqual([
			{ lang: "en", term: "counter" },
			{ lang: "it", term: "contatore" },
		]);
	});

	it("keeps the definition free of every marker line", () => {
		expect(parseDefinitionReply(reply).definition).toBe("Ein Gerät, das diskrete Ereignisse erfasst.");
	});

	it("keeps a multi-paragraph definition whole when markers follow it", () => {
		const raw = "DEFINITION:\nErster Absatz.\n\nZweiter Absatz.\nCONTEXT: Ein Satz.";
		expect(parseDefinitionReply(raw).definition).toBe("Erster Absatz.\n\nZweiter Absatz.");
	});

	it("drops a translation with no language code rather than guessing one", () => {
		expect(parseDefinitionReply("DEFINITION:\nX.\nTRANSLATIONS: counter | it: contatore").translations)
			.toEqual([{ lang: "it", term: "contatore" }]);
	});

	it("treats an empty or 'none' context as absent", () => {
		expect(parseDefinitionReply("DEFINITION:\nX.\nCONTEXT:").context).toBe("");
		expect(parseDefinitionReply("DEFINITION:\nX.\nCONTEXT: none").context).toBe("");
	});

	it("returns empty collections for a reply that carries no markers at all", () => {
		const { definition, variants, translations, context } = parseDefinitionReply("Just prose.");
		expect(definition).toBe("Just prose.");
		expect(variants).toEqual([]);
		expect(translations).toEqual([]);
		expect(context).toBe("");
	});

	it("drops a translation the model filled with a placeholder", () => {
		expect(parseDefinitionReply("DEFINITION:\nX.\nTRANSLATIONS: en: none | it: contatore").translations)
			.toEqual([{ lang: "it", term: "contatore" }]);
	});
});

describe("parseTranslationReply (ADR-206)", () => {
	it("reads the term and the definition out of the marked reply", () => {
		const raw = "TERM: cartel law\nDEFINITION:\nThe body of rules that forbids price-fixing.";
		expect(parseTranslationReply(raw)).toEqual({
			definition: "The body of rules that forbids price-fixing.",
			term: "cartel law",
		});
	});

	it("keeps a multi-paragraph translation whole", () => {
		const raw = "TERM: cartel law\nDEFINITION:\nFirst paragraph.\n\nSecond paragraph.";
		expect(parseTranslationReply(raw).definition).toBe("First paragraph.\n\nSecond paragraph.");
	});

	it("takes an unmarked reply as the translation, with no form recorded", () => {
		expect(parseTranslationReply("The body of rules.")).toEqual({
			definition: "The body of rules.",
			term: "",
		});
	});

	it("records no form when the model declines one", () => {
		expect(parseTranslationReply("TERM:\nDEFINITION:\nX.").term).toBe("");
		expect(parseTranslationReply("TERM: none\nDEFINITION:\nX.").term).toBe("");
		expect(parseTranslationReply("TERM: -\nDEFINITION:\nX.").term).toBe("");
	});

	it("strips the decoration a model puts around the form", () => {
		expect(parseTranslationReply('TERM: "cartel law" (noun)\nDEFINITION:\nX.').term).toBe("cartel law");
	});

	it("drops the marker line when the model writes no DEFINITION marker", () => {
		expect(parseTranslationReply("TERM: cartel law\nThe body of rules.")).toEqual({
			definition: "The body of rules.",
			term: "cartel law",
		});
	});
});

describe("cleanSurfaceForm (ADR-206)", () => {
	it("refuses what cannot be a surface form", () => {
		expect(cleanSurfaceForm("a")).toBe("");
		expect(cleanSurfaceForm("x".repeat(61))).toBe("");
		expect(cleanSurfaceForm("keine")).toBe("");
		expect(cleanSurfaceForm("— *Zählern*")).toBe("Zählern");
	});
});

describe("parseDefinitionReply", () => {
	it("reads the definition and the pipe-separated variants", () => {
		const { definition, variants } = parseDefinitionReply(
			"DEFINITION:\nEin Zähler misst den Verbrauch.\nVARIANTS: Zählers | Zählern | counter"
		);
		expect(definition).toBe("Ein Zähler misst den Verbrauch.");
		expect(variants).toEqual(["Zählers", "Zählern", "counter"]);
	});

	it("keeps a multi-line definition intact and stops it at the variants line", () => {
		const { definition, variants } = parseDefinitionReply(
			"DEFINITION:\nFirst line.\n\nSecond line.\nVARIANTS: Neuronen"
		);
		expect(definition).toBe("First line.\n\nSecond line.");
		expect(variants).toEqual(["Neuronen"]);
	});

	it("falls back to the whole reply when the model ignores the markers", () => {
		const { definition, variants } = parseDefinitionReply("Just prose, no markers.");
		expect(definition).toBe("Just prose, no markers.");
		expect(variants).toEqual([]);
	});

	it("accepts commas only when no pipe is present, so a spaced form is not split", () => {
		expect(parseDefinitionReply("DEFINITION:\nX.\nVARIANTS: Neuronen, neuronal").variants)
			.toEqual(["Neuronen", "neuronal"]);
		expect(parseDefinitionReply("DEFINITION:\nX.\nVARIANTS: sparse coding | Coding").variants)
			.toEqual(["sparse coding", "Coding"]);
	});

	it("strips list decoration, annotations and duplicates", () => {
		expect(
			parseDefinitionReply('DEFINITION:\nX.\nVARIANTS: - "Zählers" (genitive) | Zählers | Zählern.').variants
		).toEqual(["Zählers", "Zählern"]);
	});

	it("drops an empty or explicitly-none variants line", () => {
		expect(parseDefinitionReply("DEFINITION:\nX.\nVARIANTS:").variants).toEqual([]);
		expect(parseDefinitionReply("DEFINITION:\nX.\nVARIANTS: none").variants).toEqual([]);
		expect(parseDefinitionReply("DEFINITION:\nX.\nVARIANTS: keine").variants).toEqual([]);
	});

	it("caps the list, so one bad reply cannot mark a dozen phrases everywhere", () => {
		const many = Array.from({ length: 20 }, (_, i) => `form${i}`).join(" | ");
		expect(parseDefinitionReply(`DEFINITION:\nX.\nVARIANTS: ${many}`).variants).toHaveLength(8);
	});
});
