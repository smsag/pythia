import { describe, it, expect, vi } from "vitest";
import { RenameFollower, RENAME_LOG_LIMIT, mergeRenameLogs, normalizeRenameLog, type RenameFollowerHost, type RenameLogEntry } from "../services/renameFollower";
import { DEFAULT_SETTINGS, type PythiaSettings } from "../models/settings";
import type { Conversation } from "../models/types";

const conv = (id: string, notes: string[]): Conversation =>
	({ id, name: id, contextNotes: notes, messages: [] } as unknown as Conversation);

function harness(opts: { convs?: Conversation[]; settings?: Partial<PythiaSettings>; files?: string[]; log?: RenameLogEntry[] } = {}) {
	const convs = opts.convs ?? [];
	const settings = { ...DEFAULT_SETTINGS, ...opts.settings } as PythiaSettings;
	const files = new Set(opts.files ?? []);
	const log = opts.log ?? [];
	const deferred: (() => void)[] = [];
	const host = {
		conversations: () => convs,
		conversationsChanged: vi.fn(),
		settings: () => settings,
		settingsChanged: vi.fn(),
		exists: (p: string) => files.has(p),
		renameLog: () => log,
		defer: (fn: () => void) => { deferred.push(fn); },
		now: () => "2026-09-25T15:00:00.000Z",
		debug: () => {},
	} satisfies RenameFollowerHost;
	const follower = new RenameFollower(host);
	const tick = (): void => { while (deferred.length) deferred.shift()!(); };
	return { follower, host, convs, settings, log, files, tick, deferred };
}

describe("RenameFollower — a burst is one scan (ADR-218 addendum)", () => {
	it("applies a folder's burst of events once, on the next tick", () => {
		const h = harness({ convs: [conv("c", ["A/x.md", "A/y.md"])] });
		h.follower.queue("A", "B");
		for (const n of ["x", "y"]) h.follower.queue(`A/${n}.md`, `B/${n}.md`);
		expect(h.deferred).toHaveLength(1);           // one flush scheduled, not three
		expect(h.host.conversationsChanged).not.toHaveBeenCalled();
		h.tick();
		expect(h.convs[0].contextNotes).toEqual(["B/x.md", "B/y.md"]);
		expect(h.host.conversationsChanged).toHaveBeenCalledTimes(1);
		expect(h.log).toEqual([{ from: "A", to: "B", at: "2026-09-25T15:00:00.000Z" }]);
	});

	it("follows settings too, and says so once", () => {
		const h = harness({ settings: { templatesFolder: "Pythia/Templates", glossaryNote: "Pythia/Glossary.md" } });
		h.follower.queue("Pythia", "Tools");
		h.tick();
		expect(h.settings.templatesFolder).toBe("Tools/Templates");
		expect(h.host.settingsChanged).toHaveBeenCalledTimes(1);
	});

	it("logs nothing when nothing held the path", () => {
		const h = harness({ convs: [conv("c", ["Keep.md"])] });
		h.follower.queue("Other.md", "Moved.md");
		h.tick();
		expect(h.log).toEqual([]);
		expect(h.host.conversationsChanged).not.toHaveBeenCalled();
	});

	it("keeps only the newest entries", () => {
		const log = Array.from({ length: RENAME_LOG_LIMIT }, (_, i) => ({ from: `o${i}`, to: `n${i}`, at: "2026-01-01" }));
		const h = harness({ convs: [conv("c", ["x.md"])], log });
		h.follower.queue("x.md", "y.md");
		h.tick();
		expect(h.log).toHaveLength(RENAME_LOG_LIMIT);
		expect(h.log[h.log.length - 1]).toMatchObject({ from: "x.md", to: "y.md" });
	});
});

describe("RenameFollower.replay — a stale copy after a sync", () => {
	const entry = (from: string, to: string, at = "2026-09-25T10:00:00Z"): RenameLogEntry => ({ from, to, at });

	it("puts a copy with the old path right when the note now lives at the new one", () => {
		const h = harness({ convs: [conv("c", ["Out/Old.md"])], files: ["Out/New.md"], log: [entry("Out/Old.md", "Out/New.md")] });
		h.follower.replay();
		expect(h.convs[0].contextNotes).toEqual(["Out/New.md"]);
		expect(h.host.conversationsChanged).toHaveBeenCalledWith(["c"]);
	});

	it("leaves a new note the user made at the old path alone", () => {
		const h = harness({ convs: [conv("c", ["Out/Old.md"])], files: ["Out/Old.md", "Out/New.md"], log: [entry("Out/Old.md", "Out/New.md")] });
		h.follower.replay();
		expect(h.convs[0].contextNotes).toEqual(["Out/Old.md"]);
	});

	it("never moves a path to a place that does not exist", () => {
		const h = harness({ convs: [conv("c", ["Out/Old.md"])], files: [], log: [entry("Out/Old.md", "Out/New.md")] });
		h.follower.replay();
		expect(h.convs[0].contextNotes).toEqual(["Out/Old.md"]);
	});

	it("follows a chain to where the note is now, in time order", () => {
		const h = harness({
			convs: [conv("c", ["a.md"])],
			files: ["c.md"],
			log: [entry("b.md", "c.md", "2026-09-25T11:00:00Z"), entry("a.md", "b.md", "2026-09-25T10:00:00Z")],
		});
		h.follower.replay();
		expect(h.convs[0].contextNotes).toEqual(["c.md"]);
	});

	it("is a no-op the second time", () => {
		const h = harness({ convs: [conv("c", ["Out/Old.md"])], files: ["Out/New.md"], log: [entry("Out/Old.md", "Out/New.md")] });
		h.follower.replay();
		h.follower.replay();
		expect(h.host.conversationsChanged).toHaveBeenCalledTimes(1);
	});
});

describe("rename log in data.json", () => {
	it("keeps well-formed entries only", () => {
		expect(normalizeRenameLog([
			{ from: "a", to: "b", at: "t" },
			{ from: "a", to: "a", at: "t" },
			{ from: "", to: "b", at: "t" },
			{ from: "a", to: "b" },
			null,
		])).toEqual([{ from: "a", to: "b", at: "t" }]);
		expect(normalizeRenameLog("nope")).toEqual([]);
	});

	it("merges two devices' logs without losing either, in time order", () => {
		const a = [{ from: "x", to: "y", at: "2026-09-25T10:00:00Z" }];
		const b = [{ from: "p", to: "q", at: "2026-09-25T09:00:00Z" }, { from: "x", to: "y", at: "2026-09-25T10:00:00Z" }];
		expect(mergeRenameLogs(a, b)).toEqual([b[0], a[0]]);
	});
});
