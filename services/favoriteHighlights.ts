import type { Conversation, Favorite, MessageSource } from "../models/types";

/**
 * A favorite becomes a Markdown highlight (`==…==`) in a note Pythia writes
 * (ADR-239).
 *
 * A favorite stores the text the user SELECTED — the rendered text, where
 * `**bold**` is "bold", `[[Folder/Note|Note]]` is "Note" and a citation marker
 * is its chip's number — plus which occurrence of it in the rendered message
 * (ADR-085). A note is written from the Markdown source. So the source is
 * projected onto the text it renders to, unit by unit, the favorite is found
 * in that projection (whitespace ignored: a selection's line breaks are not
 * the DOM's), and the `==` go around the source units it covers.
 *
 * Where the `==` go is the careful part. A highlight must nest properly with
 * the markup around it, or Obsidian renders neither:
 *   - a covered run whose markup is balanced is wrapped whole: `==a **b** c==`;
 *   - one that opens or closes markup it does not contain (it starts inside
 *     `**bold**`), crosses a table cell, or meets an existing highlight is
 *     wrapped piece by piece, around the plain text between the markup:
 *     `**b==old==** ==text==`;
 *   - a code span or a wikilink is atomic — `==` inside it would be literal —
 *     so it is wrapped whole, and a fenced block is never touched;
 *   - a highlight never crosses a line: each line gets its own.
 *
 * A favorite that cannot be found (the message changed, a legacy favorite
 * with no text) is skipped: the note is still written, without that mark.
 *
 * Pure: no Obsidian, no DOM.
 */

/** What a citation marker shows on screen — its chip's number, or nothing. */
export type CiteText = (kind: "note" | "web", ref: string) => string;

type Mode =
	| "char"     // one source character, shown as itself
	| "atom"     // a code span or a wikilink: shown as its text, wrapped only whole
	| "cite"     // a citation marker: shown as its chip, never highlighted
	| "frozen"   // a character of a fenced block: shown, never highlighted
	| "markup"   // syntax that shows nothing
	| "prefix"   // a line's list / heading / quote marker
	| "barrier"  // a table pipe or a whole syntax line: a highlight cannot cross it
	| "newline";

interface Unit {
	s: number;
	e: number;
	text: string;
	mode: Mode;
	/** Which delimiter a markup unit is, for the balance check. */
	delim?: string;
	/** Already inside an `==…==` the source has. */
	lit: boolean;
}

