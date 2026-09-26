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

/** Tavily refuses a longer query with an HTTP 400 (its error names 400
 *  characters). Named here so the model is told before a credit is spent,
 *  and can shorten it in the same turn (ADR-228). */
export const MAX_QUERY_CHARS = 400;

export interface SearchArgs {
	query: string;
	topic?: SearchTopic;
	timeRange?: SearchTimeRange;
	includeDomains?: string[];
	excludeDomains?: string[];
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// A bare hostname: labels of letters, digits and hyphens, at least one dot,
// an alphabetic TLD or an internationalised one in its xn-- form (`.рф` is
// `xn--p1ai`, ADR-228). Deliberately strict — anything else is not a site filter.
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

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
	if (query.trim().length > MAX_QUERY_CHARS) {
		return { ok: false, error: `'query' may be at most ${MAX_QUERY_CHARS} characters (got ${query.trim().length}). Search with the key words only.` };
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
	/** `what` is one site's name, or `sites(n)` for several. */
	excluding: (what: string) => string;
}

export const ENGLISH_FILTER_WORDS: FilterWords = {
	topic: { news: "news", finance: "finance" },
	timeRange: { day: "past day", week: "past week", month: "past month", year: "past year" },
	sites: (n) => `${n} sites`, // only ever called for two or more
	excluding: (what) => `excluding ${what}`,
};

/** `news · past week · 2 sites` — the ONE description of a search's filters,
 *  for the status chip and the no-results message. "" when there are none. */
export function describeSearchFilters(args: SearchArgs, words: FilterWords = ENGLISH_FILTER_WORDS): string {
	const parts: string[] = [];
	if (args.topic && args.topic !== "general") parts.push(words.topic[args.topic]);
	if (args.timeRange) parts.push(words.timeRange[args.timeRange]);
	// One site is named; several are counted, so the sentence never needs a
	// singular form in any locale.
	const sites = (domains: string[]) => (domains.length === 1 ? domains[0] : words.sites(domains.length));
	if (args.includeDomains) parts.push(sites(args.includeDomains));
	if (args.excludeDomains) parts.push(words.excluding(sites(args.excludeDomains)));
	return parts.join(" · ");
}

/** True for a host that is not on the public internet. Tavily fetches the page
 *  from its own servers, so such a URL could never be read — but sending it
 *  would still hand an intranet address to a third party. */
export function isPrivateHost(hostname: string): boolean {
	// A trailing dot is the fully-qualified spelling of the same name
	// (`localhost.`, `nas.local.`) and must not change the verdict.
	const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
	if (h === "localhost" || h.endsWith(".localhost")) return true;
	if (PRIVATE_SUFFIXES.some((suffix) => h.endsWith(suffix))) return true;
	if (!h.includes(".") && !h.includes(":")) return true; // a single-label intranet name
	if (h.includes(":")) {
		// IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d), which the
		// URL parser writes as two hex groups, are the IPv4 address they carry.
		const mapped = /^(?:::ffff|64:ff9b:):([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
		if (mapped) {
			const hi = parseInt(mapped[1], 16);
			const lo = parseInt(mapped[2], 16);
			return isPrivateIPv4(hi >> 8, hi & 255, lo >> 8);
		}
		const dotted = /^(?:::ffff|64:ff9b:):(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
		if (dotted) return isPrivateHost(dotted[1]);
		// IPv6: loopback, unspecified, unique-local (fc00::/7), link-local
		// (fe80::/10), multicast (ff00::/8).
		return h === "::1" || h === "::" || /^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h) || /^ff[0-9a-f]{0,2}:/.test(h);
	}
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
	if (m) return isPrivateIPv4(Number(m[1]), Number(m[2]), Number(m[3]));
	// A public name that spells a private address — 127.0.0.1.nip.io,
	// 10-0-0-1.sslip.io — resolves to it; judged by the address it names (ADR-228).
	const spelled = /^(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})\./.exec(h);
	return !!spelled && isPrivateIPv4(Number(spelled[1]), Number(spelled[2]), Number(spelled[3]));
}

/** Names that only resolve inside a network: mDNS, the reserved home and
 *  internal suffixes, and the private ones organisations commonly use. */
const PRIVATE_SUFFIXES = [".local", ".internal", ".lan", ".home.arpa", ".home", ".corp", ".intranet", ".private"];

/** The IPv4 ranges that are not a public web server: private, loopback,
 *  link-local, carrier-grade NAT, the documentation and benchmarking nets,
 *  multicast and reserved (ADR-228 added the last four). */
function isPrivateIPv4(a: number, b: number, c: number): boolean {
	return (
		a === 10 || a === 127 || a === 0 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
		(a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments · TEST-NET-1
		(a === 198 && (b === 18 || b === 19)) || // benchmarking
		(a === 198 && b === 51 && c === 100) || // TEST-NET-2
		(a === 203 && b === 0 && c === 113) || // TEST-NET-3
		a >= 224 // multicast, reserved, broadcast
	);
}

export function parseReadUrlArgs(input: Record<string, unknown>): Parsed<string> {
	const raw = input["url"];
	if (typeof raw !== "string" || !raw.trim()) {
		return { ok: false, error: "'url' must be a non-empty string." };
	}
	const url = safeHttpUrl(raw);
	if (!url) return { ok: false, error: `'url' must be an http(s) address (got ${JSON.stringify(raw)}).` };
	const parsed = new URL(url);
	// A user:password in the address is a credential, and it would travel to
	// Tavily with the rest of the URL. Refused, never stripped: the page behind
	// it is one the user reaches as themselves.
	if (parsed.username || parsed.password) {
		return { ok: false, error: "'url' contains a user name or password; it was not sent to the web reader. Ask the user to paste the page's text instead." };
	}
	if (isPrivateHost(parsed.hostname)) {
		return { ok: false, error: `${url} is a private or local address; it was not sent to the web reader. Ask the user to paste the page's text instead.` };
	}
	return { ok: true, value: url };
}
