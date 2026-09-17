/**
 * Warming the related-conversations index in the background (ADR-169).
 *
 * The first click on "related" used to pay for the whole index: a cold vault is
 * embedded from scratch before anything can be ranked. Measured with
 * `scripts/measure-related.mjs` on a 24-conversation vault, 554 chunks took 135s
 * through onnxruntime-node — about 4 chunks/second. Extrapolated to 200
 * conversations that is ~19 minutes, and the app runs WASM rather than the
 * native runtime, so slower still. At that size the first click is not slow, it
 * is unusable.
 *
 * Lives here rather than in `main.ts` for two reasons: the plugin entry point is
 * lifecycle wiring, and the guards below are exactly the kind of rule that
 * should fail a test rather than be re-read (`main.ts` is excluded from coverage).
 */

/** Whether a background warm is allowed to run at all.
 *
 * Each guard is load-bearing:
 *
 *  • **An index must already exist.** A missing `.bin` means the model has never
 *    been downloaded, and starting a ~100 MB download nobody asked for, at
 *    launch, is not a warm — it is a surprise.
 *  • **Desktop only.** The iframe fallback runs inference on the UI thread, and
 *    that is what mobile gets wherever `blob:` Workers are blocked (ADR-126).
 *    Janking the app at launch to precompute something the user may never open
 *    is the wrong trade on a phone.
 *  • **Two conversations minimum.** Relatedness needs a pair; below that there
 *    is nothing to rank and nothing to warm.
 */
export function shouldWarmIndex(o: {
	isMobile: boolean;
	conversationCount: number;
	hasIndex: boolean;
}): boolean {
	return canWarmBeforeIndexCheck(o) && o.hasIndex;
}

/** The half of the rule that can be answered WITHOUT touching the disk.
 *
 *  Split out rather than duplicated: `warmIndex` needs to bail before asking the
 *  adapter whether an index exists, and a guard stated in two places is a guard
 *  that drifts (one builder per fact). */
export function canWarmBeforeIndexCheck(o: { isMobile: boolean; conversationCount: number }): boolean {
	if (o.isMobile) return false;
	return o.conversationCount >= 2;
}

export interface WarmIndexDeps {
	isMobile: boolean;
	conversationCount: number;
	/** Whether an index has already been built. Deliberately a boolean rather than
	 *  the index itself: reading several megabytes to answer a yes/no question was
	 *  the first version's bug. */
	hasIndex(): Promise<boolean>;
	/** Bring the index in line with the current conversations. */
	sync(): Promise<void>;
	log(message: string, data?: Record<string, unknown>): void;
}

/**
 * Run the warm if the guards allow it.
 *
 * Fail-open and silent throughout: nothing here was user-requested, so nothing
 * here interrupts. A failure only costs the next click the time it would have
 * cost anyway, which is why it goes to the debug log and never to a `Notice` —
 * the one place in this codebase where silence is the right answer, and it is
 * named here rather than left to be inferred (principle 2).
 */
export async function warmIndex(d: WarmIndexDeps): Promise<void> {
	// The cheap half of the rule first, so a phone never touches the adapter.
	if (!canWarmBeforeIndexCheck(d)) return;
	try {
		if (!shouldWarmIndex({ ...d, hasIndex: await d.hasIndex() })) {
			d.log("related: warm skipped (no index yet)");
			return;
		}
		const startedAt = Date.now();
		await d.sync();
		d.log(`related: warm ok (${Date.now() - startedAt}ms)`, { conversations: d.conversationCount });
	} catch (e) {
		d.log("related: warm failed", { error: e instanceof Error ? e.message : String(e) });
	}
}

/** How long after layout-ready the warm starts. Long enough that it never sits
 *  between the user and a drawn workspace; short enough to be done before a
 *  first click. */
export const WARM_DELAY_MS = 3000;

/**
 * Schedule the warm, and make sure it dies with the plugin.
 *
 * The timer is registered for teardown rather than left loose: a plugin disabled
 * inside the delay would otherwise run the warm against a torn-down instance,
 * reaching settings, the vault adapter and services that have already been
 * nulled. Takes `register` rather than a Plugin so the module stays free of
 * Obsidian and this stays testable.
 */
export function scheduleWarm(o: {
	run: () => void;
	register(cleanup: () => void): void;
	delayMs?: number;
}): void {
	const id = setTimeout(o.run, o.delayMs ?? WARM_DELAY_MS);
	o.register(() => clearTimeout(id));
}
