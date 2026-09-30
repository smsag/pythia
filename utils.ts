import { TFile, TFolder } from "obsidian";

export function getFilesInFolder(folder: TFolder): TFile[] {
	const results: TFile[] = [];
	const walk = (f: TFolder) => {
		for (const child of f.children) {
			if (child instanceof TFile && (child.extension === "md" || child.extension === "pdf")) {
				results.push(child);
			} else if (child instanceof TFolder) {
				walk(child);
			}
		}
	};
	walk(folder);
	return results;
}

/**
 * The `obsidian://pythia` deep link that reopens a conversation. One builder,
 * because the header's copy-link action, the inbox/insert backlinks and the
 * summary-note frontmatter each had their own — and the header's had dropped
 * the `vault` parameter, so its link opened whichever vault was active.
 *
 * `messageId` makes it a chapter link (ADR-249): the conversation opens at that
 * user message. A note that holds such a link is a note anchor.
 */
export function resumeDeepLink(conversationId: string, vaultName: string, messageId?: string): string {
	const base = `obsidian://pythia?vault=${encodeURIComponent(vaultName)}&cmd=resume&id=${encodeURIComponent(conversationId)}`;
	return messageId ? `${base}&msg=${encodeURIComponent(messageId)}` : base;
}

/**
 * The link a passage in a note gets when it starts a conversation (ADR-253):
 * the resume link plus `&anchor=1`, which is what makes a link to a WHOLE
 * conversation a note anchor without `==` around it. The deep-link handler
 * ignores the flag, so the link opens the conversation like any resume link.
 */
export function anchorDeepLink(conversationId: string, vaultName: string): string {
	return `${resumeDeepLink(conversationId, vaultName)}&anchor=1`;
}

/** What a shortcut link does: open Pythia, start a conversation, or start one
 *  with a question — `ask` ends in `&text=` so a Shortcut appends its input. */
export type PythiaLinkKind = "open" | "new" | "ask";

/**
 * The shortcut link (ADR-241). What the settings tab's Copy link buttons put on
 * the clipboard, for a macOS / iOS Shortcut's "Open URL" action. `&new` is a
 * flag, not a verb, so the same link reads as "Pythia" with one switch added.
 */
export function pythiaLink(vaultName: string, kind: PythiaLinkKind = "open"): string {
	const base = `obsidian://pythia?vault=${encodeURIComponent(vaultName)}`;
	if (kind === "open") return base;
	return kind === "new" ? `${base}&new=true` : `${base}&new=true&text=`;
}

/** Today's date as `YYYY-MM-DD` in the user's LOCAL time zone. `toISOString()`
 *  reports UTC, so a conversation started at 23:30 in Berlin used to be named
 *  and filed under the previous day. */
export function todayISO(now: Date = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/**
 * Append a deep link back to `conv` beneath `text`.
 *
 * Text lifted out of a conversation into the vault is worth little without a way
 * back to where it was said, so Insert-into-note and Save-to-inbox both attach
 * one. They built the same URI independently until this was extracted (ADR-136
 * session); a link format duplicated across call sites is a link format that
 * will eventually disagree with itself.
 *
 * Returns `text` unchanged when there is no conversation to point at.
 */
export function withConversationBacklink(
	text: string,
	conv: { id: string; name: string } | null,
	vaultName: string,
): string {
	if (!conv) return text;
	const uri = resumeDeepLink(conv.id, vaultName);
	// A `]` in the conversation name would close the link text early and leave
	// the rest of the name — and the URI — as literal text.
	const label = conv.name.replace(/[[\]]/g, "\\$&");
	return `${text}\n\n[↗ ${label}](${uri})`;
}
