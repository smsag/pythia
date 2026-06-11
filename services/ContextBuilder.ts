import { App, TFile } from "obsidian";
import type { Conversation } from "../models/types";

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

	return parts.join("\n\n");
}

export async function buildAttachedNotesContent(
	app: App,
	attachedNotes: string[]
): Promise<{ content: string; missingNotes: string[] }> {
	if (attachedNotes.length === 0) return { content: "", missingNotes: [] };
	const parts: string[] = [];
	const missingNotes: string[] = [];
	for (const notePath of attachedNotes) {
		const file = app.vault.getAbstractFileByPath(notePath);
		if (file instanceof TFile) {
			const content = await app.vault.read(file);
			parts.push(
				`<attached_note path="${notePath}">\n${content}\n</attached_note>`
			);
		} else {
			missingNotes.push(notePath);
		}
	}
	return {
		content: parts.length > 0 ? "\n\n" + parts.join("\n\n") : "",
		missingNotes,
	};
}
