import { describe, it, expect, vi } from "vitest";

// ToolHandler imports NoteWriter, which imports obsidian; the writer is injected.
vi.mock("../services/NoteWriter", () => ({ NoteWriter: class {} }));

import { citationsToFootnotes, FootnoteNumbering, messageSourcesResolver } from "../services/noteFootnotes";
import { getToolDefinitions, ToolHandler } from "../services/ToolHandler";
import type { NoteWriter } from "../services/NoteWriter";
import type { ToolCall } from "../models/types";

const makeWriter = (): NoteWriter => ({
	writeNote:            vi.fn().mockResolvedValue({ path: "Notes/out.md" }),
	createNote:           vi.fn().mockResolvedValue({ path: "Notes/out.md" }),
	prependWithSeparator: vi.fn().mockResolvedValue({ path: "Notes/out.md" }),
} as unknown as NoteWriter);

const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: "test-id", name, input });

const web = [
	{ n: 1, title: "Leitzins steigt", url: "https://www.example.com/news/zins" },
	{ n: 2, title: "Foo (bar) [draft]", url: "https://other.org/a page_(x)" },
];

describe("citationsToFootnotes", () => {
	it("turns a vault citation into a footnote with a wikilink", () => {
		const out = citationsToFootnotes("The rate is 1.75% ⟦cite:note:Finance/Rates.md⟧.");
		expect(out).toBe("The rate is 1.75%[^1].\n\n[^1]: [[Finance/Rates|Rates]]\n");
	});

	it("turns a numbered web citation into a footnote naming that page", () => {
		const out = citationsToFootnotes("Rates rose ⟦cite:web:1⟧.", web);
		expect(out).toBe("Rates rose[^1].\n\n[^1]: [Leitzins steigt](https://www.example.com/news/zins)\n");
	});

	it("resolves a domain marker to the first result from that domain", () => {
		expect(citationsToFootnotes("X ⟦cite:web:example.com⟧", web)).toContain("[^1]: [Leitzins steigt](https://www.example.com/news/zins)");
	});

	it("drops a web marker nothing fetched answers for, and adds no footnote", () => {
		expect(citationsToFootnotes("Claim ⟦cite:web:9⟧.", web)).toBe("Claim.");
		expect(citationsToFootnotes("Claim ⟦cite:web:1⟧.")).toBe("Claim.");
	});

	it("numbers by first appearance and shares one footnote per source", () => {
		const out = citationsToFootnotes("A ⟦cite:web:1⟧. B ⟦cite:note:N.md⟧. C ⟦cite:web:example.com⟧.", web);
		expect(out).toBe("A[^1]. B[^2]. C[^1].\n\n[^1]: [Leitzins steigt](https://www.example.com/news/zins)\n[^2]: [[N]]\n");
	});

	it("escapes the title and the target so neither can break the link", () => {
		expect(citationsToFootnotes("Y ⟦cite:web:2⟧", web)).toContain("[^1]: [Foo (bar) \\[draft\\]](https://other.org/a%20page_%28x%29)");
	});

	it("never reuses a label the content or the note already uses", () => {
		const out = citationsToFootnotes("New[^1] ⟦cite:note:A.md⟧\n\n[^1]: mine", [], "Old[^2]\n\n[^2]: theirs");
		expect(out).toContain("New[^1][^3]");
		expect(out.trimEnd().endsWith("[^3]: [[A]]")).toBe(true);
	});

	it("leaves a marker inside a fenced code block alone", () => {
		const text = "```\n⟦cite:note:A.md⟧\n```\nSee ⟦cite:note:B.md⟧";
		const out = citationsToFootnotes(text);
		expect(out).toContain("```\n⟦cite:note:A.md⟧\n```");
		expect(out).toContain("See[^1]");
		expect(out).not.toContain("[[A]]");
	});

	it("returns content without markers unchanged, minus foreign citation noise", () => {
		expect(citationsToFootnotes("# Title\n\nplain")).toBe("# Title\n\nplain");
		expect(citationsToFootnotes("Mbappé: 22 goals【1†source】.")).toBe("Mbappé: 22 goals.");
	});
});

