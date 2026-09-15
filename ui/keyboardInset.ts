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
 * threshold is therefore not a keyboard, and the panel is left alone. (That
 * last sentence used to add "the home indicator is handled by the input area's
 * `env(safe-area-inset-bottom)` padding" — there is no such padding any more,
 * see ADR-146.)
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
 * Lift the plugin's content pane clear of an open soft keyboard (ADR-132).
 *
 * This used to do two jobs; the second — switching the input area's
 * home-indicator padding off when the panel does not reach the screen edge —
 * is gone with the padding itself (ADR-146). What remains is the one that was
 * never in doubt.
 *
 * The properties are cleared before measuring, so repeated calls are idempotent
 * and a pane left styled by an older build heals on the next event.
 */
export function updateViewportInsets(container: HTMLElement): void {
	container.style.paddingBottom = "";
	container.style.height = "";
	container.style.removeProperty("--p-bottom-inset"); // left by builds ≤ 2.12.0
	const vv = window.visualViewport;
	if (!vv) return;

	const overlap = keyboardOverlap({
		containerBottom: container.getBoundingClientRect().bottom,
		layoutHeight: window.innerHeight,
		visualHeight: vv.height,
		visualOffsetTop: vv.offsetTop,
	});
	// Padding, not height: the panel keeps filling and painting its leaf, so
	// nothing is uncovered and `overflow: hidden` has nothing to crop.
	if (overlap > 0) container.style.paddingBottom = `${overlap}px`;
}

/**
 * Call `onChange` whenever the viewport changes, and once on mount.
 *
 * Returns a disposer. The `visualViewport` listeners are added directly rather
 * than through Obsidian's `registerDomEvent`, which does not accept a
 * `VisualViewport` target, so the caller must dispose on unload.
 *
 * The double `requestAnimationFrame` is not superstition: iOS WKWebView applies
 * safe-area insets after the first paint, so a single frame can measure a panel
 * whose insets are not settled yet.
 *
 * NOTE for callers: this covers viewport changes only. The panel's bottom edge
 * also moves when leaves open, close or resize, and none of those fire a
 * `visualViewport` event — subscribe to the workspace separately (ADR-134).
 * That mattered more when the bottom inset was conditional; it still matters for
 * a keyboard open across a layout change.
 */
export function watchViewport(onChange: () => void): () => void {
	const vv = window.visualViewport;
	if (!vv) return () => { /* no viewport API: nothing to watch or dispose */ };
	const handler = () => onChange();
	vv.addEventListener("resize", handler);
	vv.addEventListener("scroll", handler);
	requestAnimationFrame(() => { onChange(); requestAnimationFrame(onChange); });
	return () => {
		vv.removeEventListener("resize", handler);
		vv.removeEventListener("scroll", handler);
	};
}
