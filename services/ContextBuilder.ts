import { App, TFile } from "obsidian";
import type { Conversation } from "../models/types";
import { estimateTokensFromText } from "./messageUtils";
import { selectRelevantChunks } from "./noteChunking";

/**
 * Builds the system prompt from a conversation's system prompt text and
 * optional summary.
 */
export function buildSystemPrompt(conversation: Conversation): string {
	const parts: string[] = [];

	if (conversation.systemPrompt) {
		parts.push(
			`<system_prompt>\n${conversation.systemPrompt}\n</system_prompt>`
		);
	}

	if (conversation.summaryText) {
		parts.push(
			`<previous_conversation_summary>\n${conversation.summaryText}\n</previous_conversation_summary>`
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
	const parts: string[] = [];
	const missingNotes: string[] = [];
	for (const notePath of attachedNotes) {
		const file = app.vault.getAbstractFileByPath(notePath);
		if (file instanceof TFile) {
			const raw = await app.vault.read(file);
			const { text, isExcerpt } = selectRelevantChunks(raw, query);
			const body = isExcerpt
				? `(Showing only the most relevant sections of this note — it has been shortened.)\n\n${text}`
				: text;
			parts.push(
				`<attached_note path="${notePath}"${isExcerpt ? ' excerpt="true"' : ""}>\n${body}\n</attached_note>`
			);
		} else {
			missingNotes.push(notePath);
		}
	}
	const content = parts.length > 0 ? "\n\n" + parts.join("\n\n") : "";
	return {
		content,
		missingNotes,
		estimatedTokens: estimateTokensFromText(content),
	};
}
