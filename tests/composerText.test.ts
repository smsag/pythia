// @vitest-environment happy-dom
//
// D-52: the chip composer reads as the text a textarea would have held. That is
// what the model is sent, so every browser's shape for the same text must read
// the same — and a chip must read as exactly its token.
import { describe, it, expect } from "vitest";
import { CHIP_CLASS, composerText, domPosition, partsFor, textOffset } from "../ui/composerText";

/** Build a root from markup. `{{Name}}` stands for a chip whose token is `[[Name]]`. */
function root(html: string): HTMLDivElement {
	const el = document.createElement("div");
	el.innerHTML = html.replace(/\{\{([^}]+)\}\}/g, (_m, name: string) =>
		`<span class="${CHIP_CLASS}" contenteditable="false" data-token="[[${name}]]"><span class="p-source-icon"></span>${name}</span>`);
	return el;
}

describe("composerText — what the field reads as", () => {
	it("a chip reads as exactly its token, never its label or icon", () => {
		expect(composerText(root("Compare {{Q3 revenue}} with last year"))).toBe("Compare [[Q3 revenue]] with last year");
	});

	it("reads an empty field as empty — including the placeholder <br> a browser leaves", () => {
		expect(composerText(root(""))).toBe("");
		expect(composerText(root("<br>"))).toBe("");
		expect(composerText(root("<div><br></div>"))).toBe("");
	});

	it("reads each browser's line break as one \\n", () => {
		const expected = "one\ntwo";
		expect(composerText(root("one\ntwo"))).toBe(expected);                  // a set value
		expect(composerText(root("one<br>two"))).toBe(expected);                // WebKit
		expect(composerText(root("one<div>two</div>"))).toBe(expected);         // Chrome
		expect(composerText(root("<div>one</div><div>two</div>"))).toBe(expected);
	});

	it("keeps an empty line the user made", () => {
		expect(composerText(root("one<br><br>"))).toBe("one\n");               // Shift+Enter at the end
		expect(composerText(root("one<div><br></div>"))).toBe("one\n");        // Enter at the end (Chrome)
		expect(composerText(root("one<div><br></div><div>three</div>"))).toBe("one\n\nthree");
		expect(composerText(root("<div><br></div><div>two</div>"))).toBe("\ntwo");         // Enter first, then type
	});

	it("reads &nbsp; as a space — WebKit types one next to another space", () => {
		expect(composerText(root("a&nbsp; b"))).toBe("a  b");
	});

	it("reads through an inline wrapper a paste or the browser left behind", () => {
		expect(composerText(root('see <span style="x">{{Plan}}</span> now'))).toBe("see [[Plan]] now");
	});
});

describe("textOffset / domPosition — offsets are in the text, never the DOM", () => {
	it("counts a chip as its token's length", () => {
		const el = root("ab {{Plan}} cd");
		const after = el.childNodes[2] as Text; // " cd"
		expect(textOffset(el, { node: after, offset: 1 })).toBe("ab [[Plan]] ".length);
	});

	it("round-trips every offset in the text", () => {
		const el = root("ab {{Plan}} cd<div>ef</div>");
		const text = composerText(el);
		for (let n = 0; n <= text.length; n++) {
			const p = domPosition(el, n);
			const back = textOffset(el, p);
			// Inside a chip snaps to its end; everywhere else is exact.
			const inChip = n > 3 && n < 3 + "[[Plan]]".length;
			expect(back).toBe(inChip ? 3 + "[[Plan]]".length : n);
		}
	});

	it("a caret can never land inside a chip", () => {
		const el = root("{{Plan}}");
		const p = domPosition(el, 3);
		expect(p).toEqual({ node: el, offset: 1 }); // after the chip
		const chipText = el.querySelector(`.${CHIP_CLASS}`)!.lastChild!;
		expect(textOffset(el, { node: chipText, offset: 1 })).toBe("[[Plan]]".length);
	});

	it("puts the caret at the start of a new line, not before the break", () => {
		const el = root("one<div>two</div>");
		const p = domPosition(el, 4); // just after "one\n"
		expect(p.node.textContent).toBe("two");
		expect(p.offset).toBe(0);
	});
});

describe("partsFor — a set value brings a tracked link back as its chip", () => {
	const chips = new Map([["[[Plan]]", "Plan"], ["[[Q3 revenue]]", "Q3 revenue"]]);

	it("splits text around every tracked token", () => {
		expect(partsFor("see [[Plan]] and [[Q3 revenue]].", chips)).toEqual([
			"see ", { token: "[[Plan]]", label: "Plan" }, " and ", { token: "[[Q3 revenue]]", label: "Q3 revenue" }, ".",
		]);
	});

	it("leaves a link nobody tracks as text", () => {
		expect(partsFor("see [[Other]]", chips)).toEqual(["see [[Other]]"]);
	});

	it("a token that is a prefix of another does not steal its match", () => {
		const nested = new Map([["[[A]]", "A"], ["[[A]] b]]", "odd"]]);
		expect(partsFor("x [[A]] b]] y", nested)).toEqual(["x ", { token: "[[A]] b]]", label: "odd" }, " y"]);
	});

	it("an empty value is no parts", () => {
		expect(partsFor("", chips)).toEqual([]);
	});
});
