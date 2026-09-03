import { describe, it, expect, beforeEach, vi } from "vitest";

// TFileMock must be hoisted so the vi.mock factory below can reference it,
// and so the MockVault can create instances that pass instanceof TFile checks.
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

import { NoteWriter } from "../services/NoteWriter";
import type { PythiaSettings } from "../settings";

// ── Minimal mock vault ────────────────────────────────────────────────────────

class MockVault {
	private files = new Map<string, string>();
	private folders = new Set<string>();
	private _name = "TestVault";
	configDir = ".obsidian";

	getName(): string { return this._name; }
	setName(n: string): void { this._name = n; }

	getAbstractFileByPath(path: string): unknown {
		if (this.files.has(path)) return new TFileMock(path);
		if (this.folders.has(path)) return { type: "folder" };
		return null;
	}
	async modify(file: { path: string }, content: string): Promise<void> {
		this.files.set(file.path, content);
	}
	async create(path: string, content: string): Promise<{ path: string }> {
		this.files.set(path, content);
		return new TFileMock(path);
	}
	async createFolder(path: string): Promise<void> {
		this.folders.add(path);
	}
	async read(file: { path: string }): Promise<string> {
		return this.files.get(file.path) ?? "";
	}

	// Helpers for test assertions
	content(path: string): string { return this.files.get(path) ?? ""; }
	hasFile(path: string): boolean { return this.files.has(path); }
	hasFolder(path: string): boolean { return this.folders.has(path); }
	seed(path: string, content: string): void { this.files.set(path, content); }
}

const SETTINGS = { conversationsFolder: "Conversations", scratchFolder: "Scratch" } as unknown as PythiaSettings;

let vault: MockVault;
let writer: NoteWriter;

beforeEach(() => {
	vault = new MockVault();
	writer = new NoteWriter({ vault } as never, SETTINGS);
});

// ── writeNote ─────────────────────────────────────────────────────────────────

describe("writeNote", () => {
	it("creates a new file when the path does not exist", async () => {
		const file = await writer.writeNote("# Hello", "Notes/hello.md");
		expect(file.path).toBe("Notes/hello.md");
		expect(vault.content("Notes/hello.md")).toBe("# Hello");
	});

	it("overwrites an existing file in place", async () => {
		vault.seed("Notes/hello.md", "old content");
		await writer.writeNote("new content", "Notes/hello.md");
		expect(vault.content("Notes/hello.md")).toBe("new content");
	});

	it("creates parent folders when they do not exist", async () => {
		await writer.writeNote("body", "A/B/C/note.md");
		expect(vault.hasFolder("A")).toBe(true);
		expect(vault.hasFolder("A/B")).toBe(true);
		expect(vault.hasFolder("A/B/C")).toBe(true);
	});

	it("handles a root-level file with no parent folder", async () => {
		const file = await writer.writeNote("flat", "flat.md");
		expect(file.path).toBe("flat.md");
		expect(vault.content("flat.md")).toBe("flat");
	});

	it("throws on path traversal with .. segments", async () => {
		await expect(writer.writeNote("x", "../../evil.md")).rejects.toThrow(
			/path traversal/
		);
	});

	it("throws when the target is inside the Obsidian config directory", async () => {
		await expect(writer.writeNote("x", ".obsidian/plugins/pythia/data.md")).rejects.toThrow(
			/config directory/
		);
		expect(vault.hasFile(".obsidian/plugins/pythia/data.md")).toBe(false);
	});

	it("throws when the target is the config directory itself", async () => {
		await expect(writer.writeNote("x", ".obsidian")).rejects.toThrow(/config directory/);
	});

	it("does not treat a note whose name merely starts with the config-dir string as inside it", async () => {
		const file = await writer.writeNote("ok", ".obsidian-notes.md");
		expect(file.path).toBe(".obsidian-notes.md");
	});

	it("normalises backslashes to forward slashes", async () => {
		const file = await writer.writeNote("body", "Folder\\note.md");
		expect(file.path).toBe("Folder/note.md");
	});
});

