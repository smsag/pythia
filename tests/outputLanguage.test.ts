import { describe, it, expect } from "vitest";
import {
	LANG_LABELS,
	languageLabelForLocale,
	resolveLanguageLabel,
	langInstruction,
	langSuffix,
	langDirective,
} from "../services/messageUtils";
import { OUTPUT_LANGUAGES } from "../models/types";

/**
 * The output-language setting (ADR-148): how a stored setting value becomes the
 * language name every prompt is instructed with, and what each prompt shape does
 * with it. Split out of messageUtils.test.ts, which is at its file-size budget.
 */

// ── Output language resolution ────────────────────────────────────────────────

describe("languageLabelForLocale", () => {
	it("is case- and whitespace-insensitive, since the locale comes from Obsidian", () => {
		expect(languageLabelForLocale("  DE  ")).toBe("German");
		expect(languageLabelForLocale("PT-BR")).toBe("Brazilian Portuguese");
	});

	it("returns empty string for an unknown or empty code", () => {
		expect(languageLabelForLocale("zz")).toBe("");
		expect(languageLabelForLocale("")).toBe("");
	});
});

describe("resolveLanguageLabel", () => {
	it("resolves 'auto' to no label, so no instruction is added at all", () => {
		expect(resolveLanguageLabel("auto")).toBe("");
	});

	it("resolves an explicit locale code to its English language name", () => {
		expect(resolveLanguageLabel("de")).toBe("German");
		expect(resolveLanguageLabel("it")).toBe("Italian");
		expect(resolveLanguageLabel("es")).toBe("Spanish");
	});

	it("resolves 'obsidian' through Obsidian's UI locale", () => {
		expect(resolveLanguageLabel("obsidian", "de")).toBe("German");
		expect(resolveLanguageLabel("obsidian", "it")).toBe("Italian");
	});

	it("follows Obsidian into a language the dropdown does not offer", () => {
		expect(resolveLanguageLabel("obsidian", "fr")).toBe("French");
		expect(resolveLanguageLabel("obsidian", "ja")).toBe("Japanese");
	});

	it("prefers the full regional code over its base language", () => {
		expect(resolveLanguageLabel("obsidian", "pt-br")).toBe("Brazilian Portuguese");
		expect(resolveLanguageLabel("obsidian", "pt")).toBe("Portuguese");
		expect(resolveLanguageLabel("obsidian", "zh-tw")).toBe("Traditional Chinese");
	});

	it("falls back to the base language for an unlisted region", () => {
		expect(resolveLanguageLabel("obsidian", "en-gb")).toBe("English");
		expect(resolveLanguageLabel("obsidian", "de-at")).toBe("German");
	});

	it("falls back to English — not to 'auto' — for an Obsidian locale it cannot name", () => {
		// The user asked for a fixed language; saying nothing would not give them one.
		expect(resolveLanguageLabel("obsidian", "zz")).toBe("English");
		expect(resolveLanguageLabel("obsidian", "")).toBe("English");
	});

	it("returns no label for an unknown stored setting, degrading to 'auto'", () => {
		expect(resolveLanguageLabel("klingon")).toBe("");
	});
});

describe("langInstruction", () => {
	it("returns empty string for an unresolved (auto) label", () => {
		expect(langInstruction("")).toBe("");
	});

	it("returns the instruction for a resolved label", () => {
		expect(langInstruction("English")).toBe("\n\nRespond in English.");
		expect(langInstruction("Italian")).toBe("\n\nRespond in Italian.");
	});
});

describe("langSuffix", () => {
	it("returns empty string for an unresolved (auto) label", () => {
		expect(langSuffix("")).toBe("");
	});

	it("returns ' in <Language>' for a resolved label", () => {
		expect(langSuffix("German")).toBe(" in German");
		expect(langSuffix("Spanish")).toBe(" in Spanish");
	});
});

describe("langDirective", () => {
	it("returns empty string for an unresolved (auto) label", () => {
		expect(langDirective("")).toBe("");
	});

	it("names the language and the conflict it has to survive", () => {
		const directive = langDirective("Italian");
		expect(directive).toContain("Italian");
		// The point of the longer form: it has to hold across turns against a
		// user typing in another language.
		expect(directive).toContain("another language");
	});
});

describe("LANG_LABELS", () => {
	it("maps the four languages the dropdown offers", () => {
		expect(LANG_LABELS["de"]).toBe("German");
		expect(LANG_LABELS["en"]).toBe("English");
		expect(LANG_LABELS["it"]).toBe("Italian");
		expect(LANG_LABELS["es"]).toBe("Spanish");
	});

	it("covers every language the dropdown offers, so 'obsidian' can resolve them", () => {
		for (const lang of OUTPUT_LANGUAGES) {
			if (lang === "auto" || lang === "obsidian") continue;
			expect(LANG_LABELS[lang], lang).toBeTruthy();
		}
	});
});
