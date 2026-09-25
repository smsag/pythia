import { Keymap, Notice, TFile, type App, type PaneType } from "obsidian";
import type { Message, NoteWrite } from "../models/types";
import { t } from "../i18n";
import { noteBasename } from "../services/pathUtils";

/**
 * Opening a vault note from the conversation, and the chip that records a note
 * an answer wrote (ADR-218).
 *
 * The rule both follow: **a note is opened by what resolves, never by a name
 * that might not.** `workspace.openLinkText` on a name that no longer resolves
 * creates an empty note of that name — the tap meant "show me what you wrote"
 * and got a blank page, and a stray note in the vault besides. So a tap either
 * opens an existing file or says it is gone.
 */

/** Open the note at `path`, or say it was renamed or deleted. */
export async function openNotePath(app: App, path: string, newLeaf: PaneType | boolean = false): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		await app.workspace.getLeaf(newLeaf).openFile(file);
		return;
	}
	new Notice(t("noteGone", { name: noteBasename(path) }));
}

/**
 * The click handler for `[[links]]` rendered in the conversation — the answers
 * and the user's own messages. Registered once, on the chat container.
 *
 * A link that resolves opens (⌘/Ctrl-click in a new tab, as in a note). One
 * that does not is stopped here and announced, rather than handed on to
 * anything that would create it. A link in a message is history and is never
 * rewritten on a rename (ADR-218), so "no longer resolves" is the normal
 * state of an old one, not an error.
 */
export function onNoteLinkClick(app: App, evt: MouseEvent): void {
	const target = evt.target instanceof Element ? evt.target : null;
	const link = target?.closest<HTMLElement>("a.internal-link");
	if (!link) return;
	const href = link.getAttribute("data-href") ?? link.getAttribute("href") ?? "";
	if (!href) return;
	evt.preventDefault();
	evt.stopPropagation();
	// The link path is everything before a #heading or #^block.
	const linkpath = href.split("#")[0];
	const file = app.metadataCache.getFirstLinkpathDest(linkpath, "");
	if (file) {
		void app.workspace.openLinkText(href, "", Keymap.isModEvent(evt));
		return;
	}
	new Notice(t("noteGone", { name: noteBasename(linkpath) }));
}

/** Literal `t("…")` calls, so the dead-key check in tests/i18n.test.ts sees them. */
function writeLabel(write: NoteWrite): string {
	const name = noteBasename(write.path);
	switch (write.action) {
		case "rewritten": return t("rewrittenNote", { name });
		case "prepended": return t("prependedNote", { name });
		case "created": return t("createdNote", { name });
	}
}

/**
 * Fill `chipEl` as the done state of a note write: the ✓ label as a link to
 * the note. The path is read at tap time from `write`, which a rename updates
 * in place, so a chip already on screen opens the note where it is now.
 */
export function fillNoteWriteChip(app: App, chipEl: HTMLElement, write: NoteWrite): void {
	chipEl.addClass("pythia-tool-call--done");
	const link = chipEl.createEl("a", {
		cls: "pythia-tool-call-link",
		text: writeLabel(write),
		attr: { href: "#" },
	});
	link.addEventListener("click", (e) => {
		e.preventDefault();
		void openNotePath(app, write.path, Keymap.isModEvent(e));
	});
}

/** The chips of the notes an answer wrote, drawn again from the message on
 *  every render — which is what makes them outlive the turn. */
export function paintNoteWrites(app: App, row: HTMLElement, msg: Message): void {
	for (const write of msg.noteWrites ?? []) {
		fillNoteWriteChip(app, row.createDiv({ cls: "pythia-tool-call p-note-write" }), write);
	}
}
