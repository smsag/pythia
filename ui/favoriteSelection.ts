/**
 * Which answer a selection can be favorited in (ADR-085).
 *
 * A favorite is a span of ONE assistant answer: the toolbar shows its Favorite
 * button by this rule and the "Favorite selection" command runs by it, so a
 * keyboard shortcut can never favorite what the toolbar would refuse. Each
 * endpoint of the selection is resolved to its own answer, not the range's
 * common ancestor — a drag that overshoots a bubble has `.p-chat` as its common
 * ancestor, which is inside no user bubble and used to re-show the button over
 * a prompt.
 *
 * A selection that touches a chart's body is refused too (ADR-254): that text
 * is the SVG or the table, whichever view is shown, and the painter never finds
 * or counts it — a favorite, fork, link or pin made there could not be found
 * again.
 */
export function selectedAnswer(sel: Selection | null, messagesEl: HTMLElement): HTMLElement | null {
	if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) return null;
	const range = sel.getRangeAt(0);
	if (!messagesEl.contains(range.commonAncestorContainer)) return null;
	const owner = (node: Node | null): Element | null => {
		const el = node instanceof Element ? node : node?.parentElement;
		return el?.closest(".p-msg-ai") ?? null;
	};
	const start = owner(sel.anchorNode);
	if (!(start instanceof HTMLElement) || start !== owner(sel.focusNode)) return null;
	const touchesChart = Array.from(start.querySelectorAll(".p-chart-body")).some((body) => range.intersectsNode(body));
	return touchesChart ? null : start;
}
