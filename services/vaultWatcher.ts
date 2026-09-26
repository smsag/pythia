import { debounce, TFile, type EventRef, type TAbstractFile, type Vault, type Workspace } from "obsidian";

/**
 * Keeping the vault index fresh (ADR-121), lifted out of `main.ts`
 * (engineering-review #366).
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
 *
 * The note being written is held back (ADR-219). Every autosave is a `modify`,
 * so a note someone is typing in used to be re-embedded — and the whole index
 * rewritten — every couple of seconds, on a phone right next to the editor, and
 * that is what reloaded Obsidian mid-sentence. It now reaches the index when the
 * writer leaves it, or once they have stopped for `VAULT_HOLD_IDLE_MS`.
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
	 *  never hand the same edit to `applyChanges` twice.
	 *
	 *  `hold` names the note being written: its edit stays in the batch for a
	 *  later drain (ADR-219). Only an edit is held — a deleted note has nobody
	 *  writing in it, and keeping it in the index would serve a file that is gone. */
	take(hold: string | null = null): { changed: F[]; deleted: string[] } {
		const kept = hold === null ? undefined : this.changed.get(hold);
		const out = {
			changed: [...this.changed.values()].filter((f) => f !== kept),
			deleted: [...this.deleted],
		};
		this.changed.clear();
		this.deleted.clear();
		if (kept) this.changed.set(kept.path, kept);
		return out;
	}
}

/** How long the vault must be quiet before a burst of edits reaches the index.
 *  A real quiet window since ADR-219: every event restarts it. Obsidian's
 *  `debounce` without `resetTimer` fires this long after the FIRST call, so a
 *  burst that kept going was flushed every two seconds for as long as it lasted. */
export const VAULT_FLUSH_DELAY_MS = 2000;

/** How long the note being written may sit unembedded once its writer has
 *  stopped (ADR-219). Long enough that a pause to think is not a flush, short
 *  enough that a note left open on screen is found by the next question. */
export const VAULT_HOLD_IDLE_MS = 30_000;

export interface VaultWatcherHost {
	app: { vault: Vault; workspace?: Pick<Workspace, "on"> };
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
	/** A note or folder moved: stored paths follow it (ADR-218). Runs at once,
	 *  not with the debounced flush — a tap on a chip must not open the old path
	 *  in the two seconds after a rename. */
	followRename(oldPath: string, newPath: string): void;
	/** The note being written, whose edits are held back (ADR-219). Absent: no
	 *  note is held, as before. */
	activePath?(): string | null;
	delayMs?: number;
	holdIdleMs?: number;
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
	const drain = (hold: string | null): void => {
		if (batch.empty) return;
		const { changed, deleted } = batch.take(hold);
		if (changed.length > 0 || deleted.length > 0) deps.applyChanges(changed, deleted);
	};
	// Nothing is held back any more: the writer has gone quiet for long enough.
	const release = debounce(() => drain(null), deps.holdIdleMs ?? VAULT_HOLD_IDLE_MS, true);
	const flush = debounce(() => drain(deps.activePath?.() ?? null), deps.delayMs ?? VAULT_FLUSH_DELAY_MS, true);
	host.register(() => { flush.cancel(); release.cancel(); });

	// Leaving a note is the moment it is finished for now: it goes to the index at
	// once, and the note now open is the one held.
	const workspace = host.app.workspace;
	if (workspace) host.registerEvent(workspace.on("file-open", () => {
		if (batch.empty) return;
		flush.cancel();
		drain(deps.activePath?.() ?? null);
		// A note that arrived edited (a sync) and is now the one open is held from
		// here, on the same quiet clock as one being typed in.
		if (batch.empty) release.cancel();
		else release();
	}));

	// Non-markdown is dropped before the glossary is consulted, as it was inline:
	// a glossary note is always a note, so nothing else can invalidate the cache.
	const markChanged = (file: TFile): void => {
		if (!batch.markChanged(file)) return;
		deps.invalidateGlossary(file.path);
		flush();
		// The quiet clock for the held note restarts with every keystroke's save, so
		// it can never run out while the writer is still going.
		if (deps.activePath && file.path === deps.activePath()) release();
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
		deps.followRename(oldPath, f.path);
		deps.invalidateGlossary(oldPath);
		batch.markDeleted(oldPath);
		if (f instanceof TFile) markChanged(f);
		else flush();
	}));

	return batch;
}
