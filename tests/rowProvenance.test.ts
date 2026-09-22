import { describe, it, expect } from "vitest";
import { hashPolicyFor, isLatinExact, resolveRowHash } from "../services/embedding/rowProvenance";
import { conversationContentHash } from "../services/embedding/embeddingIndex";
import { VaultIndexService, type IndexableNote } from "../services/embedding/VaultIndexService";
import { ConversationIndexService, type IndexStore } from "../services/embedding/ConversationIndexService";
import type { EmbeddingProvider } from "../services/embedding/EmbeddingProvider";
import type { Conversation } from "../models/types";
import { serializeIndex, deserializeIndex } from "../services/embedding/embeddingIndex";

// ADR-201: the phone (Latin-script variant) and the desktop (full model) share one
// index file per vector family. A row may be reused only by a device that would
// have produced it — otherwise the desktop ranked non-Latin notes with the
// phone's degraded vectors, forever, because the content hash still matched.

const FULL = "xenova-paraphrase-multilingual-MiniLM-L12-v2" as const;
const LATIN = "xenova-paraphrase-multilingual-MiniLM-L12-v2-latin" as const;

class FakeProvider implements EmbeddingProvider {
	readonly dim = 4;
	embedded: string[] = [];
	async ready(): Promise<void> {}
	async embed(texts: string[]): Promise<Float32Array[]> {
		this.embedded.push(...texts);
		return texts.map(() => Float32Array.from([1, 0, 0, 0]));
	}
	unload(): void {}
}

class MemStore implements IndexStore {
	buf: ArrayBuffer | null = null;
	async read(): Promise<ArrayBuffer | null> { return this.buf; }
	async write(b: ArrayBuffer): Promise<void> { this.buf = b; }
}

const note = (path: string, content: string): IndexableNote => ({ path, load: async () => content });
const RUSSIAN = "Встреча перенесена на четверг из-за забастовки.";
const GERMAN = "Die Quartalsplanung verschiebt sich um eine Woche.";

/** A shared file holding one row for `text`, written with `hash`. */
const sharedFile = (path: string, hash: string): MemStore => {
	const store = new MemStore();
	store.buf = serializeIndex([{ id: path, contentHash: hash, chunks: [Int8Array.from([0, 1, 0, 0])] }], 4, { complete: true, scope: "" });
	return store;
};
const storedHash = (store: MemStore): string => deserializeIndex(store.buf!).items[0].contentHash;

describe("isLatinExact — which text the variant reproduces exactly", () => {
	it("is true for Latin-script text in any language, digits, punctuation and markdown", () => {
		expect(isLatinExact(["Größe, naïve café, Ærø, Łódź, Nguyễn — 3 Punkte (siehe [[Notiz]]) ✓"])).toBe(true);
	});
	it("is false as soon as one chunk holds a letter of another script", () => {
		expect(isLatinExact(["plain English", `mit ${RUSSIAN}`])).toBe(false);
		for (const s of ["Ωmega", "会議", "مرحبا", "नमस्ते", "สวัสดี"]) expect(isLatinExact([s])).toBe(false);
	});
});

describe("hashPolicyFor", () => {
	it("the full model writes and accepts only the plain hash", () => {
		const p = hashPolicyFor(FULL);
		const plain = conversationContentHash([RUSSIAN]);
		expect(p.rowHash([RUSSIAN])).toBe(plain);
		expect(p.accepts(plain, [RUSSIAN])).toBe(true);
		expect(p.accepts(plain + "~latinScript", [RUSSIAN])).toBe(false);
	});

	it("the variant tags only the rows it cannot reproduce exactly", () => {
		const p = hashPolicyFor(LATIN);
		expect(p.rowHash([GERMAN])).toBe(conversationContentHash([GERMAN])); // shared as-is: identical vectors
		expect(p.rowHash([RUSSIAN])).toBe(conversationContentHash([RUSSIAN]) + "~latinScript");
	});

	it("the variant accepts the full model's row (the better vector) and its own", () => {
		const p = hashPolicyFor(LATIN);
		const plain = conversationContentHash([RUSSIAN]);
		expect(p.accepts(plain, [RUSSIAN])).toBe(true);
		expect(p.accepts(plain + "~latinScript", [RUSSIAN])).toBe(true);
		expect(p.accepts("something-else", [RUSSIAN])).toBe(false);
	});

	it("resolveRowHash keeps an accepted stored hash and proposes the device's own otherwise", () => {
		const p = hashPolicyFor(FULL);
		const plain = conversationContentHash([GERMAN]);
		expect(resolveRowHash(p, plain, [GERMAN])).toEqual({ hash: plain, reuse: true });
		expect(resolveRowHash(p, "old", [GERMAN])).toEqual({ hash: plain, reuse: false });
		expect(resolveRowHash(p, undefined, [GERMAN])).toEqual({ hash: plain, reuse: false });
	});
});

