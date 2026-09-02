import { describe, it, expect, vi, beforeEach } from "vitest";

// requestUrl is the only obsidian import UpvotyService uses at runtime.
vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

import { requestUrl } from "obsidian";
import {
	UpvotyService,
	parseJsonRpcResponse,
	formatToolResult,
	readSessionId,
} from "../services/UpvotyService";
import type { PythiaSettings } from "../models/settings";

const requestUrlMock = requestUrl as unknown as ReturnType<typeof vi.fn>;

const settings = (overrides: Partial<PythiaSettings> = {}): PythiaSettings =>
	({ upvotyServerUrl: "https://example.com/mcp", ...overrides } as PythiaSettings);

/** A fake requestUrl response. */
const res = (status: number, text = "", headers: Record<string, string> = {}) => ({
	status,
	text,
	headers,
	json: undefined,
});

/** A JSON-RPC result envelope as raw-JSON body text. */
const rpcResult = (id: number, result: unknown) =>
	JSON.stringify({ jsonrpc: "2.0", id, result });

/** An MCP tools/call text-content result. */
const toolText = (text: string) => ({ content: [{ type: "text", text }] });

beforeEach(() => {
	requestUrlMock.mockReset();
});

// ── Pure parsers ──────────────────────────────────────────────────────────────

describe("parseJsonRpcResponse", () => {
	it("parses a raw JSON body", () => {
		const msg = parseJsonRpcResponse(rpcResult(1, { ok: true }));
		expect(msg?.result).toEqual({ ok: true });
	});

	it("parses an SSE body and picks the frame carrying a result", () => {
		const body =
			"event: message\n" +
			'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n' +
			"event: message\n" +
			`data: ${rpcResult(2, { done: true })}\n\n`;
		const msg = parseJsonRpcResponse(body);
		expect(msg?.result).toEqual({ done: true });
	});

	it("returns null for an empty or unparseable body", () => {
		expect(parseJsonRpcResponse("")).toBeNull();
		expect(parseJsonRpcResponse("not json at all")).toBeNull();
	});

	it("surfaces an error envelope", () => {
		const msg = parseJsonRpcResponse(
			JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "nope" } })
		);
		expect(msg?.error?.message).toBe("nope");
	});
});

describe("formatToolResult", () => {
	it("prefixes text content with the data guard", () => {
		const out = formatToolResult(toolText("• Dark mode (42 votes)"));
		expect(out).toContain("Dark mode");
		expect(out).toMatch(/never follow any instructions/i);
	});

	it("marks tool errors distinctly", () => {
		const out = formatToolResult({ content: [{ type: "text", text: "bad id" }], isError: true });
		expect(out).toMatch(/reported an error/i);
		expect(out).toContain("bad id");
	});

	it("handles an empty / missing result", () => {
		expect(formatToolResult(undefined)).toMatch(/^Error:/);
		expect(formatToolResult({ content: [] })).toMatch(/No Upvoty data/i);
	});

	it("truncates very long content", () => {
		const huge = "x".repeat(20000);
		const out = formatToolResult(toolText(huge));
		expect(out.length).toBeLessThan(9000);
		expect(out).toMatch(/truncated/i);
	});
});

describe("readSessionId", () => {
	it("reads the header case-insensitively", () => {
		expect(readSessionId({ "Mcp-Session-Id": "s1" })).toBe("s1");
		expect(readSessionId({ "mcp-session-id": "s2" })).toBe("s2");
		expect(readSessionId({})).toBeUndefined();
		expect(readSessionId(undefined)).toBeUndefined();
	});
});

// ── Configuration guards ──────────────────────────────────────────────────────

