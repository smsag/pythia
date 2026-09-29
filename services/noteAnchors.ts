import type { Conversation, NoteAnchor } from "../models/types";

/**
 * Note anchors (ADR-249): a passage in a vault note that links to a Pythia
 * conversation, or to one chapter of it —
 *
 *   ==[the passage](obsidian://pythia?vault=V&cmd=resume&id=C&msg=M)==[^pythia-1a2b3c4d]
 *
 * A note anchor is a Pythia resume link (`obsidian://pythia?…cmd=resume&id=…`)
 * that points at a chapter or is wrapped in `==` — `isNoteAnchor`, the one
 * rule. Whether Pythia wrote it or the user pasted a copied chapter link by
 * hand makes no difference. The `==` is also the print fallback for a reader
 * without Pythia; the footnote carries the summary onto paper.
 *
 * Everything here is pure and works on a string, so the rules can be tested
 * without a vault: where the links are (never inside code), which label a
 * footnote gets, what a selection must look like before Pythia wraps it, and
 * what a note's links say about the records kept on each conversation.
 */

/** What an anchor points at: a conversation, and optionally one chapter (a user message). */
export interface AnchorRef {
	id: string;
	msg?: string;
}

/** One anchor found in a note. Offsets are into the note's text. */
export interface AnchorMatch {
	ref: AnchorRef;
	/** The link's visible text, as written in the source (escapes included). */
	text: string;
	/** The whole anchor: the `==`, the link and an attached `[^pythia-…]` reference. */
	start: number;
	end: number;
	/** Where the link and its highlight end — where a footnote reference belongs. */
	markupEnd: number;
	/** Wrapped in `==…==` exactly. */
	highlighted: boolean;
	/** The `pythia-` footnote label attached directly after the anchor, if any. */
	footnoteLabel?: string;
}

/** Every label Pythia writes starts with this. Reserved: a footnote whose
 *  label starts with it is Pythia's to rewrite or remove. */
export const PYTHIA_FOOTNOTE_PREFIX = "pythia-";

const ANCHOR_RE = /(==)?\[((?:\\.|[^\]\\\n])+)\]\((obsidian:\/\/pythia\?[^)\s]+)\)(==)?(?:\[\^(pythia-[a-z0-9]+)\])?/g;
const FENCE_RE = /^\s{0,3}(```|~~~)/;

/**
 * `markdown` with every code region — fenced blocks and inline code spans —
 * replaced by spaces of the same length, newlines kept. Offsets into the result
 * are offsets into `markdown`, and nothing inside code can match a pattern.
 */
export function maskCode(markdown: string): string {
	let inFence = false;
	return markdown
		.split("\n")
		.map((line) => {
			if (FENCE_RE.test(line)) { inFence = !inFence; return " ".repeat(line.length); }
			if (inFence) return " ".repeat(line.length);
			return line.replace(/(`+)[^`]*?\1/g, (m) => " ".repeat(m.length));
		})
		.join("\n");
}

/** The conversation and chapter a link names, or null when it is not a
 *  Pythia resume link. Obsidian delivers protocol parameters decoded; a link
 *  read out of a note is still encoded, so it is decoded here, once. */
export function parseAnchorUrl(url: string): AnchorRef | null {
	const prefix = "obsidian://pythia?";
	if (!url.startsWith(prefix)) return null;
	const params = new Map<string, string>();
	for (const pair of url.slice(prefix.length).split("&")) {
		const eq = pair.indexOf("=");
		const key = eq < 0 ? pair : pair.slice(0, eq);
		const raw = eq < 0 ? "" : pair.slice(eq + 1);
		let value: string;
		try { value = decodeURIComponent(raw.replace(/\+/g, " ")); } catch { return null; }
		params.set(key, value);
	}
	const id = params.get("id")?.trim();
	if (params.get("cmd") !== "resume" || !id) return null;
	const msg = params.get("msg")?.trim();
	return msg ? { id, msg } : { id };
}

/**
 * THE rule for which Pythia resume link is a note anchor (ADR-249 addendum): a
 * link to a CHAPTER, or one wrapped in `==` exactly. A plain link to a whole
 * conversation stays an ordinary link — that is the `[↗ Name](…)` backlink
 * *Save to inbox* and *Insert into note* have always written, and counting it
 * would protect every conversation ever saved to the inbox from the history
 * limit. Everything the anchor feature itself writes passes: a copied chapter
 * link carries `msg=`, and Pythia wraps what it links in `==`.
 */
export function isNoteAnchor(ref: AnchorRef, highlighted: boolean): boolean {
	return !!ref.msg || highlighted;
}

/** Every anchor in `markdown`, in order. Links inside code are text. */
export function findAnchors(markdown: string): AnchorMatch[] {
	const masked = maskCode(markdown);
	const out: AnchorMatch[] = [];
	for (const m of masked.matchAll(ANCHOR_RE)) {
		const s = m.index ?? 0;
		const linkStart = s + (m[1] ? 2 : 0);
		const textStart = linkStart + 1;
		const urlStart = textStart + m[2].length + 2;
		const linkEnd = urlStart + m[3].length + 1;
		const ref = parseAnchorUrl(markdown.slice(urlStart, urlStart + m[3].length));
		if (!ref) continue;
		// A lone `==` on one side belongs to a highlight around more than the
		// link — the user's, not part of this anchor, and neither is a footnote
		// reference after it.
		const highlighted = m[1] === "==" && m[4] === "==";
		if (!isNoteAnchor(ref, highlighted)) continue;
		const markupEnd = highlighted ? linkEnd + 2 : linkEnd;
		const label = m[5] && (highlighted || !m[4]) ? m[5] : undefined;
		out.push({
			ref,
			text: markdown.slice(textStart, textStart + m[2].length),
			start: highlighted ? s : linkStart,
			end: label ? markupEnd + label.length + 3 : markupEnd,
			markupEnd,
			highlighted,
			...(label ? { footnoteLabel: label } : {}),
		});
	}
	return out;
}

/** 32-bit FNV-1a as 8 hex digits: stable across devices and runs. */
export function fnv1a(text: string): string {
	let h = 0x811c9dc5;
	for (const ch of text) {
		h ^= ch.codePointAt(0)!;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

/** ONE label per target: the same chapter linked twice in a note shares one
 *  footnote, and the label says nothing a reader could misread as a number. */
export function anchorLabel(ref: AnchorRef): string {
	return `${PYTHIA_FOOTNOTE_PREFIX}${fnv1a(`${ref.id}\u0000${ref.msg ?? ""}`)}`;
}

/** The markup Pythia writes over a selection. */
export function anchorMarkup(text: string, url: string, label?: string): string {
	return `==[${text}](${url})==${label ? `[^${label}]` : ""}`;
}

export type SelectionProblem = "empty" | "multiline" | "markup";

/**
 * Whether a selection can become an anchor, or why not. Inline text within one
 * line only: a link cannot cross a paragraph, and a selection that already
 * holds a link, code, a highlight, a footnote or half of an emphasis would come
 * out as broken Markdown — refused, never repaired behind the user's back.
 */
export function selectionProblem(text: string): SelectionProblem | null {
	if (!text.trim()) return "empty";
	if (/[\r\n]/.test(text)) return "multiline";
	if (/[[\]`|]|==|\^\[/.test(text)) return "markup";
	if (/^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(text)) return "markup";
	const doubles = text.match(/\*\*/g)?.length ?? 0;
	const singles = (text.match(/\*/g)?.length ?? 0) - 2 * doubles;
	if (doubles % 2 === 1 || singles % 2 === 1 || (text.match(/~~/g)?.length ?? 0) % 2 === 1) return "markup";
	return null;
}

