import { describe, it, expect, vi } from "vitest";

// The shared `obsidian` stub debounces to "run immediately", which would hide
// both things the wiring is for: that a burst coalesces into ONE `applyChanges`,
// and that a flush arriving after the batch was drained stays silent. This one is
// driven by hand instead.
const scheduled: { fn: (() => void) | null } = { fn: null };
vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	debounce: (fn: () => void) => Object.assign(() => { scheduled.fn = fn; }, {
		run: () => { scheduled.fn?.(); },
		cancel: () => { scheduled.fn = null; },
	}),
}));

import { TFile } from "obsidian";
import { VaultChangeBatch, registerVaultWatcher, VAULT_FLUSH_DELAY_MS } from "../services/vaultWatcher";

const md = (path: string): { path: string; extension: string } => ({ path, extension: "md" });

describe("VaultChangeBatch — a path is on exactly one side (ADR-121)", () => {
	it("starts empty and reports so, because an empty flush must not reach the index", () => {
		expect(new VaultChangeBatch().empty).toBe(true);
	});

	it("coalesces repeated edits of one note into a single entry", () => {
		const b = new VaultChangeBatch();
		b.markChanged(md("a.md"));
		b.markChanged(md("a.md"));
		b.markChanged(md("a.md"));
		expect(b.take()).toEqual({ changed: [md("a.md")], deleted: [] });
	});

	it("keeps the LAST file object for a path, not the first", () => {
		const b = new VaultChangeBatch<{ path: string; extension: string; v: number }>();
		b.markChanged({ ...md("a.md"), v: 1 });
		b.markChanged({ ...md("a.md"), v: 2 });
		expect(b.take().changed[0].v).toBe(2);
	});

	it("ignores anything that is not markdown — only notes are indexed", () => {
		const b = new VaultChangeBatch();
		expect(b.markChanged({ path: "img.png", extension: "png" })).toBe(false);
		expect(b.markChanged({ path: "doc.pdf", extension: "pdf" })).toBe(false);
		expect(b.empty).toBe(true);
	});

	it("a delete after an edit deletes: the note is gone, re-embedding it would throw", () => {
		const b = new VaultChangeBatch();
		b.markChanged(md("a.md"));
		b.markDeleted("a.md");
		expect(b.take()).toEqual({ changed: [], deleted: ["a.md"] });
	});

	it("an edit after a delete keeps the note: it came back within the window", () => {
		const b = new VaultChangeBatch();
		b.markDeleted("a.md");
		b.markChanged(md("a.md"));
		// Still deleting it here would drop a note that exists — invisible until a
		// retrieval silently stops finding it.
		expect(b.take()).toEqual({ changed: [md("a.md")], deleted: [] });
	});

	it("take() drains, so one edit can never be applied twice", () => {
		const b = new VaultChangeBatch();
		b.markChanged(md("a.md"));
		b.markDeleted("b.md");
		expect(b.take()).toEqual({ changed: [md("a.md")], deleted: ["b.md"] });
		expect(b.empty).toBe(true);
		expect(b.take()).toEqual({ changed: [], deleted: [] });
	});

	it("carries unrelated paths through together", () => {
		const b = new VaultChangeBatch();
		b.markChanged(md("a.md"));
		b.markChanged(md("b.md"));
		b.markDeleted("c.md");
		const out = b.take();
		expect(out.changed.map((f) => f.path)).toEqual(["a.md", "b.md"]);
		expect(out.deleted).toEqual(["c.md"]);
	});
});

// ── the wiring ────────────────────────────────────────────────────────────────

type Handler = (f: unknown, oldPath?: string) => void;

