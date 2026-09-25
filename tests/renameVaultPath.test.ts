import { describe, it, expect } from "vitest";
import { renameVaultPath } from "../services/renameVaultPath";
import type { Conversation } from "../models/types";

/** A conversation that holds the path in every field that can hold one. */
const everywhere = (p: string, id = "c1"): Conversation => ({
	id,
	name: "C",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	systemPrompt: "",
	provider: "anthropic",
	model: "m",
	resumeMode: "full",
	favorites: [],
	contextNotes: [p, "Keep.md"],
	templateId: p,
	summaryNote: p,
	savedNotePath: p,
	pendingRewrite: { path: p, from: { line: 0, ch: 0 }, to: { line: 0, ch: 1 }, text: "x" },
	pendingTemplate: { id: p, name: "T", systemPrompt: "", contextNotes: [p] },
	messages: [
		{ id: "u", role: "user", content: `see [[${p}]]`, timestamp: "t", attachedNotes: [p] },
		{
			id: "a", role: "assistant", content: "done", timestamp: "t",
			templateId: p,
			rewriteTarget: { path: p, from: { line: 0, ch: 0 }, to: { line: 0, ch: 1 }, text: "x" },
			noteWrites: [{ path: p, action: "created" }],
			sources: [{ n: 1, kind: "vault", ref: p, title: "Old" }, { n: 2, kind: "web", ref: p, title: "w" }],
		},
	],
	comparison: {
		id: "k", userMessageId: "u", createdAt: "t",
		candidates: [{ id: "x", provider: "anthropic", model: "m", content: "", timestamp: "t", templateId: p, sources: [{ n: 1, kind: "vault", ref: p, title: "Old" }] }],
	},
} as unknown as Conversation);

describe("renameVaultPath (ADR-218)", () => {
	it("follows a renamed note in every stored path field", () => {
		const conv = everywhere("Out/Old.md");
		expect(renameVaultPath([conv], "Out/Old.md", "Notes/New.md")).toEqual(["c1"]);
		const n = "Notes/New.md";
		expect(conv.contextNotes).toEqual([n, "Keep.md"]);
		expect([conv.templateId, conv.summaryNote, conv.savedNotePath, conv.pendingRewrite?.path]).toEqual([n, n, n, n]);
		expect(conv.pendingTemplate).toMatchObject({ id: n, contextNotes: [n] });
		const [u, a] = conv.messages;
		expect(u.attachedNotes).toEqual([n]);
		expect([a.templateId, a.rewriteTarget?.path, a.noteWrites?.[0].path]).toEqual([n, n, n]);
		expect(a.sources?.[0]).toEqual({ n: 1, kind: "vault", ref: n, title: "New" });
		expect(conv.comparison?.candidates[0]).toMatchObject({ templateId: n, sources: [{ ref: n, title: "New" }] });
	});

	it("never rewrites what was said, and never touches a web source", () => {
		const conv = everywhere("Out/Old.md");
		renameVaultPath([conv], "Out/Old.md", "Notes/New.md");
		expect(conv.messages[0].content).toBe("see [[Out/Old.md]]");
		expect(conv.messages[1].sources?.[1]).toEqual({ n: 2, kind: "web", ref: "Out/Old.md", title: "w" });
	});

	it("moves everything under a renamed folder, and nothing beside it", () => {
		const conv = everywhere("Projects/Q3/Plan.md");
		conv.contextNotes.push("Projects/Q3 archive/Other.md");
		conv.outputFolder = "Projects/Q3";
		renameVaultPath([conv], "Projects/Q3", "Projects/2026-Q3");
		expect(conv.contextNotes).toEqual(["Projects/2026-Q3/Plan.md", "Keep.md", "Projects/Q3 archive/Other.md"]);
		expect(conv.outputFolder).toBe("Projects/2026-Q3");
	});

	it("keeps a title the model gave, and follows one that was the old name", () => {
		const conv = everywhere("Out/Old.md");
		conv.messages[1].sources![0].title = "Quarterly plan";
		renameVaultPath([conv], "Out/Old.md", "Out/New.md");
		expect(conv.messages[1].sources![0].title).toBe("Quarterly plan");
	});

	it("is idempotent and reports only the conversations it changed", () => {
		const hit = everywhere("a.md", "hit");
		const miss = everywhere("b.md", "miss");
		expect(renameVaultPath([hit, miss], "a.md", "c.md")).toEqual(["hit"]);
		expect(renameVaultPath([hit, miss], "a.md", "c.md")).toEqual([]);
		expect(renameVaultPath([hit], "", "x.md")).toEqual([]);
	});

	it("never creates a field the conversation did not have", () => {
		const conv = everywhere("a.md");
		delete conv.summaryNote;
		delete conv.messages[1].templateId;
		renameVaultPath([conv], "a.md", "b.md");
		expect("summaryNote" in conv).toBe(false);
		expect("templateId" in conv.messages[1]).toBe(false);
	});

	it("mutates in place, so a chip already on screen opens the new path", () => {
		const conv = everywhere("a.md");
		const write = conv.messages[1].noteWrites![0];
		renameVaultPath([conv], "a.md", "b.md");
		expect(write.path).toBe("b.md");
	});
});
