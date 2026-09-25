import { Platform, TFile, TFolder, type App } from "obsidian";
import type { NoteDropTarget } from "./ComposerField";
import { getFilesInFolder } from "../utils";

/**
 * Notes dragged from the vault onto the composer (ADR-214).
 *
 * What a drag carries was read from Obsidian's own `DragManager` (1.13.7), not
 * guessed:
 *
 * | dragged from                         | `dragManager.draggable`         | `text/plain` on the drag          |
 * |--------------------------------------|---------------------------------|-----------------------------------|
 * | a file (explorer, search, tab, …)    | `{ type: "file", file }`        | `obsidian://open?vault=…&file=…`  |
 * | several selected items               | `{ type: "files", files }`      | one URL per FILE — folders absent |
 * | a folder                             | `{ type: "folder", file }`      | the folder's NAME only            |
 * | a link (a note, backlinks, …)        | `{ type: "link", file }`        | its URL, or the bare linktext     |
 *
 * So the text alone cannot resolve a folder, and the draggable is the only
 * complete answer — but `dragManager` is not public API. Both are read, both as
 * untrusted (principle 1): the draggable only through `instanceof TFile/TFolder`
 * checks, the text only as `obsidian://` URLs **for this vault** or `[[links]]`,
 * each resolved against the vault. Anything else is not a note drop, and the
 * composer's ordinary text drop handles it.
 */

/** Only what a note-picker attaches: Markdown and PDF (as `InlineSuggest`). */
const ATTACHABLE = new Set(["md", "pdf"]);
const attachable = (f: TFile): boolean => ATTACHABLE.has(f.extension);

/** A view claims a dropped file itself when this modifier is held ("open in this
 *  tab") — Obsidian's rule, read from `View.handleDrop`. The composer leaves
 *  such a drop alone so the gesture keeps meaning what it means everywhere. */
export function wantsOpenInTab(e: { shiftKey: boolean; altKey: boolean }, isMacOS: boolean): boolean {
	return isMacOS ? e.shiftKey : e.altKey;
}

/** The vault items in Obsidian's in-flight drag, or null when it is not one. */
export function itemsFromDraggable(d: unknown): Array<TFile | TFolder> | null {
	if (!d || typeof d !== "object") return null;
	const { type, file, files } = d as { type?: unknown; file?: unknown; files?: unknown };
	const isItem = (x: unknown): x is TFile | TFolder => x instanceof TFile || x instanceof TFolder;
	if ((type === "file" || type === "folder" || type === "link") && isItem(file)) return [file];
	if (type === "files" && Array.isArray(files)) {
		const items = files.filter(isItem);
		return items.length > 0 ? items : null;
	}
	return null;
}

/**
 * The link paths named by a drag's text: every `obsidian://open` URL for THIS
 * vault (one per line, as `dragFiles` writes them) and every `[[link]]`. A URL
 * for another vault is ignored — its path means nothing here.
 */
export function linkpathsFromText(text: string, vaultName: string): string[] {
	const out: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line.startsWith("obsidian://open?")) continue;
		let url: URL;
		try { url = new URL(line); } catch { continue; } // a malformed line is simply not a note
		if (url.searchParams.get("vault") !== vaultName) continue;
		const file = url.searchParams.get("file");
		if (file) out.push(file);
	}
	for (const m of text.matchAll(/\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
		out.push(m[1].trim());
	}
	return out;
}

/** A link path as Obsidian writes it — a vault path with or without `.md`, or a
 *  linktext — resolved to the file it names, or null. */
function resolveLinkpath(app: App, linkpath: string): TFile | TFolder | null {
	const direct = app.vault.getAbstractFileByPath(linkpath) ?? app.vault.getAbstractFileByPath(`${linkpath}.md`);
	if (direct instanceof TFile || direct instanceof TFolder) return direct;
	return app.metadataCache.getFirstLinkpathDest(linkpath, "");
}

/** Obsidian's in-flight drag, read defensively: private API, may be absent. */
export function currentDraggable(app: App): unknown {
	return (app as unknown as { dragManager?: { draggable?: unknown } }).dragManager?.draggable ?? null;
}

/** True while dragging over the composer when the drag is notes from this vault
 *  — during `dragover` the drag's text is not readable, so only the draggable
 *  can say. */
export function isNoteDrag(app: App): boolean {
	return itemsFromDraggable(currentDraggable(app)) !== null;
}

/**
 * The vault paths a drop attaches, in the order dragged, folders expanded to
 * their notes, duplicates removed. Empty when the drop is not notes.
 */
export function droppedNotePaths(app: App, text: string): string[] {
	const items = itemsFromDraggable(currentDraggable(app))
		?? linkpathsFromText(text, app.vault.getName())
			.map((p) => resolveLinkpath(app, p))
			.filter((x): x is TFile | TFolder => x !== null);
	const paths: string[] = [];
	for (const item of items) {
		const files = item instanceof TFolder ? getFilesInFolder(item) : [item];
		for (const f of files) if (attachable(f) && !paths.includes(f.path)) paths.push(f.path);
	}
	return paths;
}

/**
 * The composer's drop target for vault notes: a drag of notes attaches through
 * `attach` — the `#` picker's own path — unless the user holds Obsidian's
 * "open in this tab" modifier, which then keeps its meaning.
 */
export function vaultNoteDrop(app: App, attach: (paths: string[]) => void): NoteDropTarget {
	const openInTab = (e: DragEvent): boolean => wantsOpenInTab(e, Platform.isMacOS);
	return {
		isNoteDrag: (e) => !openInTab(e) && isNoteDrag(app),
		paths: (e) => (openInTab(e) ? [] : droppedNotePaths(app, e.dataTransfer?.getData("text/plain") ?? "")),
		attach,
	};
}
