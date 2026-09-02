import { NoteWriter } from "./NoteWriter";
import type { WebSearchService } from "./WebSearchService";
import type { UpvotyService } from "./UpvotyService";
import { UPVOTY_MCP_TOOL_BY_PYTHIA_NAME } from "./UpvotyService";
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

// ── Upvoty (read-only feedback + roadmap) ────────────────────────────────────
// These map to the Upvoty MCP server's read-only tools (see UpvotyService).
// Feedback is user-submitted portal content, so descriptions frame the results
// as data to discuss, never as instructions.

const UPVOTY_SEARCH_FEEDBACK_TOOL: ToolDefinition = {
	name: "upvoty_search_feedback",
	description:
		`Search and list feature requests / feedback from the user's Upvoty board. ` +
		`This IS the search tool — use "query" for full-text search over titles and content, and the optional filters to narrow down. ` +
		`Returns trimmed items (id, title, excerpt, board, status, author, tags, vote count), newest and pinned first. ` +
		`Use upvoty_get_feedback with an item's id for its full text and comments. ` +
		`Call upvoty_get_project first if you need the exact board, status, or tag names to filter by.`,
	inputSchema: {
		type: "object",
		properties: {
			query: { type: "string", description: "Full-text search over feedback title and content." },
			board: { type: "string", description: "Board name or id to filter by." },
			status: { type: "string", description: "Status name or id to filter by (e.g. Planned, In progress)." },
			tag: { type: "string", description: "Tag name or id to filter by." },
			sort: {
				type: "string",
				enum: ["newest", "oldest", "most_votes", "recently_updated", "status_changed"],
				description: "Sort order. Default: pinned first, then newest.",
			},
			limit: { type: "number", description: "Max items to return (1–100, default 25)." },
			page: { type: "number", description: "1-based page number for paging through results." },
		},
		required: [],
	},
};

const UPVOTY_GET_FEEDBACK_TOOL: ToolDefinition = {
	name: "upvoty_get_feedback",
	description:
		`Get one Upvoty feedback item in full — its complete content plus its most recent comments. ` +
		`Takes the item id from upvoty_search_feedback. Use this to discuss a specific feature request in depth.`,
	inputSchema: {
		type: "object",
		properties: {
			id: { type: "string", description: "The feedback item id, from upvoty_search_feedback." },
		},
		required: ["id"],
	},
};

const UPVOTY_LIST_ROADMAP_TOOL: ToolDefinition = {
	name: "upvoty_list_roadmap",
	description:
		`Get the Upvoty roadmap: items grouped by column (e.g. Planned / In progress / Done), ` +
		`each with title, excerpt, vote count, and launch date. Use this to discuss what is planned or in progress.`,
	inputSchema: {
		type: "object",
		properties: {
			limit: { type: "number", description: "Max items to return (1–100, default 100)." },
		},
		required: [],
	},
};

const UPVOTY_GET_PROJECT_TOOL: ToolDefinition = {
	name: "upvoty_get_project",
	description:
		`Get the Upvoty project metadata: its boards, feedback statuses, tags, and roadmap statuses with their names. ` +
		`Call this once when you need the exact board/status/tag names to filter upvoty_search_feedback by. ` +
		`It does not return feedback items — use upvoty_search_feedback for those.`,
	inputSchema: { type: "object", properties: {}, required: [] },
};

const UPVOTY_TOOLS: ToolDefinition[] = [
	UPVOTY_SEARCH_FEEDBACK_TOOL,
	UPVOTY_GET_FEEDBACK_TOOL,
	UPVOTY_LIST_ROADMAP_TOOL,
	UPVOTY_GET_PROJECT_TOOL,
];

const UPVOTY_TOOL_NAMES = UPVOTY_TOOLS.map((t) => t.name);

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
	researchEnabled = false,
	upvotyEnabled = false
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

	// Upvoty tools are read-only, so — like web_search — they're gated on their
	// own flag rather than writeMode and stay available when writeMode is "none".
	if (upvotyEnabled) tools.push(...UPVOTY_TOOLS);

	return tools;
}

const KNOWN_TOOLS = new Set([
	"create_note",
	"rewrite_note",
	"prepend_note",
	"web_search",
	...UPVOTY_TOOL_NAMES,
]);

export class ToolHandler {
	constructor(
		private readonly writer: NoteWriter,
		private readonly webSearch?: WebSearchService,
		private readonly upvoty?: UpvotyService
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

		// Upvoty tools are read-only reads against the remote MCP server — handle
		// them (like web_search) before the note-write path/content validation.
		if (call.name in UPVOTY_MCP_TOOL_BY_PYTHIA_NAME) {
			if (!this.upvoty) return "Error: Upvoty is not available.";
			if (call.name === "upvoty_get_feedback") {
				const id = call.input["id"];
				if (typeof id !== "string" || !id.trim()) {
					return "Error: 'id' must be a non-empty string (get it from upvoty_search_feedback).";
				}
			}
			return this.upvoty.run(call.name, buildUpvotyArgs(call.name, call.input));
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

	static allowedToolNames(writeMode: string, researchEnabled = false, upvotyEnabled = false): Set<string> {
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
		if (upvotyEnabled) for (const n of UPVOTY_TOOL_NAMES) names.add(n);
		return names;
	}
}

/** Maps a Pythia Upvoty tool call's input to the MCP server's argument shape:
 *  `limit` becomes the server's `per_page`, and only recognized keys are passed
 *  through (dropping anything the model invented). Kept a pure function so the
 *  mapping is unit-testable without a live server. */
export function buildUpvotyArgs(
	toolName: string,
	input: Record<string, unknown>
): Record<string, unknown> {
	const args: Record<string, unknown> = {};
	const str = (k: string) => {
		const v = input[k];
		if (typeof v === "string" && v.trim()) args[k] = v.trim();
	};
	const posInt = (from: string, to: string) => {
		const v = input[from];
		const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
		if (Number.isFinite(n) && n > 0) args[to] = Math.floor(n);
	};

	if (toolName === "upvoty_search_feedback") {
		str("query");
		str("board");
		str("status");
		str("tag");
		str("sort");
		posInt("limit", "per_page");
		posInt("page", "page");
	} else if (toolName === "upvoty_get_feedback") {
		str("id");
	} else if (toolName === "upvoty_list_roadmap") {
		posInt("limit", "per_page");
	}
	// upvoty_get_project takes no arguments.
	return args;
}
