import { parseChartSpec, CHART_TOOL_UNPLACED } from "./chartSpec";
import { CHART_BLOCK_SCHEMA } from "./promptConstants";
import { NoteWriter } from "./NoteWriter";
import { noteWriteResult } from "./noteWrites";
import type { WebSearchService, WebToolResult } from "./WebSearchService";
import type { WebReadScope } from "./webReadScope";
import { parseReadUrlArgs, parseSearchArgs, MAX_FILTER_DOMAINS, SEARCH_TIME_RANGES, SEARCH_TOPICS } from "./tavilyArgs";
import type { ToolCall, ToolDefinition } from "../models/types";
import { ATTACHED_NOTE_TAG, ATTACHED_NOTE_PATH_ATTR } from "./promptConstants";

const WEB_SEARCH_TOOL: ToolDefinition = {
	name: "web_search",
	description:
		`Search the live web for current information. ` +
		`Call this BEFORE answering whenever the question touches anything that can change over time, or that you cannot verify from your training data or the provided context — recent events, news, prices, releases, versions, standings, statistics, dates, or a person's current role or status. ` +
		`When you are not fully confident your knowledge is current, search rather than answering from memory: a needless search is far cheaper than a confidently outdated answer. You may search more than once to refine the query. ` +
		`The filters are optional and off by default: use topic "news" for events and announcements, "finance" for markets and companies; time_range when only recent pages will do; include_domains when the user names a site, exclude_domains to leave sites out. If a filtered search finds nothing, search again without the filters. ` +
		`Results come back numbered; cite a result inline with ⟦cite:web:<n>⟧ using its number where you use it, and do not add a separate sources list — the app lists the sources automatically. At most 5 searches per answer.`,
	inputSchema: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "The search query. Use natural language keywords, as you would type into a search engine.",
			},
			topic: {
				type: "string",
				enum: [...SEARCH_TOPICS],
				description: "Optional. The kind of source to search. Omit for a general search.",
			},
			time_range: {
				type: "string",
				enum: [...SEARCH_TIME_RANGES],
				description: "Optional. Only pages from the past day, week, month or year.",
			},
			include_domains: {
				type: "array",
				items: { type: "string" },
				description: `Optional. Search only these sites, as bare domains like example.com (at most ${MAX_FILTER_DOMAINS}).`,
			},
			exclude_domains: {
				type: "array",
				items: { type: "string" },
				description: `Optional. Leave these sites out, as bare domains (at most ${MAX_FILTER_DOMAINS}).`,
			},
		},
		required: ["query"],
	},
};

/** Reads one page through Tavily /extract (ADR-217). Same research gate as
 *  web_search: it is an outbound call to the same third party. */
const READ_URL_TOOL: ToolDefinition = {
	name: "read_url",
	description:
		`Read the full text of one public web page. Use it when the user gives you a link, or when a search result looks right but its snippet is not enough — instead of searching for a page whose address you already have. ` +
		`Long pages are cut off, and the result says so. The page comes back numbered; cite what you use with ⟦cite:web:<n>⟧ using that number. The app lists the page as a source automatically.`,
	inputSchema: {
		type: "object",
		properties: {
			url: {
				type: "string",
				description: "The full http(s) address of the page.",
			},
		},
		required: ["url"],
	},
};

