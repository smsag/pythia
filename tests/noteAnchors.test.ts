import { describe, it, expect } from "vitest";
import {
	anchorLabel, anchorMarkup, findAnchors, maskCode, normalizeNoteAnchors, parseAnchorUrl,
	reconcileNoteAnchors, recordNoteAnchor, selectionProblem,
} from "../services/noteAnchors";
import { resumeDeepLink } from "../utils";
import type { Conversation } from "../models/types";

const url = (id: string, msg?: string) => resumeDeepLink(id, "My Vault", msg);
const conv = (id: string, over: Partial<Conversation> = {}): Conversation =>
	({ id, name: id, messages: [], ...over } as unknown as Conversation);

describe("a note anchor is recognised by its address (ADR-249)", () => {
	it("reads the conversation and the chapter from a chapter link", () => {
		expect(parseAnchorUrl(url("c 1", "m/2"))).toEqual({ id: "c 1", msg: "m/2" });
		expect(parseAnchorUrl(url("c1"))).toEqual({ id: "c1" });
	});

	it("is not fooled by other Pythia links, other schemes or broken encoding", () => {
		expect(parseAnchorUrl("obsidian://pythia?vault=V")).toBeNull();
		expect(parseAnchorUrl("obsidian://pythia?vault=V&cmd=new")).toBeNull();
		expect(parseAnchorUrl("obsidian://pythia?cmd=resume")).toBeNull();
		expect(parseAnchorUrl("obsidian://open?vault=V&cmd=resume&id=c1")).toBeNull();
		expect(parseAnchorUrl("obsidian://pythia?cmd=resume&id=%E0%A4%A")).toBeNull();
	});

	it("finds a wrapped anchor, a pasted plain link and its footnote label", () => {
		const md = `A ==[capped](${url("c1", "m1")})==[^pythia-0a1b2c3d] and [see](${url("c2")}) here.`;
		const [a, b] = findAnchors(md);
		expect(a).toMatchObject({ ref: { id: "c1", msg: "m1" }, text: "capped", highlighted: true, footnoteLabel: "pythia-0a1b2c3d" });
		expect(md.slice(a.start, a.end)).toBe(`==[capped](${url("c1", "m1")})==[^pythia-0a1b2c3d]`);
		expect(md.slice(a.start, a.markupEnd)).toBe(`==[capped](${url("c1", "m1")})==`);
		expect(b).toMatchObject({ ref: { id: "c2" }, text: "see", highlighted: false });
		expect(md.slice(b.start, b.end)).toBe(`[see](${url("c2")})`);
	});

	it("a highlight around more than the link is the user's, and so is a footnote after it", () => {
		const md = `==more [x](${url("c1")}) text==[^pythia-0a1b2c3d]`;
		const [a] = findAnchors(md);
		expect(a.highlighted).toBe(false);
		expect(a.footnoteLabel).toBeUndefined();
		const lone = `==[x](${url("c1")}) and more==`;
		expect(findAnchors(lone)[0]).toMatchObject({ highlighted: false });
		expect(lone.slice(findAnchors(lone)[0].start, findAnchors(lone)[0].end)).toBe(`[x](${url("c1")})`);
	});

	it("a link inside code is text", () => {
		const md = "```\n[x](" + url("c1") + ")\n```\n`[y](" + url("c2") + ")` and [z](" + url("c3") + ")";
		expect(findAnchors(md).map((a) => a.ref.id)).toEqual(["c3"]);
	});

	it("masking keeps every offset and every line break", () => {
		const md = "a `code` b\n```\nx\n```\nc";
		const masked = maskCode(md);
		expect(masked.length).toBe(md.length);
		expect(masked.split("\n").length).toBe(md.split("\n").length);
		expect(masked).not.toContain("code");
	});
});

