import type { Conversation, ForkedFavorites } from "../models/types";

/**
 * A fork that starts from a conversation's favorites (ADR-255).
 *
 * The fork carries a SNAPSHOT of the source's favorites summary, never a live
 * link: a later regenerate in the source must not change what this fork's
 * answers are built on behind the user's back. The fork is told when the
 * source has a newer summary and takes it on one tap (`seedState`), which is
 * the only way the snapshot changes.
 *
 * Pure and tested; the service, the summary card, the reference pill, the
 * navigator and the conversation panel all read these rules.
 */

/**
 * The ONE fingerprint of which favorites a summary covered: their ids, sorted.
 * Stored on `favoritesSummary` when it is generated, so a favorite removed
 * after the summary marks it outdated too — the creation-date rule alone sees
 * only an added one.
 */
export function favoritesFingerprint(conv: Pick<Conversation, "favorites">): string {
	return (conv.favorites ?? []).map((f) => f.id).sort().join(",");
}

/**
 * Whether the favorites summary no longer covers the favorites the
 * conversation holds. With a fingerprint (every summary generated since
 * ADR-255) it is exact; without one it falls back to the card's old rule — a
 * favorite created after the summary (ADR-128). No summary is not "outdated":
 * there is nothing to be out of date.
 */
export function favoritesSummaryStale(conv: Pick<Conversation, "favorites" | "favoritesSummary">): boolean {
	const summary = conv.favoritesSummary;
	if (!summary?.text?.trim()) return false;
	if (typeof summary.favoriteIds === "string") return summary.favoriteIds !== favoritesFingerprint(conv);
	const newest = (conv.favorites ?? []).map((f) => f.createdAt ?? "").sort().pop();
	return !!(newest && summary.updatedAt && newest > summary.updatedAt);
}

/**
 * Whether a fork must regenerate the summary before taking it. Stricter than
 * `favoritesSummaryStale`, which the card reads: a summary without a
 * fingerprint (generated before ADR-255) cannot say whether a favorite was
 * REMOVED since, and a fork would then carry an unstarred passage on every
 * turn. The card keeps the softer rule — marking every old summary outdated
 * would be noise; seeding a fork from one is not.
 */
export function needsFreshSummaryToFork(conv: Pick<Conversation, "favorites" | "favoritesSummary">): boolean {
	const summary = conv.favoritesSummary;
	if (!summary?.text?.trim()) return true;
	if (typeof summary.favoriteIds !== "string") return true;
	return favoritesSummaryStale(conv);
}

/** The snapshot a fork takes of its source's favorites summary, or null when
 *  there is none to take. */
export function favoritesSeed(source: Pick<Conversation, "id" | "favorites" | "favoritesSummary">): ForkedFavorites | null {
	const summary = source.favoritesSummary;
	const text = summary?.text?.trim();
	if (!summary || !text) return null;
	return { text, sourceUpdatedAt: summary.updatedAt, favoriteCount: source.favorites?.length ?? 0, fromId: source.id };
}

/**
 * The conversation a fork's snapshot came from — what its pill names, opens
 * and offers ↻ against. A passage fork made from a fork from favorites
 * inherits the snapshot, so this is the snapshot's own `fromId`, not the
 * fork's parent; a snapshot from before `fromId` falls back to the parent.
 */
export function seedSourceId(conv: Pick<Conversation, "forkedFromId" | "forkedFromFavorites">): string | undefined {
	return conv.forkedFromFavorites?.fromId ?? conv.forkedFromId;
}

/**
 * Where a fork's snapshot stands against its source.
 * - `current`: the source holds no newer favorites summary.
 * - `outdated`: the source's summary was regenerated after the snapshot; ↻ takes it.
 * - `orphaned`: the source is gone; the snapshot is all there is, and it keeps working.
 */
export type SeedState = "current" | "outdated" | "orphaned";

export function seedState(seed: ForkedFavorites, source: Conversation | undefined): SeedState {
	if (!source) return "orphaned";
	const summary = source.favoritesSummary;
	if (!summary?.text?.trim()) return "current";
	// ISO 8601 strings sort chronologically.
	return summary.updatedAt > seed.sourceUpdatedAt ? "outdated" : "current";
}

/**
 * What kind of fork a conversation is — the ONE rule the navigator's fork tree
 * and the conversation panel read for their marker.
 * - `favorites`: started from the source's favorites summary — still so when
 *   the user switched the snapshot off, which keeps it (`ForkedFavorites.off`).
 *   A passage fork that inherited the snapshot from its parent is a `passage`
 *   fork: it started from a passage, and carries the summary as well.
 * - `passage`: started from a passage in an answer (or any other fork).
 * - `none`: not a fork.
 */
export type ForkKind = "favorites" | "passage" | "none";

export function forkKind(conv: Pick<Conversation, "forkedFromId" | "forkedFromFavorites" | "forkedFromMessageId" | "forkedFromSelection">): ForkKind {
	if (!conv.forkedFromId) return "none";
	const fromPassage = !!conv.forkedFromMessageId || !!conv.forkedFromSelection;
	return conv.forkedFromFavorites && !fromPassage ? "favorites" : "passage";
}

/**
 * Validate a snapshot read back from data.json (principle 1). It reaches the
 * system prompt on every send, so a malformed one is dropped rather than
 * repaired: the source, if it still exists, can be forked again.
 */
export function sanitizeForkedFavorites(raw: unknown): ForkedFavorites | undefined {
	if (raw === null || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	if (typeof r.text !== "string" || !r.text.trim()) return undefined;
	if (typeof r.sourceUpdatedAt !== "string") return undefined;
	const count = typeof r.favoriteCount === "number" && Number.isInteger(r.favoriteCount) && r.favoriteCount >= 0
		? r.favoriteCount
		: 0;
	return {
		text: r.text, sourceUpdatedAt: r.sourceUpdatedAt, favoriteCount: count,
		...(typeof r.fromId === "string" && r.fromId ? { fromId: r.fromId } : {}),
		...(r.off === true ? { off: true as const } : {}),
	};
}
