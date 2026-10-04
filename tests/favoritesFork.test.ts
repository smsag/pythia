import { describe, it, expect } from "vitest";
import {
	favoritesFingerprint, favoritesSummaryStale, favoritesSeed, seedState, forkKind, sanitizeForkedFavorites,
} from "../services/favoritesFork";
import { sanitizeConversationFields } from "../services/persistence";
import type { Conversation, Favorite } from "../models/types";

// A fork from favorites (ADR-255): a snapshot of the source's favorites
// summary, offered for update, never updated on its own.

const conv = (over: Partial<Conversation> = {}): Conversation => ({
	id: "c1", name: "Chat",
	createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
	systemPrompt: "", contextNotes: [], resumeMode: "full",
	provider: "anthropic", model: "m", messages: [],
	...over,
});
const fav = (id: string, createdAt?: string): Favorite => ({ id, messageId: "m1", name: id, text: id, createdAt });

describe("favoritesFingerprint", () => {
	it("is the favorite ids, order-independent", () => {
		expect(favoritesFingerprint(conv({ favorites: [fav("b"), fav("a")] }))).toBe("a,b");
		expect(favoritesFingerprint(conv({ favorites: [fav("a"), fav("b")] }))).toBe("a,b");
		expect(favoritesFingerprint(conv())).toBe("");
	});
});

describe("favoritesSummaryStale", () => {
	const summary = { text: "S", updatedAt: "2026-10-01T10:00:00.000Z" };

	it("is never stale without a summary", () => {
		expect(favoritesSummaryStale(conv({ favorites: [fav("a")] }))).toBe(false);
	});

	it("with a fingerprint, sees a removed favorite as well as an added one", () => {
		const c = conv({ favorites: [fav("a"), fav("b")], favoritesSummary: { ...summary, favoriteIds: "a,b" } });
		expect(favoritesSummaryStale(c)).toBe(false);
		expect(favoritesSummaryStale({ ...c, favorites: [fav("a")] })).toBe(true);
		expect(favoritesSummaryStale({ ...c, favorites: [fav("a"), fav("b"), fav("c")] })).toBe(true);
	});

	it("without one (a summary from before), falls back to a favorite created after it", () => {
		expect(favoritesSummaryStale(conv({ favorites: [fav("a", "2026-09-30T00:00:00.000Z")], favoritesSummary: summary }))).toBe(false);
		expect(favoritesSummaryStale(conv({ favorites: [fav("a", "2026-10-02T00:00:00.000Z")], favoritesSummary: summary }))).toBe(true);
	});
});

describe("favoritesSeed", () => {
	it("snapshots the summary, its date and the favorite count", () => {
		const source = conv({ favorites: [fav("a"), fav("b")], favoritesSummary: { text: "  S  ", updatedAt: "T1" } });
		expect(favoritesSeed(source)).toEqual({ text: "S", sourceUpdatedAt: "T1", favoriteCount: 2 });
	});

	it("is null when there is no summary to take", () => {
		expect(favoritesSeed(conv())).toBeNull();
		expect(favoritesSeed(conv({ favoritesSummary: { text: "  ", updatedAt: "T1" } }))).toBeNull();
	});
});

describe("seedState", () => {
	const seed = { text: "S", sourceUpdatedAt: "2026-10-01T10:00:00.000Z", favoriteCount: 1 };

	it("is current while the source holds the same summary", () => {
		expect(seedState(seed, conv({ favoritesSummary: { text: "S", updatedAt: seed.sourceUpdatedAt } }))).toBe("current");
	});

	it("is outdated once the source regenerated its summary — offered, not applied", () => {
		expect(seedState(seed, conv({ favoritesSummary: { text: "S2", updatedAt: "2026-10-02T10:00:00.000Z" } }))).toBe("outdated");
	});

	it("is current when the source has no summary any more — nothing newer to take", () => {
		expect(seedState(seed, conv())).toBe("current");
	});

	it("is orphaned when the source is gone", () => {
		expect(seedState(seed, undefined)).toBe("orphaned");
	});
});

describe("forkKind — the one rule the navigator and the conversation panel read", () => {
	it("tells a fork from favorites from any other fork", () => {
		const seed = { text: "S", sourceUpdatedAt: "T", favoriteCount: 1 };
		expect(forkKind(conv())).toBe("none");
		expect(forkKind(conv({ forkedFromId: "src" }))).toBe("passage");
		expect(forkKind(conv({ forkedFromId: "src", forkedFromFavorites: seed }))).toBe("favorites");
	});
});

describe("a snapshot read back from data.json (principle 1)", () => {
	it("keeps a valid one and repairs a bad count", () => {
		expect(sanitizeForkedFavorites({ text: "S", sourceUpdatedAt: "T", favoriteCount: 3 }))
			.toEqual({ text: "S", sourceUpdatedAt: "T", favoriteCount: 3 });
		expect(sanitizeForkedFavorites({ text: "S", sourceUpdatedAt: "T", favoriteCount: -1 })?.favoriteCount).toBe(0);
	});

	it("drops one that cannot go into a prompt", () => {
		for (const raw of [null, "S", { text: "", sourceUpdatedAt: "T" }, { text: 3, sourceUpdatedAt: "T" }, { text: "S" }]) {
			expect(sanitizeForkedFavorites(raw)).toBeUndefined();
		}
	});

	it("sanitizeConversationFields drops a malformed snapshot and a malformed fingerprint", () => {
		const c = conv() as unknown as Record<string, unknown>;
		c.forkedFromFavorites = { text: 42 };
		c.favoritesSummary = { text: "S", updatedAt: "T", favoriteIds: 7 };
		sanitizeConversationFields(c as unknown as Conversation);
		expect(c.forkedFromFavorites).toBeUndefined();
		expect(c.favoritesSummary).toEqual({ text: "S", updatedAt: "T" });
	});

	it("sanitizeConversationFields drops a favorites summary of the wrong shape", () => {
		const c = conv() as unknown as Record<string, unknown>;
		c.favoritesSummary = "S";
		sanitizeConversationFields(c as unknown as Conversation);
		expect(c.favoritesSummary).toBeUndefined();
	});
});
