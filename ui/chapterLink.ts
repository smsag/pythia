import { Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation, Message } from "../models/types";
import { resumeDeepLink } from "../utils";
import { chapterLabel } from "../services/chapterSummary";
import { copyText, copyTextWithFeedback } from "./clipboard";
import { CHAPTER_LINK_ICON } from "./icons";
import { t } from "../i18n";

/**
 * Copy a link to one chapter — a user message and its answer (ADR-249). From
 * every chapter: the navigator's chapter list and the label above each user
 * message. Pasted into a note, the link IS a note anchor; the copy is also held
 * for "Link selection to …", which wraps selected text in it.
 */

/** "Conversation › Chapter" — how the menu entry names what it links to. */
export function chapterDisplayName(conv: Conversation, msg: Message): string {
	return `${conv.name} › ${chapterLabel(msg)}`;
}

export async function copyChapterLink(plugin: PythiaPlugin, conv: Conversation, msg: Message, btn?: HTMLElement): Promise<void> {
	const url = resumeDeepLink(conv.id, plugin.app.vault.getName(), msg.id);
	const name = chapterDisplayName(conv, msg);
	plugin.noteAnchors.copied = { ref: { id: conv.id, msg: msg.id }, url, name };
	// A refused clipboard is said by the helper; the link is still held for
	// "Link selection to …".
	const copied = btn ? await copyTextWithFeedback(btn, url, CHAPTER_LINK_ICON) : await copyText(url);
	if (copied) new Notice(t("chapterLinkCopied", { name }));
}

/**
 * The copy control in a user message's label row. Its own button beside the
 * label text, not inside it: the label is re-rendered as text elsewhere.
 */
export function appendChapterLinkButton(row: HTMLElement, onCopy: (btn: HTMLElement) => void): void {
	const label = row.querySelector<HTMLElement>(".p-turn-label");
	if (!label) return;
	const btn = label.createEl("button", {
		cls: "pb pb-icon is-inline p-chapter-link",
		attr: { "aria-label": t("copyChapterLink"), title: t("copyChapterLink") },
	});
	setIcon(btn, CHAPTER_LINK_ICON);
	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		onCopy(btn);
	});
}
