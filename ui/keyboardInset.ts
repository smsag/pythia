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

/** Slack allowed when deciding whether the panel touches the screen edge, in
 *  CSS px — enough for sub-pixel layout and a hairline border. */
export const BOTTOM_EDGE_TOLERANCE = 4;

/**
 * Whether the panel really reaches the bottom of the screen, and therefore has a
 * home indicator to clear (ADR-134).
 *
 * `env(safe-area-inset-bottom)` reports the device's inset regardless of where
 * the element sits, so CSS alone cannot tell "I am the bottom-most thing on
 * screen" from "there is another leaf below me". Only a measurement can, and
 * without it the input area reserved that inset as dead space in a stacked
 * sidebar.
 */
export function needsBottomSafeArea(containerBottom: number, layoutHeight: number): boolean {
	return containerBottom >= layoutHeight - BOTTOM_EDGE_TOLERANCE;
}

/**
 * Apply both viewport-derived insets to the plugin's content pane.
 *
 * Kept together because both are driven by the same events (viewport resize and
 * scroll, focus, blur, open) and both are pure measurement applied as style:
 *
 *  - `padding-bottom` lifts content clear of an open soft keyboard, and is
 *    removed the moment there is no keyboard (ADR-132).
 *  - `--p-bottom-inset` switches the input area's home-indicator padding off
 *    when the panel does not actually reach the screen edge (ADR-134).
 *
 * Both properties are cleared before measuring, so repeated calls are idempotent
 * and a pane left styled by an older build heals on the next event.
 */
export function updateViewportInsets(container: HTMLElement): void {
	container.style.paddingBottom = "";
	container.style.height = "";
	const vv = window.visualViewport;
	if (!vv) return;
	const containerBottom = container.getBoundingClientRect().bottom;

	if (needsBottomSafeArea(containerBottom, window.innerHeight)) {
		container.style.removeProperty("--p-bottom-inset");
	} else {
		container.style.setProperty("--p-bottom-inset", "0px");
	}

	const overlap = keyboardOverlap({
		containerBottom,
		layoutHeight: window.innerHeight,
		visualHeight: vv.height,
		visualOffsetTop: vv.offsetTop,
	});
	// Padding, not height: the panel keeps filling and painting its leaf, so
	// nothing is uncovered and `overflow: hidden` has nothing to crop.
	if (overlap > 0) container.style.paddingBottom = `${overlap}px`;
}
