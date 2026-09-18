/**
 * The passage a rewrite will replace (ADR-178).
 *
 * The user selects text in a note, discusses it with Pythia, and applies the
 * answer back over that selection. Between those two moments the editor's own
 * selection is gone — focus moved to the chat — and the note may have been
 * edited, or arrived changed from another device.
 *
 * So the target is a **captured range plus the text that was in it**, and it is
 * verified before anything is written. Finding the passage again by searching
 * for its text is exactly what this must not do: ADR-096 spent three rounds on
 * that failure mode for fork selections, where the cost was a mark that did not
 * paint. Here the cost would be a paragraph overwritten somewhere else.
 *
 * Everything in this module is pure and works on a string, so the rule can be
 * tested without an editor.
 */

import type { EditorPos, RewriteTarget } from "../models/types";

export type TargetState =
	/** The range still holds exactly the captured text — safe to replace. */
	| "ok"
	/** The range exists but holds something else — the note changed underneath. */
	| "stale"
	/** The range is no longer inside the note at all. */
	| "gone";

/** The text between two positions, or null when the range is outside `content`. */
export function rangeText(content: string, from: EditorPos, to: EditorPos): string | null {
	const lines = content.split("\n");
	if (!inBounds(lines, from) || !inBounds(lines, to)) return null;
	if (comparePos(from, to) > 0) return null;
	if (from.line === to.line) return lines[from.line].slice(from.ch, to.ch);

	const out = [lines[from.line].slice(from.ch)];
	for (let i = from.line + 1; i < to.line; i++) out.push(lines[i]);
	out.push(lines[to.line].slice(0, to.ch));
	return out.join("\n");
}

/**
 * Whether the captured passage is still where it was. The comparison is
 * **exact** — no trimming, no whitespace normalization. A rewrite replaces a
 * range, so "close enough" is the wrong test: if the note moved by one
 * character the range is already pointing at the wrong thing.
 */
export function targetState(content: string, target: RewriteTarget): TargetState {
	const current = rangeText(content, target.from, target.to);
	if (current === null) return "gone";
	return current === target.text ? "ok" : "stale";
}

/** `content` with the range replaced. Callers check `targetState` first. */
export function replaceRange(
	content: string,
	from: EditorPos,
	to: EditorPos,
	replacement: string,
): string {
	const lines = content.split("\n");
	const head = lines.slice(0, from.line).concat(lines[from.line].slice(0, from.ch));
	const tail = [lines[to.line].slice(to.ch), ...lines.slice(to.line + 1)];
	return [...head.slice(0, -1), head[head.length - 1] + replacement + tail[0], ...tail.slice(1)].join("\n");
}

/** A short, single-line label for the armed pill — the passage is prose and can
 *  be a page long, but the pill has one line to say which passage it is. */
export function targetLabel(text: string, max = 42): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function inBounds(lines: string[], pos: EditorPos): boolean {
	return (
		Number.isInteger(pos.line) && pos.line >= 0 && pos.line < lines.length &&
		Number.isInteger(pos.ch) && pos.ch >= 0 && pos.ch <= lines[pos.line].length
	);
}

function comparePos(a: EditorPos, b: EditorPos): number {
	return a.line === b.line ? a.ch - b.ch : a.line - b.line;
}
