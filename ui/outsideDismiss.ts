/**
 * Dismiss-on-outside-interaction for popovers and menus.
 *
 * Five surfaces (the model popover, the navigator, the fork menu, the Send
 * long-press menu, the history panel's Escape) each hand-rolled the same thing:
 * add a capturing `mousedown` (and sometimes `touchstart` / `keydown`) on
 * `document` **one tick later**, so the gesture that opened the surface does not
 * also close it, and remove them on close. Four of the five had the same latent
 * leak: if the surface was closed before that tick ran (a conversation switch,
 * a view rebuild), the listeners were added afterwards and never removed.
 *
 * This is the one copy. The deferred registration is guarded by the returned
 * disposer, so disposing before the tick simply cancels it.
 */
export interface OutsideDismissOptions {
	/** Also dismiss on Escape. */
	escape?: boolean;
	/** Also listen for `touchstart` (surfaces that must close on a tap that a
	 *  browser might not translate into `mousedown`). */
	touch?: boolean;
	/** Listen for pointer events at all (default true). `false` with `escape`
	 *  gives an Escape-only dismisser. */
	pointer?: boolean;
}

/**
 * Call `onDismiss` when the user presses outside the surface (`isInside`
 * decides) or, optionally, presses Escape. Returns a disposer that is always
 * safe to call, including before the deferred registration has happened.
 */
export function attachOutsideDismiss(
	isInside: (target: Node | null) => boolean,
	onDismiss: () => void,
	{ escape = false, touch = false, pointer = true }: OutsideDismissOptions = {},
): () => void {
	let live = true;
	let armed = false;
	const onPointer = (e: Event) => {
		if (!isInside(e.target as Node | null)) onDismiss();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") { e.preventDefault(); onDismiss(); }
	};
	const detach = () => {
		if (!armed) return;
		armed = false;
		if (pointer) {
			document.removeEventListener("mousedown", onPointer, true);
			if (touch) document.removeEventListener("touchstart", onPointer, true);
		}
		if (escape) document.removeEventListener("keydown", onKey, true);
	};
	// Deferred so the press that opened the surface cannot close it in the same tick.
	setTimeout(() => {
		if (!live) return;
		armed = true;
		if (pointer) {
			document.addEventListener("mousedown", onPointer, true);
			if (touch) document.addEventListener("touchstart", onPointer, true);
		}
		if (escape) document.addEventListener("keydown", onKey, true);
	}, 0);
	return () => { live = false; detach(); };
}
