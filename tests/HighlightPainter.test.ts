// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
	findRange,
	computeOccurrenceIndex,
	paintRange,
	clearHighlights,
	repaintBody,
	removeHighlightById,
	rangeForHighlight,
	repaintForkOrigins,
	rangeForForkOrigin,
} from "../ui/HighlightPainter";

function makeBody(html: string): HTMLElement {
	const el = document.createElement("div");
	el.innerHTML = html;
	document.body.appendChild(el);
	return el;
}

describe("HighlightPainter", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	describe("findRange", () => {
		it("finds text inside a single text node", () => {
			const body = makeBody("<p>the quick brown fox</p>");
			const range = findRange(body, "quick brown");
			expect(range).not.toBeNull();
			expect(range!.toString()).toBe("quick brown");
		});

		it("finds text spanning multiple elements", () => {
			const body = makeBody("<p>hello <strong>brave</strong> world</p>");
			const range = findRange(body, "brave world");
			expect(range).not.toBeNull();
			expect(range!.toString()).toBe("brave world");
		});

		it("returns null when the text is absent", () => {
			const body = makeBody("<p>nothing to see</p>");
			expect(findRange(body, "missing")).toBeNull();
		});

		it("selects the requested occurrence when text repeats", () => {
			const body = makeBody("<p>foo bar foo bar foo</p>");
			const first = findRange(body, "foo", 0);
			const third = findRange(body, "foo", 2);
			expect(first).not.toBeNull();
			expect(third).not.toBeNull();
			// Both resolve to "foo" but at different offsets.
			expect(first!.startOffset).toBe(0);
			expect(third!.startOffset).toBeGreaterThan(first!.startOffset);
		});

		it("returns null for an out-of-range occurrence index", () => {
			const body = makeBody("<p>only once</p>");
			expect(findRange(body, "once", 1)).toBeNull();
		});

		it("returns null for empty text", () => {
			const body = makeBody("<p>text</p>");
			expect(findRange(body, "")).toBeNull();
		});
	});

	describe("computeOccurrenceIndex", () => {
		it("is 0 for the first occurrence", () => {
			const body = makeBody("<p>foo bar foo</p>");
			const range = findRange(body, "foo", 0)!;
			expect(computeOccurrenceIndex(body, range)).toBe(0);
		});

		it("counts preceding identical spans", () => {
			const body = makeBody("<p>foo bar foo baz foo</p>");
			const range = findRange(body, "foo", 2)!;
			expect(computeOccurrenceIndex(body, range)).toBe(2);
		});

		it("round-trips with findRange", () => {
			const body = makeBody("<p>x y x y x</p>");
			const range = findRange(body, "x", 1)!;
			const idx = computeOccurrenceIndex(body, range);
			const refound = findRange(body, "x", idx)!;
			expect(refound.startOffset).toBe(range.startOffset);
		});
	});

	describe("paintRange", () => {
		it("wraps a single-node selection in a tagged pythia-favorite element", () => {
			const body = makeBody("<p>the quick brown fox</p>");
			const range = findRange(body, "quick")!;
			paintRange(range, "fav-1");
			const mark = body.querySelector(".p-highlight");
			expect(mark).not.toBeNull();
			expect(mark!.tagName.toLowerCase()).toBe("pythia-favorite");
			expect(mark!.getAttribute("data-fav-id")).toBe("fav-1");
			expect(mark!.textContent).toBe("quick");
		});

		it("wraps a boundary-crossing selection in multiple marks", () => {
			const body = makeBody("<p>hello <strong>brave</strong> world</p>");
			const range = findRange(body, "brave world")!;
			paintRange(range, "fav-2");
			const marks = body.querySelectorAll('.p-highlight[data-fav-id="fav-2"]');
			expect(marks.length).toBeGreaterThanOrEqual(2);
			const joined = Array.from(marks).map((m) => m.textContent).join("");
			expect(joined).toBe("brave world");
		});
	});

	describe("clearHighlights", () => {
		it("removes marks and restores text", () => {
			const body = makeBody("<p>the quick brown fox</p>");
			paintRange(findRange(body, "quick")!, "fav-1");
			expect(body.querySelector(".p-highlight")).not.toBeNull();
			clearHighlights(body);
			expect(body.querySelector(".p-highlight")).toBeNull();
			expect(body.textContent).toBe("the quick brown fox");
		});
	});

	describe("repaintBody", () => {
		it("paints all favorites with text and reports none missing", () => {
			const body = makeBody("<p>alpha beta gamma delta</p>");
			const missing = repaintBody(body, [
				{ id: "a", text: "alpha", occurrenceIndex: 0 },
				{ id: "b", text: "gamma delta", occurrenceIndex: 0 },
			]);
			expect(missing).toEqual([]);
			expect(body.querySelector('[data-fav-id="a"]')).not.toBeNull();
			expect(body.querySelector('[data-fav-id="b"]')).not.toBeNull();
		});

		it("skips legacy favorites with no text", () => {
			const body = makeBody("<p>alpha beta</p>");
			const missing = repaintBody(body, [{ id: "legacy" }]);
			expect(missing).toEqual([]);
			expect(body.querySelector(".p-highlight")).toBeNull();
		});

		it("reports favorites whose text can no longer be found", () => {
			const body = makeBody("<p>alpha beta</p>");
			const missing = repaintBody(body, [
				{ id: "gone", text: "removed text", occurrenceIndex: 0 },
			]);
			expect(missing).toEqual(["gone"]);
		});

		it("is idempotent — repeated calls do not stack marks", () => {
			const body = makeBody("<p>alpha beta gamma</p>");
			const favs = [{ id: "a", text: "beta", occurrenceIndex: 0 }];
			repaintBody(body, favs);
			repaintBody(body, favs);
			expect(body.querySelectorAll(".p-highlight").length).toBe(1);
			expect(body.textContent).toBe("alpha beta gamma");
		});
	});

	describe("removeHighlightById", () => {
		it("unwraps only the target favorite, leaving others intact", () => {
			const body = makeBody("<p>alpha beta gamma delta</p>");
			repaintBody(body, [
				{ id: "a", text: "alpha", occurrenceIndex: 0 },
				{ id: "b", text: "gamma delta", occurrenceIndex: 0 },
			]);
			removeHighlightById(body, "a");
			expect(body.querySelector('[data-fav-id="a"]')).toBeNull();
			expect(body.querySelector('[data-fav-id="b"]')).not.toBeNull();
			expect(body.textContent).toBe("alpha beta gamma delta");
		});

		it("removes all fragments of a boundary-crossing highlight", () => {
			const body = makeBody("<p>hello <strong>brave</strong> world</p>");
			paintRange(findRange(body, "brave world")!, "x");
			expect(body.querySelectorAll('[data-fav-id="x"]').length).toBeGreaterThanOrEqual(2);
			removeHighlightById(body, "x");
			expect(body.querySelector(".p-highlight")).toBeNull();
			expect(body.textContent).toBe("hello brave world");
		});

		it("is a no-op for an unknown id", () => {
			const body = makeBody("<p>alpha beta</p>");
			repaintBody(body, [{ id: "a", text: "alpha", occurrenceIndex: 0 }]);
			removeHighlightById(body, "nope");
			expect(body.querySelector('[data-fav-id="a"]')).not.toBeNull();
		});
	});

	describe("rangeForHighlight", () => {
		it("returns a range spanning a single-fragment highlight", () => {
			const body = makeBody("<p>alpha beta gamma</p>");
			paintRange(findRange(body, "beta")!, "a");
			const range = rangeForHighlight(body, "a");
			expect(range).not.toBeNull();
			expect(range!.toString()).toBe("beta");
		});

		it("spans all fragments of a boundary-crossing highlight", () => {
			const body = makeBody("<p>hello <strong>brave</strong> world</p>");
			paintRange(findRange(body, "brave world")!, "x");
			const range = rangeForHighlight(body, "x");
			expect(range).not.toBeNull();
			expect(range!.toString()).toBe("brave world");
		});

		it("returns null when the favorite has no marks", () => {
			const body = makeBody("<p>alpha beta</p>");
			expect(rangeForHighlight(body, "missing")).toBeNull();
		});
	});

	describe("paintRange with a custom class/attr", () => {
		it("wraps in the given class and data attribute", () => {
			const body = makeBody("<p>alpha beta gamma</p>");
			paintRange(findRange(body, "beta")!, "f1", "p-fork-origin", "data-fork-id");
			const mark = body.querySelector(".p-fork-origin");
			expect(mark).not.toBeNull();
			expect(mark!.getAttribute("data-fork-id")).toBe("f1");
			expect(body.querySelector(".p-highlight")).toBeNull();
		});
	});

	describe("repaintForkOrigins", () => {
		it("paints fork-origin marks and coexists with favorite highlights", () => {
			const body = makeBody("<p>alpha beta gamma delta</p>");
			repaintBody(body, [{ id: "fav", text: "alpha", occurrenceIndex: 0 }]);
			repaintForkOrigins(body, [{ id: "fork1", text: "gamma delta", occurrenceIndex: 0 }]);
			const fav = body.querySelector('.p-highlight[data-fav-id="fav"]');
			const fork = body.querySelector('.p-fork-origin[data-fork-id="fork1"]');
			expect(fav).not.toBeNull();
			expect(fork).not.toBeNull();
			// Distinct custom elements → the theme's <mark> rules can't touch either.
			expect(fav!.tagName.toLowerCase()).toBe("pythia-favorite");
			expect(fork!.tagName.toLowerCase()).toBe("pythia-fork");
			expect(body.textContent).toBe("alpha beta gamma delta");
		});

		it("clears prior fork marks and skips text that is absent", () => {
			const body = makeBody("<p>alpha beta</p>");
			repaintForkOrigins(body, [{ id: "f1", text: "beta", occurrenceIndex: 0 }]);
			expect(body.querySelectorAll(".p-fork-origin").length).toBe(1);
			repaintForkOrigins(body, [{ id: "f2", text: "missing", occurrenceIndex: 0 }]);
			expect(body.querySelector('[data-fork-id="f1"]')).toBeNull();
			expect(body.querySelector(".p-fork-origin")).toBeNull();
		});
	});

	describe("rangeForForkOrigin", () => {
		it("spans a multi-fragment fork snippet", () => {
			const body = makeBody("<p>hello <strong>brave</strong> world</p>");
			repaintForkOrigins(body, [{ id: "f1", text: "brave world", occurrenceIndex: 0 }]);
			const range = rangeForForkOrigin(body, "f1");
			expect(range).not.toBeNull();
			expect(range!.toString()).toBe("brave world");
		});

		it("returns null when absent", () => {
			const body = makeBody("<p>alpha</p>");
			expect(rangeForForkOrigin(body, "nope")).toBeNull();
		});
	});
});
