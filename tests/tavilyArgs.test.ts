import { describe, it, expect } from "vitest";
import {
	parseSearchArgs,
	parseReadUrlArgs,
	describeSearchFilters,
	hasSearchFilters,
	isPrivateHost,
	MAX_FILTER_DOMAINS,
} from "../services/tavilyArgs";

describe("parseSearchArgs", () => {
	it("accepts a bare query and adds no filters", () => {
		const r = parseSearchArgs({ query: "  ecb rates " });
		expect(r).toEqual({ ok: true, value: { query: "ecb rates" } });
		expect(r.ok && hasSearchFilters(r.value)).toBe(false);
	});

	it("rejects a missing or empty query", () => {
		expect(parseSearchArgs({})).toMatchObject({ ok: false, error: expect.stringMatching(/'query'/) });
		expect(parseSearchArgs({ query: "  " }).ok).toBe(false);
	});

	it("accepts every topic and time_range, and names the field on a bad one", () => {
		for (const topic of ["news", "finance"]) {
			expect(parseSearchArgs({ query: "q", topic })).toEqual({ ok: true, value: { query: "q", topic } });
		}
		for (const time_range of ["day", "week", "month", "year"]) {
			expect(parseSearchArgs({ query: "q", time_range })).toEqual({ ok: true, value: { query: "q", timeRange: time_range } });
		}
		const badTopic = parseSearchArgs({ query: "q", topic: "sports" });
		expect(badTopic).toMatchObject({ ok: false, error: expect.stringMatching(/'topic'.*"sports"/) });
		const badRange = parseSearchArgs({ query: "q", time_range: "hour" });
		expect(badRange).toMatchObject({ ok: false, error: expect.stringMatching(/'time_range'.*"hour"/) });
	});

	it("treats topic general as no filter — it is Tavily's default", () => {
		expect(parseSearchArgs({ query: "q", topic: "general" })).toEqual({ ok: true, value: { query: "q" } });
	});

	it("normalises domains to bare lowercase hosts and dedupes them", () => {
		const r = parseSearchArgs({ query: "q", include_domains: ["https://www.Example.com/path", "example.com", "ecb.europa.eu"] });
		expect(r).toEqual({ ok: true, value: { query: "q", includeDomains: ["example.com", "ecb.europa.eu"] } });
	});

	it("rejects a non-domain, a non-array and more than the cap, naming the field", () => {
		expect(parseSearchArgs({ query: "q", exclude_domains: ["not a domain"] }))
			.toMatchObject({ ok: false, error: expect.stringMatching(/'exclude_domains'.*not a domain/) });
		expect(parseSearchArgs({ query: "q", include_domains: "example.com" }))
			.toMatchObject({ ok: false, error: expect.stringMatching(/'include_domains' must be an array/) });
		const many = Array.from({ length: MAX_FILTER_DOMAINS + 1 }, (_, i) => `s${i}.com`);
		expect(parseSearchArgs({ query: "q", include_domains: many }))
			.toMatchObject({ ok: false, error: expect.stringMatching(new RegExp(`at most ${MAX_FILTER_DOMAINS}`)) });
	});

	it("drops unknown keys — a stray field never reaches the request", () => {
		const r = parseSearchArgs({ query: "q", search_depth: "advanced", api_key: "x" });
		expect(r).toEqual({ ok: true, value: { query: "q" } });
	});
});

describe("describeSearchFilters", () => {
	it("is empty without filters", () => {
		expect(describeSearchFilters({ query: "q" })).toBe("");
	});
	it("names topic, range, a single site by name and counts the rest", () => {
		expect(describeSearchFilters({ query: "q", topic: "news", timeRange: "week", includeDomains: ["x.com"] }))
			.toBe("news · past week · x.com");
		expect(describeSearchFilters({ query: "q", includeDomains: ["a.com", "b.com"], excludeDomains: ["c.com"] }))
			.toBe("2 sites · excluding 1 site");
	});
});

describe("parseReadUrlArgs", () => {
	it("accepts a public http(s) URL", () => {
		expect(parseReadUrlArgs({ url: "https://example.com/a?b=1" })).toEqual({ ok: true, value: "https://example.com/a?b=1" });
		expect(parseReadUrlArgs({ url: "example.com/page" })).toEqual({ ok: true, value: "https://example.com/page" });
	});

	it("rejects a missing url and a non-http scheme", () => {
		expect(parseReadUrlArgs({}).ok).toBe(false);
		expect(parseReadUrlArgs({ url: "javascript:alert(1)" }).ok).toBe(false);
		expect(parseReadUrlArgs({ url: "file:///etc/passwd" }).ok).toBe(false);
	});

	it.each([
		"http://localhost:8080/x",
		"http://127.0.0.1/",
		"http://10.1.2.3/",
		"http://172.16.0.1/",
		"http://172.31.255.255/",
		"http://192.168.1.10/",
		"http://169.254.169.254/latest/meta-data",
		"http://[::1]/",
		"http://nas.local/",
		"http://wiki.internal/page",
		"http://intranet/page",
	])("refuses the private address %s and says why", (url) => {
		const r = parseReadUrlArgs({ url });
		expect(r.ok).toBe(false);
		expect(!r.ok && r.error).toMatch(/private or local address/);
	});
});

describe("isPrivateHost", () => {
	it("does not flag public neighbours of private ranges", () => {
		expect(isPrivateHost("172.32.0.1")).toBe(false);
		expect(isPrivateHost("11.0.0.1")).toBe(false);
		expect(isPrivateHost("example.com")).toBe(false);
		expect(isPrivateHost("2001:db8::1")).toBe(false);
	});
	it("flags IPv6 unique-local and link-local", () => {
		expect(isPrivateHost("[fd00::1]")).toBe(true);
		expect(isPrivateHost("fe80::1")).toBe(true);
	});
});
