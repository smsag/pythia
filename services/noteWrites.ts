import type { NoteWrite } from "../models/types";
import { noteBasename } from "./pathUtils";

/**
 * A note an answer wrote, from the tool result to the chip that outlives the
 * turn (ADR-218). Pure: the one format for the result line, the one parser of
 * it, and the load-time validator for what persistence hands back.
 *
 * The tool result is the only thing that knows the path the vault actually
 * used — `createNote` may have normalised or de-duplicated the one the model
 * asked for — so the record is read from it, never from the call's arguments.
 */

const VERB: Record<NoteWrite["action"], string> = {
	created: "written",
	rewritten: "written",
	prepended: "updated",
};

/** `[[Folder/Note|Note]]` — the full path so the link resolves to THIS note
 *  when two share a name, the basename so it reads like one. */
export function noteWikilink(path: string): string {
	const target = path.replace(/\.md$/, "");
	const name = noteBasename(path);
	return target === name ? `[[${name}]]` : `[[${target}|${name}]]`;
}

/** The tool result for a successful write. The first line is what
 *  `parseNoteWrite` reads; the second tells the model how to name the note,
 *  because a name in plain text is not a link the user can open. */
export function noteWriteResult(action: NoteWrite["action"], path: string): string {
	return `Note ${VERB[action]}: ${path}\nWhen you mention it in your answer, write it as the link ${noteWikilink(path)} so the user can open it. Inside a table, escape the bar as \\|.`;
}

/**
 * The text of an answer whose only output was a note write — no words, or the
 * user pressed Stop, or the stream failed after the write (ADR-218 addendum).
 * The note exists either way, so the turn is kept, and a provider rejects an
 * empty assistant message, so it says what happened. "" for no writes.
 */
export function writesOnlyContent(writes: NoteWrite[]): string {
	return writes.length > 0 ? `Wrote ${writes.map((w) => noteWikilink(w.path)).join(", ")}.` : "";
}

const RESULT_RE = /^Note (?:written|updated): (.+)$/m;

/** The write a successful tool result records, or null for anything else. */
export function parseNoteWrite(toolName: string, result: string): NoteWrite | null {
	const action: NoteWrite["action"] | null =
		toolName === "create_note" ? "created"
		: toolName === "rewrite_note" ? "rewritten"
		: toolName === "prepend_note" ? "prepended"
		: null;
	if (!action) return null;
	const m = RESULT_RE.exec(result);
	const path = m?.[1].trim();
	return path ? { path, action } : null;
}

const ACTIONS: readonly NoteWrite["action"][] = ["created", "rewritten", "prepended"];

/** Load-time validation (principle 1): keeps well-formed entries, drops the
 *  rest, and returns undefined when nothing survives. */
export function normalizeNoteWrites(value: unknown): NoteWrite[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: NoteWrite[] = [];
	for (const w of value) {
		if (!w || typeof w !== "object") continue;
		const { path, action } = w as { path?: unknown; action?: unknown };
		if (typeof path !== "string" || !path.trim()) continue;
		if (!ACTIONS.includes(action as NoteWrite["action"])) continue;
		out.push({ path, action: action as NoteWrite["action"] });
	}
	return out.length > 0 ? out : undefined;
}
