import { describe, it, expect } from "vitest";
import { noteEmbedChunks, rankByQuery } from "../services/embedding/vaultRetrieval";
import { quantize } from "../services/embedding/vectorMath";
import type { IndexedConversation } from "../services/embedding/embeddingIndex";

// ── noteEmbedChunks ─────────────────────────────────────────────────────────

describe("noteEmbedChunks", () => {
	it("splits a note into one chunk per heading section", () => {
		const chunks = noteEmbedChunks("# Budget\nsome budget text\n# Roadmap\nQ3 plan");
		expect(chunks.length).toBe(2);
		expect(chunks[0]).toContain("Budget");
		expect(chunks[1]).toContain("Roadmap");
	});

	it("returns the whole body as one chunk when there are no headings", () => {
		const chunks = noteEmbedChunks("just a flat note with no headings");
		expect(chunks).toEqual(["just a flat note with no headings"]);
	});

	it("hard-windows a section longer than maxChars", () => {
		const long = "x".repeat(1200);
		const chunks = noteEmbedChunks(long, 500);
		expect(chunks.length).toBe(3); // 500 + 500 + 200
		expect(chunks[0].length).toBe(500);
		expect(chunks[2].length).toBe(200);
	});

	it("returns no chunks for empty or whitespace content", () => {
		expect(noteEmbedChunks("")).toEqual([]);
		expect(noteEmbedChunks("   \n  ")).toEqual([]);
	});

	it("tolerates a non-string input without throwing", () => {
		expect(noteEmbedChunks(undefined as unknown as string)).toEqual([]);
	});
});

// ── rankByQuery ──────────────────────────────────────────────────────────────

/** Build an indexed note from axis-vector chunks (already unit-ish, then quantized). */
function note(id: string, axes: number[][]): IndexedConversation {
	return {
		id,
		contentHash: id,
		chunks: axes.map((a) => quantize(Float32Array.from(a))),
	};
}

const AX = (i: number): number[] => [0, 0, 0, 0].map((_, k) => (k === i ? 1 : 0));

describe("rankByQuery", () => {
	const index = [
		note("alpha.md", [AX(0)]),
		note("beta.md", [AX(1)]),
		note("mixed.md", [AX(1), AX(0)]), // has an alpha chunk too
	];
	const queryAlpha = quantize(Float32Array.from(AX(0)));

	it("ranks notes by best chunk-to-query cosine, filtered by minScore", () => {
		const out = rankByQuery(queryAlpha, index, { minScore: 0.5 });
		// alpha.md and mixed.md both contain the alpha axis; beta.md does not.
		expect(out.map((r) => r.id).sort()).toEqual(["alpha.md", "mixed.md"]);
		expect(out.every((r) => r.score > 0.9)).toBe(true);
	});

	it("excludes notes below the similarity floor", () => {
		const out = rankByQuery(queryAlpha, index, { minScore: 0.5 });
		expect(out.find((r) => r.id === "beta.md")).toBeUndefined();
	});

	it("applies the limit after sorting", () => {
		const out = rankByQuery(queryAlpha, index, { minScore: 0.5, limit: 1 });
		expect(out.length).toBe(1);
		expect(out[0].score).toBeGreaterThan(0.9);
	});

	it("returns [] when nothing clears the floor", () => {
		const queryOrthogonal = quantize(Float32Array.from(AX(3)));
		expect(rankByQuery(queryOrthogonal, index, { minScore: 0.5 })).toEqual([]);
	});

	it("skips notes with no chunks", () => {
		const withEmpty = [...index, { id: "empty.md", contentHash: "e", chunks: [] }];
		const out = rankByQuery(queryAlpha, withEmpty, { minScore: 0.5 });
		expect(out.find((r) => r.id === "empty.md")).toBeUndefined();
	});
});
