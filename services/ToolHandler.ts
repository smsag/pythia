import { NoteWriter } from "./NoteWriter";
import type { WebSearchService } from "./WebSearchService";
import type { ToolCall, ToolDefinition } from "../models/types";
import { ATTACHED_NOTE_TAG, ATTACHED_NOTE_PATH_ATTR } from "./promptConstants";

const WEB_SEARCH_TOOL: ToolDefinition = {
	name: "web_search",
	description:
		`Search the live web for current information. ` +
		`Call this BEFORE answering whenever the question touches anything that can change over time, or that you cannot verify from your training data or the provided context — recent events, news, prices, releases, versions, standings, statistics, dates, or a person's current role or status. ` +
		`When you are not fully confident your knowledge is current, search rather than answering from memory: a needless search is far cheaper than a confidently outdated answer. You may search more than once to refine the query. ` +
		`Results come back with source URLs; cite them inline with the ⟦cite:web:<domain>⟧ marker where you use them, and do not add a separate sources list — the app lists the sources automatically.`,
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

	/**
	 * @param allowedTools  Tool names permitted this turn (write mode + research gate).
	 * @param contextNotes  Vault paths explicitly attached to the conversation. When
	 *   provided, rewrite_note/prepend_note may target ONLY these paths — the
	 *   authoritative allow-list check, mirrored in the sidebar for UX. Without it a
	 *   prompt-injected model could rewrite any note it names; with it, writes are
	 *   confined to notes the user chose to share as context.
	 */
	async execute(call: ToolCall, allowedTools?: Set<string>, contextNotes?: string[]): Promise<string> {
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
		// Reject path traversal at the boundary (NoteWriter also rejects it, but a
		// clean tool-result error lets the model recover instead of surfacing a throw).
		if (path.split(/[\\/]/).some((seg) => seg === "..")) {
			return `Error: path "${path}" contains path traversal segments.`;
		}
		// Authoritative allow-list: rewrite/prepend may only touch notes the user
		// explicitly attached as context. Defense-in-depth behind the sidebar guard.
		if (
			(call.name === "rewrite_note" || call.name === "prepend_note") &&
			contextNotes &&
			!contextNotes.includes(path)
		) {
			return `Error: path "${path}" is not in context notes. You may only modify notes that were explicitly provided as context.`;
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
