// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
	findRange,
	computeOccurrenceIndex,
	paintRange,
	clearHighlights,
	repaintBody,
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
		it("wraps a single-node selection in a tagged mark", () => {
			const body = makeBody("<p>the quick brown fox</p>");
			const range = findRange(body, "quick")!;
			paintRange(range, "fav-1");
			const mark = body.querySelector("mark.p-highlight");
			expect(mark).not.toBeNull();
			expect(mark!.getAttribute("data-fav-id")).toBe("fav-1");
			expect(mark!.textContent).toBe("quick");
		});

		it("wraps a boundary-crossing selection in multiple marks", () => {
			const body = makeBody("<p>hello <strong>brave</strong> world</p>");
			const range = findRange(body, "brave world")!;
			paintRange(range, "fav-2");
			const marks = body.querySelectorAll('mark.p-highlight[data-fav-id="fav-2"]');
			expect(marks.length).toBeGreaterThanOrEqual(2);
			const joined = Array.from(marks).map((m) => m.textContent).join("");
			expect(joined).toBe("brave world");
		});
	});

	describe("clearHighlights", () => {
		it("removes marks and restores text", () => {
			const body = makeBody("<p>the quick brown fox</p>");
			paintRange(findRange(body, "quick")!, "fav-1");
			expect(body.querySelector("mark.p-highlight")).not.toBeNull();
			clearHighlights(body);
			expect(body.querySelector("mark.p-highlight")).toBeNull();
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
			expect(body.querySelector('mark[data-fav-id="a"]')).not.toBeNull();
			expect(body.querySelector('mark[data-fav-id="b"]')).not.toBeNull();
		});

		it("skips legacy favorites with no text", () => {
			const body = makeBody("<p>alpha beta</p>");
			const missing = repaintBody(body, [{ id: "legacy" }]);
			expect(missing).toEqual([]);
			expect(body.querySelector("mark.p-highlight")).toBeNull();
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
			expect(body.querySelectorAll("mark.p-highlight").length).toBe(1);
			expect(body.textContent).toBe("alpha beta gamma");
		});
	});
});
