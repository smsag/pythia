/**
 * How far the soft keyboard covers the plugin panel (ADR-132).
 *
 * Pure arithmetic, deliberately separated from the view so the rule can be
 * unit-tested: the browser APIs it reasons about (`visualViewport`, the soft
 * keyboard) cannot be exercised headlessly, and this is the part that was wrong.
 */

/**
 * Minimum shrink of the visual viewport that counts as "a keyboard is open",
 * in CSS px.
 *
 * The visual viewport shrinks for several reasons, and only one of them is an
 * obstruction the panel must move out of the way for. A soft keyboard is at
 * least ~250px tall on any phone, while Obsidian's own bottom chrome and the
 * home indicator account for a few tens of pixels. Anything under this
 * threshold is therefore not a keyboard, and the panel is left alone — the home
 * indicator is already handled by the input area's `env(safe-area-inset-bottom)`
 * padding, which is a hard rule of this project.
 */
export const MIN_KEYBOARD_INSET = 120;

export interface ViewportMetrics {
	/** `getBoundingClientRect().bottom` of the plugin's content pane. */
	containerBottom: number;
	/** `window.innerHeight` — the layout viewport, which the keyboard does not shrink. */
	layoutHeight: number;
	/** `visualViewport.height` — shrinks when the keyboard opens. */
	visualHeight: number;
	/** `visualViewport.offsetTop` — non-zero only while pinch-zoomed or scrolled. */
	visualOffsetTop: number;
}

/**
 * CSS px of the panel that the keyboard currently covers, or 0 when it covers
 * nothing.
 *
 * Returning 0 is the common case and must stay the common case: with no
 * keyboard open the panel should be left exactly as the layout made it. The
 * previous implementation skipped this test and applied the same arithmetic at
 * rest, which "corrected" for Obsidian's own chrome below the panel. In a
 * stacked mobile sidebar that chrome is not covering the panel at all, so the
 * correction removed height the panel actually needed and left a dead strip of
 * uncovered leaf beneath it.
 */
export function keyboardOverlap(m: ViewportMetrics): number {
	const inset = m.layoutHeight - (m.visualHeight + m.visualOffsetTop);
	if (inset < MIN_KEYBOARD_INSET) return 0;
	const visibleBottom = m.visualOffsetTop + m.visualHeight;
	return Math.max(0, Math.round(m.containerBottom - visibleBottom));
}

/**
 * DOM-facing shell over `keyboardOverlap`: reads the live viewport for
 * `container` and returns how much of it the keyboard covers, 0 when there is
 * no keyboard or no `visualViewport` support.
 */
export function currentKeyboardOverlap(container: HTMLElement): number {
	const vv = window.visualViewport;
	if (!vv) return 0;
	return keyboardOverlap({
		containerBottom: container.getBoundingClientRect().bottom,
		layoutHeight: window.innerHeight,
		visualHeight: vv.height,
		visualOffsetTop: vv.offsetTop,
	});
}
