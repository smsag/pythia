import { App, TFile } from "obsidian";
import type { Conversation } from "../models/types";
import { estimateTokensFromText } from "./messageUtils";
import { selectRelevantChunks } from "./noteChunking";
import {
	SYSTEM_PROMPT_TAG,
	PREVIOUS_SUMMARY_TAG,
	ATTACHED_NOTE_TAG,
	ATTACHED_NOTE_PATH_ATTR,
	ATTACHED_NOTE_EXCERPT_ATTR,
} from "./promptConstants";

/**
 * Builds the system prompt from a conversation's system prompt text and
 * optional summary.
 */
export function buildSystemPrompt(conversation: Conversation): string {
	const parts: string[] = [];

	if (conversation.systemPrompt) {
		parts.push(
			`<${SYSTEM_PROMPT_TAG}>\n${conversation.systemPrompt}\n</${SYSTEM_PROMPT_TAG}>`
		);
	}

	if (conversation.summaryText) {
		parts.push(
			`<${PREVIOUS_SUMMARY_TAG}>\n${conversation.summaryText}\n</${PREVIOUS_SUMMARY_TAG}>`
		);
	}

	if (conversation.contextNotes.length > 0) {
		parts.push(
			"Ground your answers in the content of the attached notes below. " +
			"If they don't contain the information needed to answer, say so explicitly rather than guessing."
		);
	}

	return parts.join("\n\n");
}

export async function buildAttachedNotesContent(
	app: App,
	attachedNotes: string[],
	/** The user's in-progress message — used to pick the most relevant sections of long notes. */
	query = ""
): Promise<{ content: string; missingNotes: string[]; estimatedTokens: number }> {
	if (attachedNotes.length === 0) return { content: "", missingNotes: [], estimatedTokens: 0 };
	// Reads are independent of each other — parallelize, then assemble in the
	// original attachedNotes order so prompt content stays deterministic.
	const results = await Promise.all(
		attachedNotes.map(async (notePath): Promise<{ notePath: string; part?: string }> => {
			const file = app.vault.getAbstractFileByPath(notePath);
			if (!(file instanceof TFile)) return { notePath };
			const raw = await app.vault.read(file);
			const { text, isExcerpt } = selectRelevantChunks(raw, query);
			const body = isExcerpt
				? `(Showing only the most relevant sections of this note — it has been shortened.)\n\n${text}`
				: text;
			return {
				notePath,
				part: `<${ATTACHED_NOTE_TAG} ${ATTACHED_NOTE_PATH_ATTR}="${notePath}"${isExcerpt ? ` ${ATTACHED_NOTE_EXCERPT_ATTR}="true"` : ""}>\n${body}\n</${ATTACHED_NOTE_TAG}>`,
			};
		})
	);
	const parts: string[] = [];
	const missingNotes: string[] = [];
	for (const r of results) {
		if (r.part !== undefined) parts.push(r.part);
		else missingNotes.push(r.notePath);
	}
	const content = parts.length > 0 ? "\n\n" + parts.join("\n\n") : "";
	return {
		content,
		missingNotes,
		estimatedTokens: estimateTokensFromText(content),
	};
}
