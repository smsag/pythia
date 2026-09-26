import { describe, it, expect, vi } from "vitest";

// The shared `obsidian` stub debounces to "run immediately", which would hide
// both things the wiring is for: that a burst coalesces into ONE `applyChanges`,
// and that a flush arriving after the batch was drained stays silent. These are
// driven by hand instead — one record per debouncer, so the flush window and the
// held note's quiet clock (ADR-219) can be told apart by their timeouts.
interface FakeDebouncer {
	timeout?: number;
	resetTimer?: boolean;
	calls: number;
	pending: (() => void) | null;
}
const debouncers: FakeDebouncer[] = [];
vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	debounce: (fn: () => void, timeout?: number, resetTimer?: boolean) => {
		const d: FakeDebouncer = { timeout, resetTimer, calls: 0, pending: null };
		debouncers.push(d);
		return Object.assign(() => { d.calls++; d.pending = fn; }, {
			run: () => { d.pending?.(); },
			cancel: () => { d.pending = null; },
		});
	},
}));

import { TFile, TFolder } from "obsidian";
import { VaultChangeBatch, registerVaultWatcher, VAULT_FLUSH_DELAY_MS, VAULT_HOLD_IDLE_MS } from "../services/vaultWatcher";

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

function watcher(opts: { active?: { path: string | null } } = {}) {
	debouncers.length = 0;
	const handlers: Record<string, Handler> = {};
	const workspaceHandlers: Record<string, Handler> = {};
	const applied: { changed: string[]; deleted: string[] }[] = [];
	const invalidated: string[] = [];
	const renamed: [string, string][] = [];
	const cleanups: (() => void)[] = [];
	const host = {
		app: {
			vault: { on: (name: string, cb: Handler) => { handlers[name] = cb; return { name }; } },
			workspace: { on: (name: string, cb: Handler) => { workspaceHandlers[name] = cb; return { name }; } },
		},
		registerEvent: () => {},
		register: (c: () => void) => cleanups.push(c),
	};
	const active = opts.active;
	registerVaultWatcher(host as never, {
		applyChanges: (changed, deleted) => applied.push({ changed: changed.map((f) => f.path), deleted }),
		invalidateGlossary: (path) => invalidated.push(path),
		followRename: (oldPath, newPath) => renamed.push([oldPath, newPath]),
		...(active ? { activePath: () => active.path } : {}),
	});
	const file = (path: string, extension = "md"): TFile =>
		Object.assign(new TFile(), { path, extension }) as TFile;
	const flushTimer = debouncers.find((d) => d.timeout === VAULT_FLUSH_DELAY_MS)!;
	const holdTimer = debouncers.find((d) => d.timeout === VAULT_HOLD_IDLE_MS)!;
	/** Let the debounce fire, as it would after the quiet window. */
	const flush = (): void => { flushTimer.pending?.(); };
	/** Let the held note's quiet clock run out. */
	const idle = (): void => { holdTimer.pending?.(); };
	return { handlers, workspaceHandlers, applied, invalidated, renamed, cleanups, file, flush, idle, flushTimer, holdTimer };
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

	it("a rename reaches the conversations at once, not with the debounced flush (ADR-218)", () => {
		const w = watcher();
		w.handlers.rename(w.file("Notes/New.md"), "Out/Old.md");
		expect(w.renamed).toEqual([["Out/Old.md", "Notes/New.md"]]);
		expect(w.applied).toEqual([]); // the index still waits for its flush
	});

	it("a folder rename is followed too", () => {
		const w = watcher();
		w.handlers.rename(Object.assign(new TFolder(), { path: "Projects/2026" }), "Projects/Q3");
		expect(w.renamed).toEqual([["Projects/Q3", "Projects/2026"]]);
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

describe("VaultChangeBatch.take(hold) — the note being written stays behind (ADR-219)", () => {
	it("keeps the held note's edit for a later drain and hands over the rest", () => {
		const b = new VaultChangeBatch();
		b.markChanged(md("a.md"));
		b.markChanged(md("b.md"));
		expect(b.take("a.md")).toEqual({ changed: [md("b.md")], deleted: [] });
		expect(b.empty).toBe(false);
		expect(b.take()).toEqual({ changed: [md("a.md")], deleted: [] });
	});

	it("never holds a delete: a note that is gone must leave the index now", () => {
		const b = new VaultChangeBatch();
		b.markDeleted("a.md");
		expect(b.take("a.md")).toEqual({ changed: [], deleted: ["a.md"] });
		expect(b.empty).toBe(true);
	});

	it("holding a note that has no edit takes everything", () => {
		const b = new VaultChangeBatch();
		b.markChanged(md("b.md"));
		expect(b.take("a.md")).toEqual({ changed: [md("b.md")], deleted: [] });
		expect(b.empty).toBe(true);
	});
});

describe("registerVaultWatcher — the note being written (ADR-219)", () => {
	it("both windows are real quiet windows: every event restarts them", () => {
		// Without `resetTimer`, Obsidian's debounce fires this long after the FIRST
		// call — a note typed in for a minute was flushed thirty times.
		const w = watcher({ active: { path: "a.md" } });
		expect(w.flushTimer.resetTimer).toBe(true);
		expect(w.holdTimer.resetTimer).toBe(true);
	});

	it("a pause in typing flushes every other note but not the one being written", () => {
		const w = watcher({ active: { path: "a.md" } });
		w.handlers.modify(w.file("a.md"));
		w.handlers.modify(w.file("b.md"));
		w.flush();
		expect(w.applied).toEqual([{ changed: ["b.md"], deleted: [] }]);
	});

	it("nothing reaches the index while only the note being written changes", () => {
		const w = watcher({ active: { path: "a.md" } });
		for (let i = 0; i < 5; i++) {
			w.handlers.modify(w.file("a.md"));
			w.flush();
		}
		expect(w.applied).toEqual([]);
	});

	it("every save of the note being written restarts its quiet clock, so it cannot run out mid-sentence", () => {
		const w = watcher({ active: { path: "a.md" } });
		w.handlers.modify(w.file("a.md"));
		w.handlers.modify(w.file("a.md"));
		w.handlers.modify(w.file("b.md")); // another note does not touch the clock
		expect(w.holdTimer.calls).toBe(2);
	});

	it("once the writer has been quiet long enough, the held note reaches the index", () => {
		const w = watcher({ active: { path: "a.md" } });
		w.handlers.modify(w.file("a.md"));
		w.flush();
		w.idle();
		expect(w.applied).toEqual([{ changed: ["a.md"], deleted: [] }]);
	});

	it("leaving the note sends it at once, and the note now open is the one held", () => {
		const active = { path: "a.md" as string | null };
		const w = watcher({ active });
		w.handlers.modify(w.file("a.md"));
		w.handlers.modify(w.file("c.md"));
		w.flush(); // c.md goes, a.md is held
		w.handlers.modify(w.file("c.md")); // c.md changes again, e.g. by a sync
		active.path = "c.md";
		w.workspaceHandlers["file-open"](w.file("c.md"));
		expect(w.applied).toEqual([
			{ changed: ["c.md"], deleted: [] },
			{ changed: ["a.md"], deleted: [] },
		]);
		// c.md is now the note on screen: held on the same quiet clock.
		expect(w.holdTimer.pending).not.toBeNull();
		w.idle();
		expect(w.applied.at(-1)).toEqual({ changed: ["c.md"], deleted: [] });
	});

	it("opening a note with nothing pending does nothing", () => {
		const w = watcher({ active: { path: "a.md" } });
		w.workspaceHandlers["file-open"](w.file("a.md"));
		expect(w.applied).toEqual([]);
	});

	it("deleting the note being written leaves the index at the next flush", () => {
		const w = watcher({ active: { path: "a.md" } });
		w.handlers.modify(w.file("a.md"));
		w.handlers.delete(w.file("a.md"));
		w.flush();
		expect(w.applied).toEqual([{ changed: [], deleted: ["a.md"] }]);
	});

	it("teardown cancels the quiet clock too", () => {
		const w = watcher({ active: { path: "a.md" } });
		w.handlers.modify(w.file("a.md"));
		w.cleanups[0]();
		w.idle();
		expect(w.applied).toEqual([]);
	});

	it("waits thirty seconds of quiet before a note left open is embedded", () => {
		expect(VAULT_HOLD_IDLE_MS).toBe(30_000);
	});
});
