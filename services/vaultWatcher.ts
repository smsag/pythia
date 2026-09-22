import { debounce, TFile, type EventRef, type TAbstractFile, type Vault } from "obsidian";

/**
 * Keeping the vault index fresh (ADR-121), lifted out of `main.ts`
 * (engineering-review #358).
 *
 * The watcher is EVENT-DRIVEN and targeted: an edit re-embeds that one note
 * instead of rescanning the corpus. Changed and deleted paths are batched and
 * flushed on a debounce, so a burst of edits — a sync landing twenty files, a
 * find-and-replace across a folder — coalesces into one `applyChanges`.
 *
 * The batching is the part with rules, so it lives in `VaultChangeBatch`, free of
 * Obsidian and unit-tested: a path is in exactly one of the two sets, the last
 * event about it wins, and a rename is a delete of the old path plus a change of
 * the new one. Getting that wrong is silent — the index keeps serving a note that
 * no longer exists, or forgets one that does — which is exactly the shape of bug
 * `main.ts`'s exclusion from coverage was hiding.
 */

/** The part of `TFile` the batch needs. Keeps the rules testable without a vault. */
export interface WatchedFile {
	path: string;
	extension: string;
}

/** Changed and deleted paths since the last flush.
 *
 *  A path belongs to exactly ONE side: re-creating a note that was deleted in the
 *  same window must not also delete it, and deleting one that was edited must not
 *  also re-embed it. The last event about a path is the truth, so each `mark*`
 *  removes the path from the other side. */
export class VaultChangeBatch<F extends WatchedFile = WatchedFile> {
	private readonly changed = new Map<string, F>();
	private readonly deleted = new Set<string>();

	/** Record an edit. Returns whether it was taken: only markdown is indexed, so
	 *  anything else is not a change to the index — and the caller uses the answer
	 *  to decide whether a flush is owed. */
	markChanged(file: F): boolean {
		if (file.extension !== "md") return false;
		this.changed.set(file.path, file);
		this.deleted.delete(file.path);
		return true;
	}

	markDeleted(path: string): void {
		this.deleted.add(path);
		this.changed.delete(path);
	}

	get empty(): boolean {
		return this.changed.size === 0 && this.deleted.size === 0;
	}

	/** Drain the batch. Emptied here rather than by the caller, so a flush can
	 *  never hand the same edit to `applyChanges` twice. */
	take(): { changed: F[]; deleted: string[] } {
		const out = { changed: [...this.changed.values()], deleted: [...this.deleted] };
		this.changed.clear();
		this.deleted.clear();
		return out;
	}
}

/** How long a burst of edits is allowed to coalesce before the index sees it. */
export const VAULT_FLUSH_DELAY_MS = 2000;

export interface VaultWatcherHost {
	app: { vault: Vault };
	/** Obsidian's own registration, so every listener dies with the plugin. */
	registerEvent(ref: EventRef): void;
	/** Teardown for the pending debounce. */
	register(cleanup: () => void): void;
}

export interface VaultWatcherDeps {
	/** Hand the batch to the vault index. No-ops until the index is built, so this
	 *  never eagerly loads the model (a full build happens on a turn). */
	applyChanges(changed: TFile[], deleted: string[]): void;
	/** A glossary note changed or vanished: drop the cached entries so editing one
	 *  by hand takes effect without a reload, and a deleted term stops marking
	 *  itself now rather than at the next edit (ADR-136). */
	invalidateGlossary(path: string): void;
	delayMs?: number;
}

/**
 * Register the vault listeners. One call from `onload`; everything it creates is
 * registered for teardown — a flush still pending at unload would otherwise run
 * against a torn-down provider.
 *
 * The batch is returned so a caller (a test, a future diagnostic) can inspect it;
 * nothing in the plugin needs to.
 */
export function registerVaultWatcher(host: VaultWatcherHost, deps: VaultWatcherDeps): VaultChangeBatch<TFile> {
	const vault = host.app.vault;
	const batch = new VaultChangeBatch<TFile>();
	const flush = debounce(() => {
		if (batch.empty) return;
		const { changed, deleted } = batch.take();
		deps.applyChanges(changed, deleted);
	}, deps.delayMs ?? VAULT_FLUSH_DELAY_MS);
	host.register(() => flush.cancel());

	// Non-markdown is dropped before the glossary is consulted, as it was inline:
	// a glossary note is always a note, so nothing else can invalidate the cache.
	const markChanged = (file: TFile): void => {
		if (!batch.markChanged(file)) return;
		deps.invalidateGlossary(file.path);
		flush();
	};
	const onEdit = (f: TAbstractFile): void => { if (f instanceof TFile) markChanged(f); };

	host.registerEvent(vault.on("modify", onEdit));
	host.registerEvent(vault.on("create", onEdit));
	host.registerEvent(vault.on("delete", (f) => {
		if (!(f instanceof TFile)) return;
		deps.invalidateGlossary(f.path);
		batch.markDeleted(f.path);
		flush();
	}));
	host.registerEvent(vault.on("rename", (f, oldPath) => {
		deps.invalidateGlossary(oldPath);
		batch.markDeleted(oldPath);
		if (f instanceof TFile) markChanged(f);
		else flush();
	}));

	return batch;
}