// ── prependWithSeparator ──────────────────────────────────────────────────────

describe("prependWithSeparator — neither has frontmatter", () => {
	it("prepends content above existing text with a horizontal rule", async () => {
		vault.seed("Notes/doc.md", "existing body");
		await writer.prependWithSeparator("new header", "Notes/doc.md");
		expect(vault.content("Notes/doc.md")).toBe("new header\n\n---\n\nexisting body");
	});

	it("just writes content when the file does not yet exist", async () => {
		await writer.prependWithSeparator("first line", "Notes/new.md");
		expect(vault.content("Notes/new.md")).toBe("first line");
	});
});

describe("prependWithSeparator — new content has frontmatter, doc does not", () => {
	it("places the frontmatter at the top and inserts body above existing text", async () => {
		vault.seed("Notes/doc.md", "existing");
		const incoming = "---\ntags: [x]\n---\nNew body";
		await writer.prependWithSeparator(incoming, "Notes/doc.md");
		const result = vault.content("Notes/doc.md");
		expect(result).toMatch(/^---\ntags: \[x\]\n---\n/);
		expect(result).toContain("New body");
		expect(result).toContain("existing");
		expect(result.indexOf("New body")).toBeLessThan(result.indexOf("existing"));
	});
});

describe("prependWithSeparator — doc has frontmatter, new content does not", () => {
	it("preserves existing frontmatter and inserts content after it", async () => {
		vault.seed("Notes/doc.md", "---\naliases: []\n---\ndoc body");
		await writer.prependWithSeparator("new section", "Notes/doc.md");
		const result = vault.content("Notes/doc.md");
		expect(result).toMatch(/^---\naliases: \[\]\n---\n/);
		expect(result).toContain("new section");
		expect(result).toContain("doc body");
		expect(result.indexOf("new section")).toBeLessThan(result.indexOf("doc body"));
	});
});

describe("prependWithSeparator — both have frontmatter", () => {
	it("merges new-only fields into existing frontmatter", async () => {
		vault.seed("Notes/doc.md", "---\ntitle: Old\n---\nold body");
		const incoming = "---\ntitle: New\nauthor: Alice\n---\nnew body";
		await writer.prependWithSeparator(incoming, "Notes/doc.md");
		const result = vault.content("Notes/doc.md");
		// existing 'title' is kept, new 'author' is added
		expect(result).toContain("title: Old");
		expect(result).toContain("author: Alice");
	});

	it("does not duplicate keys already present in the existing frontmatter", async () => {
		vault.seed("Notes/doc.md", "---\ntitle: Old\n---\nbody");
		await writer.prependWithSeparator("---\ntitle: New\n---\nextra", "Notes/doc.md");
		const result = vault.content("Notes/doc.md");
		const titleCount = (result.match(/^title:/gm) ?? []).length;
		expect(titleCount).toBe(1);
	});

	it("places new body above old body separated by ---", async () => {
		vault.seed("Notes/doc.md", "---\ntitle: A\n---\nold body");
		await writer.prependWithSeparator("---\nstatus: draft\n---\nnew body", "Notes/doc.md");
		const result = vault.content("Notes/doc.md");
		expect(result).toContain("new body");
		expect(result).toContain("old body");
		expect(result.indexOf("new body")).toBeLessThan(result.indexOf("old body"));
	});

	it("carries a multi-line list field's items along with the key when merging", async () => {
		vault.seed("Notes/doc.md", "---\ntitle: Old\n---\nold body");
		const incoming = "---\ntitle: New\ntags:\n  - alpha\n  - beta\n---\nnew body";
		await writer.prependWithSeparator(incoming, "Notes/doc.md");
		const result = vault.content("Notes/doc.md");
		expect(result).toContain("tags:");
		expect(result).toContain("  - alpha");
		expect(result).toContain("  - beta");
	});

	it("carries a multi-line block-scalar field's continuation lines along with the key", async () => {
		vault.seed("Notes/doc.md", "---\ntitle: Old\n---\nold body");
		const incoming = "---\ntitle: New\nsummary: |\n  line one\n  line two\n---\nnew body";
		await writer.prependWithSeparator(incoming, "Notes/doc.md");
		const result = vault.content("Notes/doc.md");
		expect(result).toContain("summary: |");
		expect(result).toContain("  line one");
		expect(result).toContain("  line two");
	});

	it("does not add a multi-line field's continuation lines when the key already exists", async () => {
		vault.seed("Notes/doc.md", "---\ntitle: Old\ntags:\n  - existing\n---\nold body");
		const incoming = "---\ntitle: New\ntags:\n  - alpha\n  - beta\n---\nnew body";
		await writer.prependWithSeparator(incoming, "Notes/doc.md");
		const result = vault.content("Notes/doc.md");
		// existing tags block is kept as-is; incoming tags block is dropped entirely
		expect(result).toContain("  - existing");
		expect(result).not.toContain("  - alpha");
		expect(result).not.toContain("  - beta");
		const tagsCount = (result.match(/^tags:/gm) ?? []).length;
		expect(tagsCount).toBe(1);
	});
});

