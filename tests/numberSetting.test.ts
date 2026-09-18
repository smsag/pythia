import { describe, it, expect } from "vitest";
import { parseNumberSetting } from "../ui/numberSetting";

// A settings field holds a value the user is still composing (ADR-171): the
// keystroke-by-keystroke writes it replaced are what deleted conversations when
// "200" was lowered to "0" through 20 and 2.
describe("parseNumberSetting", () => {
	it("accepts a whole number at or above the floor", () => {
		expect(parseNumberSetting("200", { min: 0 })).toEqual({ ok: true, value: 200 });
		expect(parseNumberSetting("0", { min: 0 })).toEqual({ ok: true, value: 0 });
	});

	it("trims surrounding space", () => {
		expect(parseNumberSetting("  42 ", { min: 0 })).toEqual({ ok: true, value: 42 });
	});

	it("rejects a value below the floor rather than clamping it", () => {
		// Clamping would store a number the user never typed; the caller shows the
		// stored value again instead.
		expect(parseNumberSetting("-1", { min: 0 })).toEqual({ ok: false });
		expect(parseNumberSetting("0", { min: 1 })).toEqual({ ok: false });
	});

	it("rejects a value above the ceiling", () => {
		expect(parseNumberSetting("1.5", { min: 0, max: 1, decimal: true })).toEqual({ ok: false });
	});

	it("rejects text that is not a number", () => {
		expect(parseNumberSetting("lots", { min: 0 })).toEqual({ ok: false });
	});

	it("rejects an empty field unless empty is a value", () => {
		expect(parseNumberSetting("", { min: 0 })).toEqual({ ok: false });
		expect(parseNumberSetting("", { min: 1, allowEmpty: true })).toEqual({ ok: true, value: undefined });
		expect(parseNumberSetting("   ", { min: 1, allowEmpty: true })).toEqual({ ok: true, value: undefined });
	});

	it("reads a decimal only where the rule allows one", () => {
		expect(parseNumberSetting("0.7", { min: 0, max: 1, decimal: true })).toEqual({ ok: true, value: 0.7 });
		expect(parseNumberSetting("0.7", { min: 0 })).toEqual({ ok: true, value: 0 });
	});
});
