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
 */
export function selectedAnswer(sel: Selection | null, messagesEl: HTMLElement): HTMLElement | null {
	if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) return null;
	if (!messagesEl.contains(sel.getRangeAt(0).commonAncestorContainer)) return null;
	const owner = (node: Node | null): Element | null => {
		const el = node instanceof Element ? node : node?.parentElement;
		return el?.closest(".p-msg-ai") ?? null;
	};
	const start = owner(sel.anchorNode);
	return start instanceof HTMLElement && start === owner(sel.focusNode) ? start : null;
}