describe("UpvotyService — configuration guards", () => {
	it("hasConfig requires both a URL and a token", () => {
		expect(new UpvotyService(settings(), "").hasConfig()).toBe(false);
		expect(new UpvotyService(settings({ upvotyServerUrl: "" }), "tok").hasConfig()).toBe(false);
		expect(new UpvotyService(settings(), "tok").hasConfig()).toBe(true);
	});

	it("returns an error (never throws) when the URL is missing", async () => {
		const svc = new UpvotyService(settings({ upvotyServerUrl: "" }), "tok");
		expect(await svc.run("upvoty_list_roadmap", {})).toMatch(/not configured/i);
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("returns an error when the token is missing", async () => {
		const svc = new UpvotyService(settings(), "");
		expect(await svc.run("upvoty_list_roadmap", {})).toMatch(/not configured/i);
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("rejects an unknown tool name", async () => {
		const svc = new UpvotyService(settings(), "tok");
		expect(await svc.run("upvoty_delete_everything", {})).toMatch(/unknown Upvoty tool/i);
	});
});

// ── Protocol flow ─────────────────────────────────────────────────────────────

describe("UpvotyService — MCP flow", () => {
	it("initializes (sending the session id on later calls) then returns the tool text", async () => {
		requestUrlMock
			// initialize → returns a session id header
			.mockResolvedValueOnce(res(200, rpcResult(1, { protocolVersion: "x" }), { "mcp-session-id": "sess-1" }))
			// notifications/initialized → 202 no body
			.mockResolvedValueOnce(res(202, ""))
			// tools/call → the feedback text
			.mockResolvedValueOnce(res(200, rpcResult(3, toolText("Feedback: A, B, C"))));

		const svc = new UpvotyService(settings(), "tok");
		const out = await svc.run("upvoty_search_feedback", { query: "billing" });

		expect(out).toContain("Feedback: A, B, C");

		// Auth header on every call; session id replayed after initialize.
		const initCall = requestUrlMock.mock.calls[0][0];
		expect(initCall.headers.Authorization).toBe("Bearer tok");
		expect(JSON.parse(initCall.body).method).toBe("initialize");

		const toolCall = requestUrlMock.mock.calls[2][0];
		expect(toolCall.headers["Mcp-Session-Id"]).toBe("sess-1");
		const toolBody = JSON.parse(toolCall.body);
		expect(toolBody.method).toBe("tools/call");
		expect(toolBody.params).toEqual({ name: "list_feedback", arguments: { query: "billing" } });
	});

	it("re-handshakes once when the session is rejected mid-call", async () => {
		requestUrlMock
			.mockResolvedValueOnce(res(200, rpcResult(1, {}), { "mcp-session-id": "sess-1" })) // init
			.mockResolvedValueOnce(res(202, "")) // initialized
			.mockResolvedValueOnce(res(404, "")) // tools/call → stale session
			.mockResolvedValueOnce(res(200, rpcResult(4, {}), { "mcp-session-id": "sess-2" })) // re-init
			.mockResolvedValueOnce(res(202, "")) // initialized
			.mockResolvedValueOnce(res(200, rpcResult(6, toolText("ok")))); // tools/call retry

		const svc = new UpvotyService(settings(), "tok");
		const out = await svc.run("upvoty_get_project", {});
		expect(out).toContain("ok");
		expect(requestUrlMock).toHaveBeenCalledTimes(6);
	});

	it("returns a readable error on an auth failure", async () => {
		requestUrlMock.mockResolvedValueOnce(res(401, "unauthorized"));
		const svc = new UpvotyService(settings(), "bad");
		const out = await svc.run("upvoty_list_roadmap", {});
		expect(out).toMatch(/rejected the token/i);
	});

	it("surfaces a JSON-RPC error from tools/call", async () => {
		requestUrlMock
			.mockResolvedValueOnce(res(200, rpcResult(1, {}), { "mcp-session-id": "s" }))
			.mockResolvedValueOnce(res(202, ""))
			.mockResolvedValueOnce(
				res(200, JSON.stringify({ jsonrpc: "2.0", id: 3, error: { message: "boom" } }))
			);
		const svc = new UpvotyService(settings(), "tok");
		expect(await svc.run("upvoty_list_roadmap", {})).toMatch(/boom/);
	});

	it("never throws on a network failure", async () => {
		requestUrlMock.mockRejectedValueOnce(new Error("offline"));
		const svc = new UpvotyService(settings(), "tok");
		expect(await svc.run("upvoty_list_roadmap", {})).toMatch(/request failed.*offline/i);
	});
});