describe("one footnote label per target", () => {
	it("is stable, reserved and different for a chapter and its conversation", () => {
		expect(anchorLabel({ id: "c1", msg: "m1" })).toBe(anchorLabel({ id: "c1", msg: "m1" }));
		expect(anchorLabel({ id: "c1", msg: "m1" })).toMatch(/^pythia-[0-9a-f]{8}$/);
		expect(anchorLabel({ id: "c1" })).not.toBe(anchorLabel({ id: "c1", msg: "m1" }));
	});

	it("the markup Pythia writes is found again as what it wrote", () => {
		const md = `x ${anchorMarkup("the cap", url("c1", "m1"), anchorLabel({ id: "c1", msg: "m1" }))} y`;
		expect(findAnchors(md)[0]).toMatchObject({ text: "the cap", highlighted: true, footnoteLabel: anchorLabel({ id: "c1", msg: "m1" }) });
	});
});

describe("what a selection must be before it becomes an anchor", () => {
	it.each([
		["", "empty"], ["   ", "empty"],
		["two\nlines", "multiline"],
		["a [link]", "markup"], ["some `code`", "markup"], ["==hi==", "markup"], ["a ^[note]", "markup"],
		["# Heading", "markup"], ["- item", "markup"], ["1. item", "markup"], ["> quote", "markup"],
		["half **bold", "markup"], ["a | b", "markup"],
	])("%j is refused as %s", (text, problem) => {
		expect(selectionProblem(text)).toBe(problem);
	});

	it.each(["plain words", "**bold** words", "rent cap of 3.5 %", "snake_case name"])("%j is fine", (text) => {
		expect(selectionProblem(text)).toBeNull();
	});
});

describe("the records follow what the note holds", () => {
	it("records new anchors and drops the ones the note lost — per note", () => {
		const a = conv("a", { noteAnchors: [{ path: "N.md", messageId: "old", createdAt: "t0" }, { path: "Other.md", createdAt: "t0" }] });
		const b = conv("b");
		const changed = reconcileNoteAnchors([a, b], "N.md", [{ id: "a", msg: "m1" }, { id: "b" }, { id: "gone" }], "t1");
		expect(changed.sort()).toEqual(["a", "b"]);
		expect(a.noteAnchors).toEqual([{ path: "Other.md", createdAt: "t0" }, { path: "N.md", messageId: "m1", createdAt: "t1" }]);
		expect(b.noteAnchors).toEqual([{ path: "N.md", createdAt: "t1" }]);
	});

	it("changes nothing when the note says what is recorded, and keeps the first date", () => {
		const a = conv("a", { noteAnchors: [{ path: "N.md", messageId: "m1", createdAt: "t0" }] });
		expect(reconcileNoteAnchors([a], "N.md", [{ id: "a", msg: "m1" }, { id: "a", msg: "m1" }], "t1")).toEqual([]);
		expect(a.noteAnchors![0].createdAt).toBe("t0");
	});

	it("a note that lost its last anchor leaves no empty list behind", () => {
		const a = conv("a", { noteAnchors: [{ path: "N.md", createdAt: "t0" }] });
		reconcileNoteAnchors([a], "N.md", [], "t1");
		expect(a.noteAnchors).toBeUndefined();
	});

	it("recording one anchor twice records it once", () => {
		const a = conv("a");
		expect(recordNoteAnchor(a, "N.md", "m1", "t")).toBe(true);
		expect(recordNoteAnchor(a, "N.md", "m1", "t")).toBe(false);
		expect(a.noteAnchors).toHaveLength(1);
	});

	it("reads back only well-formed records from data.json", () => {
		const a = conv("a", { noteAnchors: [
			{ path: "N.md", messageId: "m1", createdAt: "t" }, { path: "N.md", messageId: "m1", createdAt: "t2" },
			{ path: "", createdAt: "t" }, null, { path: "M.md", messageId: 5 },
		] as unknown as Conversation["noteAnchors"] });
		normalizeNoteAnchors(a);
		expect(a.noteAnchors).toEqual([{ path: "N.md", messageId: "m1", createdAt: "t" }, { path: "M.md", createdAt: "" }]);
		const b = conv("b", { noteAnchors: "junk" as unknown as Conversation["noteAnchors"] });
		normalizeNoteAnchors(b);
		expect(b.noteAnchors).toBeUndefined();
	});
});
