import type { Conversation } from "../models/types";
import type { PythiaSettings } from "../models/settings";
import { essentialRenames, renameSettingsPaths, renameVaultPaths, type RenamePair } from "./renameVaultPath";

/**
 * What happens between the vault's rename events and the stored paths
 * (ADR-218 addendum). Obsidian arrives through `RenameFollowerHost`; the module
 * imports no Obsidian runtime (ADR-205).
 *
 * Three rules:
 *   1. **A burst is one scan.** Events are queued and applied on the next tick,
 *      so a folder rename — reported for the folder and for each file in it —
 *      costs one pass over the conversations, not one per file.
 *   2. **Settings follow too.** Eight settings hold vault paths.
 *   3. **A rename is logged, and the log is replayed after every load.** Another
 *      device's copy of a conversation, written before it knew of the rename,
 *      can win the merge with the old paths, and no second rename event will
 *      come to fix it. The log travels in data.json, so the other device
 *      replays it too.
 */

/** One followed rename, as it is kept in data.json. */
export interface RenameLogEntry {
	from: string;
	to: string;
	/** ISO 8601 — orders the replay. */
	at: string;
}

/** The last renames kept for replay; older ones have long reached every device. */
export const RENAME_LOG_LIMIT = 100;

export interface RenameFollowerHost {
	conversations(): Conversation[];
	/** Mark these dirty and persist soon — without touching `updatedAt`: a
	 *  rename is not activity, and bumping it would reorder the list. */
	conversationsChanged(ids: string[]): void;
	settings(): PythiaSettings;
	/** Persist the settings and tell the services that read them. */
	settingsChanged(keys: string[]): void;
	/** Whether a note or folder exists at this vault path now. */
	exists(path: string): boolean;
	/** The log as data.json holds it; appended to in place. */
	renameLog(): RenameLogEntry[];
	/** Run `fn` after the current burst of events (next tick). */
	defer(fn: () => void): void;
	now(): string;
	debug(message: string): void;
}

export class RenameFollower {
	private pending: RenamePair[] = [];
	private scheduled = false;

	constructor(private readonly host: RenameFollowerHost) {}

	/** One vault rename event. Applied with the rest of its burst. */
	queue(from: string, to: string): void {
		this.pending.push({ from, to });
		if (this.scheduled) return;
		this.scheduled = true;
		this.host.defer(() => this.flush());
	}

	/** Apply everything queued. Public so a test, or an unload, can run it now. */
	flush(): void {
		const pairs = essentialRenames(this.pending);
		this.pending = [];
		this.scheduled = false;
		if (pairs.length === 0) return;
		if (!this.apply(pairs)) return;
		const at = this.host.now();
		const log = this.host.renameLog();
		log.push(...pairs.map((p) => ({ ...p, at })));
		if (log.length > RENAME_LOG_LIMIT) log.splice(0, log.length - RENAME_LOG_LIMIT);
		this.host.debug(`followed ${pairs.length} rename(s): ${pairs.map((p) => `${p.from} → ${p.to}`).join(", ")}`);
	}

	/**
	 * Re-apply the log after a load. An entry is replayed only when nothing is
	 * at its old path any more, and a path moves only to a place that exists —
	 * which is exactly a copy written before the rename was known. If the user
	 * has since made a new note at the old path, that note is left alone.
	 */
	replay(): void {
		const entries = [...this.host.renameLog()]
			.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
			.filter((e) => !this.host.exists(e.from));
		if (entries.length === 0) return;
		if (this.apply(entries, (p) => this.host.exists(p))) {
			this.host.debug(`replayed the rename log (${entries.length} entr${entries.length === 1 ? "y" : "ies"})`);
		}
	}

	private apply(pairs: RenamePair[], accept?: (path: string) => boolean): boolean {
		const ids = renameVaultPaths(this.host.conversations(), pairs, accept);
		const keys = renameSettingsPaths(this.host.settings(), pairs, accept);
		if (ids.length > 0) this.host.conversationsChanged(ids);
		if (keys.length > 0) this.host.settingsChanged(keys);
		return ids.length > 0 || keys.length > 0;
	}
}

/** Load-time validation (principle 1): well-formed entries only, newest kept. */
export function normalizeRenameLog(value: unknown): RenameLogEntry[] {
	if (!Array.isArray(value)) return [];
	const out: RenameLogEntry[] = [];
	for (const e of value) {
		if (!e || typeof e !== "object") continue;
		const { from, to, at } = e as Record<string, unknown>;
		if (typeof from !== "string" || !from || typeof to !== "string" || !to || from === to) continue;
		if (typeof at !== "string" || !at) continue;
		out.push({ from, to, at });
	}
	return out.slice(-RENAME_LOG_LIMIT);
}

/** The union of two logs — memory and disk, after a sync — deduped, in time
 *  order, capped. Neither side's entries are lost to the other's write. */
export function mergeRenameLogs(a: RenameLogEntry[], b: RenameLogEntry[]): RenameLogEntry[] {
	const seen = new Set<string>();
	const out: RenameLogEntry[] = [];
	for (const e of [...a, ...b]) {
		const key = `${e.at}\u0000${e.from}\u0000${e.to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(e);
	}
	out.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
	return out.slice(-RENAME_LOG_LIMIT);
}
