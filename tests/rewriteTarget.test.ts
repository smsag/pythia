import { describe, it, expect } from "vitest";
import { rangeText, replaceRange, targetLabel, targetState } from "../services/rewriteTarget";
import type { RewriteTarget } from "../models/types";

// ADR-178: a rewrite replaces a captured RANGE, verified against the text that
// was in it. Never a search for the passage — that is how you overwrite the
// wrong paragraph.

const doc = "# Title\n\nFirst paragraph here.\n\nSecond one, longer, with detail.\n";

describe("rangeText", () => {
	it("reads a range on one line", () => {
		expect(rangeText(doc, { line: 2, ch: 0 }, { line: 2, ch: 5 })).toBe("First");
	});

	it("reads a range across lines", () => {
		expect(rangeText(doc, { line: 2, ch: 6 }, { line: 4, ch: 6 })).toBe("paragraph here.\n\nSecond");
	});

	it("returns null for a range outside the note", () => {
		expect(rangeText(doc, { line: 99, ch: 0 }, { line: 99, ch: 1 })).toBeNull();
		expect(rangeText(doc, { line: 2, ch: 0 }, { line: 2, ch: 999 })).toBeNull();
		expect(rangeText(doc, { line: -1, ch: 0 }, { line: 0, ch: 1 })).toBeNull();
	});

	it("returns null when the range runs backwards", () => {
		expect(rangeText(doc, { line: 2, ch: 5 }, { line: 2, ch: 1 })).toBeNull();
	});

	it("reads an empty range as empty, not as missing", () => {
		expect(rangeText(doc, { line: 2, ch: 3 }, { line: 2, ch: 3 })).toBe("");
	});
});

describe("targetState", () => {
	const target = (over: Partial<RewriteTarget> = {}): RewriteTarget => ({
		path: "Note.md",
		from: { line: 2, ch: 0 },
		to: { line: 2, ch: 22 },
		text: "First paragraph here.",
		...over,
	});

	it("is ok while the range still holds the captured passage", () => {
		expect(targetState(doc, target({ to: { line: 2, ch: 21 } }))).toBe("ok");
	});

	it("is stale when the note changed underneath", () => {
		const edited = doc.replace("First paragraph here.", "First paragraph, edited.");
		expect(targetState(edited, target({ to: { line: 2, ch: 21 } }))).toBe("stale");
	});

	it("is stale rather than ok for a whitespace-only difference", () => {
		// Exact, deliberately: the range is what gets replaced, so "close enough"
		// means the range is already pointing somewhere slightly wrong.
		const edited = doc.replace("First paragraph here.", "First  paragraph here.");
		expect(targetState(edited, target({ to: { line: 2, ch: 21 } }))).toBe("stale");
	});

	it("is gone when the note shrank past the range", () => {
		expect(targetState("# Title\n", target())).toBe("gone");
	});
});

describe("replaceRange", () => {
	it("replaces within a line and leaves the rest untouched", () => {
		const out = replaceRange(doc, { line: 2, ch: 0 }, { line: 2, ch: 21 }, "A shorter one.");
		expect(out).toBe("# Title\n\nA shorter one.\n\nSecond one, longer, with detail.\n");
	});

	it("replaces across lines, including with multi-line text", () => {
		const out = replaceRange(doc, { line: 2, ch: 0 }, { line: 4, ch: 32 }, "One.\n\nTwo.");
		expect(out).toBe("# Title\n\nOne.\n\nTwo.\n");
	});

	it("round-trips: what it wrote is what the range then reads", () => {
		const from = { line: 2, ch: 0 }, to = { line: 2, ch: 21 };
		const out = replaceRange(doc, from, to, "Rewritten.");
		expect(rangeText(out, from, { line: 2, ch: 10 })).toBe("Rewritten.");
	});
});

describe("targetLabel", () => {
	it("flattens whitespace and truncates to one line", () => {
		expect(targetLabel("First\n  paragraph   here.")).toBe("First paragraph here.");
		expect(targetLabel("x".repeat(80))).toHaveLength(42);
		expect(targetLabel("x".repeat(80)).endsWith("…")).toBe(true);
	});
});
