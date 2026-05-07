import { App, TFile } from "obsidian";
import type { Conversation } from "../models/types";

/**
 * Builds the full system prompt string from a conversation's system prompt,
 * context notes, and optional summary. Shared across all LLM providers.
 *
 * Returns the assembled prompt alongside any note paths that could not be
 * resolved in the vault (renamed, moved, or deleted notes).
 */
export async function buildSystemPrompt(
	app: App,
	conversation: Conversation
): Promise<{ prompt: string; missingNotes: string[] }> {
	const parts: string[] = [];
	const missingNotes: string[] = [];

	if (conversation.systemPrompt) {
		parts.push(
			`<system_prompt>\n${conversation.systemPrompt}\n</system_prompt>`
		);
	}

	if (conversation.contextNotes.length > 0) {
		const contextParts: string[] = [];
		for (const notePath of conversation.contextNotes) {
			const file = app.vault.getAbstractFileByPath(notePath);
			if (file instanceof TFile) {
				const content = await app.vault.read(file);
				const filename = notePath.split("/").pop() ?? notePath;
				contextParts.push(
					`<note name="${filename}">\n${content}\n</note>`
				);
			} else {
				missingNotes.push(notePath);
			}
		}
		if (contextParts.length > 0) {
			parts.push(`<context>\n${contextParts.join("\n\n")}\n</context>`);
		}
	}

	if (conversation.summaryText) {
		parts.push(
			`<previous_conversation_summary>\n${conversation.summaryText}\n</previous_conversation_summary>`
		);
	}

	return { prompt: parts.join("\n\n"), missingNotes };
}

/**
 * Resolves the per-message attached notes into an inline content string
 * to be appended to the user's message.
 *
 * Returns the assembled content alongside any note paths that could not be
 * resolved in the vault.
 */
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
			const filename = notePath.split("/").pop() ?? notePath;
			parts.push(
				`<attached_note name="${filename}">\n${content}\n</attached_note>`
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
