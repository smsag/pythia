import { describe, it, expect, vi } from "vitest";

const { TFileMock } = vi.hoisted(() => {
	class TFileMock {
		path: string;
		constructor(path: string) { this.path = path; }
	}
	return { TFileMock };
});

vi.mock("obsidian", () => ({ TFile: TFileMock, App: class {} }));

import { buildAttachedNotesContent } from "../services/ContextBuilder";
import { FULL_NOTE_MAX_CHARS, wantsFullNote } from "../services/noteChunking";
import type { App } from "obsidian";

// A note that asks to be sent whole (`pythia_full: true`): a reference note read
// for its entirety, where "the sections that match this message" drops the very
// section the task needs.
describe("wantsFullNote", () => {
	it("takes only an explicit true", () => {
		expect(wantsFullNote({ pythia_full: true })).toBe(true);
		for (const value of ["true", 1, ["true"], null, false]) expect(wantsFullNote({ pythia_full: value })).toBe(false);
		for (const fm of [undefined, null, "x", 3]) expect(wantsFullNote(fm)).toBe(false);
	});
});

describe("buildAttachedNotesContent — pythia_full", () => {
	// ~30 000 chars: over the ordinary budget (12 000), under the ceiling (60 000).
	const longBody = Array.from({ length: 30 }, (_, i) => `## Section ${i}\n\n${"word ".repeat(200)}`).join("\n\n");

	const appWith = (frontmatter: unknown, body = longBody) => ({
		vault: {
			getAbstractFileByPath: (p: string) => (p.endsWith(".md") ? new TFileMock(p) : null),
			read: async () => body,
		},
		metadataCache: { getFileCache: () => ({ frontmatter }) },
	}) as unknown as App;

	it("sends the whole note when its frontmatter says `pythia_full: true`", async () => {
		const plain = await buildAttachedNotesContent(appWith({}), ["Notes/a.md"], "query");
		const whole = await buildAttachedNotesContent(appWith({ pythia_full: true }), ["Notes/a.md"], "query");
		expect(plain.content).toContain('excerpt="true"');
		expect(whole.content).not.toContain('excerpt="true"');
		expect(whole.content.length).toBeGreaterThan(plain.content.length);
	});

	it("works without a metadata cache (an app that has none behaves as before)", async () => {
		const app = { vault: appWith({}).vault } as unknown as App;
		const out = await buildAttachedNotesContent(app, ["Notes/a.md"], "query");
		expect(out.content).toContain('excerpt="true"');
	});

	it("never widens the budget of a note a search picked", async () => {
		const out = await buildAttachedNotesContent(appWith({ pythia_full: true }), ["Notes/a.md"], "query", new Set(["Notes/a.md"]));
		expect(out.content).toContain('excerpt="true"');
		expect(out.content.length).toBeLessThan(4000);
	});

	it("still has a ceiling: a note beyond it is an excerpt, marked as one", async () => {
		const huge = `## A\n\n${"word ".repeat(20000)}\n\n## B\n\n${"word ".repeat(20000)}`;
		const out = await buildAttachedNotesContent(appWith({ pythia_full: true }, huge), ["Notes/a.md"], "query");
		expect(out.content).toContain('excerpt="true"');
		expect(out.content.length).toBeLessThan(FULL_NOTE_MAX_CHARS + 500);
	});
});
