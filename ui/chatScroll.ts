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

	/** Jump to the top and stop following — twice, the second after layout, so
	 *  content that renders in late cannot push the view off the top. */
	toTop(): void {
		this.following = false;
		const el = this.scroller();
		el.scrollTo({ top: 0, behavior: "instant" });
		requestAnimationFrame(() => { this.scroller().scrollTo({ top: 0, behavior: "instant" }); });
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

/** The gap kept above a jump target — the 8px every jump used before (ADR-216). */
export const JUMP_GAP = 8;
/** What floats over the top of the chat. Only the pinned strip does (ADR-216). */
const COVER_SELECTOR = ".p-pins";

/** How much of the scroller's top edge an overlay covers right now — measured,
 *  so an expanded pin counts for its full height and a hidden one for nothing. */
export function coveredTop(scroller: HTMLElement): number {
	const cover = scroller.parentElement?.querySelector<HTMLElement>(COVER_SELECTOR);
	if (!cover || cover.hidden) return 0;
	return Math.max(0, cover.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top);
}

/**
 * The ONE "jump to" scroll: put `target` (an element in the chat, or a content
 * offset) at the top of what is visible — `JUMP_GAP` below whatever floats over
 * the chat's top edge (ADR-216). Five surfaces hand-rolled `offsetTop - 8`, and
 * each would have landed its target under the pinned strip.
 *
 * Rects and offsets against the scroller, never `scrollIntoView`, which on iOS
 * scrolls the wrong ancestor and centres a long message's start out of view.
 */
export function scrollChatTo(scroller: HTMLElement, target: HTMLElement | number, smooth = true): void {
	const top = typeof target === "number" ? target : target.offsetTop - scroller.offsetTop;
	scroller.scrollTo({ top: Math.max(0, top - JUMP_GAP - coveredTop(scroller)), behavior: smooth ? "smooth" : "instant" });
}
