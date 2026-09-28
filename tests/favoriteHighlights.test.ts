import { describe, it, expect } from "vitest";
import {
	favoritePassages, highlightMessageFavorites, highlightPassages, messageCiteText,
} from "../services/favoriteHighlights";
import type { Favorite, Message } from "../models/types";

const hl = (content: string, text: string, occurrenceIndex = 0): string =>
	highlightPassages(content, [{ text, occurrenceIndex }]);

describe("highlightPassages", () => {
	it("wraps a passage in plain text", () => {
		expect(hl("The rate is 1.75% today.", "rate is 1.75%")).toBe("The ==rate is 1.75%== today.");
	});

	it("finds the passage by what it shows, not by its markup", () => {
		expect(hl("A **bold** claim.", "A bold claim")).toBe("==A **bold** claim==.");
		expect(hl("See [the report](https://x.org/r) now.", "the report now")).toBe("See ==[the report](https://x.org/r) now==.");
	});

	it("wraps inside the markup when the passage lies within it", () => {
		expect(hl("A **bold** claim.", "bold")).toBe("A **==bold==** claim.");
	});

	it("wraps piece by piece when the passage starts inside markup it does not close", () => {
		expect(hl("A **bold** claim.", "old claim")).toBe("A **b==old==** ==claim==.");
	});

	it("marks the occurrence the user selected", () => {
		expect(hl("yes, yes and yes", "yes", 1)).toBe("yes, ==yes== and yes");
	});

	it("ignores whitespace differences between the selection and the source", () => {
		expect(hl("one two\nthree", "two three")).toBe("one ==two==\n==three==");
	});

	it("gives each line its own highlight and leaves list markers outside", () => {
		expect(hl("- first item\n- second item", "item second")).toBe("- first ==item==\n- ==second== item");
	});

	it("wraps a wikilink or a code span whole, never inside", () => {
		expect(hl("Read [[Folder/Note|Note]] first.", "ote")).toBe("Read ==[[Folder/Note|Note]]== first.");
		expect(hl("Run `npm test` now", "npm")).toBe("Run ==`npm test`== now");
	});

	it("never touches a fenced block", () => {
		const text = "```\ncode here\n```";
		expect(hl(text, "code here")).toBe(text);
	});

	it("does not double a highlight the source already has", () => {
		expect(hl("a ==lit== b", "a lit b")).toBe("==a== ==lit== ==b==");
	});

	it("does not wrap across table cells", () => {
		expect(hl("| a | b |\n|---|---|\n| one | two |", "one two")).toBe("| a | b |\n|---|---|\n| ==one== | ==two== |");
	});

	it("merges overlapping passages and skips one it cannot find", () => {
		const out = highlightPassages("alpha beta gamma", [{ text: "alpha beta" }, { text: "beta gamma" }, { text: "delta" }]);
		expect(out).toBe("==alpha beta gamma==");
	});

	it("returns the content unchanged when nothing matches", () => {
		expect(hl("nothing", "else")).toBe("nothing");
	});
});

describe("citation chips", () => {
	const sources = [{ n: 1, kind: "web" as const, ref: "https://a.de/x", title: "a.de", cite: "4" }];

	it("reads a marker as the chip number the user saw, and keeps it outside the highlight", () => {
		const out = highlightPassages("Rates rose ⟦cite:web:4⟧ sharply.", [{ text: "Rates rose1 sharply" }], messageCiteText(sources));
		expect(out).toBe("==Rates rose ⟦cite:web:4⟧ sharply==.");
		expect(highlightPassages("Rates rose ⟦cite:web:4⟧.", [{ text: "Rates rose1" }], messageCiteText(sources)))
			.toBe("==Rates rose== ⟦cite:web:4⟧.");
	});
});

const msg = (id: string, content: string, extra: Partial<Message> = {}): Message =>
	({ id, role: "assistant", content, timestamp: "", ...extra });
const fav = (messageId: string, text: string | undefined, occurrenceIndex = 0): Favorite =>
	({ id: `f-${messageId}-${text}`, messageId, name: "x", text, occurrenceIndex });

describe("highlightMessageFavorites", () => {
	it("highlights only this message's favorites, and skips a legacy one", () => {
		const m = msg("m1", "keep this, not that");
		expect(highlightMessageFavorites(m, [fav("m1", "keep this"), fav("m2", "that"), fav("m1", undefined)]))
			.toBe("==keep this==, not that");
	});
});

describe("favoritePassages", () => {
	it("takes a favorite's chip numbers out, so it is found in text the model writes", () => {
		const m = msg("m1", "Rates rose ⟦cite:web:4⟧ sharply.", {
			sources: [{ n: 1, kind: "web", ref: "https://a.de/x", title: "a.de", cite: "4" }],
		});
		const passages = favoritePassages({ messages: [m], favorites: [fav("m1", "Rates rose1 sharply")] });
		expect(passages).toEqual(["Ratesrosesharply"]);
		const written = highlightPassages("# Note\n\nRates rose ⟦cite:web:2⟧ sharply.", passages.map((text) => ({ text })));
		expect(written).toBe("# Note\n\n==Rates rose ⟦cite:web:2⟧ sharply==.");
	});
});

describe("inline code and backtick runs", () => {
	it("still treats a closed code span as one atom", () => {
		expect(hl("Run `npm test` now.", "npm test")).toBe("Run ==`npm test`== now.");
	});

	it("a long line of unmatched backticks completes quickly (no quadratic backtracking)", async () => {
		const { codeSpanAt } = await import("../services/favoriteHighlights");
		const line = "a " + "`".repeat(50000) + " x `` tail"; // not at line start: that would be a fence
		const started = Date.now();
		const out = hl(line, "tail");
		expect(Date.now() - started).toBeLessThan(1000);
		expect(out.endsWith("==tail==")).toBe(true);
		expect(codeSpanAt("``a`b``", 0)).toEqual({ end: 7, content: "a`b" });
		expect(codeSpanAt("``a`", 0)).toBeNull();
	});
});
