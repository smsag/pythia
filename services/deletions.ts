import type { Conversation } from "../models/types";

/**
 * Deletion records (ADR-252): which conversations were deleted, and when, kept
 * in data.json so a sync cannot bring one back.
 *
 * ADR-133 reconciles memory with disk per conversation and keeps one that only
 * one side holds, because without a record "deleted over there" and "created
 * here, not yet written" look the same. A second device that still held a
 * deleted conversation wrote it back, and the next reload here took it in
 * again — over and over. A record says which of the two it is.
 *
 * A record wins over a copy that is not newer than the delete; a copy edited
 * AFTER the delete (another device kept writing in it) is kept, because
 * destroying words someone wrote after the delete is the worse error. Pure:
 * no Obsidian.
 */

/** Conversation id → when it was deleted (ISO 8601). */
export type DeletionLog = Record<string, string>;

/** How long a record is kept. A device offline for longer can still bring a
 *  conversation back — visible, and deletable again. */
export const DELETION_RETENTION_DAYS = 180;
/** At most this many records; the oldest go first. */
export const DELETION_LOG_LIMIT = 5000;
/** An id longer than this is not one Pythia made. */
const MAX_ID_LENGTH = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

function isIsoDate(value: unknown): value is string {
	return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

/** Drop what has expired, then keep the newest `DELETION_LOG_LIMIT`. */
function bounded(entries: [string, string][], now: string): DeletionLog {
	const cutoff = Date.parse(now) - DELETION_RETENTION_DAYS * DAY_MS;
	const live = entries.filter(([, at]) => Date.parse(at) >= cutoff);
	live.sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
	return Object.fromEntries(live.slice(0, DELETION_LOG_LIMIT));
}

/** `deletedConversations` read back from data.json: well-formed, unexpired
 *  records only. Anything else reads as no record, never as a deletion. */
export function normalizeDeletionLog(value: unknown, now: string): DeletionLog {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const entries: [string, string][] = [];
	for (const [id, at] of Object.entries(value as Record<string, unknown>)) {
		if (!id || id.length > MAX_ID_LENGTH || !isIsoDate(at)) continue;
		// A record from the future would outlive every later edit; a day of
		// clock skew between devices is allowed, more is not a record.
		if (Date.parse(at) > Date.parse(now) + DAY_MS) continue;
		// One spelling, so the string comparisons below are chronological.
		entries.push([id, new Date(at).toISOString()]);
	}
	return bounded(entries, now);
}

/** The union of two logs — memory and disk after a sync; the later delete of
 *  an id wins. Neither side's records are lost to the other's write. */
export function mergeDeletionLogs(a: DeletionLog, b: DeletionLog, now: string): DeletionLog {
	const out = new Map<string, string>(Object.entries(a));
	for (const [id, at] of Object.entries(b)) {
		const mine = out.get(id);
		if (mine === undefined || at > mine) out.set(id, at);
	}
	return bounded([...out], now);
}

/** Record these ids as deleted at `now`. */
export function recordDeletions(log: DeletionLog, ids: string[], now: string): DeletionLog {
	return mergeDeletionLogs(log, Object.fromEntries(ids.map((id) => [id, now])), now);
}

/** Whether the record deletes this copy: it does unless the copy was edited
 *  after the delete. A missing `updatedAt` sorts oldest, so the record wins. */
export function isDeleted(conv: Pick<Conversation, "id" | "updatedAt">, log: DeletionLog): boolean {
	const at = log[conv.id];
	return at !== undefined && (conv.updatedAt ?? "") <= at;
}

/** The list without what the log deleted, and the ids it removed. */
export function applyDeletions(
	conversations: Conversation[],
	log: DeletionLog,
): { kept: Conversation[]; removed: string[] } {
	const removed: string[] = [];
	const kept = conversations.filter((c) => {
		if (!isDeleted(c, log)) return true;
		removed.push(c.id);
		return false;
	});
	return { kept, removed };
}
