import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	applyEdits, footnoteText, inspectAnchors, noteFootnoteEdits, quoteMarks, renumberFootnotes,
	updateNoteFootnotes, withExportFootnotes, type AnchorResolver,
} from "../services/anchorFootnotes";
import { anchorLabel, anchorMarkup, type AnchorRef } from "../services/noteAnchors";
import type { AnchorSummary } from "../services/chapterSummary";
import { resumeDeepLink } from "../utils";

const DATE = "2026-09-29T12:00:00.000Z";
const url = (id: string, msg?: string) => resumeDeepLink(id, "V", msg);
const ok = (over: Partial<AnchorSummary> = {}): AnchorSummary =>
	({ state: "ok", conversationName: "Rent cap scenarios", chapterName: "Index clause", summary: "The cap applies only to new contracts.", date: DATE, language: "en", ...over });
const resolver = (map: Record<string, AnchorSummary>): AnchorResolver => (ref: AnchorRef) =>
	map[`${ref.id}#${ref.msg ?? ""}`] ?? { state: "deleted" };
const L = (id: string, msg?: string) => anchorLabel({ id, msg });

describe("the print copy still highlights the passage (ADR-253)", () => {
	it("an anchor without == in the note prints as ==text== with its footnote", () => {
		const out = withExportFootnotes(`The index is ${anchorMarkup("capped", url("c1", "m1"))} and ${anchorMarkup("whole", `${url("c1")}&anchor=1`)}.`,
			resolver({ "c1#m1": ok(), "c1#": ok({ chapterName: undefined }) }));
		expect(out).toMatch(/^The index is ==capped==\[\^1\] and ==whole==\[\^2\]\./);
	});
});

