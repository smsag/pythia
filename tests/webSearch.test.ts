import { describe, it, expect, vi, beforeEach } from "vitest";

// requestUrl is the only obsidian import WebSearchService uses at runtime.
vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

import { requestUrl } from "obsidian";
import { WebSearchService, parseWebSourcesFromResult } from "../services/WebSearchService";
import type { PythiaSettings } from "../models/settings";

const requestUrlMock = requestUrl as unknown as ReturnType<typeof vi.fn>;

const settings = (overrides: Partial<PythiaSettings> = {}): PythiaSettings =>
	({ webSearchMaxResults: 5, ...overrides } as PythiaSettings);

/** Build a fake requestUrl response. */
const ok = (json: unknown) => ({ status: 200, json, text: "" });

beforeEach(() => {
	requestUrlMock.mockReset();
});

describe("WebSearchService — configuration guards", () => {
	it("returns an error string (never throws) when no API key is set", async () => {
		const svc = new WebSearchService(settings(), "");
		const result = await svc.search("anything");
		expect(result).toMatch(/^Error:/);
		expect(result).toMatch(/not configured/i);
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("returns an error for an empty query", async () => {
		const svc = new WebSearchService(settings(), "key");
		expect(await svc.search("   ")).toMatch(/query.*non-empty/i);
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("hasApiKey reflects the current key", () => {
		const svc = new WebSearchService(settings(), "");
		expect(svc.hasApiKey()).toBe(false);
		svc.updateApiKey("k");
		expect(svc.hasApiKey()).toBe(true);
	});
});

describe("WebSearchService — result formatting", () => {
	it("includes the synthesized answer and each source URL", async () => {
		requestUrlMock.mockResolvedValue(
			ok({
				answer: "Paris is the capital of France.",
				results: [
					{ title: "France", url: "https://example.com/fr", content: "About France." },
					{ title: "Paris", url: "https://example.com/paris", content: "About Paris." },
				],
			})
		);
		const svc = new WebSearchService(settings(), "key");
		const result = await svc.search("capital of France");

		expect(result).toContain("Summary: Paris is the capital of France.");
		expect(result).toContain("https://example.com/fr");
		expect(result).toContain("https://example.com/paris");
		// Web-citation directive is present (shared WEB_CITATION_INSTRUCTION).
		expect(result).toContain("⟦cite:web:<domain>⟧");
		expect(result).toContain("lists the web sources for the user automatically");
		expect(result).not.toMatch(/^Error:/);
	});

	it("truncates long snippets to bound token usage", async () => {
		const long = "x".repeat(2000);
		requestUrlMock.mockResolvedValue(
			ok({ results: [{ title: "T", url: "https://e.com", content: long }] })
		);
		const svc = new WebSearchService(settings(), "key");
		const result = await svc.search("q");
		expect(result).toContain("…");
		// The 2000-char body must not survive intact.
		expect(result).not.toContain(long);
	});

	it("respects webSearchMaxResults", async () => {
		requestUrlMock.mockResolvedValue(
			ok({
				results: [
					{ title: "1", url: "https://e.com/1", content: "a" },
					{ title: "2", url: "https://e.com/2", content: "b" },
					{ title: "3", url: "https://e.com/3", content: "c" },
				],
			})
		);
		const svc = new WebSearchService(settings({ webSearchMaxResults: 2 }), "key");
		const result = await svc.search("q");
		expect(result).toContain("https://e.com/1");
		expect(result).toContain("https://e.com/2");
		expect(result).not.toContain("https://e.com/3");

		// The request body should also ask Tavily for the capped count.
		const body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
		expect(body.max_results).toBe(2);
	});

	it("falls back to a default count when the setting is 0", async () => {
		requestUrlMock.mockResolvedValue(ok({ results: [] }));
		const svc = new WebSearchService(settings({ webSearchMaxResults: 0 }), "key");
		await svc.search("q");
		const body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
		expect(body.max_results).toBe(5);
	});

	it("reports when there are no results and no answer", async () => {
		requestUrlMock.mockResolvedValue(ok({ results: [] }));
		const svc = new WebSearchService(settings(), "key");
		expect(await svc.search("obscure")).toMatch(/No web results found/i);
	});
});

describe("WebSearchService — error handling", () => {
	it("returns an error string on a non-2xx response", async () => {
		requestUrlMock.mockResolvedValue({ status: 401, json: {}, text: "unauthorized" });
		const svc = new WebSearchService(settings(), "key");
		const result = await svc.search("q");
		expect(result).toMatch(/^Error:/);
		expect(result).toContain("401");
	});

	it("returns an error string when the request throws", async () => {
		requestUrlMock.mockRejectedValue(new Error("network down"));
		const svc = new WebSearchService(settings(), "key");
		const result = await svc.search("q");
		expect(result).toMatch(/^Error:/);
		expect(result).toContain("network down");
	});
});

describe("parseWebSourcesFromResult", () => {
	it("extracts {title, url} from the formatted tool result", () => {
		const text = [
			'Web search results for "q". Use these to answer, and cite sources by their URL.',
			"",
			"Summary: something",
			"",
			"### 1. ECB cuts rates",
			"URL: https://www.ecb.europa.eu/press",
			"snippet one",
			"",
			"### 2. Handelsblatt report",
			"URL: https://handelsblatt.com/a/b",
			"snippet two",
		].join("\n");
		const out = parseWebSourcesFromResult(text);
		expect(out).toEqual([
			{ title: "ECB cuts rates", url: "https://www.ecb.europa.eu/press" },
			{ title: "Handelsblatt report", url: "https://handelsblatt.com/a/b" },
		]);
	});
	it("returns [] when there are no result blocks", () => {
		expect(parseWebSourcesFromResult('No web results found for "q".')).toEqual([]);
	});
});
