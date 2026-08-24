import { requestUrl } from "obsidian";
import type { PythiaSettings } from "../settings";

/** Tavily is a search API built for LLM/RAG use: one POST returns ranked,
 *  already-cleaned results plus an optional synthesized answer, so Pythia does
 *  not have to run its own crawler or strip HTML. */
const TAVILY_ENDPOINT = "https://api.tavily.com/search";

/** Hard cap on characters kept from each result's content. Bounds how many
 *  tokens a single search round can inject into the conversation so a research
 *  turn can't blow the model's context window. */
const MAX_SNIPPET_CHARS = 500;

/** Fallback result count when the setting is unset or non-positive. */
const DEFAULT_MAX_RESULTS = 5;

interface TavilyResult {
	title?: string;
	url?: string;
	content?: string;
}

interface TavilyResponse {
	answer?: string;
	results?: TavilyResult[];
}

/**
 * Client-executed web search for Pythia's "research mode". The model requests a
 * search through the normal tool loop (BaseProvider → onToolCall); Pythia runs
 * the query here and feeds the formatted results back as the tool result, so
 * the same flow works for every provider without a provider-native search tool.
 *
 * Network I/O uses Obsidian's `requestUrl` rather than `fetch`: it runs in the
 * Electron main process and is not subject to renderer-origin CORS, which most
 * search APIs (Tavily included) do not grant. The trade-off is that a request
 * in flight cannot be aborted — acceptable for the ~1–3 s a search takes.
 */
export class WebSearchService {
	private settings: PythiaSettings;
	private apiKey: string;

	constructor(settings: PythiaSettings, apiKey: string) {
		this.settings = settings;
		this.apiKey = apiKey;
	}

	updateSettings(settings: PythiaSettings): void {
		this.settings = settings;
	}

	updateApiKey(apiKey: string): void {
		this.apiKey = apiKey;
	}

	hasApiKey(): boolean {
		return !!this.apiKey;
	}

	/**
	 * Runs a web search and returns a compact, citation-ready string for the
	 * model. Never throws — a missing key, network failure, or API error comes
	 * back as an "Error: …" string the model can read and recover from, matching
	 * the convention used by ToolHandler.execute for the note-writing tools.
	 */
	async search(query: string): Promise<string> {
		if (!this.apiKey) {
			return "Error: web search is not configured. Ask the user to set a Tavily API key in Pythia settings.";
		}
		const q = query.trim();
		if (!q) return "Error: 'query' must be a non-empty string.";

		const maxResults =
			this.settings.webSearchMaxResults > 0
				? this.settings.webSearchMaxResults
				: DEFAULT_MAX_RESULTS;

		let json: TavilyResponse;
		try {
			const res = await requestUrl({
				url: TAVILY_ENDPOINT,
				method: "POST",
				contentType: "application/json",
				body: JSON.stringify({
					api_key: this.apiKey,
					query: q,
					max_results: maxResults,
					search_depth: "basic",
					include_answer: true,
				}),
				// Return the response instead of throwing on 4xx/5xx so we can
				// surface a readable error string to the model.
				throw: false,
			});
			if (res.status < 200 || res.status >= 300) {
				const detail = typeof res.text === "string" ? res.text.slice(0, 200) : "";
				return `Error: web search failed (HTTP ${res.status}). ${detail}`.trim();
			}
			json = res.json as TavilyResponse;
		} catch (err) {
			return `Error: web search request failed: ${err instanceof Error ? err.message : String(err)}`;
		}

		return formatResults(q, json, maxResults);
	}
}

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
}

/** Extract the `{title, url}` sources from a formatted web-search tool result
 *  (the string `formatResults` produces). Lets the UI surface the real Tavily
 *  sources deterministically instead of depending on the model to cite them.
 *  Pure — safe to unit-test without any network. */
export function parseWebSourcesFromResult(text: string): { title: string; url: string }[] {
	const out: { title: string; url: string }[] = [];
	const re = /^###\s+\d+\.\s*(.+)\r?\nURL:\s*(\S+)/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		out.push({ title: m[1].trim(), url: m[2].trim() });
	}
	return out;
}

/** Shapes Tavily's response into a plain-text block the model reads as tool
 *  output: the synthesized answer first (when present), then each source with
 *  its URL so the model can cite it. Kept a pure function for straightforward
 *  unit testing without any network. */
function formatResults(query: string, json: TavilyResponse, maxResults: number): string {
	const results = Array.isArray(json.results) ? json.results.slice(0, maxResults) : [];
	const answer = typeof json.answer === "string" ? json.answer.trim() : "";

	if (results.length === 0 && !answer) {
		return `No web results found for "${query}".`;
	}

	const parts: string[] = [
		`Web search results for "${query}". Use these to answer. Do not add inline source markers or a sources list — Pythia lists the sources for the user automatically.`,
	];
	if (answer) parts.push(`Summary: ${answer}`);

	results.forEach((r, i) => {
		const title = (r.title ?? "Untitled").trim() || "Untitled";
		const url = (r.url ?? "").trim();
		const snippet = truncate((r.content ?? "").trim(), MAX_SNIPPET_CHARS);
		parts.push(`### ${i + 1}. ${title}\nURL: ${url}\n${snippet}`.trimEnd());
	});

	return parts.join("\n\n");
}
