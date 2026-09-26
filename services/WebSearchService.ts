import { requestUrl } from "obsidian";
import type { PythiaSettings } from "../settings";
import { WEB_CITATION_INSTRUCTION } from "./promptConstants";
import { redactSecrets } from "./redact";
import { webDomain } from "./citations";
import { safeHttpUrl } from "./urlSafety";
import { describeSearchFilters, hasSearchFilters, type SearchArgs } from "./tavilyArgs";

/** Tavily is a search API built for LLM/RAG use: one POST returns ranked,
 *  already-cleaned results plus an optional synthesized answer, so Pythia does
 *  not have to run its own crawler or strip HTML. /extract returns one page's
 *  cleaned text for a URL Pythia already has (ADR-217). */
const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";
const TAVILY_EXTRACT_ENDPOINT = "https://api.tavily.com/extract";

/** Hard cap on characters kept from each result's content. Bounds how many
 *  tokens a single search round can inject into the conversation so a research
 *  turn can't blow the model's context window. */
const MAX_SNIPPET_CHARS = 500;

/** Cap on one page read by read_url. A page is the whole point of the call, so
 *  this is far above a snippet — and it is NAMED in the result when it bites,
 *  so the model never mistakes the first 8 000 characters for the page. */
export const MAX_EXTRACT_CHARS = 8000;

/** Fallback result count when the setting is unset or non-positive. */
const DEFAULT_MAX_RESULTS = 5;

/** Tavily's own ceiling for max_results; a larger setting is clamped here
 *  rather than sent and refused. */
export const TAVILY_MAX_RESULTS = 20;

interface TavilyResult {
	title?: string;
	url?: string;
	content?: string;
}

interface TavilyResponse {
	answer?: string;
	results?: TavilyResult[];
}

interface TavilyExtractResponse {
	results?: { url?: string; raw_content?: string }[];
	failed_results?: { url?: string; error?: string }[];
}

/** Why a web call failed, for the user as well as the model (ADR-226): a
 *  rejected key and a used-up plan are fixed in settings or at Tavily, and
 *  only a Notice reaches the person who can fix them. */
export type WebErrorKind = "auth" | "quota" | "rate" | "other";

/** One numbered web result or page, as the sources row and the chips use it. */
export interface WebSource {
	n: number;
	title: string;
	url: string;
}

/**
 * What a web tool call returns (ADR-226): the text the model reads and, as
 * data, the numbered results it may cite. The sources are never read back out
 * of the text — a page's own content could otherwise plant a source.
 */
export interface WebToolResult {
	text: string;
	sources: WebSource[];
	error?: WebErrorKind;
}

/** What a POST came back as: the parsed body, or an "Error: …" string for the
 *  model and its kind. One classification of HTTP statuses for both endpoints. */
type PostResult = { ok: true; json: unknown } | { ok: false; error: string; kind: WebErrorKind };

const fail = (text: string, kind: WebErrorKind = "other"): WebToolResult => ({ text, sources: [], error: kind });

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
	 *
	 * A plain string is a query with no filters. Filters arrive already
	 * validated by `parseSearchArgs` and are sent only when set (ADR-217).
	 */
	async search(queryOrArgs: string | SearchArgs, firstN = 1): Promise<WebToolResult> {
		const args: SearchArgs = typeof queryOrArgs === "string" ? { query: queryOrArgs } : queryOrArgs;
		const q = args.query.trim();
		if (!this.apiKey) return fail(NOT_CONFIGURED, "auth");
		if (!q) return fail("Error: 'query' must be a non-empty string.");

		const maxResults = Math.min(
			this.settings.webSearchMaxResults > 0 ? this.settings.webSearchMaxResults : DEFAULT_MAX_RESULTS,
			TAVILY_MAX_RESULTS,
		);

		const body: Record<string, unknown> = {
			query: q,
			max_results: maxResults,
			search_depth: "basic",
			include_answer: true,
		};
		if (args.topic) body["topic"] = args.topic;
		if (args.timeRange) body["time_range"] = args.timeRange;
		if (args.includeDomains) body["include_domains"] = args.includeDomains;
		if (args.excludeDomains) body["exclude_domains"] = args.excludeDomains;

		const res = await this.post(TAVILY_SEARCH_ENDPOINT, body, "web search");
		if (!res.ok) return fail(res.error, res.kind);
		return formatResults({ ...args, query: q }, res.json, maxResults, firstN);
	}

	/**
	 * Reads one page through Tavily /extract (the read_url tool, ADR-217). The
	 * URL arrives validated by `parseReadUrlArgs` — http(s), public host. The
	 * page is numbered like a search result (`### n. …`), continuing the
	 * answer's numbering, so the model cites it the same way (ADR-226).
	 */
	async extract(url: string, firstN = 1): Promise<WebToolResult> {
		if (!this.apiKey) return fail(NOT_CONFIGURED, "auth");
		const res = await this.post(
			TAVILY_EXTRACT_ENDPOINT,
			{ urls: [url], extract_depth: "basic", format: "markdown" },
			"page read",
		);
		if (!res.ok) return fail(res.error, res.kind);
		return formatExtract(url, res.json, firstN);
	}

	private async post(endpoint: string, body: Record<string, unknown>, what: string): Promise<PostResult> {
		try {
			const res = await requestUrl({
				url: endpoint,
				method: "POST",
				contentType: "application/json",
				// The key travels as a bearer header (Tavily's current contract), not
				// in the JSON body: a body is what gets logged, echoed back in an error
				// payload, or kept by a proxy; an Authorization header is what every
				// layer already knows to strip.
				headers: { Authorization: `Bearer ${this.apiKey}` },
				body: JSON.stringify(body),
				// Return the response instead of throwing on 4xx/5xx so we can
				// surface a readable error string to the model.
				throw: false,
			});
			if (res.status === 401 || res.status === 403) {
				// Say what it is: a rejected key is fixed in settings, not by retrying.
				return { ok: false, kind: "auth", error: `Error: web search key was rejected (HTTP ${res.status}). Ask the user to check the Tavily API key in Pythia settings.` };
			}
			if (res.status === 432 || res.status === 433) {
				// Tavily's plan and pay-as-you-go limits: no retry helps until the
				// user raises the limit or the month turns.
				return { ok: false, kind: "quota", error: `Error: the Tavily account has used up its ${what} credits (HTTP ${res.status}). Answer from what you already have and tell the user.` };
			}
			if (res.status === 429) {
				return { ok: false, kind: "rate", error: `Error: ${what} rate limit reached (HTTP 429). Answer from what you already have, or try again later.` };
			}
			if (res.status < 200 || res.status >= 300) {
				const detail = typeof res.text === "string" ? redactSecrets(res.text.slice(0, 200)) : "";
				return { ok: false, kind: "other", error: `Error: ${what} failed (HTTP ${res.status}). ${detail}`.trim() };
			}
			return { ok: true, json: res.json };
		} catch (err) {
			return { ok: false, kind: "other", error: `Error: ${what} request failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}` };
		}
	}
}

