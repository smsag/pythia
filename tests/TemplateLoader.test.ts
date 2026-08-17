import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	TFile: class {},
	parseYaml: (text: string) => {
		// Minimal YAML parser sufficient for flat frontmatter + arrays
		const result: Record<string, unknown> = {};
		let currentArray: string[] | null = null;
		let currentKey = "";
		for (const line of text.split("\n")) {
			const arrayMatch = line.match(/^\s+-\s+(.+)$/);
			if (arrayMatch && currentArray) {
				currentArray.push(arrayMatch[1].trim());
				continue;
			}
			currentArray = null;
			const kvMatch = line.match(/^(\w+):\s*(.*)$/);
			if (kvMatch) {
				currentKey = kvMatch[1];
				const val = kvMatch[2].trim();
				if (val === "") {
					currentArray = [];
					result[currentKey] = currentArray;
				} else if (val === "true") result[currentKey] = true;
				else if (val === "false") result[currentKey] = false;
				else if (/^-?\d+(\.\d+)?$/.test(val)) result[currentKey] = Number(val);
				else result[currentKey] = val;
			}
		}
		return result;
	},
}));

import { TemplateLoader } from "../services/TemplateLoader";
import type { PythiaSettings } from "../models/settings";

const VALID_FRONTMATTER = [
	"---",
	"type: Pythia Prompt Template",
	"name: Test Template",
	"provider: anthropic",
	"model: claude-sonnet-5",
	"max_tokens: 4096",
	"temperature: 0.7",
	"effort: medium",
	"resume_mode: summary",
	"output_folder: output",
	"write_mode: create",
	"context_notes:",
	"  - notes/ref.md",
	"---",
	"You are a helpful assistant.",
].join("\n");

const makeApp = (files: Array<{ path: string; content: string }> = []) => ({
	vault: {
		getMarkdownFiles: () => files.map((f) => ({ path: f.path, basename: f.path.split("/").pop()?.replace(".md", "") })),
		read: vi.fn(async (file: { path: string }) => {
			const found = files.find((f) => f.path === file.path);
			return found?.content ?? "";
		}),
	},
});

const makeSettings = (folder = "templates"): PythiaSettings =>
	({ templatesFolder: folder }) as PythiaSettings;

