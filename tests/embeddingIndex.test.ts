import { describe, it, expect } from "vitest";
import {
	conversationContentHash,
	diffIndex,
	serializeIndex,
	deserializeIndex,
	peekIndexMeta,
	readKeeper,
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

describe("deserializeIndex — truncated files", () => {
	it("refuses a buffer cut short in the vector blob instead of yielding short vectors", () => {
		const dim = 4;
		const items = [
			{ id: "a", contentHash: "h1", chunks: [new Int8Array([1, 2, 3, 4]), new Int8Array([5, 6, 7, 8])] },
		];
		const buf = serializeIndex(items, dim);
		const cut = buf.slice(0, buf.byteLength - 3);
		expect(() => deserializeIndex(cut)).toThrow(/truncated vectors/);
	});

	it("refuses a buffer cut short inside the meta block", () => {
		const buf = serializeIndex([{ id: "a", contentHash: "h", chunks: [new Int8Array([1, 2])] }], 2);
		const cut = buf.slice(0, 20);
		expect(() => deserializeIndex(cut)).toThrow(/truncated meta/);
	});
});

// ── ADR-184: an index records what it is, and whether it finished ────────────
describe("index self-description (ADR-184)", () => {
	const vec = (n: number) => Int8Array.from(Array.from({ length: 4 }, () => n));
	const items = [{ id: "a.md", contentHash: "h1", chunks: [vec(1)] }];

	it("round-trips completeness and scope", () => {
		const buf = serializeIndex(items, 4, { complete: true, scope: "SCOPE-A" });
		const out = deserializeIndex(buf);
		expect(out.meta).toEqual({ complete: true, scope: "SCOPE-A" });
		expect(out.items.map((i) => i.id)).toEqual(["a.md"]);
	});

	it("round-trips an INCOMPLETE index — the case that matters", () => {
		// A mid-build flush (ADR-182) writes rows AND the fact that the build is
		// unfinished. Losing the second half is how a fifth of a vault got served
		// as though it were the whole thing.
		const out = deserializeIndex(serializeIndex(items, 4, { complete: false, scope: "S" }));
		expect(out.meta.complete).toBe(false);
		expect(out.items).toHaveLength(1);
	});

	it("defaults to incomplete when no meta is given", () => {
		expect(deserializeIndex(serializeIndex(items, 4)).meta).toEqual({ complete: false, scope: "" });
	});

	it("refuses a v1 file rather than reading it as complete", () => {
		// The old format carried no flag; treating its absence as "finished" would
		// skip the rebuild that this release needs anyway.
		const buf = serializeIndex(items, 4, { complete: true, scope: "S" });
		new DataView(buf).setUint8(4, 1); // stamp it v1
		expect(() => deserializeIndex(buf)).toThrow(/unsupported version/);
	});

	it("reads a hand-mangled header as incomplete rather than trusting it", () => {
		// Principle 1: validate at the boundary. A header that cannot be vouched for
		// must make the next build redo the work.
		const good = serializeIndex(items, 4, { complete: true, scope: "S" });
		const meta = JSON.stringify({ complete: "yes", scope: 42, rows: [{ id: "a.md", h: "h1", c: 1 }] });
		const metaBytes = new TextEncoder().encode(meta);
		const buf = new ArrayBuffer(15 + metaBytes.length + 4);
		new Uint8Array(buf).set(new Uint8Array(good.slice(0, 15)));
		const dv = new DataView(buf);
		dv.setUint32(11, metaBytes.length);
		new Uint8Array(buf, 15, metaBytes.length).set(metaBytes);
		expect(deserializeIndex(buf).meta).toEqual({ complete: false, scope: "" });
	});
});

describe("the index's keeper (ADR-220)", () => {
	const rows: IndexedConversation[] = [{ id: "a", contentHash: "h", chunks: [Int8Array.from([1, 2, 3, 4])] }];

	it("round-trips which kind of device wrote the file", () => {
		for (const keeper of ["desktop", "mobile"] as const) {
			const buf = serializeIndex(rows, 4, { complete: true, scope: "S", keeper });
			expect(deserializeIndex(buf).meta.keeper).toBe(keeper);
			expect(peekIndexMeta(buf)?.keeper).toBe(keeper);
		}
	});

	it("reads a file without one as unknown — the behaviour before ADR-220", () => {
		const buf = serializeIndex(rows, 4, { complete: true, scope: "S" });
		expect(deserializeIndex(buf).meta).toEqual({ complete: true, scope: "S" });
		expect(peekIndexMeta(buf)?.keeper).toBeUndefined();
	});

	it("validates it at the boundary: anything else is unknown, never trusted", () => {
		expect(readKeeper("desktop")).toBe("desktop");
		expect(readKeeper("mobile")).toBe("mobile");
		for (const bad of ["tablet", "", 1, null, undefined, {}]) expect(readKeeper(bad)).toBeUndefined();
		const forged = serializeIndex(rows, 4, { complete: true, scope: "S", keeper: "tablet" as never });
		expect(deserializeIndex(forged).meta.keeper).toBeUndefined();
	});
});
