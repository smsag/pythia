// @vitest-environment happy-dom
//
// Which mark a tap opens when marks nest (ADR-157). Terms may now be painted
// inside a favorite, a fork origin or a merge link, so a single tap can land
// inside several marks at once.

import { describe, it, expect, beforeEach } from "vitest";
import { resolveMarkTap } from "../ui/markTap";

const at = (selector: string): Element => document.querySelector(selector)!;

beforeEach(() => { document.body.innerHTML = ""; });

describe("resolveMarkTap", () => {
	it("returns null when the tap is outside every mark", () => {
		document.body.innerHTML = `<p id="t">plain text</p>`;
		expect(resolveMarkTap(at("#t"))).toBeNull();
	});

	it("returns null for a null target", () => {
		expect(resolveMarkTap(null)).toBeNull();
	});

	it("opens a term tapped on its own", () => {
		document.body.innerHTML = `<pythia-term class="p-term" data-term="Zähler" id="t">Zähler</pythia-term>`;
		expect(resolveMarkTap(at("#t"))).toMatchObject({ kind: "term", term: "Zähler" });
	});

	it("opens a person mark, which the old lookup ignored entirely (ADR-151 bug)", () => {
		// The chain only ever asked for `.p-term`, so a person was painted and then
		// did nothing when tapped.
		document.body.innerHTML = `<pythia-person class="p-person" data-term="Anna Weber" id="t">Weber</pythia-person>`;
		expect(resolveMarkTap(at("#t"))).toMatchObject({ kind: "term", term: "Anna Weber" });
	});

	it("opens the TERM when it sits inside a fork origin — innermost wins", () => {
		// The old fixed order gave this to the fork, which left the term mark
		// visible and dead: the fork is still tappable everywhere else in its span.
		document.body.innerHTML = `
			<pythia-fork class="p-fork-origin" data-fork-id="f1">before
				<pythia-term class="p-term" data-term="Zähler" id="t">Zähler</pythia-term> after
			</pythia-fork>`;
		expect(resolveMarkTap(at("#t"))).toMatchObject({ kind: "term", term: "Zähler" });
	});

	it("still opens the fork when the tap is elsewhere in the same span", () => {
		document.body.innerHTML = `
			<pythia-fork class="p-fork-origin" data-fork-id="f1"><span id="t">before</span>
				<pythia-term class="p-term" data-term="Zähler">Zähler</pythia-term>
			</pythia-fork>`;
		expect(resolveMarkTap(at("#t"))).toMatchObject({ kind: "fork", id: "f1" });
	});

	it("opens the term inside a merge link too", () => {
		document.body.innerHTML = `
			<pythia-merge class="p-merge-link" data-merge-id="m1">
				<pythia-term class="p-term" data-term="Zähler" id="t">Zähler</pythia-term>
			</pythia-merge>`;
		expect(resolveMarkTap(at("#t"))).toMatchObject({ kind: "term", term: "Zähler" });
	});

	it("survives the inverted nesting a favorite painted over a term produces", () => {
		// repaintBody splits per text node, so favoriting across a term wraps the
		// term's text from the inside. The fork here is still the outermost mark,
		// and the term is still the innermost of the two this resolver handles.
		document.body.innerHTML = `
			<pythia-term class="p-term" data-term="Zähler">
				<pythia-favorite class="p-highlight" data-fav-id="v1" id="t">Zähler</pythia-favorite>
			</pythia-term>`;
		expect(resolveMarkTap(at("#t"))).toMatchObject({ kind: "term", term: "Zähler" });
	});

	it("picks the innermost of a fork wrapping a merge", () => {
		document.body.innerHTML = `
			<pythia-fork class="p-fork-origin" data-fork-id="f1">
				<pythia-merge class="p-merge-link" data-merge-id="m1" id="t">passage</pythia-merge>
			</pythia-fork>`;
		expect(resolveMarkTap(at("#t"))).toMatchObject({ kind: "merge", id: "m1" });
	});

	it("ignores a mark that carries no id, rather than opening nothing", () => {
		document.body.innerHTML = `
			<pythia-fork class="p-fork-origin" data-fork-id="f1">
				<pythia-term class="p-term" id="t">no data-term</pythia-term>
			</pythia-fork>`;
		expect(resolveMarkTap(at("#t"))).toMatchObject({ kind: "fork", id: "f1" });
	});
});
