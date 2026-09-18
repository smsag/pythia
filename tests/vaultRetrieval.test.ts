import { describe, it, expect } from "vitest";
import { noteEmbedChunks, retrievalQuery, isIndexingOptedOut } from "../services/embedding/vaultRetrieval";

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

// ── retrievalQuery (ADR-183) ─────────────────────────────────────────────────
describe("retrievalQuery", () => {
	it("carries the previous answer into a SHORT follow-up", () => {
		// "and the second one?" is four tokens — on its own it retrieves noise.
		const out = retrievalQuery("and the second one?", "Ranked retrieval uses cosine similarity over chunks.");
		expect(out).toContain("and the second one?");
		expect(out).toContain("cosine similarity");
	});

	it("puts the user's own words FIRST", () => {
		const out = retrievalQuery("what about pricing?", "Some earlier answer about embeddings.");
		expect(out.startsWith("what about pricing?")).toBe(true);
	});

	it("leaves a long message alone — a full question does not need help", () => {
		const long = "x".repeat(250);
		expect(retrievalQuery(long, "an earlier answer")).toBe(long);
	});

	it("caps how much of the answer is carried, so it cannot dominate", () => {
		const out = retrievalQuery("more?", "y".repeat(5000));
		expect(out.length).toBeLessThan(400);
	});

	it("is just the message when there is no previous answer", () => {
		expect(retrievalQuery("first turn", "")).toBe("first turn");
		expect(retrievalQuery("first turn")).toBe("first turn");
	});

	it("returns empty for an empty message, so retrieval short-circuits", () => {
		expect(retrievalQuery("   ", "an answer")).toBe("");
	});
});

// ── isIndexingOptedOut (ADR-183) ─────────────────────────────────────────────
describe("isIndexingOptedOut", () => {
	it("opts out on an explicit false", () => {
		expect(isIndexingOptedOut({ pythia: false })).toBe(true);
		expect(isIndexingOptedOut({ pythia: "false" })).toBe(true);
	});

	it("indexes everything else, including a missing or malformed key", () => {
		// A frontmatter typo must never silently drop a note out of retrieval:
		// the user would see no pills and have nothing to explain it.
		for (const fm of [undefined, null, {}, { pythia: true }, { pythia: "no" }, { pythia: 0 }, "not an object"]) {
			expect(isIndexingOptedOut(fm)).toBe(false);
		}
	});

	it("ignores other frontmatter keys", () => {
		expect(isIndexingOptedOut({ tags: ["a"], aliases: [], pythia: false })).toBe(true);
		expect(isIndexingOptedOut({ tags: ["a"] })).toBe(false);
	});
});
