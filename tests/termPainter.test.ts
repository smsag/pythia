// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { repaintTerms, repaintBody, repaintForkOrigins } from "../ui/HighlightPainter";
import { buildTermIndex } from "../services/glossary";

/** Index bare terms, the alias-free case most of these cover. */
const idx = (terms: string[]) => buildTermIndex(terms.map((term) => ({ term })));

function render(html: string): HTMLElement {
	document.body.innerHTML = "";
	const root = document.createElement("div");
	root.innerHTML = html;
	document.body.appendChild(root);
	return root;
}
const marks = (root: HTMLElement) =>
	Array.from(root.querySelectorAll(".p-term")).map((e) => e.textContent);

describe("repaintTerms", () => {
	beforeEach(() => { document.body.innerHTML = ""; });

	it("marks every occurrence of a known term", () => {
		const root = render("<p>A neuron fires. Another neuron follows.</p>");
		repaintTerms(root, idx(["neuron"]));
		expect(marks(root)).toEqual(["neuron", "neuron"]);
		expect(root.textContent).toBe("A neuron fires. Another neuron follows.");
	});

	it("uses a custom element so no theme rule can claim it", () => {
		const root = render("<p>neuron</p>");
		repaintTerms(root, idx(["neuron"]));
		expect(root.querySelector(".p-term")!.tagName.toLowerCase()).toBe("pythia-term");
		expect(root.querySelector(".p-term")!.getAttribute("data-term")).toBe("neuron");
	});

	it("never marks inside code or links", () => {
		// A term inside an identifier is not the term, and a mark inside a link
		// would nest two interactive elements.
		const root = render('<p><code>neuron_count</code> and <a href="#">neuron</a> and neuron</p>');
		repaintTerms(root, idx(["neuron"]));
		expect(marks(root)).toEqual(["neuron"]);
	});

	it("does not mark inside an existing favorite or fork highlight", () => {
		const root = render("<p>alpha neuron omega</p>");
		repaintBody(root, [{ id: "f1", text: "alpha neuron", occurrenceIndex: 0 }]);
		repaintTerms(root, idx(["neuron"]));
		// The occurrence inside the favorite is skipped; no overlapping wrappers.
		expect(marks(root)).toEqual([]);
		expect(root.textContent).toBe("alpha neuron omega");
	});

	it("leaves fork origins intact and marks only outside them", () => {
		const root = render("<p>neuron here and neuron there</p>");
		repaintForkOrigins(root, [{ id: "k1", text: "neuron here", occurrenceIndex: 0 }]);
		repaintTerms(root, idx(["neuron"]));
		expect(root.querySelector(".p-fork-origin")).not.toBeNull();
		expect(marks(root)).toEqual(["neuron"]);
	});

	it("is idempotent — repainting never nests or duplicates marks", () => {
		const root = render("<p>neuron and neuron</p>");
		const m = idx(["neuron"]);
		repaintTerms(root, m);
		repaintTerms(root, m);
		repaintTerms(root, m);
		expect(marks(root)).toEqual(["neuron", "neuron"]);
		expect(root.querySelector(".p-term .p-term")).toBeNull();
		expect(root.textContent).toBe("neuron and neuron");
	});

	it("clears marks when the glossary becomes empty", () => {
		const root = render("<p>neuron</p>");
		repaintTerms(root, idx(["neuron"]));
		expect(marks(root)).toHaveLength(1);
		repaintTerms(root, null);
		expect(marks(root)).toEqual([]);
		expect(root.textContent).toBe("neuron");
	});

	it("marks several different terms in one pass", () => {
		const root = render("<p>Sparse Coding beats a plain neuron count.</p>");
		repaintTerms(root, idx(["neuron", "Sparse Coding"]));
		expect(marks(root)).toEqual(["Sparse Coding", "neuron"]);
	});

	it("preserves surrounding markup", () => {
		const root = render("<p>a <strong>bold neuron</strong> here</p>");
		repaintTerms(root, idx(["neuron"]));
		expect(root.querySelector("strong")).not.toBeNull();
		expect(marks(root)).toEqual(["neuron"]);
	});

	it("does nothing when no term occurs", () => {
		const root = render("<p>nothing to see</p>");
		const before = root.innerHTML;
		repaintTerms(root, idx(["neuron"]));
		expect(root.innerHTML).toBe(before);
	});
});

describe("repaintTerms with aliases", () => {
	it("tags a matched alias with the canonical term, so the anchor opens the right entry", () => {
		const root = render("<p>Mit den Zählern gerechnet.</p>");
		repaintTerms(root, buildTermIndex([{ term: "Zähler", aliases: ["Zählern"] }]));
		const mark = root.querySelector(".p-term")!;
		expect(mark.textContent).toBe("Zählern");          // the text is left as written
		expect(mark.getAttribute("data-term")).toBe("Zähler"); // but it resolves to the entry
	});
});
