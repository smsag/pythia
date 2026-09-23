import { describe, it, expect } from "vitest";
import {
	noteToken, tokensPresent, insertTokens, removeToken, type TrackedNote,
} from "../ui/composerTokens";

const track = (path: string): TrackedNote => ({ path, token: noteToken(path) });

describe("noteToken", () => {
	it("is the name the reference-row pill shows, as a wikilink", () => {
		expect(noteToken("Notes/Q3 revenue.md")).toBe("[[Q3 revenue]]");
	});

	it("drops the folder and the extension", () => {
		expect(noteToken("a/b/c/Plan.md")).toBe("[[Plan]]");
		expect(noteToken("Plan")).toBe("[[Plan]]");
	});
});

describe("insertTokens", () => {
	it("spaces the link off from the words around it", () => {
		const { value } = insertTokens("Compare with last year", 8, ["[[Q3]]"]);
		expect(value).toBe("Compare [[Q3]] with last year");
	});

	it("does not double a space that is already there", () => {
		expect(insertTokens("Compare  year", 8, ["[[Q3]]"]).value).toBe("Compare [[Q3]] year");
	});

	it("needs no leading space at the start of an empty composer", () => {
		expect(insertTokens("", 0, ["[[Q3]]"]).value).toBe("[[Q3]] ");
	});

	it("leaves the cursor after the link, ready to keep typing", () => {
		const { value, cursor } = insertTokens("Compare", 7, ["[[Q3]]"]);
		expect(value.slice(0, cursor)).toBe("Compare [[Q3]] ");
	});

	it("puts a whole folder in as separate links", () => {
		expect(insertTokens("", 0, ["[[A]]", "[[B]]"]).value).toBe("[[A]] [[B]] ");
	});

	it("clamps an offset past either end rather than losing the link", () => {
		expect(insertTokens("abc", 99, ["[[Q3]]"]).value).toContain("[[Q3]]");
		expect(insertTokens("abc", -4, ["[[Q3]]"]).value).toContain("[[Q3]]");
	});

	it("returns the text untouched when there is nothing to insert", () => {
		expect(insertTokens("abc", 1, [])).toEqual({ value: "abc", cursor: 1 });
	});
});

describe("tokensPresent", () => {
	const q3 = track("Notes/Q3 revenue.md");
	const plan = track("Notes/Plan.md");

	it("keeps a note whose link is still there", () => {
		expect(tokensPresent("Compare [[Q3 revenue]] with last year", [q3]))
			.toEqual({ present: [q3.path], absent: [] });
	});

	it("drops a note whose link was deleted", () => {
		expect(tokensPresent("Compare with last year", [q3]))
			.toEqual({ present: [], absent: [q3.path] });
	});

	// A basename can contain spaces, so no pattern can say where the link ends in
	// a sentence that continues after it. Matching what we wrote is exact.
	it("matches the whole name, spaces and all", () => {
		expect(tokensPresent("see [[Q3 revenue]] now", [q3]).present).toEqual([q3.path]);
		expect(tokensPresent("see [[Q3]] revenue now", [q3]).present).toEqual([]);
	});

	it("drops a note whose link was edited into something else", () => {
		expect(tokensPresent("Compare [[Q3 revenu]] with last year", [q3]).absent).toEqual([q3.path]);
	});

	it("handles several tracked notes independently", () => {
		const { present, absent } = tokensPresent("[[Plan]] only", [q3, plan]);
		expect(present).toEqual([plan.path]);
		expect(absent).toEqual([q3.path]);
	});

	// Two notes in different folders can share a basename and therefore a token.
	it("detaches one of two notes that share a name, not both", () => {
		const a = { path: "A/Report.md", token: "[[Report]]" };
		const b = { path: "B/Report.md", token: "[[Report]]" };
		expect(tokensPresent("[[Report]] [[Report]]", [a, b]))
			.toEqual({ present: [a.path, b.path], absent: [] });
		expect(tokensPresent("[[Report]]", [a, b]))
			.toEqual({ present: [a.path], absent: [b.path] });
		expect(tokensPresent("none left", [a, b]))
			.toEqual({ present: [], absent: [a.path, b.path] });
	});

	it("counts repeats of one note's link without inventing a second", () => {
		expect(tokensPresent("[[Plan]] and [[Plan]] again", [plan]))
			.toEqual({ present: [plan.path], absent: [] });
	});

	it("is empty for an empty tracking list", () => {
		expect(tokensPresent("[[Plan]]", [])).toEqual({ present: [], absent: [] });
	});
});

describe("removeToken", () => {
	it("takes the link and one adjacent space, leaving no double space", () => {
		expect(removeToken("Compare [[Q3]] with last year", "[[Q3]]"))
			.toBe("Compare with last year");
	});

	it("takes the space before it when the link ends the sentence", () => {
		expect(removeToken("Compare [[Q3]]", "[[Q3]]")).toBe("Compare");
	});

	it("leaves the text alone when the link is not there", () => {
		expect(removeToken("nothing here", "[[Q3]]")).toBe("nothing here");
	});

	it("removes only the first occurrence — one pill, one link", () => {
		expect(removeToken("[[A]] and [[A]]", "[[A]]")).toBe("and [[A]]");
	});

	it("survives a composer that is only the link", () => {
		expect(removeToken("[[A]]", "[[A]]")).toBe("");
	});
});
