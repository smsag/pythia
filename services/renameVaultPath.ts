import type { ComparisonCandidate, Conversation, MessageSource } from "../models/types";
import type { PythiaSettings } from "../models/settings";
import { noteBasename } from "./pathUtils";

/**
 * Notes and folders moved in the vault: follow them in every stored vault path
 * (ADR-218 and its addendum). Obsidian rewrites `[[links]]` inside vault notes
 * on a rename, but conversations and settings live in data.json, where nothing
 * followed — an attached note quietly left the context, a cited source said
 * "not found", the next Save wrote a second copy at the old path, and a renamed
 * templates folder emptied the template list.
 *
 * Every stored vault path is listed here and nowhere else — the conversation
 * fields in `renameVaultPaths`, the settings in `SETTINGS_PATH_KEYS` — and
 * `tests/pathFields.test.ts` makes the compiler refuse a new field that has not
 * been classified. The text of a message is deliberately NOT rewritten (D-58).
 *
 * Pure: no Obsidian.
 */

/** One move the vault reported: a note or a folder, `from` → `to`. */
export interface RenamePair {
	from: string;
	to: string;
}

/** A path's new place, or the path itself when no rename touched it. */
export type PathMover = (path: string) => string;

/** `p` moved by one pair — the path itself, or anything under a moved folder. */
function moveBy(p: string, pair: RenamePair): string {
	if (p === pair.from) return pair.to;
	if (p.startsWith(pair.from + "/")) return pair.to + p.slice(pair.from.length);
	return p;
}

/** The first segment of a path: `a` for `a/b/c.md`, the name itself at the root. */
function topLevel(p: string): string {
	const i = p.indexOf("/");
	return i < 0 ? p : p.slice(0, i);
}

/** The path and every folder above it, deepest first: `a/b/c.md`, `a/b`, `a`. */
function selfAndAncestors(p: string): string[] {
	const out = [p];
	for (let i = p.lastIndexOf("/"); i > 0; i = p.lastIndexOf("/", i - 1)) out.push(p.slice(0, i));
	return out;
}

/**
 * The pairs a batch actually needs. A folder rename is reported for the folder
 * AND (on Obsidian's side) for every file inside it; the file pairs are implied
 * by the folder pair and are dropped here, so a folder of 500 notes costs one
 * pair, not 500 (addendum finding 1).
 */
export function essentialRenames(pairs: RenamePair[]): RenamePair[] {
	const valid = pairs.filter((p) => p.from && p.to && p.from !== p.to);
	const byFrom = new Map<string, RenamePair>();
	for (const p of valid) byFrom.set(p.from, p);
	return valid.filter((q) => {
		for (const a of selfAndAncestors(q.from).slice(1)) {
			const f = byFrom.get(a);
			if (f && q.to === f.to + q.from.slice(a.length)) return false;
		}
		return true;
	});
}

/**
 * Compile a batch into one mover, so the conversations are scanned once per
 * batch however many pairs it holds.
 *
 * When the pairs are independent — no pair's source or target sits on, above or
 * below another pair's source — a path finds its pair in one map lookup per
 * folder level. Otherwise (a chain `a → b`, `b → c`, or a swap through a
 * temporary name) the pairs are applied in the order the vault reported them,
 * which is correct by construction and rare enough that its cost does not
 * matter.
 */
export function compileRenames(pairs: RenamePair[]): PathMover {
	const kept = essentialRenames(pairs);
	if (kept.length === 0) return (p) => p;
	const byFrom = new Map<string, RenamePair>();
	for (const p of kept) byFrom.set(p.from, p);

	// Linear in the batch: each check walks one path's folders, never the batch.
	const tos = new Set(kept.map((p) => p.to));
	const overlaps = kept.some((p) =>
		selfAndAncestors(p.to).some((a) => byFrom.has(a)) ||          // a chain: moved onto or into a source
		selfAndAncestors(p.from).slice(1).some((a) => byFrom.has(a)) || // a source inside another source
		selfAndAncestors(p.from).slice(1).some((a) => tos.has(a))       // a source inside another target
	);

	if (overlaps) return (path) => kept.reduce(moveBy, path);
	// The hot loop runs for every stored path in every conversation, and almost
	// every path is untouched: reject on the top-level folder before walking up.
	const roots = new Set(kept.map((p) => topLevel(p.from)));
	// A handful of roots (the usual burst) is checked without allocating; a
	// large set by one slice and a lookup.
	const few = roots.size <= 4 ? [...roots].map((r) => [r, r + "/"] as const) : null;
	const untouched = few
		? (path: string): boolean => !few.some(([r, prefix]) => path === r || path.startsWith(prefix))
		: (path: string): boolean => !roots.has(topLevel(path));
	return (path) => {
		if (untouched(path)) return path;
		for (let a = path; ; ) {
			const pair = byFrom.get(a);
			if (pair) return pair.to + path.slice(a.length);
			const i = a.lastIndexOf("/");
			if (i <= 0) return path;
			a = a.slice(0, i);
		}
	};
}