describe("the vault index honours the policy (ADR-201)", () => {
	it("the desktop RE-EMBEDS a non-Latin row the phone wrote, instead of trusting its hash", async () => {
		const store = sharedFile("n.md", conversationContentHash([RUSSIAN]) + "~latinScript");
		const p = new FakeProvider();
		await new VaultIndexService(p, store, { hashPolicy: hashPolicyFor(FULL) }).sync([note("n.md", RUSSIAN)]);
		expect(p.embedded).toEqual([RUSSIAN]);
		expect(storedHash(store)).toBe(conversationContentHash([RUSSIAN])); // now the full model's row
	});

	it("the phone then keeps the desktop's row — no ping-pong", async () => {
		const store = sharedFile("n.md", conversationContentHash([RUSSIAN]));
		const p = new FakeProvider();
		await new VaultIndexService(p, store, { hashPolicy: hashPolicyFor(LATIN) }).sync([note("n.md", RUSSIAN)]);
		expect(p.embedded).toEqual([]);
		expect(storedHash(store)).toBe(conversationContentHash([RUSSIAN]));
	});

	it("the phone writes a tagged row for new non-Latin text and a plain one for Latin text", async () => {
		const store = new MemStore();
		await new VaultIndexService(new FakeProvider(), store, { hashPolicy: hashPolicyFor(LATIN) })
			.sync([note("de.md", GERMAN), note("ru.md", RUSSIAN)]);
		const rows = new Map(deserializeIndex(store.buf!).items.map((i) => [i.id, i.contentHash]));
		expect(rows.get("de.md")).toBe(conversationContentHash([GERMAN]));
		expect(rows.get("ru.md")).toBe(conversationContentHash([RUSSIAN]) + "~latinScript");
	});

	it("a Latin-script row is shared both ways with no re-embed", async () => {
		const store = sharedFile("de.md", conversationContentHash([GERMAN]));
		for (const model of [FULL, LATIN]) {
			const p = new FakeProvider();
			await new VaultIndexService(p, store, { hashPolicy: hashPolicyFor(model) }).sync([note("de.md", GERMAN)]);
			expect(p.embedded).toEqual([]);
		}
	});

	it("the targeted update path (updateNote) follows the same rule", async () => {
		const store = sharedFile("n.md", conversationContentHash([RUSSIAN]) + "~latinScript");
		const p = new FakeProvider();
		const svc = new VaultIndexService(p, store, { hashPolicy: hashPolicyFor(FULL) });
		await svc.hydrateForQuery();
		await svc.updateNote(note("n.md", RUSSIAN));
		expect(p.embedded).toEqual([RUSSIAN]);
	});
});

describe("the related-conversations index honours it too", () => {
	it("the desktop re-embeds a conversation the phone tagged", async () => {
		const conv = { id: "c1", name: "Встреча", messages: [{ role: "user", content: RUSSIAN }] } as unknown as Conversation;
		// Build the phone's row first, then read it on the desktop.
		const store = new MemStore();
		const phone = new FakeProvider();
		await new ConversationIndexService(phone, store, { hashPolicy: hashPolicyFor(LATIN) }).sync([conv]);
		expect(storedHash(store)).toMatch(/~latinScript$/);
		const desktop = new FakeProvider();
		await new ConversationIndexService(desktop, store, { hashPolicy: hashPolicyFor(FULL) }).sync([conv]);
		expect(desktop.embedded.length).toBeGreaterThan(0);
		expect(storedHash(store)).not.toMatch(/~latinScript$/);
		// …and the phone keeps the desktop's row.
		const again = new FakeProvider();
		await new ConversationIndexService(again, store, { hashPolicy: hashPolicyFor(LATIN) }).sync([conv]);
		expect(again.embedded).toEqual([]);
	});
});
