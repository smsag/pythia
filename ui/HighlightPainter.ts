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

import { entryKind, canonicalTerm, type TermIndex } from "../services/glossary";

const HIGHLIGHT_CLASS = "p-highlight";
const FORK_ORIGIN_CLASS = "p-fork-origin";
const MERGE_LINK_CLASS = "p-merge-link";
const TERM_CLASS = "p-term";
const FLASH_CLASS = "p-highlight-flash";

// Favorites and fork origins are wrapped in dedicated custom elements rather than
// <mark>. <mark> is styled by Obsidian core and community themes (`.markdown-rendered
// mark`), which loads after the plugin and kept overriding the fork accent back to
// the yellow highlight token. A custom element carries no theme rules, so the
// plugin's own styling wins with no specificity contest. Hyphenated names are
// spec-valid custom-element names. (ADR-086)
const FAVORITE_TAG = "pythia-favorite";
const FORK_TAG = "pythia-fork";
const MERGE_TAG = "pythia-merge";
const TERM_TAG = "pythia-term";
const PERSON_CLASS = "p-person";
const PERSON_TAG = "pythia-person";

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

	return rangeFromOffsets(nodes, matchStart, matchEnd);
}

/**
 * Build a Range from two offsets in the concatenated body text.
 *
 * The scan runs backwards because an offset on a node boundary belongs to the
 * *later* node when it starts a match and the earlier one when it ends it — and
 * taking the last node that contains it gets both right.
 */
function rangeFromOffsets(nodes: TextPos[], from: number, to: number): Range | null {
	const locate = (offset: number): { node: Text; offset: number } | null => {
		for (let i = nodes.length - 1; i >= 0; i--) {
			const { node, start } = nodes[i];
			if (offset >= start && offset <= start + node.data.length) {
				return { node, offset: offset - start };
			}
		}
		return null;
	};

	const startLoc = locate(from);
	const endLoc = locate(to);
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
 * Wrap the given range in highlight element(s) tagged with `id`. Splits across
 * text-node boundaries so boundary-crossing selections are handled. `tagName` is
 * the wrapper element (a custom element — see FAVORITE_TAG / FORK_TAG). Mutates the
 * DOM in place. Safe to call repeatedly only on freshly rendered bodies (see
 * repaint, which clears prior marks first).
 */
export function paintRange(
	range: Range,
	id: string,
	className: string = HIGHLIGHT_CLASS,
	dataAttr = "data-fav-id",
	tagName: string = FAVORITE_TAG,
): void {
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
		const mark = document.createElement(tagName);
		mark.className = className;
		mark.setAttribute(dataAttr, id);
		try {
			sub.surroundContents(mark);
		} catch {
			// A single text-node sub-range never crosses element boundaries, so this
			// should not throw; ignore defensively rather than break rendering.
		}
	}
}

// ── Fork-origin marks (accent) ──────────────────────────────────────────────
// A source conversation paints the snippet each fork branched from, in the accent
// color, so the fork's summary can be surfaced at its origin. Same find/paint
// machinery as favorites, wrapped in the FORK_TAG element with a `data-fork-id`.

/** Repaint fork-origin marks for one message body from the given fork descriptors. */
export function repaintForkOrigins(
	body: HTMLElement,
	forks: { id: string; text: string; occurrenceIndex?: number }[],
): void {
	unwrapMarks(body.querySelectorAll<HTMLElement>(`.${FORK_ORIGIN_CLASS}`));
	for (const fork of forks) {
		if (!fork.text) continue;
		// Fall back to the first occurrence when the stored occurrence index doesn't
		// resolve (ADR-096): a fork of a short word that repeats in the message (e.g.
		// "SSIH") records a non-zero index, and if that index is stale/out-of-range at
		// paint time findRange returns null and the mark silently never paints — which
		// also kills the tap-to-open anchor and the "Forked from" scroll-to-span. A
		// visible mark on the first occurrence is far better than none.
		const range =
			findRange(body, fork.text, fork.occurrenceIndex ?? 0) ?? findRange(body, fork.text, 0);
		if (range) paintRange(range, fork.id, FORK_ORIGIN_CLASS, "data-fork-id", FORK_TAG);
	}
}

/** Range spanning all fork-origin mark fragments for `forkId`, or null if absent. */
export function rangeForForkOrigin(root: HTMLElement, forkId: string): Range | null {
	const marks = root.querySelectorAll<HTMLElement>(
		`.${FORK_ORIGIN_CLASS}[data-fork-id="${forkId}"]`
	);
	if (marks.length === 0) return null;
	const range = document.createRange();
	range.setStartBefore(marks[0]);
	range.setEndAfter(marks[marks.length - 1]);
	return range;
}

