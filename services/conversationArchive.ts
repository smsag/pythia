import type { Conversation } from "../models/types";
import type { PythiaSettings } from "../models/settings";
import { DEFAULT_SETTINGS } from "../models/settings";
import { stripCitationMarkers } from "./citations";
import { formatDate, formatClockTime } from "./messageUtils";
import { safeNoteName, yamlString } from "./pathUtils";

/**
 * A conversation as a vault note, for the archive that runs before the history
 * limit deletes it (ADR-172).
 *
 * Pure, and deliberately lossless in the only way that matters: the whole
 * transcript, in order, with nothing truncated. An archive that shortened what
 * it saved would be a second, quieter version of the bug it exists to prevent
 * (ADR-171) — the vault is where the content survives once `data.json` no
 * longer holds it.
 */

/** The folder archives are written to, with the default standing in for a
 *  cleared setting. Three callers read it (the eviction, the limit's dialog and
 *  the delete dialog) and none of them owns the fallback. */
export function archiveFolderOf(settings: PythiaSettings): string {
	return settings.archiveFolder || DEFAULT_SETTINGS.archiveFolder;
}

/** ISO date (YYYY-MM-DD) for the note's file name and frontmatter. */
function isoDate(iso: string | undefined): string {
	const d = iso ? new Date(iso) : new Date();
	return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 10);
}

/**
 * Where a conversation's archive note goes. `isTaken` decides collisions —
 * two conversations may carry the same name and the same day, and an archive
 * that overwrote one with the other would lose exactly what it was saving, so
 * the path is suffixed until it is free.
 */
export function archiveNotePath(
	folder: string,
	conv: Conversation,
	isTaken: (path: string) => boolean,
): string {
	const base = `${isoDate(conv.updatedAt ?? conv.createdAt)}-${safeNoteName(conv.name)}`;
	const dir = folder.replace(/\/+$/, "");
	const at = (suffix: string): string => (dir ? `${dir}/${base}${suffix}.md` : `${base}${suffix}.md`);
	if (!isTaken(at(""))) return at("");
	// Bounded: 999 same-named conversations archived on one day is not a case to
	// loop forever over, and the timestamp suffix is always free in practice.
	for (let n = 2; n <= 999; n++) {
		if (!isTaken(at(` ${n}`))) return at(` ${n}`);
	}
	return at(` ${Date.now()}`);
}

/** The note's body: frontmatter Obsidian can query, then the transcript. */
export function archiveNoteContent(conv: Conversation, resumeUri: string): string {
	const context = conv.contextNotes.length > 0
		? conv.contextNotes.map((n) => `  - ${yamlString(n)}`).join("\n")
		: "  []";

	const front = [
		"---",
		'type: "Pythia Archive"',
		`conversation: ${yamlString(conv.name)}`,
		`created: ${isoDate(conv.createdAt)}`,
		`updated: ${isoDate(conv.updatedAt)}`,
		`provider: ${yamlString(conv.provider)}`,
		`model: ${yamlString(conv.model)}`,
		`messages: ${conv.messages.length}`,
		`archived: ${isoDate(new Date().toISOString())}`,
		`source: ${yamlString(resumeUri)}`,
		"context:",
		context,
		"---",
	].join("\n");

	const body: string[] = ["", `# ${conv.name}`, ""];
	if (conv.summaryText) body.push(conv.summaryText.trim(), "");

	for (const msg of conv.messages) {
		const who = msg.role === "user" ? "You" : "Pythia";
		const when = msg.timestamp
			? `${formatDate(msg.timestamp)} · ${formatClockTime(msg.timestamp)}`
			: "";
		body.push(`## ${who}${when ? ` — ${when}` : ""}`, "", stripCitationMarkers(msg.content).trim(), "");
	}

	return `${front}\n${body.join("\n").replace(/\n{3,}$/, "\n")}`;
}
