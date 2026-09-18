/**
 * How big `data.json` has become, and when to say so (ADR-174).
 *
 * Pythia keeps every conversation in one file and rewrites the whole of it
 * after every message. That is fine for a long time and then is not, and the
 * number that decides which is the file's size, not the conversation count —
 * a hundred long research conversations weigh more than a thousand short ones.
 *
 * The thresholds come from `scripts/bench-store.mjs`, measured on a synthetic
 * corpus of ~22 KB conversations (Node 22, a server-class CPU — a phone in a
 * webview is several times slower):
 *
 * | data.json | rewrite per turn | startup parse |
 * |---|---|---|
 * | 4.5 MB (200 conversations)  |  18 ms |  12 ms |
 * | 11 MB  (500)                |  44 ms |  27 ms |
 * | 22 MB  (1 000)              |  87 ms |  65 ms |
 * | 45 MB  (2 000)              | 180 ms | 138 ms |
 *
 * `warn` sits where a turn starts paying tens of milliseconds and a sync moves
 * tens of megabytes per message; `high` is where that has roughly doubled and
 * the startup parse is felt. Neither is a cliff — they are where a user should
 * be told a number they otherwise cannot see.
 */

export const STORAGE_WARN_BYTES = 25 * 1024 * 1024;
export const STORAGE_HIGH_BYTES = 50 * 1024 * 1024;

export type StorageLevel = "ok" | "warn" | "high";

export function storageLevel(bytes: number): StorageLevel {
	if (bytes >= STORAGE_HIGH_BYTES) return "high";
	if (bytes >= STORAGE_WARN_BYTES) return "warn";
	return "ok";
}

/**
 * A file size a person can read. Locale-independent on purpose, like every
 * other number Pythia draws (ADR-139): `toLocaleString` would change the
 * decimal mark and the width of a label drawn to a mono rhythm.
 */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "—";
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
	return `${(mb / 1024).toFixed(1)} GB`;
}
