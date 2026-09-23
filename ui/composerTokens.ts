/**
 * The note link a `#` attachment leaves in the composer (ADR-211).
 *
 * Picking a note used to delete the `#query` you had typed and put the note in
 * the reference row instead — text vanished from under the cursor and reappeared
 * somewhere else. It now leaves an Obsidian wikilink in its place, so the
 * filename is visible where you put it, travels into the sent message, and
 * renders there as a link you can open.
 *
 * Two rules make the rest work, and both live here because they are arithmetic
 * over a string and nothing else:
 *
 * 1. **A token is matched by the literal text Pythia wrote, never by a pattern.**
 *    A note's basename may contain spaces and brackets, so no regex can say where
 *    `[[Q3 revenue]]` ends in a sentence that continues after it. Matching what we
 *    inserted is exact, and it is also why the wikilink form is safe: Pythia never
 *    has to tell a link you typed from one it wrote, because it only ever looks
 *    for its own.
 * 2. **Presence is counted, not tested.** Two notes in different folders can share
 *    a basename and therefore a token. Deleting one occurrence must detach one
 *    note, not both — so occurrences are allocated to tracked notes in order.
 */

import { noteBasename } from "../services/pathUtils";

/** A note attached from the composer, and the exact text inserted for it. */
export interface TrackedNote {
	path: string;
	token: string;
}

/** The text inserted for `path` — the same name the reference-row pill shows. */
export function noteToken(path: string): string {
	return `[[${noteBasename(path)}]]`;
}

/** Non-overlapping occurrences of `token` in `value`. */
function countOccurrences(value: string, token: string): number {
	if (!token) return 0;
	let count = 0;
	let from = 0;
	for (;;) {
		const at = value.indexOf(token, from);
		if (at === -1) return count;
		count++;
		from = at + token.length;
	}
}

export interface TokenPresence {
	/** Tracked notes whose token is still in the composer. */
	present: string[];
	/** Tracked notes whose token is gone — the user deleted or edited it. */
	absent: string[];
}

/**
 * Split the tracked notes by whether their token survives in `value`.
 *
 * The caller makes `conversation.contextNotes` match: this is a two-way sync, not
 * a one-way detach, so an undo that brings a token back re-attaches its note
 * rather than leaving the composer disagreeing with the reference row.
 */
export function tokensPresent(value: string, tracked: readonly TrackedNote[]): TokenPresence {
	const remaining = new Map<string, number>();
	for (const note of tracked) {
		if (!remaining.has(note.token)) remaining.set(note.token, countOccurrences(value, note.token));
	}
	const present: string[] = [];
	const absent: string[] = [];
	for (const note of tracked) {
		const left = remaining.get(note.token) ?? 0;
		if (left > 0) { remaining.set(note.token, left - 1); present.push(note.path); }
		else absent.push(note.path);
	}
	return { present, absent };
}

/** Where the cursor lands after an insert, and the text it lands in. */
export interface Insertion {
	value: string;
	cursor: number;
}

/**
 * Put `tokens` into `value` at `at`.
 *
 * A space is added on each side only where there is not one already, so the
 * sentence reads correctly whether the link is dropped mid-phrase, at the end, or
 * into an empty composer — and the caller never has to think about it.
 */
export function insertTokens(value: string, at: number, tokens: readonly string[]): Insertion {
	if (tokens.length === 0) return { value, cursor: at };
	const pos = Math.min(Math.max(at, 0), value.length);
	const before = value.slice(0, pos);
	const after = value.slice(pos);

	const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
	const body = tokens.join(" ");
	const trail = /^\s/.test(after) ? "" : " ";

	return {
		value:  before + lead + body + trail + after,
		cursor: before.length + lead.length + body.length + trail.length,
	};
}

/** The text with `token` removed once, and the cursor kept where it was. Used
 *  when a pill's × detaches a note the composer still names. */
export function removeToken(value: string, token: string): string {
	const at = value.indexOf(token);
	if (at === -1) return value;
	const end = at + token.length;
	// Take one adjacent space with it, so removing a link from the middle of a
	// sentence does not leave a double space behind.
	const eatsAfter = value.slice(end, end + 1) === " ";
	const eatsBefore = !eatsAfter && at > 0 && value.slice(at - 1, at) === " ";
	return value.slice(0, eatsBefore ? at - 1 : at) + value.slice(eatsAfter ? end + 1 : end);
}
