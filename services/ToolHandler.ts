import { NoteWriter } from "./NoteWriter";
import type { WebSearchService } from "./WebSearchService";
import type { ToolCall, ToolDefinition } from "../models/types";
import { ATTACHED_NOTE_TAG, ATTACHED_NOTE_PATH_ATTR } from "./promptConstants";

const WEB_SEARCH_TOOL: ToolDefinition = {
	name: "web_search",
	description:
		`Search the live web for current information. ` +
		`Use this whenever the question concerns recent events, or facts that may have changed since your training cutoff, or anything you are not confident is up to date — prices, versions, people's current roles, news, dates, statistics. ` +
		`Prefer searching over guessing when recency matters. ` +
		`Results come back with source URLs — cite them inline in your answer.`,
	inputSchema: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "The search query. Use natural language keywords, as you would type into a search engine.",
			},
		},
		required: ["query"],
	},
};

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

export function getToolDefinitions(
	defaultFolder: string,
	writeMode: "update" | "create" | "none" | "rewrite" | "all" = "all",
	researchEnabled = false
): ToolDefinition[] {
	const tools: ToolDefinition[] = [];

	// Note-writing tools are gated by writeMode.
	if (writeMode === "rewrite") tools.push(REWRITE_NOTE_TOOL);
	else if (writeMode === "update") tools.push(PREPEND_NOTE_TOOL);
	else if (writeMode === "create") tools.push(CREATE_NOTE_TOOL(defaultFolder));
	else if (writeMode !== "none") {
		// "all" — inject all three; descriptions guide the LLM to pick the right one
		tools.push(CREATE_NOTE_TOOL(defaultFolder), PREPEND_NOTE_TOOL, REWRITE_NOTE_TOOL);
	}

	// web_search is read-only, so it's gated on the research flag rather than
	// writeMode — it must be available even when writeMode is "none".
	if (researchEnabled) tools.push(WEB_SEARCH_TOOL);

	return tools;
}

const KNOWN_TOOLS = new Set(["create_note", "rewrite_note", "prepend_note", "web_search"]);

export class ToolHandler {
	constructor(
		private readonly writer: NoteWriter,
		private readonly webSearch?: WebSearchService
	) {}

	async execute(call: ToolCall, allowedTools?: Set<string>): Promise<string> {
		if (!KNOWN_TOOLS.has(call.name)) return `Error: unknown tool "${call.name}"`;
		if (allowedTools && !allowedTools.has(call.name)) {
			return `Error: tool "${call.name}" is not allowed in the current write mode.`;
		}

		// web_search is not a vault write — handle it before the path/content
		// validation below, which is specific to the note-writing tools.
		if (call.name === "web_search") {
			if (!this.webSearch) return "Error: web search is not available.";
			const query = call.input["query"];
			if (typeof query !== "string" || !query.trim()) {
				return "Error: 'query' must be a non-empty string.";
			}
			return this.webSearch.search(query);
		}

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

	static allowedToolNames(writeMode: string, researchEnabled = false): Set<string> {
		const names = new Set<string>();
		if (writeMode === "rewrite") names.add("rewrite_note");
		else if (writeMode === "update") names.add("prepend_note");
		else if (writeMode === "create") names.add("create_note");
		else if (writeMode !== "none") {
			names.add("create_note");
			names.add("rewrite_note");
			names.add("prepend_note");
		}
		if (researchEnabled) names.add("web_search");
		return names;
	}
}