/**
 * Follow a batch in every conversation. Mutates in place — the view holds these
 * objects, so a chip already on screen opens the new path without a re-render —
 * and returns the ids it changed, so only those are marked dirty. Idempotent.
 *
 * `accept`, when given, must approve each new path (the rename log's replay
 * passes "exists in the vault", so a stale entry can never move a path to a
 * place that is not there).
 */
export function renameVaultPaths(
	conversations: Conversation[],
	pairs: RenamePair[],
	accept?: (newPath: string) => boolean,
): string[] {
	const mover = compileRenames(pairs);
	const changed: string[] = [];
	for (const conv of conversations) {
		let dirty = false;
		const path = (p: string): string => {
			const next = mover(p);
			if (next === p || (accept && !accept(next))) return p;
			dirty = true;
			return next;
		};
		const paths = (list: string[] | undefined): void => {
			if (!Array.isArray(list)) return;
			for (let i = 0; i < list.length; i++) {
				if (typeof list[i] === "string") list[i] = path(list[i]);
			}
		};
		const sources = (list: MessageSource[] | undefined): void => {
			if (!Array.isArray(list)) return;
			for (const s of list) {
				if (s.kind !== "vault" || typeof s.ref !== "string") continue;
				const next = path(s.ref);
				if (next === s.ref) continue;
				// The title is the name the row shows; follow it only when it was
				// the old name, never over a title the model gave the note.
				if (s.title === noteBasename(s.ref)) s.title = noteBasename(next);
				s.ref = next;
			}
		};
		/** Rewrite one string field in place — only when present, so a field
		 *  the record never had is not created as `undefined`. */
		const field = <T extends object, K extends keyof T>(obj: T | undefined, key: K): void => {
			const value = obj?.[key];
			if (typeof value === "string") (obj as Record<K, unknown>)[key] = path(value);
		};

		/** A comparison answer — pending, or kept as an alternative tab (ADR-219). */
		const candidate = (c: ComparisonCandidate): void => {
			field(c, "templateId");
			sources(c.sources);
			for (const w of c.noteWrites ?? []) field(w, "path");
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
			for (const c of m.alternatives ?? []) candidate(c);
		}
		for (const c of conv.comparison?.candidates ?? []) candidate(c);
		if (dirty) changed.push(conv.id);
	}
	return changed;
}

/** The settings that hold a vault path (a folder or a note). */
export const SETTINGS_PATH_KEYS = [
	"templatesFolder",
	"conversationsFolder",
	"scratchFolder",
	"archiveFolder",
	"inboxNote",
	"glossaryNote",
	"glossaryFolder",
	"promptOptimizerTemplateId",
] as const satisfies readonly (keyof PythiaSettings)[];

/** The settings that hold a list of vault paths. */
export const SETTINGS_PATH_LIST_KEYS = ["vaultContextFolders"] as const satisfies readonly (keyof PythiaSettings)[];

/**
 * Follow a batch in the settings (addendum finding 2). A settings path is typed
 * by hand, so it is compared without surrounding space or trailing slashes; a
 * moved one is written back in the vault's own spelling. An empty value means
 * "the default" or "none" and is never touched. Returns the keys it changed.
 */
export function renameSettingsPaths(
	settings: PythiaSettings,
	pairs: RenamePair[],
	accept?: (newPath: string) => boolean,
): string[] {
	const mover = compileRenames(pairs);
	const move = (value: unknown): string | null => {
		if (typeof value !== "string") return null;
		const p = value.trim().replace(/\/+$/, "");
		if (!p) return null;
		const next = mover(p);
		return next === p || (accept && !accept(next)) ? null : next;
	};
	const changed: string[] = [];
	for (const key of SETTINGS_PATH_KEYS) {
		const next = move(settings[key]);
		if (next !== null) {
			settings[key] = next;
			changed.push(key);
		}
	}
	for (const key of SETTINGS_PATH_LIST_KEYS) {
		const list = settings[key];
		if (!Array.isArray(list)) continue;
		let dirty = false;
		for (let i = 0; i < list.length; i++) {
			const next = move(list[i]);
			if (next !== null) { list[i] = next; dirty = true; }
		}
		if (dirty) changed.push(key);
	}
	return changed;
}
