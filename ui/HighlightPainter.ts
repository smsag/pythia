// HighlightPainter — locate and visually mark favorited text spans inside a
// rendered message body.
//
// Favorites store the *exact selected text* (not character offsets), because the
// message body is produced by MarkdownRenderer and re-created on every render;
// source offsets do not map cleanly onto the rendered DOM. To paint a favorite we
// re-find its text among the body's text nodes and wrap the matching range.
//
// A selection frequently crosses element boundaries (bold spans, links, adjacent
// paragraphs), so Range.surroundContents — which throws on boundary-crossing
// ranges — cannot be used. Instead we split the range per text node and wrap each
// fragment in its own <mark>, all tagged with the same data-fav-id.

const HIGHLIGHT_CLASS = "p-highlight";
const FLASH_CLASS = "p-highlight-flash";

interface TextPos {
	node: Text;
	/** Offset of this text node's first character within the concatenated body text. */
	start: number;
}

/** Collect every text node under `root` with its running offset in the concatenated text. */
function collectTextNodes(root: HTMLElement): { nodes: TextPos[]; full: string } {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: TextPos[] = [];
	let full = "";
	let node = walker.nextNode() as Text | null;
	while (node) {
		nodes.push({ node, start: full.length });
		full += node.data;
		node = walker.nextNode() as Text | null;
	}
	return { nodes, full };
}

/**
 * Build a DOM Range covering the `occurrenceIndex`-th occurrence of `text`
 * within `root`. Returns null when the text (or that occurrence) is not present —
 * e.g. the message was edited or streamed differently since the favorite was made.
 */
export function findRange(
	root: HTMLElement,
	text: string,
	occurrenceIndex = 0,
): Range | null {
	if (!text) return null;
	const { nodes, full } = collectTextNodes(root);
	if (nodes.length === 0) return null;

	// Locate the requested occurrence in the concatenated text.
	let searchFrom = 0;
	let matchStart = -1;
	for (let i = 0; i <= occurrenceIndex; i++) {
		matchStart = full.indexOf(text, searchFrom);
		if (matchStart === -1) return null;
		searchFrom = matchStart + text.length;
	}
	const matchEnd = matchStart + text.length;

	// Map the global start/end offsets back to (text node, local offset).
	const locate = (offset: number): { node: Text; offset: number } | null => {
		for (let i = nodes.length - 1; i >= 0; i--) {
			const { node, start } = nodes[i];
			if (offset >= start && offset <= start + node.data.length) {
				return { node, offset: offset - start };
			}
		}
		return null;
	};

	const startLoc = locate(matchStart);
	const endLoc = locate(matchEnd);
	if (!startLoc || !endLoc) return null;

	const range = document.createRange();
	range.setStart(startLoc.node, startLoc.offset);
	range.setEnd(endLoc.node, endLoc.offset);
	return range;
}

/**
 * Count how many times `range`'s text already appears in `root` before the
 * range's own start. Used at favorite-creation time so re-finding later paints
 * the same occurrence when the message contains duplicate text.
 */
export function computeOccurrenceIndex(root: HTMLElement, range: Range): number {
	const text = range.toString();
	if (!text) return 0;
	const { nodes, full } = collectTextNodes(root);

	// Global offset of the range start within the concatenated body text.
	let startOffset = -1;
	for (const { node, start } of nodes) {
		if (node === range.startContainer) {
			startOffset = start + range.startOffset;
			break;
		}
	}
	if (startOffset === -1) return 0;

	let count = 0;
	let from = full.indexOf(text);
	while (from !== -1 && from < startOffset) {
		count++;
		from = full.indexOf(text, from + text.length);
	}
	return count;
}

/**
 * Wrap the given range in <mark> element(s) tagged with `favId`. Splits across
 * text-node boundaries so boundary-crossing selections are handled. Mutates the
 * DOM in place. Safe to call repeatedly only on freshly rendered bodies (see
 * repaint, which clears prior marks first).
 */
