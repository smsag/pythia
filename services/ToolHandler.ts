import { App } from "obsidian";
import { NoteWriter } from "./NoteWriter";
import type { PythiaSettings } from "../settings";
import type { ToolCall, ToolDefinition } from "../models/types";

export function getToolDefinitions(defaultFolder: string, writeMode: "update" | "create" = "create"): ToolDefinition[] {
	if (writeMode === "update") {
		return [
			{
				name: "prepend_note",
				description:
					`Prepend content to the top of an existing note in the Obsidian vault, separated from the original content by a horizontal rule (---). ` +
					`Use this tool to add a summary, analysis, or result above the existing text of a note. ` +
					`The path must match the path of the note you received as context.`,
				inputSchema: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "The vault path of the existing note to update. Must end with .md.",
						},
						content: {
							type: "string",
							description: "The content to prepend to the top of the note.",
						},
					},
					required: ["path", "content"],
				},
			},
		];
	}

	return [
		{
			name: "create_note",
			description:
				`Create or overwrite a markdown note in the Obsidian vault. ` +
				`Only use this tool when the user explicitly asks to save, write, or create a note or file in the vault — for example: "save this as a note", "create a note called…", "write this to my vault". ` +
				`Do NOT use this tool to answer questions, generate plans, lists, summaries, or any other content the user wants to read in the chat. Respond in chat unless explicitly instructed to save.` +
				`The path must include the folder and filename with a .md extension. ` +
				`If the user does not specify a path, default to "${defaultFolder}/<descriptive-name>.md".`,
			inputSchema: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description:
							'The vault path for the note, e.g. "Folder/Note Title.md". Must end with .md.',
					},
					content: {
						type: "string",
						description: "The full markdown content of the note.",
					},
				},
				required: ["path", "content"],
			},
		},
	];
}

export async function executeToolCall(
	app: App,
	settings: PythiaSettings,
	call: ToolCall
): Promise<string> {
	const path = call.input["path"];
	const content = call.input["content"];

	if (typeof path !== "string" || !path.trim()) {
		return "Error: 'path' must be a non-empty string.";
	}
	if (typeof content !== "string") {
		return "Error: 'content' must be a string.";
	}
	if (!path.endsWith(".md")) {
		return "Error: path must end with .md";
	}

	const writer = new NoteWriter(app, settings);

	if (call.name === "create_note") {
		try {
			const file = await writer.writeNote(content, path);
			return `Note created: ${file.path}`;
		} catch (err) {
			return `Error creating note: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	if (call.name === "prepend_note") {
		try {
			const file = await writer.prependWithSeparator(content, path);
			return `Note updated: ${file.path}`;
		} catch (err) {
			return `Error updating note: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	return `Error: unknown tool "${call.name}"`;
}
