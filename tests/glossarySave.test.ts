import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { GlossaryService } from "../services/GlossaryService";
import { replaceBody } from "../services/glossaryNotes";
import type { GlossaryEntry } from "../services/glossary";
import type PythiaPlugin from "../main";

// A property someone else put on a term note must survive Pythia's next write.
// `save` once wrote the rendered body over the whole file, so the frontmatter
// block was gone before `processFrontMatter` re-added Pythia's own keys: `tags`,
// a hand-set property, another plugin's key — all deleted on a re-lookup.

describe("replaceBody", () => {
	it("keeps the frontmatter block verbatim and swaps the body", () => {
		const note = "---\ntype: term\nschreibstubeAvoid:\n  - Immobilie\n---\nAlt.\n";
		expect(replaceBody(note, "Neu.\n")).toBe("---\ntype: term\nschreibstubeAvoid:\n  - Immobilie\n---\nNeu.\n");
	});

	it("keeps CRLF line endings inside the block", () => {
		expect(replaceBody("---\r\ntags: a\r\n---\r\nAlt.", "Neu.\n")).toBe("---\r\ntags: a\r\n---\r\nNeu.\n");
	});

	it("adds the line break a block at the very end of a file lacks", () => {
		expect(replaceBody("---\ntags: a\n---", "Neu.\n")).toBe("---\ntags: a\n---\nNeu.\n");
	});

	it("is the body alone when there is no block", () => {
		expect(replaceBody("Alt.\n", "Neu.\n")).toBe("Neu.\n");
	});
});

// ── The service's own write path, over an in-memory vault ────────────────────

/** Flat `key: value` frontmatter, enough to stand in for Obsidian's merge. */
function readBlock(text: string): Record<string, string> {
	const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
	const fm: Record<string, string> = {};
	for (const line of m?.[1].split("\n") ?? []) {
		const i = line.indexOf(":");
		if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	}
	return fm;
}

function writeBlock(fm: Record<string, unknown>, body: string): string {
	const lines = Object.entries(fm).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : String(v)}`);
	return `---\n${lines.join("\n")}\n---\n${body}`;
}

function harness(initial: Record<string, string>) {
	const files = new Map(Object.entries(initial));
	const fileFor = (path: string) =>
		Object.assign(new TFile(), { path, basename: path.split("/").pop()!.replace(/\.md$/, "") });
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (files.has(p) ? fileFor(p) : null),
			read: async (f: { path: string }) => files.get(f.path)!,
			create: async (p: string, text: string) => { files.set(p, text); },
			modify: async (f: { path: string }, text: string) => { files.set(f.path, text); },
			process: async (f: { path: string }, fn: (text: string) => string) => {
				files.set(f.path, fn(files.get(f.path)!));
			},
		},
		metadataCache: {
			getFileCache: (f: { path: string }) => ({ frontmatter: readBlock(files.get(f.path) ?? "") }),
		},
		fileManager: {
			// Obsidian's processFrontMatter: the existing block, merged, body untouched.
			processFrontMatter: async (f: { path: string }, fn: (fm: Record<string, unknown>) => void) => {
				const text = files.get(f.path)!;
				const fm: Record<string, unknown> = readBlock(text);
				fn(fm);
				files.set(f.path, writeBlock(fm, text.replace(/^---\n[\s\S]*?\n---\n?/, "")));
			},
		},
	};
	const plugin = {
		app,
		settings: { glossaryFolder: "Glossar" },
		noteWriter: { ensureFolder: async () => {} },
	} as unknown as PythiaPlugin;
	return { files, service: new GlossaryService(plugin) };
}

const lookup = (over: Partial<GlossaryEntry> = {}): GlossaryEntry => ({
	term: "Kartellrecht",
	definition: "Recht gegen Wettbewerbsbeschränkungen.",
	source: "model",
	...over,
});

describe("GlossaryService.save keeps what is not Pythia's", () => {
	const path = "Glossar/Terms/Kartellrecht.md";

	it("a re-lookup keeps a property another plugin set", async () => {
		const { files, service } = harness({
			[path]: "---\ntype: term\nsource: model\nschreibstubeAvoid: cartel law\ntags: recht\n---\nAlte Definition.\n",
		});
		await service.save(lookup({ definition: "Neue Definition." }));
		const text = files.get(path)!;
		expect(readBlock(text).schreibstubeAvoid).toBe("cartel law");
		expect(readBlock(text).tags).toBe("recht");
		expect(text).toContain("Neue Definition.");
	});

	it("keeps a cached translation of an unchanged manual definition", async () => {
		const { files, service } = harness({
			[path]: "---\ntype: term\nsource: manual\ndefinition_en: Law against cartels.\ntranslated_from: abc\n---\nHandgeschrieben.\n",
		});
		await service.save(lookup({ definition: "Vom Modell." }));
		const fm = readBlock(files.get(path)!);
		expect(fm.definition_en).toBe("Law against cartels.");
		expect(files.get(path)).toContain("Handgeschrieben.");
	});

	it("still writes Pythia's own keys and the body on a new note", async () => {
		const { files, service } = harness({});
		await service.save(lookup());
		const text = files.get(path)!;
		expect(readBlock(text).type).toBe("term");
		expect(text).toContain("Recht gegen Wettbewerbsbeschränkungen.");
	});
});