describe("the footnote text (ADR-249)", () => {
	it("is the agreed format: „Conversation › Chapter“ (Pythia, date) — summary", () => {
		expect(footnoteText(ok({ language: "de", summary: "Die Kappung gilt nur für neue Verträge." })))
			.toBe("„Rent cap scenarios › Index clause“ (Pythia, 29 Sep 2026) — Die Kappung gilt nur für neue Verträge.");
		expect(footnoteText(ok())).toBe("“Rent cap scenarios › Index clause” (Pythia, 29 Sep 2026) — The cap applies only to new contracts.");
	});

	it("follows the summary's language for its quote marks", () => {
		expect(quoteMarks("de").slice(0, 2)).toEqual(["„", "“"]);
		expect(quoteMarks("en").slice(0, 2)).toEqual(["“", "”"]);
		expect(quoteMarks("it").slice(0, 2)).toEqual(["«", "»"]);
		expect(quoteMarks("es").slice(0, 2)).toEqual(["«", "»"]);
		expect(quoteMarks(undefined).slice(0, 2)).toEqual(["“", "”"]);
		expect(footnoteText(ok({ language: "it" }))).toMatch(/^«Rent cap scenarios › Index clause» \(Pythia/);
	});

	it("a whole-conversation link names the conversation alone", () => {
		expect(footnoteText(ok({ chapterName: undefined }))).toMatch(/^“Rent cap scenarios” \(Pythia, 29 Sep 2026\) — /);
	});

	it("no summary yet: no date, and the words in the fallback language", () => {
		expect(footnoteText({ state: "none", conversationName: "Rent cap scenarios" }, "de"))
			.toBe("„Rent cap scenarios“ (Pythia) — Noch keine Zusammenfassung.");
		expect(footnoteText({ state: "none", conversationName: "C" })).toBe("“C” (Pythia) — No summary yet.");
	});

	it("a deleted conversation says so, with or without a name", () => {
		expect(footnoteText({ state: "deleted", conversationName: "C" })).toBe("“C” (Pythia) — Conversation deleted.");
		expect(footnoteText({ state: "deleted" }, "de")).toBe("(Pythia) — Unterhaltung gelöscht.");
	});

	it("a hostile name still makes one valid definition line", () => {
		const text = footnoteText(ok({ conversationName: "A “quoted” [^1] ==x== name\nwith a break", chapterName: "B]" }));
		expect(text).not.toContain("\n");
		expect(text).toContain("‘quoted’");
		expect(text).toContain("\\[^1\\]");
		expect(text).toContain("=\\=x=\\=");
		expect(text).toContain("B\\]");
		expect(`[^pythia-1]: ${text}`).toMatch(/^\[\^pythia-1\]: [^\n]+$/);
	});

	it("shortens a long conversation name, never the chapter", () => {
		const text = footnoteText(ok({ conversationName: "x".repeat(100), chapterName: "y".repeat(80) }));
		expect(text).toContain(`${"x".repeat(59)}…`);
		expect(text).toContain("y".repeat(80));
	});

	it("is built in one place only", () => {
		const root = process.cwd();
		const files = ["main.ts", "sidebar.ts", ...["services", "ui"].flatMap((d) => readdirSync(resolve(root, d)).filter((f) => f.endsWith(".ts")).map((f) => join(d, f)))];
		const offenders = files.filter((f) => f !== join("services", "anchorFootnotes.ts") && /\(Pythia(?![A-Za-z])/.test(readFileSync(resolve(root, f), "utf8")));
		// "(Pythia" not followed by a letter: the footnote's "(Pythia, date)", never a
		// call like getActiveViewOfType(PythiaSidebarView).
		expect(offenders).toEqual([]);
	});
});

describe("updateNoteFootnotes — only Pythia's parts of a note", () => {
	const map = { "c1#m1": ok(), "c1#": ok({ chapterName: undefined, summary: "Whole." }) };
	const r = resolver(map);

	it("adds the reference after the anchor and the definition as the last block", () => {
		const md = `# Note\n\nThe index is ${anchorMarkup("capped", url("c1", "m1"))} for now.\n`;
		const out = updateNoteFootnotes(md, r);
		expect(out).toBe(`# Note\n\nThe index is [capped](${url("c1", "m1")})[^${L("c1", "m1")}] for now.\n\n[^${L("c1", "m1")}]: ${footnoteText(ok())}\n`);
	});

	it("is idempotent: a second run changes nothing", () => {
		const md = `A ${anchorMarkup("x", url("c1", "m1"))} b ${anchorMarkup("y", `${url("c1")}&anchor=1`)}.`;
		const once = updateNoteFootnotes(md, r);
		expect(updateNoteFootnotes(once, r)).toBe(once);
		expect(noteFootnoteEdits(once, r)).toEqual([]);
	});

	it("never touches the author's footnotes, orphans included", () => {
		const md = `Smith[^smith] and ${anchorMarkup("x", url("c1", "m1"))}.\n\n[^smith]: Smith (2020).\n[^orphan]: nobody cites me.\n`;
		const out = updateNoteFootnotes(md, r);
		expect(out).toContain("Smith[^smith] and");
		expect(out).toContain("[^smith]: Smith (2020).\n[^orphan]: nobody cites me.\n\n[^pythia-");
	});

	it("the same chapter linked twice shares one footnote", () => {
		const md = `${anchorMarkup("a", url("c1", "m1"))} and ${anchorMarkup("b", url("c1", "m1"))}`;
		const out = updateNoteFootnotes(md, r);
		expect(out.match(new RegExp(`\\[\\^${L("c1", "m1")}\\]:`, "g"))).toHaveLength(1);
		expect(out.match(new RegExp(`\\[\\^${L("c1", "m1")}\\](?!:)`, "g"))).toHaveLength(2);
	});

	it("refreshes an outdated definition in place and removes an orphaned one", () => {
		const md = `${anchorMarkup("a", url("c1", "m1"), L("c1", "m1"))}\n\n[^${L("c1", "m1")}]: old text\n[^pythia-deadbeef]: from a link you deleted\n`;
		const out = updateNoteFootnotes(md, r);
		expect(out).not.toContain("old text");
		expect(out).not.toContain("pythia-deadbeef");
		expect(out).toContain(footnoteText(ok()));
	});

	it("drops a Pythia reference no anchor owns any more", () => {
		const md = `text[^pythia-deadbeef] and ${anchorMarkup("a", url("c1", "m1"))}`;
		expect(updateNoteFootnotes(md, r)).toMatch(/^text and \[a\]/);
	});

	it("leaves a note Pythia has nothing in byte for byte — code included", () => {
		const md = "No links.\n```\n[^pythia-deadbeef]: in code\n```\n[^1]: mine";
		expect(updateNoteFootnotes(md, r)).toBe(md);
	});

	it("edits apply to the text they were computed from", () => {
		const md = `x ${anchorMarkup("a", url("c1", "m1"))} y`;
		expect(applyEdits(md, noteFootnoteEdits(md, r))).toBe(updateNoteFootnotes(md, r));
	});
});

describe("renumberFootnotes — one sequence, by first reference", () => {
	it("numbers the author's and Pythia's footnotes together, inline ones included", () => {
		const md = "A[^pythia-aa] B^[inline] C[^smith] D[^pythia-aa]\n\n[^smith]: S.\n[^pythia-aa]: P.\n[^unused]: U.\n";
		expect(renumberFootnotes(md)).toBe("A[^1] B^[inline] C[^3] D[^1]\n\n[^3]: S.\n[^1]: P.\n[^4]: U.\n");
	});

	it("leaves code alone", () => {
		expect(renumberFootnotes("`[^x]` y[^x]\n\n[^x]: X")).toBe("`[^x]` y[^1]\n\n[^1]: X");
	});
});

describe("withExportFootnotes — a copy for print, never a write", () => {
	it("prints the anchor as highlighted text with its footnote, and renumbers everything", () => {
		const md = `Smith[^smith] said ${anchorMarkup("capped", url("c1", "m1"), L("c1", "m1"))} and ==[plain](${url("c1")})== [back](${url("c9")}).\n\n[^smith]: Smith (2020).\n[^${L("c1", "m1")}]: stale\n`;
		const out = withExportFootnotes(md, resolver({ "c1#m1": ok(), "c1#": ok({ chapterName: undefined, summary: "Whole." }) }));
		expect(out).not.toContain("pythia-");
		// An old backlink is an ordinary link, and prints as one.
		expect(out).toContain(`Smith[^1] said ==capped==[^2] and ==plain==[^3] [back](${url("c9")}).`);
		expect(out).toContain("[^1]: Smith (2020).");
		expect(out).toContain(`[^2]: ${footnoteText(ok())}`);
		expect(out).toContain("[^3]: “Rent cap scenarios” (Pythia, 29 Sep 2026) — Whole.");
	});

	it("a deleted conversation is still explained in print", () => {
		const out = withExportFootnotes(`${anchorMarkup("x", url("gone", "m"))}`, resolver({}));
		expect(out).toBe("==x==[^1]\n\n[^1]: (Pythia) — Conversation deleted.\n");
	});
});

describe("inspectAnchors — what a print preview shows", () => {
	it("counts anchors, and targets that are outdated or will say no summary", () => {
		const md = `${anchorMarkup("a", url("c1", "m1"))} ${anchorMarkup("b", url("c1", "m1"))} [c](${url("c2", "m")}) [d](${url("c3", "m")}) [old](${url("c4")})`;
		const states: Record<string, "ok" | "outdated" | "missing"> = { c1: "outdated", c2: "missing", c3: "ok" };
		expect(inspectAnchors(md, (ref) => states[ref.id])).toEqual({ links: 4, outdated: 1, missing: 1 });
	});
});
