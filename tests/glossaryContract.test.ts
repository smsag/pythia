import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { entryFromFrontmatter, parseBody, renderBody, stripFrontmatter, TERM_TYPE } from "../services/glossaryNotes";
import type { GlossaryEntry } from "../services/glossary";

/**
 * The term note's contract with its outside readers (ADR-259): `contracts/GLOSSARY.md`.
 * Nimbus runs the same cases against its reader; a change here is a change there.
 */
interface Cases {
	version: number;
	reads: {
		name: string;
		fileName: string;
		content: string;
		frontmatter: Record<string, unknown> | null;
		term: string | null;
		definition: string | null;
		context: string | null;
	}[];
	writes: {
		name: string;
		entry: { definition: string; contexts: string[]; discussion?: string };
		body: string;
		definition: string;
		context: string | null;
	}[];
}

const cases = JSON.parse(
	readFileSync(fileURLToPath(new URL("../contracts/glossary-cases.json", import.meta.url)), "utf8"),
) as Cases;

describe("glossary contract", () => {
	it("is the version this reader and writer know", () => {
		expect(cases.version).toBe(1);
	});

	describe("reads", () => {
		for (const item of cases.reads) {
			it(item.name, () => {
				// The frontmatter as Obsidian's metadataCache hands it over; the body as the file holds it.
				if (item.frontmatter?.type !== TERM_TYPE) {
					expect(item.term).toBeNull();
					return;
				}
				const entry = entryFromFrontmatter(item.fileName.replace(/\.md$/, ""), item.frontmatter, parseBody(stripFrontmatter(item.content)));
				expect(entry.term).toBe(item.term);
				expect(entry.definition).toBe(item.definition);
				expect(entry.contexts?.[0] ?? null).toBe(item.context);
			});
		}
	});

	describe("writes", () => {
		for (const item of cases.writes) {
			it(item.name, () => {
				const entry: GlossaryEntry = { term: "Begriff", source: "model", ...item.entry };
				const body = renderBody(entry);
				expect(body).toBe(item.body);
				const read = parseBody(body);
				expect(read.definition).toBe(item.definition);
				expect(read.contexts[0] ?? null).toBe(item.context);
			});
		}
	});
});
