// A clock that stops while Obsidian is in the background (ADR-202).
//
// iOS freezes a backgrounded app within seconds, the embedding Worker with it.
// The embedding providers' timeouts were wall-clock: the load deadline compared
// `Date.now()` against a start time, and each request armed a one-shot
// `setTimeout`. Come back after six minutes during a first model download and the
// load "timed out" at once — a rejection `FallbackEmbeddingProvider` then
// memoized, leaving embedding dead for the session. A timeout should measure time
// the work could actually run, which is visible time.
//
// Fed by the ONE `visibilitychange` handler (services/embedding/residency.ts).
// Pure apart from the injected `now`, so it is tested with a fake clock.

/** Floor on the poll interval — see `timeout`. */
const MIN_POLL_MS = 50;

export class VisibleClock {
	private hiddenSince: number | null = null;
	private hiddenTotal = 0;

	constructor(private readonly now: () => number = Date.now) {}

	/** Record a visibility change. Repeated calls with the same state are no-ops. */
	note(hidden: boolean): void {
		const t = this.now();
		if (hidden && this.hiddenSince === null) this.hiddenSince = t;
		else if (!hidden && this.hiddenSince !== null) {
			this.hiddenTotal += t - this.hiddenSince;
			this.hiddenSince = null;
		}
	}

	/** Milliseconds of VISIBLE time since the clock's origin — frozen while hidden. */
	elapsed(): number {
		const t = this.now();
		const hiddenNow = this.hiddenSince === null ? 0 : t - this.hiddenSince;
		return t - this.hiddenTotal - hiddenNow;
	}

	/**
	 * Call `fire` once `ms` of visible time has passed. Polls, because a one-shot
	 * timer cannot be paused: on resume an overdue timer fires immediately, which is
	 * the bug. Returns the cancel function.
	 */
	timeout(fire: () => void, ms: number, pollMs = Math.min(1_000, ms)): () => void {
		// Never 0: `setInterval(…, 0)` is a spin, and a deadline of 0 is a caller
		// mistake rather than a reason to burn the thread the timeout protects.
		const poll = Math.max(MIN_POLL_MS, pollMs);
		const start = this.elapsed();
		const handle = setInterval(() => {
			if (this.elapsed() - start >= ms) {
				clearInterval(handle);
				fire();
			}
		}, poll);
		return () => clearInterval(handle);
	}
}

/** The process-wide clock both embedding providers measure their timeouts on. */
export const visibleClock = new VisibleClock();
