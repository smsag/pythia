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
	/**
	 * Obsidian's own `--keyboard-height` (ADR-165 addendum), 0 when no keyboard is
	 * open. Obsidian mobile sets it from the native keyboard frame and places its
	 * own editing toolbar at `100vh - keyboard-height`, so it is the authoritative
	 * keyboard top on the device. The visual viewport is the browser's estimate
	 * and, on iOS, came up short by about the home indicator: the composer's
	 * bottom row sat under the keyboard by that much once nothing else padded it.
	 */
	keyboardHeight?: number;
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
	const visibleBottom = m.visualOffsetTop + m.visualHeight;
	const byViewport = inset < MIN_KEYBOARD_INSET ? 0 : Math.max(0, m.containerBottom - visibleBottom);
	// Obsidian's number wins when it is the larger: it is where Obsidian itself
	// draws the keyboard's top edge (`.mobile-toolbar { top: calc(100vh -
	// var(--keyboard-height) - …) }`), and it is 0 whenever no keyboard is open,
	// so it can never pad the panel at rest.
	const kb = m.keyboardHeight ?? 0;
	const byKeyboard = kb > 0 ? Math.max(0, m.containerBottom - (m.layoutHeight - kb)) : 0;
	return Math.round(Math.max(byViewport, byKeyboard));
}

/** Obsidian mobile's `--keyboard-height` in CSS px; 0 when unset, absent or not a number. */
export function readKeyboardHeight(): number {
	const raw = getComputedStyle(document.documentElement).getPropertyValue("--keyboard-height");
	const px = parseFloat(raw);
	return Number.isFinite(px) && px > 0 ? px : 0;
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
	const overlap = keyboardOverlap({
		containerBottom: container.getBoundingClientRect().bottom,
		layoutHeight: window.innerHeight,
		visualHeight: vv?.height ?? window.innerHeight,
		visualOffsetTop: vv?.offsetTop ?? 0,
		keyboardHeight: readKeyboardHeight(),
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
	let live = true;
	const handler = () => { if (live) onChange(); };
	vv?.addEventListener("resize", handler);
	vv?.addEventListener("scroll", handler);
	// Obsidian mobile announces the keyboard on `window` and updates
	// `--keyboard-height` alongside; the second call catches a value written
	// after the event, once the show/hide animation has settled (ADR-165 addendum).
	const timers: number[] = [];
	const onKeyboard = () => { handler(); timers.push(window.setTimeout(handler, KEYBOARD_SETTLE_MS)); };
	window.addEventListener("keyboardWillShow", onKeyboard);
	window.addEventListener("keyboardWillHide", onKeyboard);
	// Guarded: a view closed within two frames of opening must not be measured
	// after its disposer ran.
	requestAnimationFrame(() => { handler(); requestAnimationFrame(handler); });
	return () => {
		live = false;
		for (const t of timers) window.clearTimeout(t);
		vv?.removeEventListener("resize", handler);
		vv?.removeEventListener("scroll", handler);
		window.removeEventListener("keyboardWillShow", onKeyboard);
		window.removeEventListener("keyboardWillHide", onKeyboard);
	};
}

/** Obsidian animates the keyboard for 300 ms on iOS; measure again once it has landed. */
export const KEYBOARD_SETTLE_MS = 350;
