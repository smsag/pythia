import type { Conversation, MessageSource } from "../models/types";
import { noteBasename } from "./pathUtils";

/**
 * A note or folder moved in the vault: follow it in every conversation
 * (ADR-218). Obsidian rewrites `[[links]]` inside vault notes on a rename, but
 * conversations live in data.json, where nothing followed — an attached note
 * quietly left the context, a cited source said "not found", and the next Save
 * wrote a second copy at the old path.
 *
 * Every stored vault path is listed here and nowhere else; a new path field
 * joins this function or it goes stale on the first rename. The text of a
 * message is deliberately NOT rewritten (a `[[link]]` in what was said is
 * history, and the model sees it); a stale link there says so when tapped.
 *
 * Mutates in place — the view holds these objects, so a chip already on screen
 * opens the new path without a re-render — and returns the ids of the
 * conversations it changed, so only those are marked dirty. Idempotent: a
 * second event for the same move finds nothing left to change, which is what
 * makes it safe that a folder rename may also report each file inside it.
 *
 * Pure: no Obsidian.
 */
export function renameVaultPath(conversations: Conversation[], oldPath: string, newPath: string): string[] {
	if (!oldPath || !newPath || oldPath === newPath) return [];
	const oldName = noteBasename(oldPath);
	const newName = noteBasename(newPath);

	/** The moved path itself, or anything under it when a folder moved. */
	const moved = (p: string): string | null =>
		p === oldPath ? newPath
		: p.startsWith(oldPath + "/") ? newPath + p.slice(oldPath.length)
		: null;

	const changed: string[] = [];
	for (const conv of conversations) {
		let dirty = false;
		const path = (p: string | undefined): string | undefined => {
			if (p === undefined) return p;
			const next = moved(p);
			if (next === null) return p;
			dirty = true;
			return next;
		};
		const paths = (list: string[] | undefined): void => {
			if (!Array.isArray(list)) return;
			for (let i = 0; i < list.length; i++) list[i] = path(list[i]) as string;
		};
		const sources = (list: MessageSource[] | undefined): void => {
			if (!Array.isArray(list)) return;
			for (const s of list) {
				if (s.kind !== "vault") continue;
				const next = path(s.ref) as string;
				if (next === s.ref) continue;
				// The title is the name the row shows; follow it only when it was
				// the old name, never over a title the model gave the note.
				if (s.title === noteBasename(s.ref)) s.title = noteBasename(next);
				else if (s.title === oldName) s.title = newName;
				s.ref = next;
			}
		};

		/** Rewrite one string field in place — only when present, so a field
		 *  the record never had is not created as `undefined`. */
		const field = <T extends object, K extends keyof T>(obj: T | undefined, key: K): void => {
			const value = obj?.[key];
			if (typeof value === "string") (obj as Record<K, unknown>)[key] = path(value);
		};

		paths(conv.contextNotes);
		field(conv, "templateId");
		field(conv, "summaryNote");
		field(conv, "savedNotePath");
		field(conv, "outputFolder");
		field(conv.pendingRewrite, "path");
		field(conv.pendingTemplate, "id");
		field(conv.pendingTemplate, "outputFolder");
		paths(conv.pendingTemplate?.contextNotes);
		for (const m of conv.messages ?? []) {
			paths(m.attachedNotes);
			field(m, "templateId");
			field(m.rewriteTarget, "path");
			for (const w of m.noteWrites ?? []) field(w, "path");
			sources(m.sources);
		}
		for (const c of conv.comparison?.candidates ?? []) {
			field(c, "templateId");
			sources(c.sources);
		}
		if (dirty) changed.push(conv.id);
	}
	return changed;
}