const RENDER_CHART_TOOL: ToolDefinition = {
	name: "render_chart",
	description:
		"Draw a chart inline in your answer, at the point you call this. Use it when the answer " +
		"turns on a handful of comparable numbers, INSTEAD OF writing them out as a table or a " +
		"list. " + CHART_BLOCK_SCHEMA,
	inputSchema: {
		type: "object",
		properties: {
			type:       { type: "string", enum: ["bar", "line", "pie"] },
			title:      { type: "string" },
			categories: { type: "array", items: { type: "string" } },
			series:     {
				type:  "array",
				items: {
					type: "object",
					properties: {
						name:   { type: "string" },
						values: { type: "array", items: { type: ["number", "null"] } },
						source: { type: "string" },
					},
					required: ["name", "values"],
				},
			},
			unit:    { type: "string" },
			stacked: { type: "boolean" },
			note:    { type: "string" },
		},
		required: ["type", "categories", "series"],
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

	// web_search and read_url are read-only, so they are gated on the research
	// flag rather than writeMode — available even when writeMode is "none".
	if (researchEnabled) tools.push(WEB_SEARCH_TOOL, READ_URL_TOOL);

	// render_chart writes nothing at all — not the vault, not the web — so it is
	// gated on neither. It has to reach a comparison run (writeMode "none") and a
	// conversation with research off, because numbers worth charting come out of
	// a vault note as often as out of a search (ADR-210).
	tools.push(RENDER_CHART_TOOL);

	return tools;
}

const KNOWN_TOOLS = new Set(["create_note", "rewrite_note", "prepend_note", "web_search", "read_url", "render_chart"]);

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
	 * @param readScope  Which pages read_url may read in this send, and how many
	 *   (ADR-217 addendum). Without one, read_url refuses — the guard fails
	 *   closed, so a new caller cannot forget it into an open door.
	 */
	async execute(call: ToolCall, allowedTools?: Set<string>, contextNotes?: string[], readScope?: WebReadScope): Promise<string> {
		if (!KNOWN_TOOLS.has(call.name)) return `Error: unknown tool "${call.name}"`;
		// The web tools are gated by research, not the write mode, and say so.
		if (call.name === "web_search" || call.name === "read_url") {
			return (await this.executeWeb(call, allowedTools, readScope)).text;
		}
		if (allowedTools && !allowedTools.has(call.name)) {
			return `Error: tool "${call.name}" is not allowed in the current write mode.`;
		}

		// render_chart is not a vault write either, so it too is handled before
		// the path/content validation below.
		//
		// A chart reaching HERE means nobody intercepted the call, and so nobody
		// can place the block — the send path and the comparison both do, through
		// acceptChartCall. It is still validated, because the reason is worth
		// giving; it is never reported as a success, because a model told "drawn"
		// when nothing was drawn writes its answer around a chart that is not
		// there (principle 2).
		if (call.name === "render_chart") {
			const parsed = parseChartSpec(call.input);
			return parsed.ok ? CHART_TOOL_UNPLACED : `Error: ${parsed.error}`;
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
				// create_note never overwrites: an existing note is an error the
				// model can recover from by choosing another path (or rewrite_note on
				// a context note, which the user confirms by name).
				const file = call.name === "create_note"
					? await this.writer.createNote(content, path)
					: await this.writer.writeNote(content, path);
				return noteWriteResult(call.name === "create_note" ? "created" : "rewritten", file.path);
			} catch (err) {
				return `Error writing note: ${err instanceof Error ? err.message : String(err)}`;
			}
		}

		if (call.name === "prepend_note") {
			try {
				const file = await this.writer.prependWithSeparator(content, path);
				return noteWriteResult("prepended", file.path);
			} catch (err) {
				return `Error updating note: ${err instanceof Error ? err.message : String(err)}`;
			}
		}

		return `Error: unknown tool "${call.name}"`;
	}

	/**
	 * The two web tools, returning the numbered results as data beside the text
	 * the model reads (ADR-226) — the sources row is built from `sources`, never
	 * parsed back out of `text`. `firstN` is the number the first result gets,
	 * so numbering runs on across every call in one answer. Never throws.
	 */
	async executeWeb(call: ToolCall, allowedTools?: Set<string>, readScope?: WebReadScope, firstN = 1): Promise<WebToolResult> {
		const refuse = (text: string): WebToolResult => ({ text: `Error: ${text}`, sources: [], error: "other" });
		if (call.name !== "web_search" && call.name !== "read_url") return refuse(`unknown tool "${call.name}"`);
		if (allowedTools && !allowedTools.has(call.name)) {
			return refuse(`tool "${call.name}" is not available: web research is off for this message.`);
		}
		if (!this.webSearch) return refuse("web search is not available.");
		// Without a scope there is no budget and no allow-list: fail closed.
		if (!readScope) return refuse(`${call.name} is not available here.`);

		if (call.name === "web_search") {
			const args = parseSearchArgs(call.input);
			if (!args.ok) return refuse(args.error);
			const over = readScope.admitSearch();
			return over ? refuse(over) : this.webSearch.search(args.value, firstN);
		}
		const url = parseReadUrlArgs(call.input);
		if (!url.ok) return refuse(url.error);
		const refused = readScope.admit(url.value);
		return refused ? refuse(refused) : this.webSearch.extract(url.value, firstN);
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
		if (researchEnabled) {
			names.add("web_search");
			names.add("read_url");
		}
		// Ungated, for the same reason getToolDefinitions offers it unconditionally.
		names.add("render_chart");
		return names;
	}
}
