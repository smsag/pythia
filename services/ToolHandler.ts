import { NoteWriter } from "./NoteWriter";
import type { ToolCall, ToolDefinition } from "../models/types";
import { ATTACHED_NOTE_TAG, ATTACHED_NOTE_PATH_ATTR } from "./promptConstants";

const CREATE_NOTE_TOOL = (defaultFolder: string): ToolDefinition => ({
	name: "create_note",
	description:
		`Create a new markdown note in the Obsidian vault at a path you choose. ` +
		`Use this when the user asks to save, write, or create a note — e.g. "save this as a note", "create a note called…". ` +
		`Do NOT use for content the user wants to read in chat, and do NOT use this to modify a note that was provided as context — use rewrite_note or prepend_note for that. ` +
		`If the user does not specify a path, default to "${defaultFolder}/<descriptive-name>.md".`,
	inputSchema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: 'Vault path for the new note, e.g. "Folder/Note Title.md". Must end with .md.',
			},
			content: {
				type: "string",
				description: "The full markdown content of the note.",
			},
		},
		required: ["path", "content"],
	},
});

const PREPEND_NOTE_TOOL: ToolDefinition = {
	name: "prepend_note",
	description:
		`Add content above the existing text of a note that was provided as context, separated by a horizontal rule (---). ` +
		`Use this when the user asks to prepend, add to the top of, or insert content before an existing document — e.g. "add a summary above this", "prepend this to my doc". ` +
		`The path must exactly match the ${ATTACHED_NOTE_PATH_ATTR} attribute of an <${ATTACHED_NOTE_TAG}> tag you received.`,
	inputSchema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "Exact vault path of the context note to prepend to. Must end with .md.",
			},
			content: {
				type: "string",
				description: "The content to prepend above the existing note text.",
			},
		},
		required: ["path", "content"],
	},
};

const REWRITE_NOTE_TOOL: ToolDefinition = {
	name: "rewrite_note",
	description:
		`Replace the full content of a note that was provided as context. ` +
		`Use this when the user asks to rewrite, restructure, revise, or replace a document — e.g. "rewrite this doc", "restructure as bullet points", "make this more concise". ` +
		`The path must exactly match the ${ATTACHED_NOTE_PATH_ATTR} attribute of an <${ATTACHED_NOTE_TAG}> tag you received — do not invent a path. ` +
		`Do NOT use this to answer questions or produce content the user wants to read in chat.`,
	inputSchema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: `Exact vault path of the context note to rewrite, matching the ${ATTACHED_NOTE_TAG} ${ATTACHED_NOTE_PATH_ATTR} attribute.`,
			},
			content: {
				type: "string",
				description: "The full new markdown content to write to the note.",
			},
		},
		required: ["path", "content"],
	},
};

export function getToolDefinitions(defaultFolder: string, writeMode: "update" | "create" | "none" | "rewrite" | "all" = "all"): ToolDefinition[] {
	if (writeMode === "none") return [];
	if (writeMode === "rewrite") return [REWRITE_NOTE_TOOL];
	if (writeMode === "update") return [PREPEND_NOTE_TOOL];
	if (writeMode === "create") return [CREATE_NOTE_TOOL(defaultFolder)];
	// "all" — inject all three tools; descriptions guide the LLM to pick the right one
	return [CREATE_NOTE_TOOL(defaultFolder), PREPEND_NOTE_TOOL, REWRITE_NOTE_TOOL];
}

export class ToolHandler {
	constructor(private readonly writer: NoteWriter) {}

	async execute(call: ToolCall): Promise<string> {
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

		if (call.name === "create_note" || call.name === "rewrite_note") {
			try {
				const file = await this.writer.writeNote(content, path);
				return `Note written: ${file.path}`;
			} catch (err) {
				return `Error writing note: ${err instanceof Error ? err.message : String(err)}`;
			}
		}

		if (call.name === "prepend_note") {
			try {
				const file = await this.writer.prependWithSeparator(content, path);
				return `Note updated: ${file.path}`;
			} catch (err) {
				return `Error updating note: ${err instanceof Error ? err.message : String(err)}`;
			}
		}

		return `Error: unknown tool "${call.name}"`;
	}
}
