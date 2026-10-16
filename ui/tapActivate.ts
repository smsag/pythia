/**
 * A tap that opens something in place of the surface it was made on (ADR-258).
 *
 * A control that removes its own surface in its click handler — a conversation
 * row closing the panel — lets the rest of the touch through on iOS. WebKit
 * runs its tap gesture after the synthesized click and hit-tests again, so the
 * tap lands on whatever the closing surface uncovered: the chat text, where it
 * placed a caret, and from there Obsidian reloaded. The command palette opens
 * the same conversation without a tap through, and opened it fine.
 *
 * So on touch the tap is taken where it ends: `touchend` with `preventDefault`,
 * which cancels the synthesized mouse events, the click and WebKit's own tap
 * handling, so nothing of the gesture outlives the surface. A pointer and the
 * keyboard keep the click. A touch that moved is a scroll, never a tap.
 */

/** How far a finger may drift and still be tapping, in CSS pixels. */
export const TAP_MOVE_TOLERANCE_PX = 10;

/** A click this soon after a touch tap is that tap's own echo, never a second one. */
export const TAP_CLICK_ECHO_MS = 800;

export interface TapOptions {
	/** Asked at the moment of the tap; false swallows it (a long-press just fired, the list is still scrolling). */
	allow?: () => boolean;
	/** For tests. */
	now?: () => number;
}

/** Call `onTap` on a tap or a click of `el`; the element is transient, so its listeners go with it. */
export function attachTap(el: HTMLElement, onTap: () => void, opts: TapOptions = {}): void {
	const allow = opts.allow ?? (() => true);
	const now = opts.now ?? (() => Date.now());
	let start: { x: number; y: number } | null = null;
	let tappedAt = -Infinity;

	const point = (e: Event): { x: number; y: number } | null => {
		const t = (e as TouchEvent).touches?.[0] ?? (e as TouchEvent).changedTouches?.[0];
		return t ? { x: t.clientX, y: t.clientY } : null;
	};

	el.addEventListener("touchstart", (e: Event) => {
		const touches = (e as TouchEvent).touches;
		// A second finger is a pinch, not a tap.
		start = touches && touches.length > 1 ? null : (point(e) ?? { x: 0, y: 0 });
	}, { passive: true });
	el.addEventListener("touchmove", (e: Event) => {
		if (!start) return;
		const p = point(e);
		if (p && Math.hypot(p.x - start.x, p.y - start.y) > TAP_MOVE_TOLERANCE_PX) start = null;
	}, { passive: true });
	el.addEventListener("touchcancel", () => { start = null; }, { passive: true });
	el.addEventListener("touchend", (e: Event) => {
		if (!start) return;
		start = null;
		// Cancelled whether or not it opens: a long-press that showed its menu
		// must not be followed by a click that opens the row underneath.
		e.preventDefault();
		tappedAt = now();
		if (allow()) onTap();
	}, { passive: false });
	el.addEventListener("click", () => {
		if (now() - tappedAt < TAP_CLICK_ECHO_MS) return;
		if (allow()) onTap();
	});
}
