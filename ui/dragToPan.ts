/**
 * Drag-to-pan for a horizontally scrolling element.
 *
 * Wide content in a narrow sidebar has to scroll sideways, and a trackpad or a
 * mouse wheel gives no good way to do that. This lets the pointer grab the
 * content and drag it, the way a map pans.
 *
 * Shared by every surface that scrolls sideways — code blocks, rendered
 * diagrams, and wide tables (ADR-131) — so the gesture and its thresholds stay
 * identical across all three instead of being re-implemented per surface.
 */

/** Pixels the pointer must travel before a press becomes a pan rather than a click. */
const PAN_THRESHOLD = 5;

/**
 * Let the pointer drag `el` horizontally. Mouse only: touch devices already pan
 * a scroll container natively, and hijacking touch would fight that.
 *
 * A press that never crosses the threshold stays a click, so selecting text or
 * pressing a button inside the element still works.
 */
export function attachDragToPan(el: HTMLElement): void {
	let startX = 0;
	let startScrollLeft = 0;
	let panning = false;

	const onMove = (e: PointerEvent) => {
		const dx = e.clientX - startX;
		if (!panning) {
			if (Math.abs(dx) < PAN_THRESHOLD) return;
			panning = true;
			el.classList.add("p-panning");
		}
		el.scrollLeft = startScrollLeft - dx;
	};

	const cleanup = () => {
		if (panning) el.classList.remove("p-panning");
		panning = false;
		document.removeEventListener("pointermove", onMove);
		document.removeEventListener("pointerup", cleanup);
		document.removeEventListener("pointercancel", cleanup);
	};

	el.addEventListener("pointerdown", (e) => {
		if (e.pointerType !== "mouse" || e.button !== 0) return;
		// Nothing to pan when the content already fits.
		if (el.scrollWidth <= el.clientWidth) return;
		startX = e.clientX;
		startScrollLeft = el.scrollLeft;
		panning = false;
		document.addEventListener("pointermove", onMove);
		document.addEventListener("pointerup", cleanup);
		document.addEventListener("pointercancel", cleanup);
	});
}
