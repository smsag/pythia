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
	const vault = encodeURIComponent(vaultName);
	const uri = `obsidian://pythia?vault=${vault}&cmd=resume&id=${encodeURIComponent(conv.id)}`;
	// A `]` in the conversation name would close the link text early and leave
	// the rest of the name — and the URI — as literal text.
	const label = conv.name.replace(/[[\]]/g, "\\$&");
	return `${text}\n\n[↗ ${label}](${uri})`;
}