// ── Merge-link marks ────────────────────────────────────────────────────────
// The inverse of a fork origin: a passage pointed AT an existing conversation,
// so that conversation's summary can be surfaced where the passage is read.
// Same find/paint machinery, wrapped in MERGE_TAG with a `data-merge-id`.

/** Repaint merge-link marks for one message body from the given link descriptors. */
export function repaintMergeLinks(
	body: HTMLElement,
	merges: { id: string; text: string; occurrenceIndex?: number }[],
): void {
	unwrapMarks(body.querySelectorAll<HTMLElement>(`.${MERGE_LINK_CLASS}`));
	for (const merge of merges) {
		if (!merge.text) continue;
		// Same first-occurrence fallback as fork origins (ADR-096): a stale or
		// out-of-range stored index must not make the mark — and with it the
		// tap-to-open anchor — silently vanish.
		const range =
			findRange(body, merge.text, merge.occurrenceIndex ?? 0) ?? findRange(body, merge.text, 0);
		if (range) paintRange(range, merge.id, MERGE_LINK_CLASS, "data-merge-id", MERGE_TAG);
	}
}

// ── Glossary term marks ─────────────────────────────────────────────────────
// Unlike favorites, fork origins and merge links, a term mark is not anchored to
// a stored span: any occurrence of any known term is marked, everywhere (ADR-136).
// So this walks the body once against a single alternation rather than re-finding
// specific text.

/** Elements whose text must never be marked. */
const TERM_SKIP = "code, pre, a, .p-cite, .p-sources-row";

/**
 * The character a skipped node's text is replaced with while matching.
 *
 * Masking rather than omitting is what lets a match cross an element boundary
 * safely: offsets stay true to the real text, so a range built from them lands
 * where it should, and no term can span a skipped region because no term
 * contains a Unicode noncharacter.
 */
const MASK = "￿";

/** The concatenated body text with every skipped node blanked out, same length. */
function maskedText(nodes: TextPos[]): string {
	let out = "";
	for (const { node } of nodes) {
		const parent = node.parentElement;
		const skip =
			!parent ||
			parent.closest(TERM_SKIP) !== null ||
			// Only another term/person mark is excluded — a term must not nest inside
			// a term. Favorites, fork origins and merge links are fine to sit inside
			// (ADR-157).
			parent.closest(`.${TERM_CLASS}, .${PERSON_CLASS}`) !== null;
		out += skip ? MASK.repeat(node.data.length) : node.data;
	}
	return out;
}

/**
 * Mark every occurrence of every known term in `body`.
 *
 * `index` carries one alternation over every surface form of every term (see
 * `buildTermIndex`), so this is a single pass over the body text rather than one
 * pass per term — the difference between linear and quadratic as a glossary
 * grows. The mark records the *canonical* term, not the form that matched, so
 * tapping "Zählern" opens the entry filed under "Zähler".
 *
 * **Matching runs over the whole body's text, not node by node** (ADR-207). A
 * German term is one word and never splits; its English equivalent is usually
 * two ("Kartellrecht" → "cartel law"), and two words are exactly what markdown
 * can put in different text nodes — `**Cartel** law`, or a phrase that overlaps
 * the end of a favorite. Per-node matching missed all of them, and it missed
 * them on the side of the glossary where multi-word forms are the rule rather
 * than the exception. A match that crosses a boundary is painted as one mark per
 * node it touches, all carrying the same `data-term`, exactly as a favorite
 * spanning a bold span already was.
 *
 * Text inside code, links and citation chips is skipped: a term inside an
 * identifier is not the term, and marking inside a link would nest two
 * interactive elements. Skipping is done by masking (see `MASK`) so that a match
 * can never straddle a skipped region.
 *
 * **Text inside a favorite, fork origin or merge link is NOT skipped** (ADR-157).
 * It used to be, to avoid "overlapping wrappers that later unwrapping would have
 * to untangle" — but they do not overlap, they nest: terms paint last, so a term
 * mark lands strictly inside the deliberate mark, and each unwrapper targets its
 * own class and leaves the other alone. The cost of the exclusion was that
 * favoriting a passage silently un-marked every term in it, which is the passage
 * a reader is most likely to be working through.
 *
 * `normalize()` first: unwrapping a mark leaves its text split into adjacent
 * nodes, and while that no longer decides whether a term matches, it decides how
 * many fragments the mark is painted in.
 *
 * Every match is located before any is painted, and the node list is rebuilt for
 * each paint: wrapping splits the node it touches, which invalidates the list,
 * but it never changes the text — so the offsets stay valid and only the mapping
 * has to be redone.
 */
