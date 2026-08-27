import { describe, it, expect } from "vitest";
import { cleanOptimizedOutput } from "../services/promptOptimizerText";

describe("cleanOptimizedOutput", () => {
	it("leaves a clean prompt untouched", () => {
		expect(cleanOptimizedOutput("Write a haiku about the sea.")).toBe("Write a haiku about the sea.");
	});

	it("trims surrounding whitespace", () => {
		expect(cleanOptimizedOutput("\n\n  Do the thing.  \n")).toBe("Do the thing.");
	});

	it("drops a leading conversational preamble line", () => {
		const raw = "Sure! Here's how you can restructure your prompt using the CO-STAR framework:\n\n**Context**: foo";
		expect(cleanOptimizedOutput(raw)).toBe("**Context**: foo");
	});

	it("removes leading and trailing horizontal rules", () => {
		expect(cleanOptimizedOutput("---\n\n**Context**: foo\n\n---")).toBe("**Context**: foo");
		expect(cleanOptimizedOutput("***\nbody\n___")).toBe("body");
	});

	it("unwraps a surrounding code fence", () => {
		expect(cleanOptimizedOutput("```\nWrite a haiku.\n```")).toBe("Write a haiku.");
		expect(cleanOptimizedOutput("```text\nfoo bar\n```")).toBe("foo bar");
	});

	it("removes the preamble line AND the following leading rule together", () => {
		const raw = "Certainly! Here is the optimized prompt:\n\n---\n\nSummarize the notes.";
		expect(cleanOptimizedOutput(raw)).toBe("Summarize the notes.");
	});

	it("does NOT strip a legit first line whose colon is mid-line (not a preamble)", () => {
		// "Here is the plan: do X" — the opener word is present but the colon is not
		// at the end of the line, so it is real content, not a preamble.
		const raw = "Here is the plan: do X, then Y.";
		expect(cleanOptimizedOutput(raw)).toBe("Here is the plan: do X, then Y.");
	});

	it("does NOT strip a non-opener first line ending in a colon", () => {
		// A genuine one-line prompt like an instruction ending in a colon must survive.
		expect(cleanOptimizedOutput("Summarize the following text:")).toBe("Summarize the following text:");
	});

	it("handles empty / nullish input", () => {
		expect(cleanOptimizedOutput("")).toBe("");
		expect(cleanOptimizedOutput(undefined as unknown as string)).toBe("");
	});
});
