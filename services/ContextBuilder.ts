import { App, TFile } from "obsidian";
import type { Conversation } from "../models/types";

/**
 * Builds the full system prompt string from a conversation's system prompt,
 * context notes, and optional summary. Shared across all LLM providers.
 */
export async function buildSystemPrompt(
	app: App,
	conversation: Conversation
): Promise<string> {
	const parts: string[] = [];

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

	return parts.join("\n\n");
}

/**
 * Resolves the per-message attached notes into an inline content string
 * to be appended to the user's message.
 */
export async function buildAttachedNotesContent(
	app: App,
	attachedNotes: string[]
): Promise<string> {
	if (attachedNotes.length === 0) return "";
	const parts: string[] = [];
	for (const notePath of attachedNotes) {
		const file = app.vault.getAbstractFileByPath(notePath);
		if (file instanceof TFile) {
			const content = await app.vault.read(file);
			const filename = notePath.split("/").pop() ?? notePath;
			parts.push(
				`<attached_note name="${filename}">\n${content}\n</attached_note>`
			);
		}
	}
	return parts.length > 0 ? "\n\n" + parts.join("\n\n") : "";
}
