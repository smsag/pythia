import { describe, it, expect } from "vitest";
import { compileRenames, essentialRenames, renameSettingsPaths, renameVaultPaths } from "../services/renameVaultPath";
import { DEFAULT_SETTINGS } from "../models/settings";
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

describe("renameVaultPaths (ADR-218)", () => {
	it("follows a renamed note in every stored path field", () => {
		const conv = everywhere("Out/Old.md");
		expect(renameVaultPaths([conv], [{ from: "Out/Old.md", to: "Notes/New.md" }])).toEqual(["c1"]);
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
		renameVaultPaths([conv], [{ from: "Out/Old.md", to: "Notes/New.md" }]);
		expect(conv.messages[0].content).toBe("see [[Out/Old.md]]");
		expect(conv.messages[1].sources?.[1]).toEqual({ n: 2, kind: "web", ref: "Out/Old.md", title: "w" });
	});

	it("moves everything under a renamed folder, and nothing beside it", () => {
		const conv = everywhere("Projects/Q3/Plan.md");
		conv.contextNotes.push("Projects/Q3 archive/Other.md");
		conv.outputFolder = "Projects/Q3";
		renameVaultPaths([conv], [{ from: "Projects/Q3", to: "Projects/2026-Q3" }]);
		expect(conv.contextNotes).toEqual(["Projects/2026-Q3/Plan.md", "Keep.md", "Projects/Q3 archive/Other.md"]);
		expect(conv.outputFolder).toBe("Projects/2026-Q3");
	});

	it("keeps a title the model gave, and follows one that was the old name", () => {
		const conv = everywhere("Out/Old.md");
		conv.messages[1].sources![0].title = "Quarterly plan";
		renameVaultPaths([conv], [{ from: "Out/Old.md", to: "Out/New.md" }]);
		expect(conv.messages[1].sources![0].title).toBe("Quarterly plan");
	});

	it("is idempotent and reports only the conversations it changed", () => {
		const hit = everywhere("a.md", "hit");
		const miss = everywhere("b.md", "miss");
		expect(renameVaultPaths([hit, miss], [{ from: "a.md", to: "c.md" }])).toEqual(["hit"]);
		expect(renameVaultPaths([hit, miss], [{ from: "a.md", to: "c.md" }])).toEqual([]);
		expect(renameVaultPaths([hit], [{ from: "", to: "x.md" }])).toEqual([]);
	});

	it("never creates a field the conversation did not have", () => {
		const conv = everywhere("a.md");
		delete conv.summaryNote;
		delete conv.messages[1].templateId;
		renameVaultPaths([conv], [{ from: "a.md", to: "b.md" }]);
		expect("summaryNote" in conv).toBe(false);
		expect("templateId" in conv.messages[1]).toBe(false);
	});

	it("mutates in place, so a chip already on screen opens the new path", () => {
		const conv = everywhere("a.md");
		const write = conv.messages[1].noteWrites![0];
		renameVaultPaths([conv], [{ from: "a.md", to: "b.md" }]);
		expect(write.path).toBe("b.md");
	});
});

describe("compileRenames — one scan per burst (ADR-218 addendum)", () => {
	it("drops the file pairs a folder pair already implies", () => {
		const pairs = [
			{ from: "a/x.md", to: "b/x.md" },
			{ from: "a", to: "b" },
			{ from: "a/sub/y.md", to: "b/sub/y.md" },
		];
		expect(essentialRenames(pairs)).toEqual([{ from: "a", to: "b" }]);
	});

	it("keeps a file pair that went somewhere else", () => {
		const pairs = [{ from: "a", to: "b" }, { from: "a/x.md", to: "c/x.md" }];
		expect(essentialRenames(pairs)).toHaveLength(2);
	});

	it("resolves a swap through a temporary name in the order the vault reported", () => {
		const move = compileRenames([
			{ from: "A.md", to: "tmp.md" },
			{ from: "B.md", to: "A.md" },
			{ from: "tmp.md", to: "B.md" },
		]);
		expect([move("A.md"), move("B.md"), move("C.md")]).toEqual(["B.md", "A.md", "C.md"]);
	});

	it("resolves a chain", () => {
		const move = compileRenames([{ from: "a.md", to: "b.md" }, { from: "b.md", to: "c.md" }]);
		expect(move("a.md")).toBe("c.md");
	});

	it("moves the deepest-matching folder's contents, and nothing beside it", () => {
		const move = compileRenames([{ from: "P/Q3", to: "P/2026-Q3" }, { from: "Notes/old.md", to: "Notes/new.md" }]);
		expect(move("P/Q3/plan.md")).toBe("P/2026-Q3/plan.md");
		expect(move("P/Q3 archive/x.md")).toBe("P/Q3 archive/x.md");
		expect(move("Notes/old.md")).toBe("Notes/new.md");
		expect(move("Notes/old.md.bak")).toBe("Notes/old.md.bak");
	});

	it("the fast path agrees with applying the pairs in order, on independent batches", () => {
		for (let seed = 1; seed <= 50; seed++) {
			let x = seed;
			const rnd = (n: number): number => { x = (x * 1103515245 + 12345) % 2147483648; return x % n; };
			const pairs = Array.from({ length: 1 + rnd(6) }, (_, i) => ({ from: `src${i}/f${rnd(3)}`, to: `dst${i}/g${rnd(3)}` }));
			const move = compileRenames(pairs);
			for (let k = 0; k < 20; k++) {
				const path = `src${rnd(8)}/f${rnd(3)}/n${rnd(4)}.md`;
				const sequential = essentialRenames(pairs).reduce((p, pair) => p === pair.from ? pair.to : p.startsWith(pair.from + "/") ? pair.to + p.slice(pair.from.length) : p, path);
				expect(move(path)).toBe(sequential);
			}
		}
	});

	it("an accept check can refuse a move (the replay's guard)", () => {
		const conv = everywhere("a.md");
		expect(renameVaultPaths([conv], [{ from: "a.md", to: "b.md" }], () => false)).toEqual([]);
		expect(conv.contextNotes[0]).toBe("a.md");
	});
});

describe("renameSettingsPaths (ADR-218 addendum)", () => {
	const settings = () => ({
		...DEFAULT_SETTINGS,
		templatesFolder: "Pythia/Templates/",
		glossaryFolder: "Glossary",
		archiveFolder: "",
		inboxNote: "Pythia/Inbox.md",
		vaultContextFolders: ["Pythia/Research", "Work"],
	});

	it("follows a moved folder into every path setting, in the vault's spelling", () => {
		const s = settings();
		const keys = renameSettingsPaths(s, [{ from: "Pythia", to: "Tools/Pythia" }]);
		expect(s.templatesFolder).toBe("Tools/Pythia/Templates");
		expect(s.inboxNote).toBe("Tools/Pythia/Inbox.md");
		expect(s.vaultContextFolders).toEqual(["Tools/Pythia/Research", "Work"]);
		expect(s.glossaryFolder).toBe("Glossary");
		expect(keys).toEqual(expect.arrayContaining(["templatesFolder", "inboxNote", "vaultContextFolders", "conversationsFolder", "scratchFolder", "glossaryNote"]));
		expect(keys).not.toContain("glossaryFolder");
	});

	it("never touches an empty value, and reports nothing when nothing moved", () => {
		const s = settings();
		expect(renameSettingsPaths(s, [{ from: "Elsewhere", to: "Other" }])).toEqual([]);
		expect(s.archiveFolder).toBe("");
	});
});