const FENCE_RE = /^\s{0,3}(```|~~~)/;
const RULE_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const PREFIX_RE = /^\s*(?:>\s?)*\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/;
const ESC_Y = /\\([!-/:-@[-`{-~])/y;
const CITE_Y = /[ \t]*⟦cite:(note|web):([^⟧]+)⟧/y;
const FOREIGN_Y = /[ \t]*【[^】]*†[^】]*】/y;
const WIKI_Y = /!?\[\[([^\]]+)\]\]/y;
const CODE_Y = /(`+)(.*?[^`])\1(?!`)/y;
const LINK_Y = /\[([^\]\n]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/y;
const HTML_Y = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?\/?>/y;
const EMPHASIS = ["**", "__", "~~"];

function stickyAt(re: RegExp, line: string, i: number): RegExpExecArray | null {
	re.lastIndex = i;
	return re.exec(line);
}

const isWordChar = (ch: string | undefined): boolean => !!ch && /[\p{L}\p{N}]/u.test(ch);
const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);

/** One line outside a fence, as units. `lit` restarts at every line — a
 *  highlight does not cross one. */
function tokenizeLine(line: string, base: number, out: Unit[], citeText: CiteText): void {
	let lit = false;
	const push = (s: number, e: number, mode: Mode, text = "", delim?: string): void => {
		out.push({ s: base + s, e: base + e, text, mode, delim, lit });
	};
	const prefix = PREFIX_RE.exec(line)?.[0] ?? "";
	if (prefix) push(0, prefix.length, "prefix");
	const isTable = /^\s*\|/.test(line);
	const linkCloses = new Map<number, number>();
	let i = prefix.length;
	while (i < line.length) {
		const close = linkCloses.get(i);
		if (close !== undefined) { push(i, i + close, "markup", "", "]("); i += close; continue; }
		let m: RegExpExecArray | null;
		if ((m = stickyAt(ESC_Y, line, i))) {
			push(i, i + 1, "markup", "", "esc");
			push(i + 1, i + 2, "char", m[1]);
			i += 2;
			continue;
		}
		if ((m = stickyAt(CITE_Y, line, i))) {
			push(i, i + m[0].length, "cite", citeText(m[1] as "note" | "web", m[2].trim()));
			i += m[0].length;
			continue;
		}
		if ((m = stickyAt(FOREIGN_Y, line, i))) { push(i, i + m[0].length, "cite"); i += m[0].length; continue; }
		if ((m = stickyAt(WIKI_Y, line, i))) {
			const inner = m[1];
			const bar = inner.indexOf("|");
			push(i, i + m[0].length, "atom", bar === -1 ? inner : inner.slice(bar + 1));
			i += m[0].length;
			continue;
		}
		if ((m = stickyAt(CODE_Y, line, i))) { push(i, i + m[0].length, "atom", m[2]); i += m[0].length; continue; }
		if ((m = stickyAt(LINK_Y, line, i))) {
			push(i, i + 1, "markup", "", "[");
			linkCloses.set(i + 1 + m[1].length, m[0].length - 1 - m[1].length);
			i += 1;
			continue;
		}
		if ((m = stickyAt(HTML_Y, line, i))) { push(i, i + m[0].length, "markup", "", "html"); i += m[0].length; continue; }
		const two = line.slice(i, i + 2);
		if (two === "==") {
			push(i, i + 2, "markup", "", "==");
			lit = !lit;
			i += 2;
			continue;
		}
		if (EMPHASIS.includes(two)) { push(i, i + 2, "markup", "", two); i += 2; continue; }
		const ch = line[i];
		const literal =
			(ch === "_" && isWordChar(line[i - 1]) && isWordChar(line[i + 1])) ||
			(ch === "*" && isSpace(line[i - 1]) && isSpace(line[i + 1]));
		if ((ch === "*" || ch === "_") && !literal) { push(i, i + 1, "markup", "", ch); i += 1; continue; }
		if (ch === "|" && isTable) { push(i, i + 1, "barrier"); i += 1; continue; }
		push(i, i + 1, "char", ch);
		i += 1;
	}
}

/** The whole source as units, each knowing what it shows on screen. */
function tokenize(content: string, citeText: CiteText): Unit[] {
	const units: Unit[] = [];
	const lines = content.split("\n");
	let pos = 0;
	let inFence = false;
	lines.forEach((line, li) => {
		if (FENCE_RE.test(line)) {
			units.push({ s: pos, e: pos + line.length, text: "", mode: "barrier", lit: false });
			inFence = !inFence;
		} else if (inFence) {
			for (let k = 0; k < line.length; k++) units.push({ s: pos + k, e: pos + k + 1, text: line[k], mode: "frozen", lit: false });
		} else if (RULE_RE.test(line) || TABLE_SEP_RE.test(line)) {
			units.push({ s: pos, e: pos + line.length, text: "", mode: "barrier", lit: false });
		} else {
			tokenizeLine(line, pos, units, citeText);
		}
		pos += line.length;
		if (li < lines.length - 1) {
			units.push({ s: pos, e: pos + 1, text: "\n", mode: "newline", lit: false });
			pos += 1;
		}
	});
	return units;
}

const SHOWN: ReadonlySet<Mode> = new Set<Mode>(["char", "atom", "cite", "frozen"]);

/** The units the `occurrence`-th appearance of `text` covers, first and last;
 *  null when it does not appear that often. Whitespace is ignored on both sides. */
function locate(units: Unit[], text: string, occurrence: number): [number, number] | null {
	const needle = text.replace(/\s+/g, "");
	if (!needle) return null;
	let hay = "";
	const owner: number[] = [];
	units.forEach((u, k) => {
		if (!SHOWN.has(u.mode)) return;
		for (let j = 0; j < u.text.length; j++) {
			if (/\s/.test(u.text[j])) continue;
			hay += u.text[j];
			owner.push(k);
		}
	});
	let at = -1;
	let from = 0;
	for (let n = 0; n <= occurrence; n++) {
		at = hay.indexOf(needle, from);
		if (at === -1) return null;
		from = at + needle.length;
	}
	return [owner[at], owner[at + needle.length - 1]];
}

const isBlank = (u: Unit): boolean => u.mode === "char" && /^\s$/.test(u.text);

/** Wrapping [a, b] whole keeps the Markdown well-formed: every delimiter it
 *  holds is closed inside it, and nothing in it forbids a highlight. */
function balanced(units: Unit[], a: number, b: number): boolean {
	const counts = new Map<string, number>();
	for (let k = a; k <= b; k++) {
		const u = units[k];
		if (u.lit || u.mode === "barrier" || u.mode === "frozen") return false;
		if (u.mode !== "markup" || !u.delim || u.delim === "esc") continue;
		if (u.delim === "==" || u.delim === "html") return false;
		counts.set(u.delim, (counts.get(u.delim) ?? 0) + 1);
	}
	if ((counts.get("[") ?? 0) !== (counts.get("](") ?? 0)) return false;
	for (const [delim, n] of counts) {
		if (delim !== "[" && delim !== "](" && n % 2 !== 0) return false;
	}
	return true;
}

/** The unit ranges to wrap for one covered line segment. */
function groupsFor(units: Unit[], a: number, b: number): [number, number][] {
	const edge = (u: Unit): boolean => isBlank(u) || u.mode === "prefix" || u.mode === "cite" || u.mode === "newline";
	while (a <= b && edge(units[a])) a++;
	while (b >= a && edge(units[b])) b--;
	if (a > b) return [];
	if (balanced(units, a, b)) return [[a, b]];
	// A passage that starts at a link's text and runs past it is balanced once
	// the delimiters touching its edges are included.
	let wa = a;
	let wb = b;
	while (wa > 0 && units[wa - 1].mode === "markup" && !units[wa - 1].lit) wa--;
	while (wb < units.length - 1 && units[wb + 1].mode === "markup" && !units[wb + 1].lit) wb++;
	if ((wa !== a || wb !== b) && balanced(units, wa, wb)) return [[wa, wb]];
	// Piece by piece: the plain text between the markup, never what is lit.
	const out: [number, number][] = [];
	let start = -1;
	const flush = (end: number): void => {
		let s = start;
		let e = end;
		while (s <= e && isBlank(units[s])) s++;
		while (e >= s && isBlank(units[e])) e--;
		if (s <= e) out.push([s, e]);
		start = -1;
	};
	for (let k = a; k <= b; k++) {
		const u = units[k];
		const wrappable = (u.mode === "char" || u.mode === "atom") && !u.lit;
		if (wrappable && start === -1) start = k;
		if (!wrappable && start !== -1) flush(k - 1);
	}
	if (start !== -1) flush(b);
	return out;
}

/**
 * `content` with each passage wrapped in `==…==`. A passage is the text as
 * shown on screen and which occurrence of it; `citeText` says what a citation
 * marker shows (a chip number in a stored message, nothing in text the model
 * is writing). Overlapping passages merge into one highlight.
 */
export function highlightPassages(
	content: string,
	passages: { text: string; occurrenceIndex?: number }[],
	citeText: CiteText = () => "",
): string {
	if (passages.length === 0 || !content) return content;
	const units = tokenize(content, citeText);
	const covered = new Array<boolean>(units.length).fill(false);
	let any = false;
	for (const p of passages) {
		const span = locate(units, p.text, p.occurrenceIndex ?? 0);
		if (!span) continue;
		for (let k = span[0]; k <= span[1]; k++) covered[k] = true;
		any = true;
	}
	if (!any) return content;

	// Covered segments, cut at every line break and at a fenced block.
	const groups: [number, number][] = [];
	let segStart = -1;
	for (let k = 0; k <= units.length; k++) {
		const inSeg = k < units.length && covered[k] && units[k].mode !== "newline" && units[k].mode !== "frozen";
		if (inSeg && segStart === -1) segStart = k;
		if (!inSeg && segStart !== -1) { groups.push(...groupsFor(units, segStart, k - 1)); segStart = -1; }
	}

	let out = content;
	for (const [a, b] of groups.sort((x, y) => y[0] - x[0])) {
		const s = units[a].s;
		const e = units[b].e;
		out = `${out.slice(0, s)}==${out.slice(s, e)}==${out.slice(e)}`;
	}
	return out;
}

/** What a stored message's citation markers show: the chip's number, found the
 *  way `eachCitationSegment` finds it (by what the marker said, else by ref). */
export function messageCiteText(sources: MessageSource[] | undefined): CiteText {
	const byKey = new Map((sources ?? []).map((s) => [`${s.kind}:${s.cite ?? s.ref}`, String(s.n)]));
	return (kind, ref) => byKey.get(`${kind === "note" ? "vault" : "web"}:${ref}`) ?? "";
}

/** A message's content with its own favorites highlighted — Save to note and
 *  the archive. Legacy favorites (no text) and those on another answer are skipped. */
export function highlightMessageFavorites(
	msg: { id: string; content: string; sources?: MessageSource[] },
	favorites: Favorite[] | undefined,
): string {
	const own = (favorites ?? []).filter((f) => f.messageId === msg.id && !!f.text);
	if (own.length === 0) return msg.content;
	return highlightPassages(
		msg.content,
		own.map((f) => ({ text: f.text as string, occurrenceIndex: f.occurrenceIndex })),
		messageCiteText(msg.sources),
	);
}

/**
 * A conversation's favorites as text to find in a note the model is writing
 * (`create_note` · `rewrite_note` · `prepend_note`). The model's markers are
 * numbered differently from the chips the user selected over, so a favorite's
 * chip numbers are taken out: it is located in its own message, and only the
 * text it covers there — not the chips — is kept.
 */
export function favoritePassages(conv: Pick<Conversation, "favorites" | "messages">): string[] {
	const out: string[] = [];
	for (const fav of conv.favorites ?? []) {
		if (!fav.text) continue;
		const msg = conv.messages.find((m) => m.id === fav.messageId);
		if (!msg) continue;
		const units = tokenize(msg.content, messageCiteText(msg.sources));
		const span = locate(units, fav.text, fav.occurrenceIndex ?? 0);
		if (!span) continue;
		let text = "";
		for (let k = span[0]; k <= span[1]; k++) {
			const u = units[k];
			if (u.mode === "char" || u.mode === "atom" || u.mode === "frozen") text += u.text;
		}
		text = text.replace(/\s+/g, "");
		if (text) out.push(text);
	}
	return out;
}
