import { describe, it, expect, vi } from "vitest";

// Mock the NoteWriter module to prevent its obsidian import from failing
// in the test environment. ToolHandler receives an injected writer, so
// the mock class body is irrelevant — we never instantiate it in these tests.
vi.mock("../services/NoteWriter", () => ({ NoteWriter: class {} }));

import { getToolDefinitions, ToolHandler, buildUpvotyArgs } from "../services/ToolHandler";
import type { NoteWriter } from "../services/NoteWriter";
import type { WebSearchService } from "../services/WebSearchService";
import type { UpvotyService } from "../services/UpvotyService";
import type { ToolCall } from "../models/types";

// ── Minimal mock writer ───────────────────────────────────────────────────────

const makeWriter = (overrides?: { writeNote?: () => Promise<{ path: string }>; prependWithSeparator?: () => Promise<{ path: string }> }): NoteWriter => ({
	writeNote:           vi.fn().mockResolvedValue({ path: "Notes/out.md" }),
	prependWithSeparator: vi.fn().mockResolvedValue({ path: "Notes/out.md" }),
	...overrides,
} as unknown as NoteWriter);

const makeHandler = (overrides?: Parameters<typeof makeWriter>[0]) =>
	new ToolHandler(makeWriter(overrides));

const call = (name: string, input: Record<string, unknown>): ToolCall => ({
	id: "test-id",
	name,
	input,
});

// ── getToolDefinitions ────────────────────────────────────────────────────────

describe("getToolDefinitions", () => {
	it("returns empty array for write mode 'none'", () => {
		expect(getToolDefinitions("Scratch", "none")).toHaveLength(0);
	});

	it("returns only create_note for write mode 'create'", () => {
		const defs = getToolDefinitions("Scratch", "create");
		expect(defs).toHaveLength(1);
		expect(defs[0].name).toBe("create_note");
	});

	it("returns only prepend_note for write mode 'update'", () => {
		const defs = getToolDefinitions("Scratch", "update");
		expect(defs).toHaveLength(1);
		expect(defs[0].name).toBe("prepend_note");
	});

	it("returns only rewrite_note for write mode 'rewrite'", () => {
		const defs = getToolDefinitions("Scratch", "rewrite");
		expect(defs).toHaveLength(1);
		expect(defs[0].name).toBe("rewrite_note");
	});

	it("returns all three tools for write mode 'all' (default)", () => {
		const defs = getToolDefinitions("Scratch");
		expect(defs).toHaveLength(3);
		expect(defs.map(d => d.name)).toEqual(["create_note", "prepend_note", "rewrite_note"]);
	});

	it("embeds the default folder in the create_note description", () => {
		const [def] = getToolDefinitions("My Notes", "create");
		expect(def.description).toContain("My Notes");
	});

	it("each definition has required path and content in its input schema", () => {
		for (const def of getToolDefinitions("Scratch")) {
			expect((def.inputSchema as { required: string[] }).required).toContain("path");
			expect((def.inputSchema as { required: string[] }).required).toContain("content");
		}
	});
});

// ── ToolHandler — input validation ───────────────────────────────────────────

describe("ToolHandler — input validation", () => {
	it("rejects a missing path", async () => {
		const result = await makeHandler().execute(call("create_note", { content: "body" }));
		expect(result).toMatch(/path.*non-empty/i);
	});

	it("rejects an empty path string", async () => {
		const result = await makeHandler().execute(call("create_note", { path: "  ", content: "body" }));
		expect(result).toMatch(/path.*non-empty/i);
	});

	it("rejects a non-string content value", async () => {
		const result = await makeHandler().execute(call("create_note", { path: "Notes/x.md", content: 42 }));
		expect(result).toMatch(/content.*string/i);
	});

	it("rejects a path that does not end with .md", async () => {
		const result = await makeHandler().execute(call("create_note", { path: "Notes/x.txt", content: "body" }));
		expect(result).toMatch(/\.md/);
	});
});

// ── ToolHandler — create_note ─────────────────────────────────────────────────

describe("ToolHandler — create_note", () => {
	it("calls writer.writeNote with the correct arguments", async () => {
		const writer = makeWriter();
		await new ToolHandler(writer).execute(call("create_note", { path: "Notes/new.md", content: "# Title" }));
		expect(writer.writeNote).toHaveBeenCalledWith("# Title", "Notes/new.md");
	});

	it("returns a success message containing the written path", async () => {
		const result = await makeHandler().execute(call("create_note", { path: "Notes/new.md", content: "body" }));
		expect(result).toContain("Notes/out.md");
	});

	it("returns an error string when writeNote throws", async () => {
		const result = await makeHandler({ writeNote: vi.fn().mockRejectedValue(new Error("disk full")) })
			.execute(call("create_note", { path: "Notes/x.md", content: "body" }));
		expect(result).toMatch(/error writing note.*disk full/i);
	});
});

