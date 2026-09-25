import { describe, it, expect } from "vitest";
import { noteWikilink, noteWriteResult, parseNoteWrite, normalizeNoteWrites, writesOnlyContent } from "../services/noteWrites";

describe("noteWikilink", () => {
	it("links by full path and reads as the name", () => {
		expect(noteWikilink("Out/Q3 plan.md")).toBe("[[Out/Q3 plan|Q3 plan]]");
	});
	it("needs no alias at the vault root", () => {
		expect(noteWikilink("Q3 plan.md")).toBe("[[Q3 plan]]");
	});
});

describe("noteWriteResult → parseNoteWrite (ADR-218)", () => {
	it("round-trips every action, keeping the path the vault reported", () => {
		for (const [tool, action] of [["create_note", "created"], ["rewrite_note", "rewritten"], ["prepend_note", "prepended"]] as const) {
			const result = noteWriteResult(action, "Out/My note 2.md");
			expect(parseNoteWrite(tool, result)).toEqual({ path: "Out/My note 2.md", action });
		}
	});

	it("tells the model to name the note as a link", () => {
		expect(noteWriteResult("created", "Out/X.md")).toContain("[[Out/X|X]]");
	});

	it("records nothing for an error, a declined write or another tool", () => {
		expect(parseNoteWrite("create_note", "Error writing note: exists")).toBeNull();
		expect(parseNoteWrite("create_note", "User declined.")).toBeNull();
		expect(parseNoteWrite("web_search", noteWriteResult("created", "a.md"))).toBeNull();
	});
});

describe("normalizeNoteWrites", () => {
	it("keeps well-formed entries and drops the rest", () => {
		expect(normalizeNoteWrites([
			{ path: "a.md", action: "created" },
			{ path: "", action: "created" },
			{ path: "b.md", action: "deleted" },
			null,
			"c.md",
		])).toEqual([{ path: "a.md", action: "created" }]);
	});
	it("is undefined when nothing survives or it is not a list", () => {
		expect(normalizeNoteWrites([{ path: 1 }])).toBeUndefined();
		expect(normalizeNoteWrites("a.md")).toBeUndefined();
	});
});

describe("writesOnlyContent (ADR-218 addendum)", () => {
	it("names every note written, as links", () => {
		expect(writesOnlyContent([{ path: "Out/A.md", action: "created" }, { path: "B.md", action: "prepended" }]))
			.toBe("Wrote [[Out/A|A]], [[B]].");
	});
	it("is empty when nothing was written", () => {
		expect(writesOnlyContent([])).toBe("");
	});
});

describe("noteWriteResult — tables", () => {
	it("tells the model to escape the bar inside a table", () => {
		expect(noteWriteResult("created", "Out/X.md")).toContain("escape the bar as \\|");
	});
});
