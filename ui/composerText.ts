/**
 * The composer's DOM, read as the text a textarea would have held (D-52).
 *
 * The composer is a `contenteditable`, so a note link can be a chip — one atom
 * with an icon — while everything downstream still sees plain text: the send
 * path, ADR-211's literal token count, and above all the model. **A chip reads as
 * exactly the token it stands for** (`[[Name]]`). That is the whole contract, and
 * the reason prompt quality cannot change with the composer: the text a chip
 * produces is the text the textarea held.
 *
 * Browsers disagree about what a line break is inside an editable element —
 * Chrome wraps a new line in a `<div>`, WebKit may use `<br>`, a pasted or
 * programmatic value is a literal `\n` in a text node — so all three read as one
 * `\n`, and a block's trailing `<br>` (the placeholder that keeps an empty line
 * open) reads as nothing. `&nbsp;`, which WebKit inserts for a typed space next
 * to another, reads as a space.
 *
 * Offsets are in that text, never in the DOM. `textOffset` maps a DOM position to
 * one and `domPosition` maps back; a position inside a chip snaps to its end, so
 * a caret can never land inside the atom.
 */

/** The class every composer chip carries; its `data-token` is its text. */
export const CHIP_CLASS = "p-composer-chip";

export function isChip(node: Node): node is HTMLElement {
	return node.nodeType === 1 && (node as HTMLElement).classList.contains(CHIP_CLASS);
}

const BLOCK_TAGS = new Set(["DIV", "P", "LI"]);
const isBlock = (node: Node): boolean => node.nodeType === 1 && BLOCK_TAGS.has((node as Element).tagName);
const isBr = (node: Node): boolean => node.nodeType === 1 && (node as Element).tagName === "BR";

/** A DOM point: a node and an offset in it, as a Range or Selection holds it. */
export interface DomPoint { node: Node; offset: number }

/** One run of the text and where it lives, so an offset can be found in the DOM. */
type Segment =
	| { kind: "text"; node: Text; start: number; end: number }
	| { kind: "atom"; start: number; end: number; before: DomPoint; after: DomPoint };

interface Walk { text: string; segments: Segment[]; at: number | null }

function walk(root: Node, stop: DomPoint | null): Walk {
	let out = "";
	const segments: Segment[] = [];
	let at: number | null = null;
	/** Anything so far — content or a block, even an empty one (an empty line). */
	let started = false;

	const visit = (parent: Node): void => {
		const kids = Array.from(parent.childNodes);
		for (let i = 0; i < kids.length; i++) {
			if (at === null && stop && stop.node === parent && stop.offset === i) at = out.length;
			const node = kids[i];
			if (node.nodeType === 3) {
				const data = (node as Text).data.replace(/ /g, " ");
				if (at === null && stop && stop.node === node) at = out.length + Math.min(stop.offset, data.length);
				segments.push({ kind: "text", node: node as Text, start: out.length, end: out.length + data.length });
				out += data;
				if (data) started = true;
			} else if (isChip(node)) {
				const token = node.dataset.token ?? "";
				if (at === null && stop && node.contains(stop.node)) at = out.length + token.length; // inside → after
				segments.push({ kind: "atom", start: out.length, end: out.length + token.length, before: { node: parent, offset: i }, after: { node: parent, offset: i + 1 } });
				out += token;
				started = true;
			} else if (isBr(node)) {
				// The last <br> of a block is the placeholder that keeps an empty line
				// open; it is not a line of its own.
				const placeholder = i === kids.length - 1 && (parent === root || isBlock(parent));
				if (placeholder) continue;
				segments.push({ kind: "atom", start: out.length, end: out.length + 1, before: { node: parent, offset: i }, after: { node: parent, offset: i + 1 } });
				out += "\n";
				started = true;
			} else if (isBlock(node)) {
				// A block starts a new line — unless it is the first thing there is.
				if (started) {
					segments.push({ kind: "atom", start: out.length, end: out.length + 1, before: { node: parent, offset: i }, after: { node, offset: 0 } });
					out += "\n";
				}
				started = true;
				visit(node);
			} else {
				visit(node); // an unknown inline wrapper (a <span> from a paste) — read through it
			}
		}
		if (at === null && stop && stop.node === parent && stop.offset >= kids.length) at = out.length;
	};

	visit(root);
	return { text: out, segments, at };
}

/** The composer's text, chips read as their tokens. */
export function composerText(root: Node): string {
	return walk(root, null).text;
}

/** Where a DOM point falls in the composer's text; the end when it is outside. */
export function textOffset(root: Node, point: DomPoint): number {
	const w = walk(root, point);
	return w.at ?? w.text.length;
}

/** The DOM point for a text offset. Inside a chip snaps to after it. */
export function domPosition(root: Node, offset: number): DomPoint {
	const { segments, text } = walk(root, null);
	const n = Math.min(Math.max(offset, 0), text.length);
	for (const s of segments) {
		if (n > s.end) continue;
		if (s.kind === "text") return { node: s.node, offset: n - s.start };
		return n <= s.start ? s.before : s.after;
	}
	return { node: root, offset: root.childNodes.length };
}

/** A piece of what goes into the composer: plain text, or a chip. */
export type ComposerPart = string | { token: string; label: string };

/**
 * Split `text` into parts, turning every occurrence of a known token into a
 * chip. Used when a whole value is set (a restored draft, a prefill) — a link
 * Pythia tracks comes back as the chip it was, anything else stays text.
 */
export function partsFor(text: string, chips: ReadonlyMap<string, string>): ComposerPart[] {
	const parts: ComposerPart[] = [];
	let from = 0;
	while (from < text.length) {
		let best = -1;
		let bestToken = "";
		for (const token of chips.keys()) {
			if (!token) continue;
			const at = text.indexOf(token, from);
			if (at !== -1 && (best === -1 || at < best || (at === best && token.length > bestToken.length))) {
				best = at;
				bestToken = token;
			}
		}
		if (best === -1) break;
		if (best > from) parts.push(text.slice(from, best));
		parts.push({ token: bestToken, label: chips.get(bestToken) ?? bestToken });
		from = best + bestToken.length;
	}
	if (from < text.length) parts.push(text.slice(from));
	return parts;
}