// ── ToolHandler — rewrite_note ────────────────────────────────────────────────

describe("ToolHandler — rewrite_note", () => {
	it("calls writer.writeNote (same as create_note)", async () => {
		const writer = makeWriter();
		await new ToolHandler(writer).execute(call("rewrite_note", { path: "Notes/existing.md", content: "updated" }));
		expect(writer.writeNote).toHaveBeenCalledWith("updated", "Notes/existing.md");
	});

	it("returns a success message", async () => {
		const result = await makeHandler().execute(call("rewrite_note", { path: "Notes/x.md", content: "body" }));
		expect(result).toMatch(/Note written/);
	});
});

// ── ToolHandler — prepend_note ────────────────────────────────────────────────

describe("ToolHandler — prepend_note", () => {
	it("calls writer.prependWithSeparator with the correct arguments", async () => {
		const writer = makeWriter();
		await new ToolHandler(writer).execute(call("prepend_note", { path: "Notes/doc.md", content: "prefix" }));
		expect(writer.prependWithSeparator).toHaveBeenCalledWith("prefix", "Notes/doc.md");
	});

	it("returns a success message containing the updated path", async () => {
		const result = await makeHandler().execute(call("prepend_note", { path: "Notes/doc.md", content: "prefix" }));
		expect(result).toContain("Notes/out.md");
	});

	it("returns an error string when prependWithSeparator throws", async () => {
		const result = await makeHandler({ prependWithSeparator: vi.fn().mockRejectedValue(new Error("locked")) })
			.execute(call("prepend_note", { path: "Notes/doc.md", content: "prefix" }));
		expect(result).toMatch(/error updating note.*locked/i);
	});
});

// ── ToolHandler — unknown tool ────────────────────────────────────────────────

describe("ToolHandler — unknown tool", () => {
	it("returns an error for an unrecognised tool name", async () => {
		const result = await makeHandler().execute(call("delete_note", { path: "Notes/x.md", content: "" }));
		expect(result).toMatch(/unknown tool.*delete_note/i);
	});
});

// ── web_search gating ─────────────────────────────────────────────────────────

describe("getToolDefinitions — web_search research gating", () => {
	it("does not include web_search when research is disabled (default)", () => {
		const names = getToolDefinitions("Scratch", "all").map((d) => d.name);
		expect(names).not.toContain("web_search");
	});

	it("appends web_search when research is enabled, for every write mode", () => {
		for (const mode of ["none", "create", "update", "rewrite", "all"] as const) {
			const names = getToolDefinitions("Scratch", mode, true).map((d) => d.name);
			expect(names).toContain("web_search");
		}
	});

	it("exposes web_search even when writeMode is 'none'", () => {
		const defs = getToolDefinitions("Scratch", "none", true);
		expect(defs.map((d) => d.name)).toEqual(["web_search"]);
		expect((defs[0].inputSchema as { required: string[] }).required).toContain("query");
	});
});

describe("ToolHandler.allowedToolNames — research", () => {
	it("omits web_search unless research is enabled", () => {
		expect(ToolHandler.allowedToolNames("all").has("web_search")).toBe(false);
		expect(ToolHandler.allowedToolNames("all", true).has("web_search")).toBe(true);
		expect(ToolHandler.allowedToolNames("none", true).has("web_search")).toBe(true);
	});
});

// ── ToolHandler — web_search execution ────────────────────────────────────────

const makeSearch = (result = "web results"): WebSearchService =>
	({ search: vi.fn().mockResolvedValue(result) } as unknown as WebSearchService);

describe("ToolHandler — web_search", () => {
	it("routes to the search service and returns its string result", async () => {
		const search = makeSearch("Summary: X");
		const handler = new ToolHandler(makeWriter(), search);
		const result = await handler.execute(
			call("web_search", { query: "latest news" }),
			new Set(["web_search"])
		);
		expect(search.search).toHaveBeenCalledWith("latest news");
		expect(result).toBe("Summary: X");
	});

	it("rejects a missing/empty query before calling the service", async () => {
		const search = makeSearch();
		const handler = new ToolHandler(makeWriter(), search);
		const result = await handler.execute(call("web_search", { query: "  " }), new Set(["web_search"]));
		expect(result).toMatch(/query.*non-empty/i);
		expect(search.search).not.toHaveBeenCalled();
	});

	it("returns an error when no search service is wired", async () => {
		const result = await makeHandler().execute(
			call("web_search", { query: "q" }),
			new Set(["web_search"])
		);
		expect(result).toMatch(/web search is not available/i);
	});

	it("is blocked when web_search is not in the allowed set", async () => {
		const search = makeSearch();
		const handler = new ToolHandler(makeWriter(), search);
		const result = await handler.execute(call("web_search", { query: "q" }), new Set(["create_note"]));
		expect(result).toMatch(/not allowed/i);
		expect(search.search).not.toHaveBeenCalled();
	});
});

