import { describe, it, expect } from "vitest";
import { chunkByHeadings, selectRelevantChunks, NOTE_CHUNK_THRESHOLD_CHARS } from "../services/noteChunking";

describe("chunkByHeadings", () => {
	it("splits content at each heading line", () => {
		const md = "# Intro\nHello.\n\n## Details\nMore text.\n\n## Other\nEven more.";
		const chunks = chunkByHeadings(md);
		expect(chunks).toHaveLength(3);
		expect(chunks[0].heading).toBe("Intro");
		expect(chunks[1].heading).toBe("Details");
		expect(chunks[2].heading).toBe("Other");
	});

	it("keeps preamble before the first heading as its own chunk", () => {
		const md = "Some intro text.\n\n# Heading\nBody.";
		const chunks = chunkByHeadings(md);
		expect(chunks[0].heading).toBe("");
		expect(chunks[0].text).toContain("Some intro text.");
	});

	it("returns a single chunk for content with no headings", () => {
		const md = "Just plain text.\nNo headings here.";
		const chunks = chunkByHeadings(md);
		expect(chunks).toHaveLength(1);
	});

	it("drops empty chunks", () => {
		const md = "# A\n\n# B\nContent.";
		const chunks = chunkByHeadings(md);
		expect(chunks.every((c) => c.text.length > 0)).toBe(true);
	});
});

describe("selectRelevantChunks", () => {
	it("returns content unchanged when under the size threshold", () => {
		const short = "# A\nShort note.";
		const result = selectRelevantChunks(short, "anything");
		expect(result).toEqual({ text: short, isExcerpt: false });
	});

	it("returns content unchanged when over threshold but has no headings to split on", () => {
		const long = "x".repeat(NOTE_CHUNK_THRESHOLD_CHARS + 100);
		const result = selectRelevantChunks(long, "anything");
		expect(result.isExcerpt).toBe(false);
		expect(result.text).toBe(long);
	});

	it("excerpts a long, headed note down to the relevant sections", () => {
		const filler = "lorem ipsum ".repeat(200); // padding to exceed the threshold
		const md =
			`# Budget\n${filler}\n` +
			`# Weather\nIt rained on Tuesday. ${filler}\n` +
			`# Roadmap\nQ3 roadmap details. ${filler}`;
		expect(md.length).toBeGreaterThan(NOTE_CHUNK_THRESHOLD_CHARS);

		const result = selectRelevantChunks(md, "what is the roadmap for Q3");
		expect(result.isExcerpt).toBe(true);
		expect(result.text).toContain("Roadmap");
		expect(result.text).not.toContain("Weather");
	});

	it("preserves original document order among kept chunks", () => {
		const filler = "lorem ipsum ".repeat(200);
		const md =
			`# First budget section\nbudget details. ${filler}\n` +
			`# Second budget section\nmore budget details. ${filler}\n` +
			`# Unrelated\nsomething else entirely. ${filler}`;

		const result = selectRelevantChunks(md, "budget");
		const firstIdx = result.text.indexOf("First budget section");
		const secondIdx = result.text.indexOf("Second budget section");
		expect(firstIdx).toBeGreaterThanOrEqual(0);
		expect(secondIdx).toBeGreaterThan(firstIdx);
	});
});
