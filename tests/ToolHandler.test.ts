import { describe, it, expect, vi } from "vitest";

// Mock the NoteWriter module to prevent its obsidian import from failing
// in the test environment. executeToolCall receives an injected writer, so
// the mock class body is irrelevant — we never instantiate it in these tests.
vi.mock("../services/NoteWriter", () => ({ NoteWriter: class {} }));

import { getToolDefinitions, executeToolCall } from "../services/ToolHandler";
import type { NoteWriter } from "../services/NoteWriter";
import type { ToolCall } from "../models/types";

// ── Minimal mock writer ───────────────────────────────────────────────────────

const makeWriter = (overrides?: { writeNote?: () => Promise<{ path: string }>; prependWithSeparator?: () => Promise<{ path: string }> }): NoteWriter => ({
	writeNote:           vi.fn().mockResolvedValue({ path: "Notes/out.md" }),
	prependWithSeparator: vi.fn().mockResolvedValue({ path: "Notes/out.md" }),
	...overrides,
} as unknown as NoteWriter);

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

// ── executeToolCall — input validation ────────────────────────────────────────

describe("executeToolCall — input validation", () => {
	it("rejects a missing path", async () => {
		const result = await executeToolCall(makeWriter(), call("create_note", { content: "body" }));
		expect(result).toMatch(/path.*non-empty/i);
	});

	it("rejects an empty path string", async () => {
		const result = await executeToolCall(makeWriter(), call("create_note", { path: "  ", content: "body" }));
		expect(result).toMatch(/path.*non-empty/i);
	});

	it("rejects a non-string content value", async () => {
		const result = await executeToolCall(makeWriter(), call("create_note", { path: "Notes/x.md", content: 42 }));
		expect(result).toMatch(/content.*string/i);
	});

	it("rejects a path that does not end with .md", async () => {
		const result = await executeToolCall(makeWriter(), call("create_note", { path: "Notes/x.txt", content: "body" }));
		expect(result).toMatch(/\.md/);
	});
});

// ── executeToolCall — create_note ─────────────────────────────────────────────

describe("executeToolCall — create_note", () => {
	it("calls writer.writeNote with the correct arguments", async () => {
		const writer = makeWriter();
		await executeToolCall(writer, call("create_note", { path: "Notes/new.md", content: "# Title" }));
		expect(writer.writeNote).toHaveBeenCalledWith("# Title", "Notes/new.md");
	});

	it("returns a success message containing the written path", async () => {
		const result = await executeToolCall(makeWriter(), call("create_note", { path: "Notes/new.md", content: "body" }));
		expect(result).toContain("Notes/out.md");
	});

	it("returns an error string when writeNote throws", async () => {
		const writer = makeWriter({ writeNote: vi.fn().mockRejectedValue(new Error("disk full")) });
		const result = await executeToolCall(writer, call("create_note", { path: "Notes/x.md", content: "body" }));
		expect(result).toMatch(/error writing note.*disk full/i);
	});
});

// ── executeToolCall — rewrite_note ────────────────────────────────────────────

describe("executeToolCall — rewrite_note", () => {
	it("calls writer.writeNote (same as create_note)", async () => {
		const writer = makeWriter();
		await executeToolCall(writer, call("rewrite_note", { path: "Notes/existing.md", content: "updated" }));
		expect(writer.writeNote).toHaveBeenCalledWith("updated", "Notes/existing.md");
	});

	it("returns a success message", async () => {
		const result = await executeToolCall(makeWriter(), call("rewrite_note", { path: "Notes/x.md", content: "body" }));
		expect(result).toMatch(/Note written/);
	});
});

// ── executeToolCall — prepend_note ────────────────────────────────────────────

describe("executeToolCall — prepend_note", () => {
	it("calls writer.prependWithSeparator with the correct arguments", async () => {
		const writer = makeWriter();
		await executeToolCall(writer, call("prepend_note", { path: "Notes/doc.md", content: "prefix" }));
		expect(writer.prependWithSeparator).toHaveBeenCalledWith("prefix", "Notes/doc.md");
	});

	it("returns a success message containing the updated path", async () => {
		const result = await executeToolCall(makeWriter(), call("prepend_note", { path: "Notes/doc.md", content: "prefix" }));
		expect(result).toContain("Notes/out.md");
	});

	it("returns an error string when prependWithSeparator throws", async () => {
		const writer = makeWriter({ prependWithSeparator: vi.fn().mockRejectedValue(new Error("locked")) });
		const result = await executeToolCall(writer, call("prepend_note", { path: "Notes/doc.md", content: "prefix" }));
		expect(result).toMatch(/error updating note.*locked/i);
	});
});

// ── executeToolCall — unknown tool ────────────────────────────────────────────

describe("executeToolCall — unknown tool", () => {
	it("returns an error for an unrecognised tool name", async () => {
		const result = await executeToolCall(makeWriter(), call("delete_note", { path: "Notes/x.md", content: "" }));
		expect(result).toMatch(/unknown tool.*delete_note/i);
	});
});
