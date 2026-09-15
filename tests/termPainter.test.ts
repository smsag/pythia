// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { repaintTerms, repaintBody, repaintForkOrigins } from "../ui/HighlightPainter";
import { buildTermMatcher } from "../services/glossary";

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
		repaintTerms(root, buildTermMatcher(["neuron"]));
		expect(marks(root)).toEqual(["neuron", "neuron"]);
		expect(root.textContent).toBe("A neuron fires. Another neuron follows.");
	});

	it("uses a custom element so no theme rule can claim it", () => {
		const root = render("<p>neuron</p>");
		repaintTerms(root, buildTermMatcher(["neuron"]));
		expect(root.querySelector(".p-term")!.tagName.toLowerCase()).toBe("pythia-term");
		expect(root.querySelector(".p-term")!.getAttribute("data-term")).toBe("neuron");
	});

	it("never marks inside code or links", () => {
		// A term inside an identifier is not the term, and a mark inside a link
		// would nest two interactive elements.
		const root = render('<p><code>neuron_count</code> and <a href="#">neuron</a> and neuron</p>');
		repaintTerms(root, buildTermMatcher(["neuron"]));
		expect(marks(root)).toEqual(["neuron"]);
	});

	it("does not mark inside an existing favorite or fork highlight", () => {
		const root = render("<p>alpha neuron omega</p>");
		repaintBody(root, [{ id: "f1", text: "alpha neuron", occurrenceIndex: 0 }]);
		repaintTerms(root, buildTermMatcher(["neuron"]));
		// The occurrence inside the favorite is skipped; no overlapping wrappers.
		expect(marks(root)).toEqual([]);
		expect(root.textContent).toBe("alpha neuron omega");
	});

	it("leaves fork origins intact and marks only outside them", () => {
		const root = render("<p>neuron here and neuron there</p>");
		repaintForkOrigins(root, [{ id: "k1", text: "neuron here", occurrenceIndex: 0 }]);
		repaintTerms(root, buildTermMatcher(["neuron"]));
		expect(root.querySelector(".p-fork-origin")).not.toBeNull();
		expect(marks(root)).toEqual(["neuron"]);
	});

	it("is idempotent — repainting never nests or duplicates marks", () => {
		const root = render("<p>neuron and neuron</p>");
		const m = buildTermMatcher(["neuron"]);
		repaintTerms(root, m);
		repaintTerms(root, m);
		repaintTerms(root, m);
		expect(marks(root)).toEqual(["neuron", "neuron"]);
		expect(root.querySelector(".p-term .p-term")).toBeNull();
		expect(root.textContent).toBe("neuron and neuron");
	});

	it("clears marks when the glossary becomes empty", () => {
		const root = render("<p>neuron</p>");
		repaintTerms(root, buildTermMatcher(["neuron"]));
		expect(marks(root)).toHaveLength(1);
		repaintTerms(root, null);
		expect(marks(root)).toEqual([]);
		expect(root.textContent).toBe("neuron");
	});

	it("marks several different terms in one pass", () => {
		const root = render("<p>Sparse Coding beats a plain neuron count.</p>");
		repaintTerms(root, buildTermMatcher(["neuron", "Sparse Coding"]));
		expect(marks(root)).toEqual(["Sparse Coding", "neuron"]);
	});

	it("preserves surrounding markup", () => {
		const root = render("<p>a <strong>bold neuron</strong> here</p>");
		repaintTerms(root, buildTermMatcher(["neuron"]));
		expect(root.querySelector("strong")).not.toBeNull();
		expect(marks(root)).toEqual(["neuron"]);
	});

	it("does nothing when no term occurs", () => {
		const root = render("<p>nothing to see</p>");
		const before = root.innerHTML;
		repaintTerms(root, buildTermMatcher(["neuron"]));
		expect(root.innerHTML).toBe(before);
	});
});
