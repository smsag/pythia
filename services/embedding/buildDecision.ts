// Whether a vault-index build may start, and what it must reset first (ADR-203).
//
// The head of `VaultRagService.refresh` had grown into six interacting flags —
// force, manual, clear, a complete index, the crash-loop guard and a previous
// failure — and two bugs were living in exactly that tangle (#358, #359). It is
// a decision, not an effect, so it is made here and tested as a table.
//
// The rule that is new: an AUTOMATIC build does not retry a load that already
// failed in this session. `FallbackEmbeddingProvider` memoizes its rejection
// (deliberately — an out-of-memory load must not be hammered), so every send
// after a failed load re-entered the build, failed in a millisecond, and left
// another interrupted-build marker behind. Two sends after ONE out-of-memory
// load were enough to report "the last 2 builds ended without finishing" and
// pause a build that had only ever failed once. Only a manual build — which
// unloads the provider first — or a new session can clear it.

/** Why a build did not start. */
export type BuildBlock =
	| "busy"        // one is already running
	| "complete"    // the index is finished under today's scope
	| "paused"      // the guard: too many builds died (ADR-199)
	| "loadFailed"; // the model failed to load in this session (see the header)

export interface BuildRequest {
	/** Build even though the index is complete (a rebuild, or "Build now"). */
	force?: boolean;
	/** The user pressed a button; nothing about the session's history blocks it. */
	manual?: boolean;
}

export interface BuildFacts {
	/** A build is already running. */
	syncing: boolean;
	/** The index is complete under today's scope. */
	complete: boolean;
	/** The crash-loop guard allows an automatic build (true when there is none). */
	mayAutoBuild: boolean;
	/** The last attempt in this session failed while LOADING the model — as
	 *  opposed to during the build, where the model is known to be good. */
	loadFailed: boolean;
}

export type BuildDecision =
	| { run: false; blocked: BuildBlock }
	/** `reloadProvider`: drop the provider's memoized rejection before loading,
	 *  so the user's press really loads again (#357). Only after a failed LOAD —
	 *  a build that failed with a healthy model would otherwise pay for a full
	 *  reload (on the desktop, terminating the Worker and reparsing the model). */
	| { run: true; reloadProvider: boolean };

export function decideBuild(req: BuildRequest, facts: BuildFacts): BuildDecision {
	if (facts.syncing) return { run: false, blocked: "busy" };
	// A COMPLETE index is kept fresh by the watcher's targeted `applyChanges`
	// (ADR-121), so re-running a whole-corpus scan on every turn re-paid the exact
	// cost that ADR removed: reading, chunking and hashing every in-scope note, on
	// the host thread, per send — plus a "Building the vault index…" notice
	// flashing each time. A rebuild and "Build now" pass `force`; a scope change
	// makes `complete` false on its own, so narrowing the folders still rebuilds
	// instead of leaving the notes outside them retrievable (ADR-184).
	if (!req.force && facts.complete) return { run: false, blocked: "complete" };
	if (!req.manual && !facts.mayAutoBuild) return { run: false, blocked: "paused" };
	if (!req.manual && facts.loadFailed) return { run: false, blocked: "loadFailed" };
	return { run: true, reloadProvider: Boolean(req.manual) && facts.loadFailed };
}
