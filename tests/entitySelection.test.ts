// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { readEntitySelection } from "../ui/entitySelection";

/**
 * The shared selection rule behind Define and Person (ADR-151). Written once
 * because it was written twice the moment people were added.
 */
function selectIn(html: string, selector: string): void {
	document.body.innerHTML = html;
	const node = document.querySelector(selector)!;
	const range = document.createRange();
	range.selectNodeContents(node);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);
}

afterEach(() => {
	window.getSelection()?.removeAllRanges();
	document.body.innerHTML = "";
});

describe("readEntitySelection", () => {
	it("accepts a short span in an assistant message and returns the whole message as the passage", () => {
		selectIn('<div data-msg-id="m1"><p><span id="t">Zähler</span> wird abgelesen.</p></div>', "#t");
		const result = readEntitySelection(5);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.selection.text).toBe("Zähler");
		expect(result.selection.passage).toContain("wird abgelesen");
	});

	it("rejects a selection in a user message — the terminology explained is the model's", () => {
		selectIn('<div data-msg-id="m1" class="p-msg-user"><p><span id="t">Zähler</span></p></div>', "#t");
		expect(readEntitySelection(5)).toEqual({ ok: false, reason: "not-applicable" });
	});

	it("rejects a selection outside any message", () => {
		selectIn('<div><p><span id="t">Zähler</span></p></div>', "#t");
		expect(readEntitySelection(5)).toEqual({ ok: false, reason: "not-applicable" });
	});

	it("rejects a selection past the word cap, which the caller reports", () => {
		selectIn('<div data-msg-id="m1"><p><span id="t">eins zwei drei vier fünf sechs</span></p></div>', "#t");
		expect(readEntitySelection(5)).toEqual({ ok: false, reason: "too-long" });
	});

	it("lets a person take one more word than a term, for multi-part surnames", () => {
		selectIn('<div data-msg-id="m1"><p><span id="t">eins zwei drei vier fünf sechs</span></p></div>', "#t");
		expect(readEntitySelection(6).ok).toBe(true);
	});

	it("rejects a long selection even within the word cap", () => {
		const long = "a".repeat(61);
		selectIn(`<div data-msg-id="m1"><p><span id="t">${long}</span></p></div>`, "#t");
		expect(readEntitySelection(5)).toEqual({ ok: false, reason: "too-long" });
	});
});
