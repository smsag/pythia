/**
 * Long-press gesture — one implementation for touch and mouse.
 *
 * Three surfaces needed the same 450 ms press-and-hold (the Send button's
 * summary menu, the fork anchor's Open control, and now the merge anchor), and
 * each had hand-rolled the same seven listeners plus the same cancel-on-
 * move/leave rules. This centralizes the gesture so the timing and the cancel
 * cases can't drift apart between them — and, unlike the inline versions, it is
 * unit-testable without mounting a view.
 *
 * Two binding modes, because the call sites differ in how they clean up:
 *   - with `bind` (the view's `registerDomEvent`): Obsidian removes the
 *     listeners on unload, so the returned cleanup only cancels a pending timer;
 *   - without it: listeners are added directly and the returned cleanup removes
 *     every one of them, for surfaces that re-attach on rebuild.
 */

export const LONG_PRESS_MS = 450;

type Binder = (
	el: HTMLElement,
	type: string,
	callback: (ev: Event) => void,
	options?: boolean | AddEventListenerOptions,
) => void;

export interface LongPressOptions {
	/** Hold duration before firing. Defaults to LONG_PRESS_MS. */
	delayMs?: number;
	/** Obsidian's `registerDomEvent`; when given, listeners are auto-removed by it. */
	bind?: Binder;
}

/**
 * Fire `onFire` when `el` is pressed and held. Returns a cleanup function:
 * always safe to call, always cancels a pending press.
 */
export function attachLongPress(
	el: HTMLElement,
	onFire: () => void,
	{ delayMs = LONG_PRESS_MS, bind }: LongPressOptions = {},
): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;

	const cancel = () => {
		if (timer !== null) { clearTimeout(timer); timer = null; }
	};
	const start = () => {
		cancel();
		timer = setTimeout(() => { timer = null; onFire(); }, delayMs);
	};
	// Left button only — a right-click opens a context menu, and a middle-click
	// press should not arm a gesture the user can't see.
	const onMouseDown = (e: Event) => { if ((e as MouseEvent).button === 0) start(); };
	const onTouchStart = () => start();

	// touchmove cancels so a scroll that begins on the control never fires it.
	const listeners: [string, (ev: Event) => void, AddEventListenerOptions?][] = [
		["touchstart", onTouchStart, { passive: true }],
		["touchend", cancel, { passive: true }],
		["touchcancel", cancel, { passive: true }],
		["touchmove", cancel, { passive: true }],
		["mousedown", onMouseDown, undefined],
		["mouseup", cancel, undefined],
		["mouseleave", cancel, undefined],
	];

	for (const [type, handler, options] of listeners) {
		if (bind) bind(el, type, handler, options);
		else el.addEventListener(type, handler, options);
	}

	return () => {
		cancel();
		if (bind) return; // the binder owns removal
		for (const [type, handler] of listeners) el.removeEventListener(type, handler);
	};
}