export function repaintTerms(body: HTMLElement, index: TermIndex | null): void {
	unwrapMarks(body.querySelectorAll<HTMLElement>(`.${TERM_CLASS}, .${PERSON_CLASS}`));
	body.normalize(); // rejoin text split by the unwrap above
	if (!index) return;

	const masked = maskedText(collectTextNodes(body).nodes);
	const matcher = index.matcher;
	matcher.lastIndex = 0;

	const hits: { from: number; to: number; surface: string }[] = [];
	let match = matcher.exec(masked);
	while (match) {
		// A zero-length match would loop forever; the matcher cannot produce one
		// (every form is at least two characters) but the guard is cheap.
		if (match[0].length === 0) break;
		hits.push({ from: match.index, to: match.index + match[0].length, surface: match[0] });
		match = matcher.exec(masked);
	}

	for (const hit of hits) {
		const { nodes } = collectTextNodes(body);
		const range = rangeFromOffsets(nodes, hit.from, hit.to);
		if (!range) continue;
		// People and terms share the index and the anchor; only the mark differs,
		// because the mark is the sole signal of what a tap will open (ADR-151).
		const isPerson = entryKind(index, hit.surface) === "person";
		paintRange(
			range,
			canonicalTerm(index, hit.surface),
			isPerson ? PERSON_CLASS : TERM_CLASS,
			"data-term",
			isPerson ? PERSON_TAG : TERM_TAG,
		);
	}
}

/** Unwrap a set of highlight elements, restoring their text nodes into the DOM. */
function unwrapMarks(marks: NodeListOf<HTMLElement> | HTMLElement[]): void {
	marks.forEach((mark) => {
		const parent = mark.parentNode;
		if (!parent) return;
		while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
		parent.removeChild(mark);
		parent.normalize();
	});
}

/** Remove every favorite highlight under `root`, restoring the original text nodes. */
export function clearHighlights(root: HTMLElement): void {
	unwrapMarks(root.querySelectorAll<HTMLElement>(`.${HIGHLIGHT_CLASS}`));
}

/**
 * Remove only the highlight marks for a single favorite, leaving every other
 * highlight untouched. Surgical alternative to clear-all-then-repaint, so removing
 * one favorite can never drop another's color.
 */
export function removeHighlightById(root: HTMLElement, favId: string): void {
	unwrapMarks(
		root.querySelectorAll<HTMLElement>(`.${HIGHLIGHT_CLASS}[data-fav-id="${favId}"]`)
	);
}

/**
 * Build a Range spanning all mark fragments of a single favorite (a highlight may
 * be split across several <mark> elements at element boundaries). Returns null
 * when no marks for `favId` are present. Does not touch the selection.
 */
export function rangeForHighlight(root: HTMLElement, favId: string): Range | null {
	const marks = root.querySelectorAll<HTMLElement>(
		`.${HIGHLIGHT_CLASS}[data-fav-id="${favId}"]`
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
	const mark = root.querySelector<HTMLElement>(`.${HIGHLIGHT_CLASS}[data-fav-id="${favId}"]`);
	if (!mark) return;
	mark.addClass(FLASH_CLASS);
	setTimeout(() => mark.removeClass(FLASH_CLASS), 1200);
}

const PIN_FLASH_TAG = "pythia-pin-flash";
const PIN_FLASH_CLASS = "p-pin-flash";

/**
 * Flash a passage that carries no mark of its own — a pinned text's source, when
 * ↗ jumps back to it (ADR-216). `flashHighlight` needs an existing favorite
 * mark; this paints a temporary one and unwraps it again, normalizing the body
 * so a term or favorite that straddles the seam still matches afterwards. The
 * mark it returns is where to scroll; null when the text is no longer there.
 */
export function flashText(body: HTMLElement, text: string, occurrenceIndex = 0): HTMLElement | null {
	const range = findRange(body, text, occurrenceIndex);
	if (!range) return null;
	paintRange(range, "flash", PIN_FLASH_CLASS, "data-pin-flash", PIN_FLASH_TAG);
	const marks = Array.from(body.querySelectorAll<HTMLElement>(`${PIN_FLASH_TAG}.${PIN_FLASH_CLASS}`));
	setTimeout(() => { unwrapMarks(marks); body.normalize(); }, 1200);
	return marks[0] ?? null;
}
