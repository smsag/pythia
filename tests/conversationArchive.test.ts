import { describe, it, expect } from "vitest";
import { archiveNoteContent, archiveNotePath } from "../services/conversationArchive";
import type { Conversation, Message } from "../models/types";

const msg = (role: "user" | "assistant", content: string, timestamp?: string): Message => ({
	id: `m-${role}-${content.slice(0, 4)}`,
	role,
	content,
	timestamp: timestamp ?? "2026-09-15T04:39:00.000Z",
});

const conv = (over: Partial<Conversation> = {}): Conversation => ({
	id: "c1",
	name: "Mietvertrag: Nebenkosten",
	createdAt: "2026-01-05T10:00:00.000Z",
	updatedAt: "2026-09-15T04:39:00.000Z",
	systemPrompt: "",
	contextNotes: [],
	resumeMode: "full",
	provider: "anthropic",
	model: "claude-sonnet-5",
	messages: [msg("user", "Was steht zu Nebenkosten drin?"), msg("assistant", "Abschnitt 4 regelt sie.")],
	favorites: [],
	...over,
});

describe("archiveNotePath", () => {
	it("names the note by the conversation's last-updated day and a safe title", () => {
		const path = archiveNotePath("Pythia/Archive", conv(), () => false);
		expect(path).toBe("Pythia/Archive/2026-09-15-Mietvertrag- Nebenkosten.md");
	});

	it("never returns a path that is taken — the archive must not overwrite", () => {
		// Two conversations can share a name and a day; overwriting one with the
		// other would lose exactly what the archive exists to keep.
		const taken = new Set(["Pythia/Archive/2026-09-15-Mietvertrag- Nebenkosten.md"]);
		const path = archiveNotePath("Pythia/Archive", conv(), (p) => taken.has(p));
		expect(path).toBe("Pythia/Archive/2026-09-15-Mietvertrag- Nebenkosten 2.md");
		taken.add(path);
		expect(archiveNotePath("Pythia/Archive", conv(), (p) => taken.has(p)))
			.toBe("Pythia/Archive/2026-09-15-Mietvertrag- Nebenkosten 3.md");
	});

	it("tolerates a folder written with a trailing slash, and the vault root", () => {
		expect(archiveNotePath("Pythia/Archive/", conv(), () => false)).toBe("Pythia/Archive/2026-09-15-Mietvertrag- Nebenkosten.md");
		expect(archiveNotePath("", conv(), () => false)).toBe("2026-09-15-Mietvertrag- Nebenkosten.md");
	});

	it("falls back to the conversation's creation day when updatedAt is missing", () => {
		const path = archiveNotePath("A", conv({ updatedAt: undefined as unknown as string }), () => false);
		expect(path).toBe("A/2026-01-05-Mietvertrag- Nebenkosten.md");
	});
});

describe("archiveNoteContent", () => {
	it("carries the whole transcript, in order, with both roles labelled", () => {
		const note = archiveNoteContent(conv(), "obsidian://pythia?id=c1");
		expect(note).toContain("Was steht zu Nebenkosten drin?");
		expect(note).toContain("Abschnitt 4 regelt sie.");
		expect(note.indexOf("## You")).toBeLessThan(note.indexOf("## Pythia"));
	});

	it("writes frontmatter Obsidian can query, with every scalar quoted", () => {
		const note = archiveNoteContent(conv(), "obsidian://pythia?id=c1");
		expect(note.startsWith("---\n")).toBe(true);
		// The name holds a colon — unquoted it would break the frontmatter block.
		expect(note).toContain('conversation: "Mietvertrag: Nebenkosten"');
		expect(note).toContain('type: "Pythia Archive"');
		expect(note).toContain("messages: 2");
		expect(note).toContain('source: "obsidian://pythia?id=c1"');
		expect(note).toContain("created: 2026-01-05");
		expect(note).toContain("updated: 2026-09-15");
	});

	it("keeps the summary and the attached notes", () => {
		const note = archiveNoteContent(
			conv({ summaryText: "Nebenkosten sind in Abschnitt 4 geregelt.", contextNotes: ["Recht/Mietrecht.md"] }),
			"obsidian://pythia?id=c1",
		);
		expect(note).toContain("Nebenkosten sind in Abschnitt 4 geregelt.");
		expect(note).toContain('  - "Recht/Mietrecht.md"');
	});

	it("strips citation markers — they point at a conversation that is being removed", () => {
		const note = archiveNoteContent(
			conv({ messages: [msg("assistant", "Abschnitt 4.⟦cite:note:Recht/Mietrecht.md⟧")] }),
			"obsidian://pythia?id=c1",
		);
		expect(note).toContain("Abschnitt 4.");
		expect(note).not.toContain("⟦cite:");
	});

	it("survives an empty conversation", () => {
		const note = archiveNoteContent(conv({ messages: [] }), "obsidian://pythia?id=c1");
		expect(note).toContain("messages: 0");
		expect(note).toContain("# Mietvertrag: Nebenkosten");
	});
});
