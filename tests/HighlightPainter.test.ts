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
	repaintTerms,
	rangeForForkOrigin,
	repaintMergeLinks,
} from "../ui/HighlightPainter";
import { buildTermIndex } from "../services/glossary";

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

		it("does not find a selection carrying block-boundary / content-edge whitespace (why fork selections must be trimmed — ADR-096)", () => {
			// `Selection.toString()` can include a block-boundary newline or edge
			// whitespace that the concatenated text-node data never contains, so an
			// untrimmed selection is unfindable — the fork-origin mark never paints.
			const body = makeBody("<p>the quick brown fox</p>");
			expect(findRange(body, "brown fox\n")).toBeNull(); // trailing newline (block end)
			expect(findRange(body, "brown fox ")).toBeNull();  // trailing space at content end
			expect(findRange(body, " the quick")).toBeNull();  // leading space at content start
			// Trimmed, each resolves — the fix trims the stored selection at search time.
			expect(findRange(body, "brown fox\n".trim())).not.toBeNull();
			expect(findRange(body, " the quick".trim())).not.toBeNull();
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

		it("falls back to the first occurrence when the stored index is out of range (ADR-096)", () => {
			// "SSIH" appears twice; a fork recorded occurrenceIndex 5 (stale/out of range).
			// Without the fallback findRange returns null and NOTHING paints; with it the
			// mark still appears on the first occurrence so the branch-back is visible.
			const body = makeBody("<p>SSIH merged with SSIH in 1983</p>");
			repaintForkOrigins(body, [{ id: "fork1", text: "SSIH", occurrenceIndex: 5 }]);
			const marks = body.querySelectorAll('.p-fork-origin[data-fork-id="fork1"]');
			expect(marks.length).toBeGreaterThan(0);
			expect(marks[0].textContent).toBe("SSIH");
		});
	});

	describe("repaintMergeLinks", () => {
		it("paints merge marks in their own custom element, alongside favorites and fork origins", () => {
			const body = makeBody("<p>alpha beta gamma delta</p>");
			repaintBody(body, [{ id: "fav", text: "alpha", occurrenceIndex: 0 }]);
			repaintForkOrigins(body, [{ id: "fork1", text: "beta", occurrenceIndex: 0 }]);
			repaintMergeLinks(body, [{ id: "m1", text: "gamma delta", occurrenceIndex: 0 }]);
			const merge = body.querySelector('.p-merge-link[data-merge-id="m1"]');
			expect(merge).not.toBeNull();
			// A third distinct custom element, so no theme rule and neither of the two
			// highlighter treatments can bleed onto a merge link (ADR-086 / ADR-130).
			expect(merge!.tagName.toLowerCase()).toBe("pythia-merge");
			expect(body.querySelector('.p-highlight[data-fav-id="fav"]')).not.toBeNull();
			expect(body.querySelector('.p-fork-origin[data-fork-id="fork1"]')).not.toBeNull();
			expect(body.textContent).toBe("alpha beta gamma delta");
		});

		it("clears prior merge marks and skips text that is absent", () => {
			const body = makeBody("<p>alpha beta</p>");
			repaintMergeLinks(body, [{ id: "m1", text: "beta", occurrenceIndex: 0 }]);
			expect(body.querySelectorAll(".p-merge-link").length).toBe(1);
			repaintMergeLinks(body, [{ id: "m2", text: "missing", occurrenceIndex: 0 }]);
			expect(body.querySelector('[data-merge-id="m1"]')).toBeNull();
			expect(body.querySelector(".p-merge-link")).toBeNull();
		});

		it("repainting the same link twice does not nest or duplicate marks", () => {
			const body = makeBody("<p>alpha beta</p>");
			const link = [{ id: "m1", text: "beta", occurrenceIndex: 0 }];
			repaintMergeLinks(body, link);
			repaintMergeLinks(body, link);
			expect(body.querySelectorAll(".p-merge-link").length).toBe(1);
			expect(body.textContent).toBe("alpha beta");
		});

		it("falls back to the first occurrence when the stored index is out of range", () => {
			const body = makeBody("<p>SSIH merged with SSIH in 1983</p>");
			repaintMergeLinks(body, [{ id: "m1", text: "SSIH", occurrenceIndex: 5 }]);
			const marks = body.querySelectorAll('.p-merge-link[data-merge-id="m1"]');
			expect(marks.length).toBeGreaterThan(0);
			expect(marks[0].textContent).toBe("SSIH");
		});

		it("paints a passage that spans element boundaries as multiple fragments", () => {
			const body = makeBody("<p>hello <strong>brave</strong> world</p>");
			repaintMergeLinks(body, [{ id: "m1", text: "brave world", occurrenceIndex: 0 }]);
			const marks = body.querySelectorAll('.p-merge-link[data-merge-id="m1"]');
			expect(marks.length).toBeGreaterThan(1);
			expect(Array.from(marks).map((m) => m.textContent).join("")).toBe("brave world");
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

// ── Terms nest inside deliberate marks (ADR-157) ──────────────────────────────

describe("repaintTerms inside favorites, forks and merge links", () => {
	const index = () => buildTermIndex([{ term: "Zähler", aliases: ["Zählern"] }]);
	const body = (html: string): HTMLElement => {
		document.body.innerHTML = `<div id="body">${html}</div>`;
		return document.querySelector<HTMLElement>("#body")!;
	};
	const termMarks = (el: HTMLElement) => Array.from(el.querySelectorAll(".p-term"));

	beforeEach(() => { document.body.innerHTML = ""; });

	it("marks a term inside a favorite — favoriting a passage no longer un-marks its terms", () => {
		const el = body(`<p><pythia-favorite class="p-highlight" data-fav-id="v1">Der Zähler läuft.</pythia-favorite></p>`);
		repaintTerms(el, index());
		expect(termMarks(el)).toHaveLength(1);
		expect(termMarks(el)[0].closest(".p-highlight")).not.toBeNull();
	});

	it("marks a term inside a fork origin", () => {
		const el = body(`<p><pythia-fork class="p-fork-origin" data-fork-id="f1">Der Zähler läuft.</pythia-fork></p>`);
		repaintTerms(el, index());
		expect(termMarks(el)).toHaveLength(1);
		expect(termMarks(el)[0].closest(".p-fork-origin")).not.toBeNull();
	});

	it("marks a term inside a merge link", () => {
		const el = body(`<p><pythia-merge class="p-merge-link" data-merge-id="m1">Der Zähler läuft.</pythia-merge></p>`);
		repaintTerms(el, index());
		expect(termMarks(el)[0].closest(".p-merge-link")).not.toBeNull();
	});

	it("marks the same term inside and outside a highlight in one pass", () => {
		const el = body(`<p>Ein Zähler. <pythia-favorite class="p-highlight" data-fav-id="v1">Noch ein Zähler.</pythia-favorite></p>`);
		repaintTerms(el, index());
		expect(termMarks(el)).toHaveLength(2);
	});

	it("still refuses to nest a term inside another term", () => {
		const el = body(`<p>Der Zähler läuft.</p>`);
		repaintTerms(el, index());
		repaintTerms(el, index()); // second pass must not double-wrap
		expect(termMarks(el)).toHaveLength(1);
		expect(termMarks(el)[0].querySelector(".p-term")).toBeNull();
	});

	it("re-matches a term whose text was split by unwrapping a previous mark", () => {
		// Unwrapping leaves adjacent text nodes; a term is matched within ONE node,
		// so without normalize() a term straddling the seam would stop matching.
		const el = body(`<p>Der <pythia-term class="p-term" data-term="x">Zäh</pythia-term>ler läuft.</p>`);
		repaintTerms(el, index());
		expect(termMarks(el)).toHaveLength(1);
		expect(termMarks(el)[0].textContent).toBe("Zähler");
	});

	it("leaves the favorite intact when the terms are repainted", () => {
		const el = body(`<p><pythia-favorite class="p-highlight" data-fav-id="v1">Der Zähler läuft.</pythia-favorite></p>`);
		repaintTerms(el, index());
		repaintTerms(el, null); // glossary emptied
		expect(el.querySelector(".p-highlight")?.textContent).toBe("Der Zähler läuft.");
	});
});
