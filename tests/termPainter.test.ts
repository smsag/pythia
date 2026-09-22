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

	it("marks a term INSIDE a favorite (ADR-157 reverses the old exclusion)", () => {
		// This used to assert the opposite. The exclusion meant favoriting a passage
		// silently un-marked every term in it — the passage a reader is most likely
		// to be working through.
		const root = render("<p>alpha neuron omega</p>");
		repaintBody(root, [{ id: "f1", text: "alpha neuron", occurrenceIndex: 0 }]);
		repaintTerms(root, idx(["neuron"]));
		expect(marks(root)).toEqual(["neuron"]);
		expect(root.querySelector(".p-term")?.closest(".p-highlight")).not.toBeNull();
		expect(root.textContent).toBe("alpha neuron omega");
	});

	it("marks terms both inside and outside a fork origin, leaving the fork intact", () => {
		const root = render("<p>neuron here and neuron there</p>");
		repaintForkOrigins(root, [{ id: "k1", text: "neuron here", occurrenceIndex: 0 }]);
		repaintTerms(root, idx(["neuron"]));
		expect(root.querySelector(".p-fork-origin")).not.toBeNull();
		expect(marks(root)).toEqual(["neuron", "neuron"]);
		expect(root.textContent).toBe("neuron here and neuron there");
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

// ── ADR-207: a multi-word form is the normal case on the English side ────────
//
// German merges what English separates ("Kartellrecht" → "cartel law"), so every
// English equivalent of a German term is a phrase — and a phrase is exactly what
// markdown can break in half.

describe("repaintTerms across text-node boundaries (ADR-207)", () => {
	beforeEach(() => { document.body.innerHTML = ""; });

	const term = () => idx(["cartel law"]);

	it("marks a phrase split by emphasis, as one mark per node it touches", () => {
		const root = render("<p>A <strong>cartel</strong> law question.</p>");
		repaintTerms(root, term());
		expect(marks(root)).toEqual(["cartel", " law"]);
		// One entry, whichever fragment is tapped.
		expect(Array.from(root.querySelectorAll(".p-term")).map((e) => e.getAttribute("data-term")))
			.toEqual(["cartel law", "cartel law"]);
		expect(root.textContent).toBe("A cartel law question.");
		expect(root.querySelector("strong")).not.toBeNull();
	});

	it("marks a phrase broken by a soft line break in the source", () => {
		const root = render("<p>The cartel\nlaw applies.</p>");
		repaintTerms(root, term());
		expect(marks(root)).toEqual(["cartel\nlaw"]);
		expect(root.querySelector(".p-term")!.getAttribute("data-term")).toBe("cartel law");
	});

	it("marks the hyphenated spelling of the same compound", () => {
		const root = render("<p>A cartel-law question.</p>");
		repaintTerms(root, term());
		expect(marks(root)).toEqual(["cartel-law"]);
		expect(root.querySelector(".p-term")!.getAttribute("data-term")).toBe("cartel law");
	});

	it("marks a phrase that overlaps the end of a favorite", () => {
		const root = render("<p>alpha cartel law omega</p>");
		repaintBody(root, [{ id: "f1", text: "alpha cartel", occurrenceIndex: 0 }]);
		repaintTerms(root, term());
		expect(root.textContent).toBe("alpha cartel law omega");
		expect(marks(root).join("")).toBe("cartel law");
		// The favorite survives, and the fragment inside it stays inside it (ADR-157).
		expect(root.querySelector(".p-highlight")).not.toBeNull();
		expect(root.querySelector(".p-highlight .p-term")).not.toBeNull();
	});

	it("never lets a match straddle skipped text", () => {
		// "count" is inside a code span, so "neuron count" is not present as a term
		// however the characters line up.
		const root = render("<p>The neuron <code>count</code> rises.</p>");
		repaintTerms(root, idx(["neuron count"]));
		expect(marks(root)).toEqual([]);
	});

	it("keeps later offsets true after an earlier phrase has been painted", () => {
		const root = render("<p>A <strong>cartel</strong> law and another cartel law.</p>");
		repaintTerms(root, term());
		expect(marks(root).join("|")).toBe("cartel| law|cartel law");
		expect(root.textContent).toBe("A cartel law and another cartel law.");
	});

	it("is still idempotent when a phrase is split", () => {
		const root = render("<p>A <strong>cartel</strong> law question.</p>");
		const m = term();
		repaintTerms(root, m);
		repaintTerms(root, m);
		expect(marks(root)).toEqual(["cartel", " law"]);
		expect(root.querySelector(".p-term .p-term")).toBeNull();
		expect(root.textContent).toBe("A cartel law question.");
	});
});