const sameRef = (a: AnchorRef, b: { messageId?: string }): boolean => (a.msg ?? undefined) === (b.messageId ?? undefined);

/**
 * Make each conversation's records for the note at `path` say exactly what the
 * note says now: an anchor the note holds is recorded, one it no longer holds
 * is dropped. Mutates in place and returns the ids it changed, so only those
 * are saved. `found` may name conversations that do not exist — ignored.
 */
export function reconcileNoteAnchors(
	conversations: Conversation[],
	path: string,
	found: AnchorRef[],
	now: string,
): string[] {
	const byConv = new Map<string, AnchorRef[]>();
	for (const ref of found) {
		const list = byConv.get(ref.id) ?? [];
		if (!list.some((r) => (r.msg ?? undefined) === (ref.msg ?? undefined))) list.push(ref);
		byConv.set(ref.id, list);
	}
	const changed: string[] = [];
	for (const conv of conversations) {
		const current = (conv.noteAnchors ?? []).filter((a) => a.path === path);
		const wanted = byConv.get(conv.id) ?? [];
		const same = current.length === wanted.length && wanted.every((r) => current.some((a) => sameRef(r, a)));
		if (same) continue;
		const others = (conv.noteAnchors ?? []).filter((a) => a.path !== path);
		const next: NoteAnchor[] = wanted.map((r) =>
			current.find((a) => sameRef(r, a)) ?? { path, ...(r.msg ? { messageId: r.msg } : {}), createdAt: now });
		const all = [...others, ...next];
		if (all.length > 0) conv.noteAnchors = all; else delete conv.noteAnchors;
		changed.push(conv.id);
	}
	return changed;
}

/** Record one anchor Pythia just wrote. False when it was already recorded. */
export function recordNoteAnchor(conv: Conversation, path: string, messageId: string | undefined, now: string): boolean {
	const list = conv.noteAnchors ?? [];
	if (list.some((a) => a.path === path && (a.messageId ?? undefined) === (messageId ?? undefined))) return false;
	conv.noteAnchors = [...list, { path, ...(messageId ? { messageId } : {}), createdAt: now }];
	return true;
}

/** `noteAnchors` read back from data.json: well-formed entries or none. */
export function normalizeNoteAnchors(conv: Conversation): void {
	const raw = (conv as { noteAnchors?: unknown }).noteAnchors;
	if (raw === undefined) return;
	if (!Array.isArray(raw)) { delete conv.noteAnchors; return; }
	const seen = new Set<string>();
	const out: NoteAnchor[] = [];
	for (const a of raw as Record<string, unknown>[]) {
		if (!a || typeof a !== "object" || typeof a.path !== "string" || !a.path) continue;
		const messageId = typeof a.messageId === "string" && a.messageId ? a.messageId : undefined;
		const key = `${a.path}\u0000${messageId ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ path: a.path, ...(messageId ? { messageId } : {}), createdAt: typeof a.createdAt === "string" ? a.createdAt : "" });
	}
	if (out.length > 0) conv.noteAnchors = out; else delete conv.noteAnchors;
}