// ── Upvoty gating ─────────────────────────────────────────────────────────────

const UPVOTY_NAMES = [
	"upvoty_search_feedback",
	"upvoty_get_feedback",
	"upvoty_list_roadmap",
	"upvoty_get_project",
];

describe("getToolDefinitions — Upvoty gating", () => {
	it("does not include Upvoty tools when disabled (default)", () => {
		const names = getToolDefinitions("Scratch", "all", true).map((d) => d.name);
		for (const n of UPVOTY_NAMES) expect(names).not.toContain(n);
	});

	it("appends all Upvoty tools when enabled, for every write mode", () => {
		for (const mode of ["none", "create", "update", "rewrite", "all"] as const) {
			const names = getToolDefinitions("Scratch", mode, false, true).map((d) => d.name);
			for (const n of UPVOTY_NAMES) expect(names).toContain(n);
		}
	});

	it("exposes Upvoty tools even when writeMode is 'none' and research is off", () => {
		const names = getToolDefinitions("Scratch", "none", false, true).map((d) => d.name);
		expect(names).toEqual(UPVOTY_NAMES);
	});
});

describe("ToolHandler.allowedToolNames — Upvoty", () => {
	it("omits Upvoty tools unless enabled", () => {
		const off = ToolHandler.allowedToolNames("all", false, false);
		for (const n of UPVOTY_NAMES) expect(off.has(n)).toBe(false);
		const on = ToolHandler.allowedToolNames("none", false, true);
		for (const n of UPVOTY_NAMES) expect(on.has(n)).toBe(true);
	});
});

// ── buildUpvotyArgs — input → MCP argument mapping ────────────────────────────

describe("buildUpvotyArgs", () => {
	it("maps search filters and renames limit → per_page", () => {
		const args = buildUpvotyArgs("upvoty_search_feedback", {
			query: " dark mode ",
			board: "Feature Requests",
			status: "Planned",
			tag: "ui",
			sort: "most_votes",
			limit: 10,
			page: 2,
		});
		expect(args).toEqual({
			query: "dark mode",
			board: "Feature Requests",
			status: "Planned",
			tag: "ui",
			sort: "most_votes",
			per_page: 10,
			page: 2,
		});
	});

	it("drops empty, blank, and non-positive values", () => {
		const args = buildUpvotyArgs("upvoty_search_feedback", {
			query: "   ",
			board: "",
			limit: 0,
			page: -3,
			bogus: "ignored",
		});
		expect(args).toEqual({});
	});

	it("coerces numeric strings for limit", () => {
		expect(buildUpvotyArgs("upvoty_list_roadmap", { limit: "25" })).toEqual({ per_page: 25 });
	});

	it("passes only id for get_feedback and nothing for get_project", () => {
		expect(buildUpvotyArgs("upvoty_get_feedback", { id: "abc", extra: 1 })).toEqual({ id: "abc" });
		expect(buildUpvotyArgs("upvoty_get_project", { anything: 1 })).toEqual({});
	});
});

// ── ToolHandler — Upvoty execution ────────────────────────────────────────────

const makeUpvoty = (result = "upvoty data"): UpvotyService =>
	({ run: vi.fn().mockResolvedValue(result) } as unknown as UpvotyService);

describe("ToolHandler — Upvoty tools", () => {
	it("routes to the Upvoty service with the mapped args", async () => {
		const upvoty = makeUpvoty("feedback list");
		const handler = new ToolHandler(makeWriter(), undefined, upvoty);
		const result = await handler.execute(
			call("upvoty_search_feedback", { query: "billing", limit: 5 }),
			new Set(UPVOTY_NAMES)
		);
		expect(upvoty.run).toHaveBeenCalledWith("upvoty_search_feedback", { query: "billing", per_page: 5 });
		expect(result).toBe("feedback list");
	});

	it("rejects get_feedback without an id before calling the service", async () => {
		const upvoty = makeUpvoty();
		const handler = new ToolHandler(makeWriter(), undefined, upvoty);
		const result = await handler.execute(
			call("upvoty_get_feedback", { id: "  " }),
			new Set(UPVOTY_NAMES)
		);
		expect(result).toMatch(/id.*non-empty/i);
		expect(upvoty.run).not.toHaveBeenCalled();
	});

	it("returns an error when no Upvoty service is wired", async () => {
		const result = await makeHandler().execute(
			call("upvoty_list_roadmap", {}),
			new Set(UPVOTY_NAMES)
		);
		expect(result).toMatch(/upvoty is not available/i);
	});

	it("is blocked when the tool is not in the allowed set", async () => {
		const upvoty = makeUpvoty();
		const handler = new ToolHandler(makeWriter(), undefined, upvoty);
		const result = await handler.execute(
			call("upvoty_get_project", {}),
			new Set(["create_note"])
		);
		expect(result).toMatch(/not allowed/i);
		expect(upvoty.run).not.toHaveBeenCalled();
	});
});
