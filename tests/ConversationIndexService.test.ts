import { describe, it, expect } from "vitest";
import { ConversationIndexService, type IndexStore } from "../services/embedding/ConversationIndexService";
import type { EmbeddingProvider } from "../services/embedding/EmbeddingProvider";
import type { Conversation, Message } from "../models/types";

// Fake embedder: maps text to a 4-dim axis vector by a keyword, and records every
// text it embedded so tests can assert the incremental (re-embed only changed) path.
class FakeProvider implements EmbeddingProvider {
	readonly dim = 4;
	embedded: string[] = [];
	async ready(): Promise<void> {}
	async embed(texts: string[]): Promise<Float32Array[]> {
		this.embedded.push(...texts);
		return texts.map((t) => {
			const v = new Float32Array(4);
			if (t.includes("alpha")) v[0] = 1;
			else if (t.includes("beta")) v[1] = 1;
			else v[2] = 1;
			return v;
		});
	}
	unload(): void {}
}

class MemStore implements IndexStore {
	buf: ArrayBuffer | null = null;
	writes = 0;
	async read(): Promise<ArrayBuffer | null> { return this.buf; }
	async write(b: ArrayBuffer): Promise<void> { this.buf = b; this.writes++; }
}

let seq = 0;
const msg = (content: string): Message => ({ id: `m${seq++}`, role: "user", content, timestamp: "2026-01-01T00:00:00.000Z" });
const conv = (over: Partial<Conversation> & { name: string }): Conversation => ({
	id: over.id ?? `c${seq++}`, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
	systemPrompt: "", contextNotes: [], resumeMode: "full", provider: "anthropic", model: "claude",
	messages: over.messages ?? [], ...over,
} as Conversation);

describe("ConversationIndexService", () => {
	const alpha1 = conv({ id: "a1", name: "alpha one", messages: [msg("all about alpha")] });
	const alpha2 = conv({ id: "a2", name: "alpha two", messages: [msg("more alpha content")] });
	const beta1 = conv({ id: "b1", name: "beta one", messages: [msg("all about beta")] });

	it("embeds every conversation on first sync and persists", async () => {
		const p = new FakeProvider();
		const store = new MemStore();
		const svc = new ConversationIndexService(p, store);
		await svc.sync([alpha1, beta1]);
		expect(p.embedded.length).toBeGreaterThanOrEqual(2);
		expect(store.writes).toBe(1);
		expect(store.buf).not.toBeNull();
	});

	it("re-embeds nothing when unchanged (incremental)", async () => {
		const p = new FakeProvider();
		const store = new MemStore();
		const svc = new ConversationIndexService(p, store);
		await svc.sync([alpha1, beta1]);
		const afterFirst = p.embedded.length;
		const writesAfterFirst = store.writes;
		await svc.sync([alpha1, beta1]);
		expect(p.embedded.length).toBe(afterFirst); // no new embeds
		expect(store.writes).toBe(writesAfterFirst); // no rewrite
	});

	it("re-embeds only the conversation whose content changed", async () => {
		const p = new FakeProvider();
		const svc = new ConversationIndexService(p, new MemStore());
		await svc.sync([alpha1, beta1]);
		p.embedded = [];
		const alpha1Edited = conv({ id: "a1", name: "alpha one", messages: [msg("all about alpha — edited")] });
		await svc.sync([alpha1Edited, beta1]);
		expect(p.embedded.every((t) => t.includes("alpha"))).toBe(true); // only a1 re-embedded
		expect(p.embedded.length).toBeGreaterThan(0);
	});

	it("drops a removed conversation from the index and results", async () => {
		const p = new FakeProvider();
		const svc = new ConversationIndexService(p, new MemStore());
		await svc.getRelated("a1", [alpha1, alpha2, beta1], { minScore: 0.5 });
		const afterRemoval = await svc.getRelated("a1", [alpha1, beta1], { minScore: 0.5 });
		expect(afterRemoval.find((r) => r.id === "a2")).toBeUndefined();
	});

	it("ranks related by similarity, excludes the source, applies minScore", async () => {
		const p = new FakeProvider();
		const svc = new ConversationIndexService(p, new MemStore());
		const out = await svc.getRelated("a1", [alpha1, alpha2, beta1], { minScore: 0.5 });
		expect(out.map((r) => r.id)).toEqual(["a2"]); // alpha↔alpha only; beta filtered, source excluded
		expect(out[0].score).toBeGreaterThan(0.9);
	});

	it("still ranks related when a malformed conversation is in the set (the reported bug)", async () => {
		// "Show related" returned nothing because doSync built embed chunks for the
		// WHOLE set via conversationChunks, so one malformed conversation (null
		// message element / non-string content) threw and rejected getRelated. This
		// runs the REAL orchestration (sync → embed → rank) with such a record mixed in.
		const p = new FakeProvider();
		const svc = new ConversationIndexService(p, new MemStore());
		const nullMsg = conv({ id: "bad1", name: "alpha broken", messages: [null as unknown as Message] });
		const noContent = conv({ id: "bad2", name: "gamma", messages: [{ id: "x", role: "user", timestamp: "" } as unknown as Message] });
		const out = await svc.getRelated("a1", [alpha1, alpha2, beta1, nullMsg, noContent], { minScore: 0.5 });
		expect(out.map((r) => r.id)).toContain("a2"); // the genuine alpha↔alpha match still surfaces
		expect(out).not.toHaveLength(0);
	});

	it("loads a persisted index without re-embedding", async () => {
		const store = new MemStore();
		const p1 = new FakeProvider();
		await new ConversationIndexService(p1, store).sync([alpha1, alpha2, beta1]);

		const p2 = new FakeProvider(); // fresh: embedded starts empty
		const svc2 = new ConversationIndexService(p2, store);
		const out = await svc2.getRelated("a1", [alpha1, alpha2, beta1], { minScore: 0.5 });
		expect(p2.embedded).toEqual([]); // served entirely from the persisted index
		expect(out.map((r) => r.id)).toEqual(["a2"]);
	});
});
