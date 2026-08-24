import { describe, it, expect, vi } from "vitest";

const { TFileMock } = vi.hoisted(() => {
	class TFileMock {
		path: string;
		name: string;
		stat: { size: number };
		constructor(path: string, size = 0) {
			this.path = path;
			this.name = path.split("/").pop() ?? path;
			this.stat = { size };
		}
	}
	return { TFileMock };
});

vi.mock("obsidian", () => ({
	TFile: TFileMock,
	App: class {},
}));

import { buildSystemPrompt, buildAttachedNotesContent, buildAttachedPdfs } from "../services/ContextBuilder";
import type { Conversation } from "../models/types";

class MockVault {
	private files = new Map<string, string>();
	private binaries = new Map<string, { size: number; bytes: Uint8Array }>();
	getAbstractFileByPath(path: string): unknown {
		if (this.files.has(path)) return new TFileMock(path);
		if (this.binaries.has(path)) return new TFileMock(path, this.binaries.get(path)!.size);
		return null;
	}
	async read(file: { path: string }): Promise<string> {
		return this.files.get(file.path) ?? "";
	}
	async readBinary(file: { path: string }): Promise<ArrayBuffer> {
		const bin = this.binaries.get(file.path);
		return bin ? (bin.bytes.buffer as ArrayBuffer) : new ArrayBuffer(0);
	}
	seed(path: string, content: string): void { this.files.set(path, content); }
	seedBinary(path: string, size: number, bytes: Uint8Array = new Uint8Array(size)): void {
		this.binaries.set(path, { size, bytes });
	}
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
	it("returns the default system prompt when there is no custom prompt, summary, or notes", () => {
		const result = buildSystemPrompt(baseConv());
		expect(result).toContain("<system_prompt>");
		expect(result).toContain("research assistant");
	});

	it("wraps the system prompt in a system_prompt tag", () => {
		const result = buildSystemPrompt(baseConv({ systemPrompt: "Be helpful." }));
		expect(result).toBe("<system_prompt>\nBe helpful.\n</system_prompt>");
	});

	it("wraps the summary in a previous_conversation_summary tag", () => {
		const result = buildSystemPrompt(baseConv({ summaryText: "We discussed X." }));
		expect(result).toContain("<previous_conversation_summary>\nWe discussed X.\n</previous_conversation_summary>");
	});

	it("falls back to forkedFromSummary when the conversation has no own summary", () => {
		const result = buildSystemPrompt(baseConv({ forkedFromSummary: "Source said Y." }));
		expect(result).toContain("<previous_conversation_summary>\nSource said Y.\n</previous_conversation_summary>");
	});

	it("prefers the conversation's own summaryText over forkedFromSummary", () => {
		const result = buildSystemPrompt(baseConv({ summaryText: "Own summary.", forkedFromSummary: "Source said Y." }));
		expect(result).toContain("Own summary.");
		expect(result).not.toContain("Source said Y.");
	});

	it("adds a grounding instruction only when notes are attached", () => {
		const withoutNotes = buildSystemPrompt(baseConv({ systemPrompt: "Hi" }));
		const withNotes = buildSystemPrompt(baseConv({ systemPrompt: "Hi", contextNotes: ["Note.md"] }));
		expect(withoutNotes).not.toMatch(/Synthesize/);
		expect(withNotes).toMatch(/Synthesize/);
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
		const filler = "lorem ipsum ".repeat(600);
		const longNote = `# Budget\n${filler}\n# Weather\n${filler}\n# Roadmap\nQ3 roadmap details. ${filler}`;
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

// ── buildAttachedPdfs ──────────────────────────────────────────────────────────

describe("buildAttachedPdfs", () => {
	it("returns empty result for no attached paths", async () => {
		const vault = new MockVault();
		const app = { vault } as unknown as import("obsidian").App;
		const result = await buildAttachedPdfs(app, []);
		expect(result).toEqual({ pdfs: [], missingPdfs: [], oversizedPdfs: [] });
	});

	it("base64-encodes a PDF's bytes and includes its filename", async () => {
		const vault = new MockVault();
		const bytes = new Uint8Array([1, 2, 3, 4]);
		vault.seedBinary("Papers/paper.pdf", bytes.length, bytes);
		const app = { vault } as unknown as import("obsidian").App;

		const { pdfs, missingPdfs, oversizedPdfs } = await buildAttachedPdfs(app, ["Papers/paper.pdf"]);
		expect(missingPdfs).toHaveLength(0);
		expect(oversizedPdfs).toHaveLength(0);
		expect(pdfs).toHaveLength(1);
		expect(pdfs[0].filename).toBe("paper.pdf");
		expect(pdfs[0].mediaType).toBe("application/pdf");
		expect(pdfs[0].base64).toBe(Buffer.from(bytes).toString("base64"));
	});

	it("reports missing PDFs without throwing", async () => {
		const vault = new MockVault();
		const app = { vault } as unknown as import("obsidian").App;
		const { missingPdfs, pdfs } = await buildAttachedPdfs(app, ["Ghost.pdf"]);
		expect(missingPdfs).toEqual(["Ghost.pdf"]);
		expect(pdfs).toHaveLength(0);
	});

	it("flags oversized PDFs and does not read them", async () => {
		const vault = new MockVault();
		vault.seedBinary("Papers/huge.pdf", 21 * 1024 * 1024);
		const app = { vault } as unknown as import("obsidian").App;
		const { oversizedPdfs, pdfs } = await buildAttachedPdfs(app, ["Papers/huge.pdf"]);
		expect(oversizedPdfs).toEqual(["Papers/huge.pdf"]);
		expect(pdfs).toHaveLength(0);
	});
});
