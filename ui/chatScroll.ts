/**
 * Where the conversation is scrolled, and who moved it (ADR-215).
 *
 * Bring a card that just appeared in the conversation fully into view.
 *
 * The write-confirmation card used to be scrolled to while it was still EMPTY —
 * `scrollTop = scrollHeight`, then the label and buttons were added — so at rest
 * only its top edge showed and the buttons sat below the fold. The cut-off and
 * rewrite cards were painted under a finished answer with no scroll at all. The
 * rule here: measure the card once it is built, and scroll only as far as it
 * takes for the WHOLE card to show, with a margin.
 *
 * Measured with rects against the scroller rather than `scrollIntoView`, which
 * on iOS scrolls the wrong ancestor (see `scrollToMessage`).
 */

/** The breathing room kept below a revealed card — `--s3`. */
export const REVEAL_MARGIN = 12;

interface Span { top: number; bottom: number }

/**
 * How far to scroll (positive = down) so `card` sits inside `view` with `margin`
 * to spare. Zero when it already does. A card taller than the view shows its
 * top — the label says what the buttons below it are about.
 */
export function revealDelta(view: Span, card: Span, margin = REVEAL_MARGIN): number {
	const room = view.bottom - view.top;
	if (card.bottom - card.top + 2 * margin > room) return card.top - margin - view.top;
	if (card.bottom + margin > view.bottom) return card.bottom + margin - view.bottom;
	if (card.top - margin < view.top) return card.top - margin - view.top;
	return 0;
}

/** Scroll `scroller` so `card` is fully visible. True when it had to move. */
export function revealInScroller(scroller: HTMLElement, card: HTMLElement): boolean {
	const delta = revealDelta(scroller.getBoundingClientRect(), card.getBoundingClientRect());
	if (delta === 0) return false;
	scroller.scrollTop += delta;
	return true;
}

/**
 * The chat's scroll state, lifted out of the view: whether it is FOLLOWING the
 * answer, and the two ways Pythia moves it — to the bottom as tokens arrive,
 * and to reveal a card. Moves Pythia makes are flagged, so the scroll listener
 * can tell them from the user's own and only the user's scroll-up stops the
 * following.
 */
export class ChatScroll {
	/** New content scrolls into view. A user scroll of more than 50px up stops it. */
	following = true;
	private programmatic = false;

	constructor(private readonly scroller: () => HTMLElement) {}

	/** The scroller's `scroll` event. */
	onScroll(): void {
		if (this.programmatic) return;
		const el = this.scroller();
		if (el.scrollHeight - el.scrollTop - el.clientHeight > 50) this.following = false;
	}

	toBottom(force = false): void {
		if (!force && !this.following) return;
		this.move((el) => { el.scrollTop = el.scrollHeight; });
	}

	/** Show a finished card whole. Unforced it only follows a user who is following;
	 *  forced — a card the answer waits on — it is shown regardless, and following
	 *  resumes, since the card is where the answer continues. */
	reveal(card: HTMLElement, force = false): void {
		if (!force && !this.following) return;
		this.move((el) => { revealInScroller(el, card); });
		if (force) this.following = true;
	}

	private move(fn: (el: HTMLElement) => void): void {
		this.programmatic = true;
		fn(this.scroller());
		requestAnimationFrame(() => { this.programmatic = false; });
	}
}
