import { Notice, TFile, type Editor } from "obsidian";
import type PythiaPlugin from "../main";
import type { EditorPos } from "../models/types";
import { anchorMarkup, findAnchors, recordNoteAnchor, selectionProblem, type AnchorRef, type SelectionProblem } from "../services/noteAnchors";
import { needsRefresh } from "../services/chapterSummary";
import { REFRESH_LIMIT, type RefreshResult } from "../services/NoteAnchorService";
import { resumeDeepLink, todayISO } from "../utils";
import { PYTHIA_ICON_ID } from "./pluginIcon";
import { CHAPTER_LINK_ICON } from "./icons";
import { noticeFailure } from "./failureNotice";
import { t } from "../i18n";

/**
 * Everything a note does with a note anchor (ADR-249): start a conversation
 * from a selection and leave the anchor behind, wrap a selection in a copied
 * chapter link, and bring the note's footnotes up to date. Plus the one
 * listener that keeps the records honest: a note that is opened is read for
 * its anchors, so a link pasted by hand is known the next time the history
 * limit runs.
 *
 * Every write here goes through the editor, as one undo step, and only after
 * the text it replaces was checked to be exactly the text the user selected.
 */

const PROBLEM_TEXT: Record<SelectionProblem, () => string> = {
	empty: () => t("anchorSelectionEmpty"),
	multiline: () => t("anchorSelectionMultiline"),
	markup: () => t("anchorSelectionMarkup"),
};

/** The selection as text and an ordered range, read together. */
function captureSelection(editor: Editor): { text: string; from: EditorPos; to: EditorPos } | null {
	const text = editor.getSelection();
	const [range] = editor.listSelections();
	if (!range) return null;
	const { anchor: a, head: b } = range;
	const aFirst = a.line === b.line ? a.ch <= b.ch : a.line < b.line;
	return { text, from: aFirst ? a : b, to: aFirst ? b : a };
}

/** Refused with the reason, or null when the selection can carry a link. */
function refuse(text: string): boolean {
	const problem = selectionProblem(text);
	if (!problem) return false;
	new Notice(PROBLEM_TEXT[problem]());
	return true;
}

export function registerNoteAnchorEntries(plugin: PythiaPlugin): void {
	plugin.addCommand({
		id: "start-linked-conversation",
		name: t("cmdStartLinkedConversation"),
		icon: PYTHIA_ICON_ID,
		editorCallback: (editor, ctx) => startLinked(plugin, editor, ctx.file?.path),
	});

	plugin.addCommand({
		id: "link-selection-to-chapter",
		name: t("cmdLinkSelectionToChapter"),
		icon: CHAPTER_LINK_ICON,
		editorCallback: (editor, ctx) => linkSelectionToChapter(plugin, editor, ctx.file?.path),
	});

	plugin.addCommand({
		id: "update-footnotes",
		name: t("cmdUpdateFootnotes"),
		icon: PYTHIA_ICON_ID,
		checkCallback: (checking) => {
			const file = plugin.app.workspace.getActiveFile();
			if (!file || file.extension !== "md") return false;
			if (!checking) updateFootnotes(plugin, file).catch((err) => noticeFailure("update footnotes", err));
			return true;
		},
	});

	plugin.registerEvent(
		plugin.app.workspace.on("editor-menu", (menu, editor, ctx) => {
			const path = ctx.file?.path;
			const text = editor.getSelection();
			if (!path || !text || selectionProblem(text)) return;
			menu.addItem((item) => item
				.setTitle(t("cmdStartLinkedConversation"))
				.setIcon(PYTHIA_ICON_ID)
				.onClick(() => startLinked(plugin, editor, path)));
			const copied = plugin.noteAnchors.copied;
			if (copied) {
				menu.addItem((item) => item
					.setTitle(t("linkSelectionToNamed", { name: copied.name }))
					.setIcon(CHAPTER_LINK_ICON)
					.onClick(() => linkSelectionToChapter(plugin, editor, path)));
			}
		})
	);

	plugin.registerEvent(
		plugin.app.workspace.on("file-open", (file) => {
			if (file instanceof TFile) void plugin.noteAnchors.recordFromFile(file);
		})
	);
}

