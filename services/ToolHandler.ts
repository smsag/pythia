import { App } from "obsidian";
import { NoteWriter } from "./NoteWriter";
import type { PythiaSettings } from "../settings";
import type { ToolCall, ToolDefinition } from "../models/types";

export function getToolDefinitions(defaultFolder: string): ToolDefinition[] {
	return [
		{
			name: "create_note",
			description:
				`Create or overwrite a markdown note in the Obsidian vault. ` +
				`Use this tool when the user asks you to create, write, or save a note. ` +
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
	if (call.name === "create_note") {
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

		try {
			const writer = new NoteWriter(app, settings);
			const file = await writer.writeNote(content, path);
			return `Note created: ${file.path}`;
		} catch (err) {
			return `Error creating note: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	return `Error: unknown tool "${call.name}"`;
}