// ── updateSettings ────────────────────────────────────────────────────────────

describe("updateSettings", () => {
	it("replaces the stored settings reference", async () => {
		const newSettings = { conversationsFolder: "NewFolder", scratchFolder: "NewScratch" } as unknown as PythiaSettings;
		writer.updateSettings(newSettings);
		// Verify by creating a summary note — it uses settings.conversationsFolder for the path
		const path = await writer.saveSummaryNote(
			{ name: "T", contextNotes: [], messages: [], id: "1", createdAt: "", updatedAt: "",
			  systemPrompt: "", resumeMode: "full", provider: "anthropic", model: "m" },
			"summary text"
		);
		expect(path).toContain("NewFolder");
	});
});

// ── saveSummaryNote ───────────────────────────────────────────────────────────

describe("saveSummaryNote", () => {
	it("creates a note with an LLM Note type, a resume link, and no pythia tag", async () => {
		const conv = {
			id: "c1", name: "My Chat", createdAt: "", updatedAt: "",
			systemPrompt: "", contextNotes: [], resumeMode: "full" as const,
			provider: "anthropic" as const, model: "m", messages: [],
		};
		const path = await writer.saveSummaryNote(conv, "Great conversation.");
		const content = vault.content(path);
		expect(path).toContain("Conversations");
		expect(content).toContain('type: "LLM Note"');
		expect(content).not.toContain("pythia-conversation");
		expect(content).not.toContain("tags:");
		// Frontmatter link back to the conversation (deep link opens Pythia active).
		expect(content).toContain("source:");
		expect(content).toContain("obsidian://pythia?vault=");
		expect(content).toContain("cmd=resume&id=c1");
		expect(content).toContain("Great conversation.");
	});

	it("sanitises illegal characters in the conversation name", async () => {
		const conv = {
			id: "c2", name: 'Bad:Name/With*Chars', createdAt: "", updatedAt: "",
			systemPrompt: "", contextNotes: [], resumeMode: "full" as const,
			provider: "anthropic" as const, model: "m", messages: [],
		};
		const path = await writer.saveSummaryNote(conv, "body");
		// Extract just the filename part (after the last /) and verify no illegal chars remain
		const filename = path.split("/").pop() ?? path;
		expect(filename).not.toMatch(/[:*?"<>|\\]/);
	});

	it("includes context note paths in the frontmatter", async () => {
		const conv = {
			id: "c3", name: "Chat", createdAt: "", updatedAt: "",
			systemPrompt: "", contextNotes: ["Notes/a.md", "Notes/b.md"],
			resumeMode: "full" as const, provider: "anthropic" as const, model: "m", messages: [],
		};
		const path = await writer.saveSummaryNote(conv, "summary");
		const content = vault.content(path);
		expect(content).toContain("Notes/a.md");
		expect(content).toContain("Notes/b.md");
	});

	it("appends an Output section when outputPath is provided", async () => {
		const conv = {
			id: "c4", name: "Chat", createdAt: "", updatedAt: "",
			systemPrompt: "", contextNotes: [], resumeMode: "full" as const,
			provider: "anthropic" as const, model: "m", messages: [],
		};
		const path = await writer.saveSummaryNote(conv, "summary", "Output/result.md");
		expect(vault.content(path)).toContain("[[Output/result.md]]");
	});
});

// ── saveFavoritesSummaryNote ──────────────────────────────────────────────────

describe("saveFavoritesSummaryNote", () => {
	it("writes an LLM Note with a resume link and no pythia tag", async () => {
		const conv = {
			id: "fav-1", name: "My Chat", createdAt: "", updatedAt: "",
			systemPrompt: "", contextNotes: [], resumeMode: "full" as const,
			provider: "anthropic" as const, model: "m", messages: [],
		};
		const path = await writer.saveFavoritesSummaryNote(conv, "Key learnings…");
		const content = vault.content(path);
		expect(path).toContain("-favorites.md");
		expect(content).toContain('type: "LLM Note"');
		expect(content).not.toContain("pythia-favorites");
		expect(content).not.toContain("tags:");
		expect(content).toContain("source:");
		expect(content).toContain("obsidian://pythia?vault=");
		expect(content).toContain("cmd=resume&id=fav-1");
		expect(content).toContain("Key learnings…");
	});
});

// ── appendConversationSlice ───────────────────────────────────────────────────

describe("appendConversationSlice", () => {
	it("writes a heading and formatted messages to a new file", async () => {
		const messages = [
			{ id: "m1", role: "user" as const, content: "Hello", timestamp: "" },
			{ id: "m2", role: "assistant" as const, content: "Hi there", timestamp: "" },
		];
		await writer.appendConversationSlice(messages, "Log/chat.md");
		const content = vault.content("Log/chat.md");
		expect(content).toContain("**You:** Hello");
		expect(content).toContain("**Pythia:** Hi there");
		expect(content).toMatch(/^## \d\d\.\d\d\.\d{4}/m);
	});

	it("appends to existing file content", async () => {
		vault.seed("Log/chat.md", "## previous\n\n**You:** earlier");
		const messages = [{ id: "m1", role: "user" as const, content: "new msg", timestamp: "" }];
		await writer.appendConversationSlice(messages, "Log/chat.md");
		const content = vault.content("Log/chat.md");
		expect(content).toContain("earlier");
		expect(content).toContain("new msg");
		expect(content.indexOf("earlier")).toBeLessThan(content.indexOf("new msg"));
	});

	it("adds resume-URI frontmatter to a new file when conversationId is provided", async () => {
		const messages = [{ id: "m1", role: "user" as const, content: "hi", timestamp: "" }];
		await writer.appendConversationSlice(messages, "Log/new.md", "conv-123");
		const content = vault.content("Log/new.md");
		expect(content).toContain("source:");
		expect(content).toContain("obsidian://pythia?vault=");
		expect(content).toContain("cmd=resume&id=conv-123");
	});

	it("does not add frontmatter when file already has content", async () => {
		vault.seed("Log/existing.md", "existing");
		const messages = [{ id: "m1", role: "user" as const, content: "hi", timestamp: "" }];
		await writer.appendConversationSlice(messages, "Log/existing.md", "conv-123");
		const content = vault.content("Log/existing.md");
		expect(content).not.toContain("source:");
	});
});

// ── prependToInbox ────────────────────────────────────────────────────────────

describe("prependToInbox", () => {
	it("creates the inbox note with a timestamped entry when it does not exist", async () => {
		await writer.prependToInbox("clip this", "Inbox.md");
		const result = vault.content("Inbox.md");
		expect(result).toContain("clip this");
		expect(result).toContain("---");
	});

	it("prepends new entry above existing inbox content", async () => {
		vault.seed("Inbox.md", "old entry\n\n---\n");
		await writer.prependToInbox("new entry", "Inbox.md");
		const result = vault.content("Inbox.md");
		expect(result.indexOf("new entry")).toBeLessThan(result.indexOf("old entry"));
	});
});
