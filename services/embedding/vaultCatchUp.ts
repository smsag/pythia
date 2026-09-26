// The once-per-session catch-up of a complete vault index (ADR-221).
//
// The watcher only sees what changes while Pythia runs, and `decideBuild` never
// rescans a complete index. So a note edited on a phone that no longer writes the
// index, a sync that landed before launch, or a note deleted on another device
// kept its old vectors here until it happened to be edited on this device. A
// desktop on a Worker backend caught up by accident — its first send of a session
// ran an incremental sync — but a desktop on the UI-thread fallback (D-38) served
// the file as it was, and neither caught up before the first question.
//
// The catch-up reads and hashes every in-scope note and embeds only the ones whose
// content moved; the model loads only if one did, and the file is written only if
// something changed. Lifted out of `VaultRagService` so its order of steps is
// tested here and the service stays under its size budget.

import type { IndexableNote, VaultIndexService } from "./VaultIndexService";
import type { BuildGuard } from "./buildGuard";
import { isOutOfMemoryError } from "./memoryError";

/** How long after the workspace is up the catch-up starts: well after the related
 *  warm (ADR-169) and the first paint. Both use the one shared provider, so the
 *  model loads once however they overlap. */
export const CATCH_UP_DELAY_MS = 10_000;

/** The UI-thread cadence whatever the backend (ADR-125): nothing is waiting on a
 *  catch-up, and when nothing changed, reading and hashing is its whole cost. */
export const CATCH_UP_THROTTLE = { yieldEveryNotes: 1, breatherMs: 4 };

export interface CatchUpHost {
	/** The index service, constructed if needed — never a loaded model. */
	service(): VaultIndexService;
	scope(): string;
	/** The in-scope notes, read lazily one at a time by the sync. */
	notes(): IndexableNote[];
	modelId(): string;
	guard?: Pick<BuildGuard, "start" | "end"> | null;
	onProgress(done: number, total: number): void;
}

export type CatchUpResult = { ran: true; notes: number } | { ran: false; reason: "incomplete" };

/**
 * Bring a complete index up to date with the vault. An index that is not complete
 * under today's scope is left alone: finishing or re-scoping it is a full build's
 * job, with the notices and the "Build now" that come with one.
 */
export async function catchUpIndex(h: CatchUpHost): Promise<CatchUpResult> {
	const svc = h.service();
	// Read, not hydrate: an index left to a full build must not look ready.
	await svc.loadPersisted();
	const scope = h.scope();
	if (!svc.isComplete(scope)) return { ran: false, reason: "incomplete" };

	const notes = h.notes();
	// Under the crash-loop guard like any automatic build (ADR-199): a catch-up
	// that the OS kills while embedding is the same event as a build that is.
	h.guard?.start(h.modelId());
	try {
		await svc.sync(notes, h.onProgress, CATCH_UP_THROTTLE, scope);
	} catch (e) {
		// Out of memory is one allocation short of a kill, so its marker stays.
		if (!isOutOfMemoryError(e)) h.guard?.end();
		throw e;
	}
	h.guard?.end();
	return { ran: true, notes: notes.length };
}
