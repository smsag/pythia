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
	if (o.isMobile) return false;
	if (!o.hasIndex) return false;
	return o.conversationCount >= 2;
}

export interface WarmIndexDeps {
	isMobile: boolean;
	conversationCount: number;
	/** The persisted index, or null when none has been built yet. */
	readIndex(): Promise<ArrayBuffer | null>;
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
	if (d.isMobile || d.conversationCount < 2) return;
	try {
		const hasIndex = (await d.readIndex()) !== null;
		if (!shouldWarmIndex({ isMobile: d.isMobile, conversationCount: d.conversationCount, hasIndex })) {
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
