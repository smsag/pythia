// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { referenceEntries } from "../ui/referenceEntries";
import type { Conversation } from "../models/types";

// The reference row shows four different things (ADR-116/177/178). Which ones,
// and in what order, is a rule — tested here rather than read out of a DOM builder.

const conv = (over: Partial<Conversation> = {}): Conversation => ({
	id: "c1", name: "Chat",
	createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
	systemPrompt: "", contextNotes: [], resumeMode: "full",
	provider: "anthropic", model: "m", messages: [], favorites: [],
	...over,
});

describe("referenceEntries", () => {
	it("is empty for a bare conversation", () => {
		expect(referenceEntries(conv(), [])).toEqual([]);
	});

	it("leads with what changes the next answer, then attachments, output, auto", () => {
		const entries = referenceEntries(conv({
			contextNotes: ["Attached.md"],
			savedNotePath: "Out.md",
			pendingTemplate: { id: "T.md", name: "Term Note", systemPrompt: "x" },
			pendingRewrite: { path: "Doc.md", from: { line: 1, ch: 0 }, to: { line: 1, ch: 4 }, text: "some" },
		}), ["Auto.md"]);

		expect(entries.map((e) => e.kind)).toEqual(["template", "rewrite", "context", "output", "auto"]);
	});

	it("labels the armed template by name and the rewrite by its passage", () => {
		const entries = referenceEntries(conv({
			pendingTemplate: { id: "T.md", name: "Term Note", systemPrompt: "x" },
			pendingRewrite: { path: "Doc.md", from: { line: 0, ch: 0 }, to: { line: 0, ch: 9 }, text: "First\n  line" },
		}), []);

		expect(entries[0]).toMatchObject({ kind: "template", label: "Term Note", path: "T.md" });
		// Whitespace flattened — the pill has one line.
		expect((entries[1] as { label: string }).label).toContain("First line");
		expect(entries[1].path).toBe("Doc.md");
	});

	it("names the field an output pill clears, so the ✕ needs no closure", () => {
		const entries = referenceEntries(conv({ savedNotePath: "A.md", summaryNote: "B.md" }), []);
		expect(entries).toEqual([
			{ kind: "output", path: "A.md", field: "savedNotePath" },
			{ kind: "output", path: "B.md", field: "summaryNote" },
		]);
	});

	it("never lists a note as both attached and auto-retrieved", () => {
		const entries = referenceEntries(conv({ contextNotes: ["Shared.md"] }), ["Shared.md", "Other.md"]);
		expect(entries).toEqual([
			{ kind: "context", path: "Shared.md" },
			{ kind: "auto", path: "Other.md" },
		]);
	});
});