export function paintRange(range: Range, favId: string): void {
	// Gather the text nodes the range touches before mutating (surrounding nodes
	// changes the tree, so snapshot first).
	const root = range.commonAncestorContainer;
	const rootEl: Node = root.nodeType === Node.ELEMENT_NODE ? root : root.parentNode!;
	const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
	const touched: Text[] = [];
	let n = walker.nextNode() as Text | null;
	while (n) {
		if (range.intersectsNode(n)) touched.push(n);
		n = walker.nextNode() as Text | null;
	}

	for (const textNode of touched) {
		const isStart = textNode === range.startContainer;
		const isEnd = textNode === range.endContainer;
		const from = isStart ? range.startOffset : 0;
		const to = isEnd ? range.endOffset : textNode.data.length;
		if (to <= from) continue;

		const sub = document.createRange();
		sub.setStart(textNode, from);
		sub.setEnd(textNode, to);
		const mark = document.createElement("mark");
		mark.className = HIGHLIGHT_CLASS;
		mark.setAttribute("data-fav-id", favId);
		try {
			sub.surroundContents(mark);
		} catch {
			// A single text-node sub-range never crosses element boundaries, so this
			// should not throw; ignore defensively rather than break rendering.
		}
	}
}

/** Unwrap a set of <mark> elements, restoring their text nodes into the DOM. */
function unwrapMarks(marks: NodeListOf<HTMLElement> | HTMLElement[]): void {
	marks.forEach((mark) => {
		const parent = mark.parentNode;
		if (!parent) return;
		while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
		parent.removeChild(mark);
		parent.normalize();
	});
}

/** Remove every highlight <mark> under `root`, restoring the original text nodes. */
export function clearHighlights(root: HTMLElement): void {
	unwrapMarks(root.querySelectorAll<HTMLElement>(`mark.${HIGHLIGHT_CLASS}`));
}

/**
 * Remove only the highlight marks for a single favorite, leaving every other
 * highlight untouched. Surgical alternative to clear-all-then-repaint, so removing
 * one favorite can never drop another's color.
 */
export function removeHighlightById(root: HTMLElement, favId: string): void {
	unwrapMarks(
		root.querySelectorAll<HTMLElement>(`mark.${HIGHLIGHT_CLASS}[data-fav-id="${favId}"]`)
	);
}

/**
 * Build a Range spanning all mark fragments of a single favorite (a highlight may
 * be split across several <mark> elements at element boundaries). Returns null
 * when no marks for `favId` are present. Does not touch the selection.
 */
export function rangeForHighlight(root: HTMLElement, favId: string): Range | null {
	const marks = root.querySelectorAll<HTMLElement>(
		`mark.${HIGHLIGHT_CLASS}[data-fav-id="${favId}"]`
	);
	if (marks.length === 0) return null;
	const range = document.createRange();
	range.setStartBefore(marks[0]);
	range.setEndAfter(marks[marks.length - 1]);
	return range;
}

/**
 * Re-apply all favorites for a message onto its freshly rendered body.
 * Clears any existing marks first so repeated calls are idempotent.
 * Returns the ids of favorites whose text could not be located.
 */
export function repaintBody(
	body: HTMLElement,
	favorites: { id: string; text?: string; occurrenceIndex?: number }[],
): string[] {
	clearHighlights(body);
	const missing: string[] = [];
	for (const fav of favorites) {
		if (!fav.text) continue; // legacy message-level favorite — nothing to paint
		const range = findRange(body, fav.text, fav.occurrenceIndex ?? 0);
		if (!range) {
			missing.push(fav.id);
			continue;
		}
		paintRange(range, fav.id);
	}
	return missing;
}

/** Briefly flash a highlight to draw the eye after a navigator jump. */
export function flashHighlight(favId: string, root: ParentNode): void {
	const mark = root.querySelector<HTMLElement>(`mark.${HIGHLIGHT_CLASS}[data-fav-id="${favId}"]`);
	if (!mark) return;
	mark.addClass(FLASH_CLASS);
	setTimeout(() => mark.removeClass(FLASH_CLASS), 1200);
}