function watcher() {
	scheduled.fn = null;
	const handlers: Record<string, Handler> = {};
	const applied: { changed: string[]; deleted: string[] }[] = [];
	const invalidated: string[] = [];
	const cleanups: (() => void)[] = [];
	const host = {
		app: { vault: { on: (name: string, cb: Handler) => { handlers[name] = cb; return { name }; } } },
		registerEvent: () => {},
		register: (c: () => void) => cleanups.push(c),
	};
	registerVaultWatcher(host as never, {
		applyChanges: (changed, deleted) => applied.push({ changed: changed.map((f) => f.path), deleted }),
		invalidateGlossary: (path) => invalidated.push(path),
	});
	const file = (path: string, extension = "md"): TFile =>
		Object.assign(new TFile(), { path, extension }) as TFile;
	/** Let the debounce fire, as it would after the quiet window. */
	const flush = (): void => { scheduled.fn?.(); };
	return { handlers, applied, invalidated, cleanups, file, flush };
}

describe("registerVaultWatcher — which vault events reach the index", () => {
	it("registers the four events it needs and nothing else", () => {
		expect(Object.keys(watcher().handlers).sort()).toEqual(["create", "delete", "modify", "rename"]);
	});

	it("an edit and a creation both re-embed that one note", () => {
		const w = watcher();
		w.handlers.modify(w.file("a.md"));
		w.flush();
		w.handlers.create(w.file("b.md"));
		w.flush();
		expect(w.applied).toEqual([
			{ changed: ["a.md"], deleted: [] },
			{ changed: ["b.md"], deleted: [] },
		]);
	});

	it("a burst of edits costs ONE applyChanges, not one per file", () => {
		const w = watcher();
		for (const p of ["a.md", "b.md", "c.md"]) w.handlers.modify(w.file(p));
		w.handlers.delete(w.file("d.md"));
		expect(w.applied).toEqual([]); // nothing until the window closes
		w.flush();
		expect(w.applied).toEqual([{ changed: ["a.md", "b.md", "c.md"], deleted: ["d.md"] }]);
	});

	it("a flush after the batch was drained says nothing at all", () => {
		const w = watcher();
		w.handlers.modify(w.file("a.md"));
		w.flush();
		w.flush();
		// An empty `applyChanges` is not harmless: it is a no-op the index has to be
		// woken up to perform, and a second one per quiet window adds up.
		expect(w.applied).toHaveLength(1);
	});

	it("a rename is a delete of the old path plus a change of the new one", () => {
		const w = watcher();
		w.handlers.rename(w.file("new.md"), "old.md");
		w.flush();
		expect(w.applied).toEqual([{ changed: ["new.md"], deleted: ["old.md"] }]);
	});

	it("a non-markdown edit reaches neither the index nor the glossary", () => {
		const w = watcher();
		w.handlers.modify(w.file("img.png", "png"));
		w.flush();
		expect(w.applied).toEqual([]);
		expect(w.invalidated).toEqual([]);
	});

	it("a folder event is not a file event", () => {
		const w = watcher();
		w.handlers.modify({ path: "Folder", children: [] });
		w.handlers.delete({ path: "Folder", children: [] });
		w.flush();
		expect(w.applied).toEqual([]);
	});

	it("every path that changed or vanished is offered to the glossary cache (ADR-136)", () => {
		const w = watcher();
		w.handlers.modify(w.file("Glossary/Terms/Zähler.md"));
		w.handlers.delete(w.file("Glossary/Terms/Gone.md"));
		w.handlers.rename(w.file("Glossary/Terms/New.md"), "Glossary/Terms/Old.md");
		// A deleted term note must stop marking its term now, not at the next edit —
		// and a rename must drop the cache under the OLD name.
		expect(w.invalidated).toEqual([
			"Glossary/Terms/Zähler.md",
			"Glossary/Terms/Gone.md",
			"Glossary/Terms/Old.md",
			"Glossary/Terms/New.md",
		]);
	});

	it("teardown cancels a pending flush, which would run against a torn-down provider", () => {
		const w = watcher();
		w.handlers.modify(w.file("a.md"));
		expect(w.cleanups).toHaveLength(1);
		w.cleanups[0]();
		w.flush();
		expect(w.applied).toEqual([]);
	});

	it("coalesces a burst rather than paying per keystroke", () => {
		expect(VAULT_FLUSH_DELAY_MS).toBe(2000);
	});
});