describe("TemplateLoader", () => {
	describe("loadTemplates", () => {
		it("returns an empty array when templatesFolder is empty", async () => {
			const app = makeApp();
			const loader = new TemplateLoader(app as never, makeSettings(""));
			expect(await loader.loadTemplates()).toEqual([]);
		});

		it("returns an empty array when templatesFolder is only whitespace", async () => {
			const app = makeApp();
			const loader = new TemplateLoader(app as never, makeSettings("   "));
			expect(await loader.loadTemplates()).toEqual([]);
		});

		it("only includes files inside the folder (not prefix-matched siblings)", async () => {
			const app = makeApp([
				{ path: "templates/a.md", content: VALID_FRONTMATTER },
				{ path: "templates-archive/b.md", content: VALID_FRONTMATTER },
			]);
			const loader = new TemplateLoader(app as never, makeSettings("templates"));
			const results = await loader.loadTemplates();
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe("templates/a.md");
		});
	});

	describe("loadTemplate — validation", () => {
		let app: ReturnType<typeof makeApp>;
		let loader: TemplateLoader;

		beforeEach(() => {
			app = makeApp([]);
			loader = new TemplateLoader(app as never, makeSettings());
		});

		it("parses a valid template with all fields", async () => {
			const file = { path: "templates/full.md", basename: "full" };
			app.vault.read.mockResolvedValueOnce(VALID_FRONTMATTER);
			const tpl = await loader.loadTemplate(file as never);
			expect(tpl).not.toBeNull();
			expect(tpl!.name).toBe("Test Template");
			expect(tpl!.provider).toBe("anthropic");
			expect(tpl!.model).toBe("claude-sonnet-5");
			expect(tpl!.maxTokens).toBe(4096);
			expect(tpl!.temperature).toBe(0.7);
			expect(tpl!.effort).toBe("medium");
			expect(tpl!.resumeMode).toBe("summary");
			expect(tpl!.outputFolder).toBe("output");
			expect(tpl!.writeMode).toBe("create");
			expect(tpl!.contextNotes).toEqual(["notes/ref.md"]);
			expect(tpl!.systemPrompt).toBe("You are a helpful assistant.");
		});

		it("returns null for a file without frontmatter", async () => {
			app.vault.read.mockResolvedValueOnce("Just text, no frontmatter.");
			const tpl = await loader.loadTemplate({ path: "templates/no-fm.md", basename: "no-fm" } as never);
			expect(tpl).toBeNull();
		});

		it("returns null when type is not 'Pythia Prompt Template'", async () => {
			const content = "---\ntype: Other\nname: X\n---\nBody";
			app.vault.read.mockResolvedValueOnce(content);
			const tpl = await loader.loadTemplate({ path: "templates/wrong-type.md", basename: "wrong-type" } as never);
			expect(tpl).toBeNull();
		});

		it("rejects an invalid provider", async () => {
			const content = "---\ntype: Pythia Prompt Template\nprovider: invalid\n---\nBody";
			app.vault.read.mockResolvedValueOnce(content);
			const tpl = await loader.loadTemplate({ path: "templates/bad-prov.md", basename: "bad-prov" } as never);
			expect(tpl).not.toBeNull();
			expect(tpl!.provider).toBeUndefined();
		});

		it("rejects an invalid resume_mode", async () => {
			const content = "---\ntype: Pythia Prompt Template\nresume_mode: invalid\n---\nBody";
			app.vault.read.mockResolvedValueOnce(content);
			const tpl = await loader.loadTemplate({ path: "templates/bad-rm.md", basename: "bad-rm" } as never);
			expect(tpl!.resumeMode).toBeUndefined();
		});

		it("rejects an output_folder with traversal segments", async () => {
			const content = "---\ntype: Pythia Prompt Template\noutput_folder: ../secret\n---\nBody";
			app.vault.read.mockResolvedValueOnce(content);
			const tpl = await loader.loadTemplate({ path: "templates/traverse.md", basename: "traverse" } as never);
			expect(tpl!.outputFolder).toBeUndefined();
		});

		it("rejects context_notes entries with traversal segments", async () => {
			const content = "---\ntype: Pythia Prompt Template\ncontext_notes:\n  - ../secret.md\n  - valid/note.md\n---\nBody";
			app.vault.read.mockResolvedValueOnce(content);
			const tpl = await loader.loadTemplate({ path: "templates/ctx.md", basename: "ctx" } as never);
			expect(tpl!.contextNotes).toEqual(["valid/note.md"]);
		});

		it("rejects temperature outside [0, 1]", async () => {
			const content = "---\ntype: Pythia Prompt Template\ntemperature: 1.5\n---\nBody";
			app.vault.read.mockResolvedValueOnce(content);
			const tpl = await loader.loadTemplate({ path: "templates/hot.md", basename: "hot" } as never);
			expect(tpl!.temperature).toBeUndefined();
		});

		it("rejects an invalid effort level", async () => {
			const content = "---\ntype: Pythia Prompt Template\neffort: extreme\n---\nBody";
			app.vault.read.mockResolvedValueOnce(content);
			const tpl = await loader.loadTemplate({ path: "templates/eff.md", basename: "eff" } as never);
			expect(tpl!.effort).toBeUndefined();
		});

		it("rejects an invalid write_mode", async () => {
			const content = "---\ntype: Pythia Prompt Template\nwrite_mode: invalid\n---\nBody";
			app.vault.read.mockResolvedValueOnce(content);
			const tpl = await loader.loadTemplate({ path: "templates/wm.md", basename: "wm" } as never);
			expect(tpl!.writeMode).toBeUndefined();
		});
	});
});
