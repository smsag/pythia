import { describe, it, expect, vi } from "vitest";

const { TFileMock } = vi.hoisted(() => {
	class TFileMock {
		path: string;
		constructor(path: string) { this.path = path; }
	}
	return { TFileMock };
});

vi.mock("obsidian", () => ({
	TFile: TFileMock,
	App: class {},
}));

import { buildSystemPrompt, buildAttachedNotesContent } from "../services/ContextBuilder";
import type { Conversation } from "../models/types";

class MockVault {
	private files = new Map<string, string>();
	getAbstractFileByPath(path: string): unknown {
		return this.files.has(path) ? new TFileMock(path) : null;
	}
	async read(file: { path: string }): Promise<string> {
		return this.files.get(file.path) ?? "";
	}
	seed(path: string, content: string): void { this.files.set(path, content); }
}

const baseConv = (overrides: Partial<Conversation> = {}): Conversation => ({
	id: "c1",
	name: "Test",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	systemPrompt: "",
	contextNotes: [],
	resumeMode: "full",
	provider: "anthropic",
	model: "claude-sonnet-4-6",
	messages: [],
	...overrides,
});

// ── buildSystemPrompt ─────────────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
	it("returns an empty string when there is no system prompt, summary, or notes", () => {
		expect(buildSystemPrompt(baseConv())).toBe("");
	});

	it("wraps the system prompt in a system_prompt tag", () => {
		const result = buildSystemPrompt(baseConv({ systemPrompt: "Be helpful." }));
		expect(result).toBe("<system_prompt>\nBe helpful.\n</system_prompt>");
	});

	it("wraps the summary in a previous_conversation_summary tag", () => {
		const result = buildSystemPrompt(baseConv({ summaryText: "We discussed X." }));
		expect(result).toContain("<previous_conversation_summary>\nWe discussed X.\n</previous_conversation_summary>");
	});

	it("adds a grounding instruction only when notes are attached", () => {
		const withoutNotes = buildSystemPrompt(baseConv({ systemPrompt: "Hi" }));
		const withNotes = buildSystemPrompt(baseConv({ systemPrompt: "Hi", contextNotes: ["Note.md"] }));
		expect(withoutNotes).not.toMatch(/ground/i);
		expect(withNotes).toMatch(/ground/i);
	});

	it("joins multiple parts with a blank line", () => {
		const result = buildSystemPrompt(baseConv({ systemPrompt: "Hi", summaryText: "Summary" }));
		expect(result).toBe(
			"<system_prompt>\nHi\n</system_prompt>\n\n<previous_conversation_summary>\nSummary\n</previous_conversation_summary>"
		);
	});
});

// ── buildAttachedNotesContent ─────────────────────────────────────────────────

describe("buildAttachedNotesContent", () => {
	it("returns empty content and zero tokens for no attached notes", async () => {
		const vault = new MockVault();
		const app = { vault } as unknown as import("obsidian").App;
		const result = await buildAttachedNotesContent(app, []);
		expect(result).toEqual({ content: "", missingNotes: [], estimatedTokens: 0 });
	});

	it("inlines note content wrapped in an attached_note tag", async () => {
		const vault = new MockVault();
		vault.seed("Notes/A.md", "Hello world");
		const app = { vault } as unknown as import("obsidian").App;
		const { content, missingNotes } = await buildAttachedNotesContent(app, ["Notes/A.md"]);
		expect(content).toContain('<attached_note path="Notes/A.md">');
		expect(content).toContain("Hello world");
		expect(missingNotes).toHaveLength(0);
	});

	it("reports missing notes without throwing", async () => {
		const vault = new MockVault();
		const app = { vault } as unknown as import("obsidian").App;
		const { missingNotes, content } = await buildAttachedNotesContent(app, ["Ghost.md"]);
		expect(missingNotes).toEqual(["Ghost.md"]);
		expect(content).toBe("");
	});

	it("estimates tokens proportional to the inlined content length", async () => {
		const vault = new MockVault();
		vault.seed("Notes/A.md", "x".repeat(400));
		const app = { vault } as unknown as import("obsidian").App;
		const { estimatedTokens } = await buildAttachedNotesContent(app, ["Notes/A.md"]);
		expect(estimatedTokens).toBeGreaterThan(90);
	});

	it("excerpts a long note and marks it as a partial excerpt, using the query for relevance", async () => {
		const vault = new MockVault();
		const filler = "lorem ipsum ".repeat(400);
		const longNote = `# Budget\n${filler}\n# Roadmap\nQ3 roadmap details. ${filler}`;
		vault.seed("Notes/Long.md", longNote);
		const app = { vault } as unknown as import("obsidian").App;

		const { content } = await buildAttachedNotesContent(app, ["Notes/Long.md"], "what is the Q3 roadmap");
		expect(content).toContain('excerpt="true"');
		expect(content).toContain("Roadmap");
		expect(content).toContain("most relevant sections");
	});

	it("inlines a short note fully without marking it as an excerpt", async () => {
		const vault = new MockVault();
		vault.seed("Notes/Short.md", "# A\nJust a short note.");
		const app = { vault } as unknown as import("obsidian").App;

		const { content } = await buildAttachedNotesContent(app, ["Notes/Short.md"], "anything");
		expect(content).not.toContain("excerpt=");
		expect(content).toContain("Just a short note.");
	});
});