/** A command's async work, with a failure said rather than swallowed. */
function startLinked(plugin: PythiaPlugin, editor: Editor, path: string | undefined): void {
	startLinkedConversation(plugin, editor, path).catch((err) => noticeFailure("start linked conversation", err));
}

/**
 * Selection → a new conversation about it, and the selection becomes an anchor
 * to that conversation. Creating the conversation is an await, so the range is
 * checked again afterwards; if the note changed, the conversation still starts
 * but nothing is written into the note, and the user is told.
 */
export async function startLinkedConversation(plugin: PythiaPlugin, editor: Editor, path: string | undefined): Promise<void> {
	const sel = captureSelection(editor);
	if (!path || !sel || refuse(sel.text)) return;

	const conv = await plugin.createConversation({ name: `Conversation ${todayISO()}` });
	if (editor.getRange(sel.from, sel.to) === sel.text) {
		editor.replaceRange(anchorMarkup(sel.text, resumeDeepLink(conv.id, plugin.app.vault.getName())), sel.from, sel.to);
		recordNoteAnchor(conv, path, undefined, new Date().toISOString());
		await plugin.conversationStore.save(conv);
	} else {
		new Notice(t("anchorSelectionChanged"));
	}
	const view = await plugin.activateView();
	await view.setActiveConversation(conv);
	view.triggerAutoPrompt(sel.text);
}

/** Selection → wrapped in the chapter link copied in the panel. Synchronous
 *  from the read to the write, so nothing can change the text in between. */
export function linkSelectionToChapter(plugin: PythiaPlugin, editor: Editor, path: string | undefined): void {
	const copied = plugin.noteAnchors.copied;
	if (!copied) { new Notice(t("noChapterCopied")); return; }
	const text = editor.getSelection();
	if (!path || refuse(text)) return;
	editor.replaceSelection(anchorMarkup(text, copied.url));
	new Notice(t("anchorLinked", { name: copied.name }));
	afterLinked(plugin, copied.ref, path).catch((err) => noticeFailure("link selection", err));
}

/** The anchor is in the note: record it, write its summary if the chapter has
 *  none, and its footnote when the setting says so. */
async function afterLinked(plugin: PythiaPlugin, ref: AnchorRef, path: string): Promise<void> {
	const conv = plugin.conversationStore.getById(ref.id);
	if (conv && recordNoteAnchor(conv, path, ref.msg, new Date().toISOString())) await plugin.conversationStore.save(conv);
	if (needsRefresh(plugin.noteAnchors.status(ref))) await plugin.noteAnchors.refresh([ref], { onProgress: () => {} });
	const file = plugin.app.vault.getAbstractFileByPath(path);
	if (plugin.settings.anchorFootnotes && file instanceof TFile) await plugin.noteAnchors.updateNote(file);
}

/** The command: refresh what is missing or outdated, then write the footnotes. */
export async function updateFootnotes(plugin: PythiaPlugin, file: TFile): Promise<void> {
	const text = await plugin.app.vault.read(file);
	await plugin.noteAnchors.recordFromText(file.path, text);
	const result = await plugin.noteAnchors.refreshSummaries(text, { onProgress: () => {} });
	const changed = await plugin.noteAnchors.updateNote(file);
	if (findAnchors(text).length === 0 && !changed) { new Notice(t("footnotesNoAnchors")); return; }
	new Notice(t("footnotesUpdated", { count: String(result.refreshed) }));
	if (result.failed.length > 0) new Notice(describeFailures(result), 10000);
}

/** One line naming why each summary was not written. */
export function describeFailures(result: RefreshResult): string {
	const reasons = new Set(result.failed.map((f) => {
		switch (f.reason) {
			case "limit": return t("footnotesRefreshLimit", { max: String(REFRESH_LIMIT) });
			case "empty": return t("footnotesRefreshEmpty");
			case "changed": return t("footnotesRefreshGone");
			case "deleted": return t("noteAnchorDeleted");
			case "unanswered": return t("noteAnchorUnanswered");
			default: return t("footnotesRefreshError");
		}
	}));
	return t("footnotesRefreshFailed", { count: String(result.failed.length), reasons: [...reasons].join("; ") });
}
