import { webDomain } from "./citations";
import { safeHttpUrl } from "./urlSafety";

/**
 * The arguments a model may pass to the two Tavily tools, validated where they
 * enter (principle 1, ADR-217). A tool call's input is untrusted: every
 * rejection names the field and the value, because the string goes back to the
 * model and has to be actionable in the same turn — the `parseChartSpec`
 * pattern. The result is built fresh, never spread, so an unknown key cannot
 * reach the request body.
 *
 * Pure: no network, no Obsidian.
 */

export const SEARCH_TOPICS = ["general", "news", "finance"] as const;
export const SEARCH_TIME_RANGES = ["day", "week", "month", "year"] as const;
export type SearchTopic = (typeof SEARCH_TOPICS)[number];
export type SearchTimeRange = (typeof SEARCH_TIME_RANGES)[number];

/** Per list. More than this is a crawl, not a filter — and every entry rides
 *  in the request, so the cap is named in the error rather than applied. */
export const MAX_FILTER_DOMAINS = 10;

export interface SearchArgs {
	query: string;
	topic?: SearchTopic;
	timeRange?: SearchTimeRange;
	includeDomains?: string[];
	excludeDomains?: string[];
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// A bare hostname: labels of letters, digits and hyphens, at least one dot,
// an alphabetic TLD. Deliberately strict — anything else is not a site filter.
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function oneOf<T extends string>(field: string, value: unknown, allowed: readonly T[]): Parsed<T | undefined> {
	if (value === undefined || value === null || value === "") return { ok: true, value: undefined };
	if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
		return { ok: true, value: value as T };
	}
	return { ok: false, error: `'${field}' must be one of ${allowed.join(", ")} (got ${JSON.stringify(value)}).` };
}

function domainList(field: string, value: unknown): Parsed<string[] | undefined> {
	if (value === undefined || value === null) return { ok: true, value: undefined };
	if (!Array.isArray(value)) return { ok: false, error: `'${field}' must be an array of domains.` };
	if (value.length > MAX_FILTER_DOMAINS) {
		return { ok: false, error: `'${field}' may name at most ${MAX_FILTER_DOMAINS} domains (got ${value.length}).` };
	}
	const out: string[] = [];
	for (const entry of value) {
		const host = typeof entry === "string" ? webDomain(entry).toLowerCase() : "";
		if (!HOST_RE.test(host)) {
			return { ok: false, error: `'${field}' contains ${JSON.stringify(entry)}, which is not a domain like example.com.` };
		}
		if (!out.includes(host)) out.push(host);
	}
	return { ok: true, value: out.length > 0 ? out : undefined };
}

export function parseSearchArgs(input: Record<string, unknown>): Parsed<SearchArgs> {
	const query = input["query"];
	if (typeof query !== "string" || !query.trim()) {
		return { ok: false, error: "'query' must be a non-empty string." };
	}
	const topic = oneOf("topic", input["topic"], SEARCH_TOPICS);
	if (!topic.ok) return topic;
	const timeRange = oneOf("time_range", input["time_range"], SEARCH_TIME_RANGES);
	if (!timeRange.ok) return timeRange;
	const includeDomains = domainList("include_domains", input["include_domains"]);
	if (!includeDomains.ok) return includeDomains;
	const excludeDomains = domainList("exclude_domains", input["exclude_domains"]);
	if (!excludeDomains.ok) return excludeDomains;

	const args: SearchArgs = { query: query.trim() };
	// "general" is Tavily's default; storing it would make an unfiltered search
	// read as filtered in the chip and the no-results message.
	if (topic.value && topic.value !== "general") args.topic = topic.value;
	if (timeRange.value) args.timeRange = timeRange.value;
	if (includeDomains.value) args.includeDomains = includeDomains.value;
	if (excludeDomains.value) args.excludeDomains = excludeDomains.value;
	return { ok: true, value: args };
}

export function hasSearchFilters(args: SearchArgs): boolean {
	return !!(args.topic || args.timeRange || args.includeDomains || args.excludeDomains);
}

/** Words for the filter summary, supplied by the caller so the same builder
 *  serves the model (English) and the chip (the UI locale). */
export interface FilterWords {
	topic: Record<Exclude<SearchTopic, "general">, string>;
	timeRange: Record<SearchTimeRange, string>;
	sites: (n: number) => string;
	excluding: (n: number) => string;
}

export const ENGLISH_FILTER_WORDS: FilterWords = {
	topic: { news: "news", finance: "finance" },
	timeRange: { day: "past day", week: "past week", month: "past month", year: "past year" },
	sites: (n) => (n === 1 ? "1 site" : `${n} sites`),
	excluding: (n) => (n === 1 ? "excluding 1 site" : `excluding ${n} sites`),
};

/** `news · past week · 2 sites` — the ONE description of a search's filters,
 *  for the status chip and the no-results message. "" when there are none. */
export function describeSearchFilters(args: SearchArgs, words: FilterWords = ENGLISH_FILTER_WORDS): string {
	const parts: string[] = [];
	if (args.topic && args.topic !== "general") parts.push(words.topic[args.topic]);
	if (args.timeRange) parts.push(words.timeRange[args.timeRange]);
	if (args.includeDomains) {
		parts.push(args.includeDomains.length === 1 ? args.includeDomains[0] : words.sites(args.includeDomains.length));
	}
	if (args.excludeDomains) parts.push(words.excluding(args.excludeDomains.length));
	return parts.join(" · ");
}

/** True for a host that is not on the public internet. Tavily fetches the page
 *  from its own servers, so such a URL could never be read — but sending it
 *  would still hand an intranet address to a third party. */
export function isPrivateHost(hostname: string): boolean {
	const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (h === "localhost" || h.endsWith(".localhost")) return true;
	if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return true;
	if (!h.includes(".") && !h.includes(":")) return true; // a single-label intranet name
	if (h.includes(":")) {
		// IPv6: loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10).
		return h === "::1" || h === "::" || /^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h);
	}
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
	if (!m) return false;
	const [a, b] = [Number(m[1]), Number(m[2])];
	return (
		a === 10 || a === 127 || a === 0 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
	);
}

export function parseReadUrlArgs(input: Record<string, unknown>): Parsed<string> {
	const raw = input["url"];
	if (typeof raw !== "string" || !raw.trim()) {
		return { ok: false, error: "'url' must be a non-empty string." };
	}
	const url = safeHttpUrl(raw);
	if (!url) return { ok: false, error: `'url' must be an http(s) address (got ${JSON.stringify(raw)}).` };
	if (isPrivateHost(new URL(url).hostname)) {
		return { ok: false, error: `${url} is a private or local address; it was not sent to the web reader. Ask the user to paste the page's text instead.` };
	}
	return { ok: true, value: url };
}