// ── citations become footnotes in a written note (ADR-238) ───────────────────

describe("note writes turn citations into footnotes", () => {
	const sources = [{ n: 1, title: "Page", url: "https://example.com/p" }];

	it("create_note writes footnotes for vault and web citations", async () => {
		const writer = makeWriter();
		await new ToolHandler(writer).execute(
			call("create_note", { path: "Notes/new.md", content: "A ⟦cite:note:Src.md⟧. B ⟦cite:web:1⟧." }),
			undefined, undefined, undefined, sources,
		);
		expect(writer.createNote).toHaveBeenCalledWith(
			"A[^1]. B[^2].\n\n[^1]: [[Src]]\n[^2]: [Page](https://example.com/p)\n", "Notes/new.md",
		);
	});

	it("rewrite_note writes footnotes too", async () => {
		const writer = makeWriter();
		await new ToolHandler(writer).execute(call("rewrite_note", { path: "Notes/doc.md", content: "A ⟦cite:web:1⟧" }),
			undefined, ["Notes/doc.md"], undefined, sources);
		expect(writer.writeNote).toHaveBeenCalledWith("A[^1]\n\n[^1]: [Page](https://example.com/p)\n", "Notes/doc.md");
	});

	it("prepend_note numbers around the labels the note already uses", async () => {
		const writer = makeWriter();
		await new ToolHandler(writer).execute(call("prepend_note", { path: "Notes/doc.md", content: "A ⟦cite:web:1⟧" }),
			undefined, ["Notes/doc.md"], undefined, sources);
		const prepare = vi.mocked(writer.prependWithSeparator).mock.calls[0][2]!;
		expect(prepare("A ⟦cite:web:1⟧", "Old[^1]\n\n[^1]: theirs")).toBe("A[^2]\n\n[^2]: [Page](https://example.com/p)\n");
	});

	it("every note tool tells the model to cite with markers, not a sources list", () => {
		for (const def of getToolDefinitions("Scratch", "all")) {
			if (!def.name.endsWith("_note")) continue;
			expect(def.description).toContain("⟦cite:note:");
			expect(def.description).toContain("footnotes");
		}
	});
});

// ── transcripts: each message against its own sources (ADR-238) ───────────────

describe("messageSourcesResolver", () => {
	it("finds a web source by what its marker said", () => {
		const resolve = messageSourcesResolver([{ n: 1, kind: "web", ref: "https://a.de/x", title: "a.de", cite: "3" }]);
		expect(resolve("web", "3")).toEqual({ kind: "web", url: "https://a.de/x", title: "a.de" });
		expect(resolve("web", "9")).toBeNull();
	});

	it("links a message from before ADR-226, whose source is a bare domain", () => {
		const numbering = new FootnoteNumbering([]);
		const out = numbering.apply("X ⟦cite:web:ecb.europa.eu⟧", messageSourcesResolver([
			{ n: 1, kind: "web", ref: "ecb.europa.eu", title: "ecb.europa.eu" },
		]));
		expect(out).toContain("[^1]: [ecb.europa.eu](https://ecb.europa.eu)");
	});

	it("drops every web marker of a message with no stored sources", () => {
		expect(new FootnoteNumbering([]).apply("Y ⟦cite:web:1⟧.", messageSourcesResolver(undefined))).toBe("Y.");
	});

	it("defines a source once across calls and never reuses a label the note holds", () => {
		const numbering = new FootnoteNumbering(["Earlier[^1]"]);
		const resolve = messageSourcesResolver([]);
		expect(numbering.apply("A ⟦cite:note:N.md⟧", resolve)).toBe("A[^2]\n\n[^2]: [[N]]\n");
		expect(numbering.apply("B ⟦cite:note:N.md⟧", resolve)).toBe("B[^2]");
	});
});
