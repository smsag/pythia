import { describe, it, expect } from "vitest";
import { TFile, TFolder } from "obsidian";
import { registerVaultWatcher } from "../services/vaultWatcher";

// What Pythia keeps in step with the vault once its index went to Schreibstube
// (ADR-224): the glossary cache (ADR-136) and the stored paths that follow a
// rename (ADR-218). Both at once — nothing is batched any more.

type Handler = (f: unknown, oldPath?: string) => void;

function watcher() {
	const handlers: Record<string, Handler> = {};
	const invalidated: string[] = [];
	const renamed: [string, string][] = [];
	let registered = 0;
	const host = {
		app: { vault: { on: (name: string, cb: Handler) => { handlers[name] = cb; return { name }; } } },
		registerEvent: () => { registered++; },
	};
	registerVaultWatcher(host as never, {
		invalidateGlossary: (path) => invalidated.push(path),
		followRename: (oldPath, newPath) => renamed.push([oldPath, newPath]),
	});
	const file = (path: string, extension = "md"): TFile =>
		Object.assign(new TFile(), { path, extension }) as TFile;
	return { handlers, invalidated, renamed, file, registered: () => registered };
}

describe("registerVaultWatcher (ADR-136, ADR-218, ADR-224)", () => {
	it("registers each of its four listeners for teardown", () => {
		expect(watcher().registered()).toBe(4);
	});

	it("a rename reaches the conversations at once (ADR-218)", () => {
		const w = watcher();
		w.handlers.rename(w.file("Notes/New.md"), "Out/Old.md");
		expect(w.renamed).toEqual([["Out/Old.md", "Notes/New.md"]]);
	});

	it("a folder rename is followed too", () => {
		const w = watcher();
		w.handlers.rename(Object.assign(new TFolder(), { path: "Projects/2026" }), "Projects/Q3");
		expect(w.renamed).toEqual([["Projects/Q3", "Projects/2026"]]);
	});

	it("every note that changed or vanished is offered to the glossary cache", () => {
		const w = watcher();
		w.handlers.modify(w.file("Glossary/Terms/Zähler.md"));
		w.handlers.create(w.file("Glossary/Terms/Neu.md"));
		w.handlers.delete(w.file("Glossary/Terms/Gone.md"));
		w.handlers.rename(w.file("Glossary/Terms/New.md"), "Glossary/Terms/Old.md");
		// A deleted term note must stop marking its term now, not at the next edit —
		// and a rename must drop the cache under the OLD name.
		expect(w.invalidated).toEqual([
			"Glossary/Terms/Zähler.md",
			"Glossary/Terms/Neu.md",
			"Glossary/Terms/Gone.md",
			"Glossary/Terms/Old.md",
			"Glossary/Terms/New.md",
		]);
	});

	it("a non-markdown edit does not reach the glossary", () => {
		const w = watcher();
		w.handlers.modify(w.file("img.png", "png"));
		expect(w.invalidated).toEqual([]);
	});

	it("a folder event is not a file event", () => {
		const w = watcher();
		w.handlers.modify({ path: "Folder", children: [] });
		w.handlers.delete({ path: "Folder", children: [] });
		expect(w.invalidated).toEqual([]);
	});
});
