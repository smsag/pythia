// The crash-loop breaker for the vault index build (ADR-199).
//
// When the OS kills the process mid-build (iOS: `jetsam per-process-limit`), no
// catch runs and nothing is logged by us — the next thing that happens is a
// fresh Obsidian, an unfinished index, and the next send starting the same build
// again. That was a reload every minute or two. The only witness that survives
// the kill is something written BEFORE the build started, so a marker is saved
// at the start and removed at the end; finding it at the next start means the
// last build never reached its end.
//
// Stored per device (Obsidian's vault-scoped localStorage), never in data.json:
// the marker describes THIS device's crash, and a synced copy would pause the
// build on a desktop that never crashed.

/** How many builds in a row may die before the next one waits for the user. Two,
 *  not one: iOS also ends backgrounded apps and the user swipes Obsidian away,
 *  and a single interruption like that should resume on its own. */
export const MAX_INTERRUPTED_BUILDS = 2;

export interface BuildMarker {
	/** Consecutive builds that started and never recorded an end. */
	attempts: number;
	/** When the most recent of them started (ms since epoch). */
	startedAt: number;
	/** The model it was loading — the likeliest suspect when it was a crash. */
	modelId: string;
}

/** Where the marker lives. Obsidian's `app.loadLocalStorage`/`saveLocalStorage`
 *  in production; a plain object in tests. `save(null)` removes it. */
export interface BuildMarkerStore {
	load(): unknown;
	save(marker: BuildMarker | null): void;
}

/** Validate a stored marker (principle 1): anything malformed reads as "no marker",
 *  which lets the build run — the cost of a bad read is one more attempt, never a
 *  build that can no longer start. */
export function parseBuildMarker(raw: unknown): BuildMarker | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const attempts = r.attempts;
	if (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 1) return null;
	return {
		attempts,
		startedAt: typeof r.startedAt === "number" && Number.isFinite(r.startedAt) ? r.startedAt : 0,
		modelId: typeof r.modelId === "string" ? r.modelId : "",
	};
}

/** Whether an AUTOMATIC build may start. A build the user asks for always may. */
export function mayAutoBuild(marker: BuildMarker | null): boolean {
	return (marker?.attempts ?? 0) < MAX_INTERRUPTED_BUILDS;
}

/** The marker to save as a build starts. */
export function markBuildStarted(prior: BuildMarker | null, now: number, modelId: string): BuildMarker {
	return { attempts: (prior?.attempts ?? 0) + 1, startedAt: now, modelId };
}

/** The persistence around one build: `start` before any model work, `end` when the
 *  build finished OR failed inside JavaScript (a caught error is not a crash). */
export class BuildGuard {
	constructor(private readonly store: BuildMarkerStore, private readonly now: () => number = Date.now) {}

	private read(): BuildMarker | null {
		try {
			return parseBuildMarker(this.store.load());
		} catch {
			// A storage that throws on read has not told us a build died; see
			// parseBuildMarker for why unknown means "may build".
			return null;
		}
	}

	/** The interrupted-build record, or null when the last build ended normally. */
	marker(): BuildMarker | null {
		return this.read();
	}

	mayAutoBuild(): boolean {
		return mayAutoBuild(this.read());
	}

	start(modelId: string): void {
		this.write(markBuildStarted(this.read(), this.now(), modelId));
	}

	end(): void {
		this.write(null);
	}

	private write(marker: BuildMarker | null): void {
		try {
			this.store.save(marker);
		} catch (e) {
			// Not silent (principle 2): without the marker the breaker cannot see
			// the next crash, so the log must say it is blind.
			console.warn("[Pythia] vault RAG: could not save the build marker — crash-loop protection is off", e);
		}
	}
}

/** localStorage key of the vault-index marker. */
const VAULT_BUILD_MARKER_KEY = "pythia-vault-index-build";

/** The vault index's guard, on Obsidian's vault-scoped, per-device localStorage —
 *  never data.json, which syncs (see the header). */
export function vaultBuildGuard(app: {
	loadLocalStorage(key: string): unknown;
	saveLocalStorage(key: string, data: unknown): void;
}): BuildGuard {
	return new BuildGuard({
		load: () => app.loadLocalStorage(VAULT_BUILD_MARKER_KEY),
		save: (marker) => app.saveLocalStorage(VAULT_BUILD_MARKER_KEY, marker),
	});
}