const NOT_CONFIGURED = "Error: web search is not configured. Ask the user to set a Tavily API key in Pythia settings.";

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
}

/** A result Pythia can show and link to: an object with an http(s) URL. Title
 *  and snippet are strings or nothing, and a title is one line — a newline in
 *  it would put text where the numbered header ends (principle 1, ADR-226). */
function cleanResults(value: unknown): { title: string; url: string; content: string }[] {
	if (!Array.isArray(value)) return [];
	const out: { title: string; url: string; content: string }[] = [];
	for (const r of value) {
		if (!r || typeof r !== "object") continue;
		const { title, url, content } = r as TavilyResult;
		const href = typeof url === "string" ? safeHttpUrl(url) : null;
		if (!href) continue;
		const oneLine = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
		out.push({ title: oneLine || webDomain(href), url: href, content: typeof content === "string" ? content.trim() : "" });
	}
	return out;
}

/** Shapes Tavily's response into a plain-text block the model reads as tool
 *  output — the synthesized answer first (when present), then each result
 *  under its number, which is what the model cites — and returns the numbered
 *  results as data. Numbering starts at `firstN` so it runs on across every
 *  search and page read in one answer (ADR-226). Pure. */
function formatResults(args: SearchArgs, raw: unknown, maxResults: number, firstN: number): WebToolResult {
	const json = (raw && typeof raw === "object" ? raw : {}) as TavilyResponse;
	const query = args.query;
	const results = cleanResults(json.results).slice(0, maxResults);
	const answer = typeof json.answer === "string" ? json.answer.trim() : "";

	if (results.length === 0 && !answer) {
		// A filtered search that finds nothing says which filters, so the model
		// can widen it itself. Never retried behind its back: that would spend a
		// second credit nobody sees (ADR-217).
		const text = hasSearchFilters(args)
			? `No web results found for "${query}" with filters (${describeSearchFilters(args)}). Search again without them if they may be too narrow.`
			: `No web results found for "${query}".`;
		return { text, sources: [] };
	}

	const parts: string[] = [
		`Web search results for "${query}". Use these to answer. ${WEB_CITATION_INSTRUCTION}`,
	];
	if (answer) parts.push(`Summary (not a source, do not cite it): ${answer}`);

	const sources: WebSource[] = results.map((r, i) => ({ n: firstN + i, title: r.title, url: r.url }));
	results.forEach((r, i) => {
		parts.push(`### ${firstN + i}. ${r.title}\nURL: ${r.url}\n${truncate(r.content, MAX_SNIPPET_CHARS)}`.trimEnd());
	});

	return { text: parts.join("\n\n"), sources };
}

/** One extracted page as tool output. Empty text and a listed failure are both
 *  errors — "" from the reader is never "the page said nothing" (principle 2). */
function formatExtract(url: string, raw: unknown, firstN: number): WebToolResult {
	const json = (raw && typeof raw === "object" ? raw : {}) as TavilyExtractResponse;
	const results = Array.isArray(json.results) ? json.results : [];
	const page = results.find((r) => !!r && typeof r === "object" && typeof r.raw_content === "string" && r.raw_content.trim());
	if (!page) {
		const failed = Array.isArray(json.failed_results) ? json.failed_results[0] : undefined;
		const reason = failed && typeof failed.error === "string" && failed.error.trim() ? failed.error.trim() : "no readable text was returned";
		return fail(`Error: could not read ${url}: ${redactSecrets(reason.slice(0, 200))}. Tell the user, and search for the topic instead if that helps.`);
	}
	const text = (page.raw_content ?? "").trim();
	const pageUrl = (typeof page.url === "string" ? safeHttpUrl(page.url) : null) ?? url;
	const cut = text.length > MAX_EXTRACT_CHARS;
	const body = cut ? text.slice(0, MAX_EXTRACT_CHARS).trimEnd() : text;
	const title = webDomain(pageUrl);
	return {
		text: [
			`Content of the web page ${pageUrl}. Use it to answer. ${WEB_CITATION_INSTRUCTION}`,
			`### ${firstN}. ${title}\nURL: ${pageUrl}\n${body}`,
			...(cut ? [`(truncated: the first ${MAX_EXTRACT_CHARS} of ${text.length} characters are shown)`] : []),
		].join("\n\n"),
		sources: [{ n: firstN, title, url: pageUrl }],
	};
}
