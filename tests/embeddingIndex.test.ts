import { describe, it, expect } from "vitest";
import {
	conversationContentHash,
	diffIndex,
	serializeIndex,
	deserializeIndex,
	type IndexedConversation,
} from "../services/embedding/embeddingIndex";

describe("conversationContentHash", () => {
	it("is deterministic for the same chunks", () => {
		expect(conversationContentHash(["a", "b"])).toBe(conversationContentHash(["a", "b"]));
	});
	it("changes when content changes", () => {
		expect(conversationContentHash(["a", "b"])).not.toBe(conversationContentHash(["a", "c"]));
	});
});

describe("diffIndex", () => {
	it("flags new and changed conversations to embed, and removed ones to drop", () => {
		const existing = new Map([["a", "h1"], ["b", "h2"], ["c", "h3"]]);
		const desired = [
			{ id: "a", contentHash: "h1" }, // unchanged
			{ id: "b", contentHash: "h2-new" }, // changed
			{ id: "d", contentHash: "h4" }, // new
			// c is gone
		];
		const diff = diffIndex(existing, desired);
		expect(diff.toEmbed.sort()).toEqual(["b", "d"]);
		expect(diff.toDrop).toEqual(["c"]);
	});
	it("embeds everything against an empty index", () => {
		const diff = diffIndex(new Map(), [{ id: "a", contentHash: "h" }]);
		expect(diff.toEmbed).toEqual(["a"]);
		expect(diff.toDrop).toEqual([]);
	});
});

describe("serializeIndex / deserializeIndex", () => {
	const dim = 4;
	const mk = (id: string, hash: string, chunks: number[][]): IndexedConversation => ({
		id,
		contentHash: hash,
		chunks: chunks.map((c) => Int8Array.from(c)),
	});

	it("round-trips ids, hashes, and chunk vectors exactly", () => {
		const items = [
			mk("alpha", "h1", [[1, 2, 3, 4], [-5, -6, -7, -8]]),
			mk("beta", "h2", [[127, 0, -127, 1]]),
		];
		const { items: back, dim: d } = deserializeIndex(serializeIndex(items, dim));
		expect(d).toBe(dim);
		expect(back.map((i) => [i.id, i.contentHash])).toEqual([["alpha", "h1"], ["beta", "h2"]]);
		expect(back[0].chunks.length).toBe(2);
		expect(Array.from(back[0].chunks[1])).toEqual([-5, -6, -7, -8]);
		expect(Array.from(back[1].chunks[0])).toEqual([127, 0, -127, 1]);
	});

	it("round-trips an empty index", () => {
		const { items, dim: d } = deserializeIndex(serializeIndex([], dim));
		expect(items).toEqual([]);
		expect(d).toBe(dim);
	});

	it("rejects a chunk whose length does not match dim", () => {
		expect(() => serializeIndex([mk("x", "h", [[1, 2, 3]])], dim)).toThrow(/dim/);
	});

	it("rejects a buffer with a bad magic header", () => {
		expect(() => deserializeIndex(new ArrayBuffer(32))).toThrow(/magic/);
	});
});
