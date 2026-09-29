import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import { NoteAnchorService, REFRESH_LIMIT, type NoteAnchorHost } from "../services/NoteAnchorService";
import { anchorMarkup } from "../services/noteAnchors";
import { chapterFingerprint, chapterOf } from "../services/chapterSummary";
import { resumeDeepLink } from "../utils";
import { DEFAULT_SETTINGS } from "../models/settings";
import type { Conversation, Message } from "../models/types";

const msg = (id: string, role: Message["role"], content: string): Message => ({ id, role, content, timestamp: "2026-09-29T10:00:00.000Z" });
const url = (id: string, m?: string) => resumeDeepLink(id, "V", m);

function makeConv(id = "c1"): Conversation {
	return {
		id, name: "Rent cap", provider: "anthropic", model: "m",
		messages: [msg("u1", "user", "Index clause?"), msg("a1", "assistant", "It lags a year."), msg("u2", "user", "And new leases?"), msg("a2", "assistant", "Capped.")],
	} as unknown as Conversation;
}

function setup(opts: { reply?: (q: string) => Promise<string>; files?: Record<string, string>; footnotes?: boolean } = {}) {
	const convs = new Map<string, Conversation>([["c1", makeConv()]]);
	const saved: string[] = [];
	const notices: string[] = [];
	const files = new Map(Object.entries(opts.files ?? {}));
	const generateChapterSummary = vi.fn(async (q: string) => (opts.reply ? opts.reply(q) : `Summary of ${q}`));
	const generateSummary = vi.fn(async () => "The whole conversation.");
	const fileFor = (path: string) => Object.assign(new TFile(), { path, extension: "md" });
	const host: NoteAnchorHost = {
		app: {
			workspace: { getLeavesOfType: () => [] },
			vault: {
				getAbstractFileByPath: (p: string) => (files.has(p) ? fileFor(p) : null),
				cachedRead: async (f: { path: string }) => files.get(f.path) ?? "",
				process: async (f: { path: string }, fn: (s: string) => string) => { files.set(f.path, fn(files.get(f.path) ?? "")); },
			},
		} as unknown as NoteAnchorHost["app"],
		conversations: () => [...convs.values()],
		getById: (id) => convs.get(id),
		save: async (c) => { saved.push(c.id); },
		llm: () => ({ generateChapterSummary, generateSummary }) as unknown as ReturnType<NoteAnchorHost["llm"]>,
		settings: () => ({ ...DEFAULT_SETTINGS, anchorFootnotes: opts.footnotes ?? false }),
		notice: (m) => notices.push(m),
		log: () => {},
	};
	return { service: new NoteAnchorService(host), convs, saved, notices, files, generateChapterSummary, generateSummary, fileFor };
}

describe("refreshing a chapter's summary (ADR-249)", () => {
	it("writes it with the chapter's fingerprint and its detected language", async () => {
		const { service, convs } = setup({ reply: async () => "Die Kappung gilt nur für neue Verträge und nicht für die alten." });
		const res = await service.refresh([{ id: "c1", msg: "u1" }], { onProgress: () => {} });
		expect(res).toEqual({ refreshed: 1, failed: [] });
		const c = convs.get("c1")!;
		expect(c.messages[0].chapterSummary).toMatchObject({ fingerprint: chapterFingerprint(chapterOf(c, "u1")!), language: "de" });
		expect(service.status({ id: "c1", msg: "u1" })).toBe("ok");
	});

	it("an empty reply is a failure that says so, never an empty summary", async () => {
		const { service, convs } = setup({ reply: async () => "  " });
		const res = await service.refresh([{ id: "c1", msg: "u1" }], { onProgress: () => {} });
		expect(res.failed).toEqual([{ id: "c1", msg: "u1", reason: "empty" }]);
		expect(convs.get("c1")!.messages[0].chapterSummary).toBeUndefined();
	});

	it("a chapter that changed while it was summarized is not given the old summary", async () => {
		const holder: { convs?: Map<string, Conversation> } = {};
		const env = setup({ reply: async () => { holder.convs!.get("c1")!.messages[1].content = "Retried."; return "Old answer summary."; } });
		holder.convs = env.convs;
		const convs = env.convs;
		const res = await env.service.refresh([{ id: "c1", msg: "u1" }], { onProgress: () => {} });
		expect(res.failed[0].reason).toBe("changed");
		expect(convs.get("c1")!.messages[0].chapterSummary).toBeUndefined();
	});

	it("names deleted and unanswered chapters instead of asking the model", async () => {
		const { service, generateChapterSummary, convs } = setup();
		convs.get("c1")!.messages.push(msg("u3", "user", "Open question"));
		const res = await service.refresh([{ id: "gone", msg: "x" }, { id: "c1", msg: "nope" }, { id: "c1", msg: "u3" }], { onProgress: () => {} });
		expect(res.failed.map((f) => f.reason)).toEqual(["deleted", "deleted", "unanswered"]);
		expect(generateChapterSummary).not.toHaveBeenCalled();
	});

	it("refuses more than the limit, by name, and does the rest", async () => {
		const { service } = setup();
		const refs = Array.from({ length: REFRESH_LIMIT + 2 }, () => ({ id: "c1", msg: "u1" }));
		const res = await service.refresh(refs, { onProgress: () => {} });
		expect(res.failed.filter((f) => f.reason === "limit")).toHaveLength(2);
		expect(res.refreshed).toBe(REFRESH_LIMIT);
	});

	it("stops starting new work once aborted", async () => {
		const { service, generateChapterSummary } = setup();
		const ctrl = new AbortController();
		ctrl.abort();
		const res = await service.refresh([{ id: "c1", msg: "u1" }, { id: "c1", msg: "u2" }], { signal: ctrl.signal, onProgress: () => {} });
		expect(res.refreshed).toBe(0);
		expect(generateChapterSummary).not.toHaveBeenCalled();
	});

	it("reports progress, and without a progress callback says what it is doing", async () => {
		const progress: [number, number][] = [];
		const a = setup();
		await a.service.refresh([{ id: "c1", msg: "u1" }, { id: "c1", msg: "u2" }], { onProgress: (d, n) => progress.push([d, n]) });
		expect(progress).toEqual([[1, 2], [2, 2]]);
		expect(a.notices).toEqual([]);
		const b = setup();
		await b.service.refresh([{ id: "c1", msg: "u1" }]);
		expect(b.notices).toHaveLength(1);
	});

	it("a whole-conversation link refreshes the conversation summary", async () => {
		const { service, convs, generateSummary } = setup();
		await service.refresh([{ id: "c1" }], { onProgress: () => {} });
		expect(generateSummary).toHaveBeenCalledOnce();
		expect(convs.get("c1")!.summaryText).toBe("The whole conversation.");
	});
});

describe("the API a print plugin reads", () => {
	it("is version 1, frozen, and never writes a note", async () => {
		const note = `The ${anchorMarkup("index", url("c1", "u1"))} lags.`;
		const { service, files } = setup({ files: { "N.md": note } });
		const api = service.api();
		expect(api.version).toBe(1);
		expect(Object.isFrozen(api)).toBe(true);
		expect(api.inspectForExport(note)).toEqual({ links: 1, outdated: 0, missing: 1 });
		const res = await api.refreshSummaries(note, { onProgress: () => {} });
		expect(res.refreshed).toBe(1);
		expect(api.inspectForExport(note)).toEqual({ links: 1, outdated: 0, missing: 0 });
		const printed = api.withExportFootnotes(note);
		expect(printed).toMatch(/^The ==index==\[\^1\] lags\.\n\n\[\^1\]: “Rent cap › Index clause\?” \(Pythia, \d+ \w+ \d{4}\) — Summary of Index clause\?\n$/);
		expect(files.get("N.md")).toBe(note);
	});

	it("records the links of the note a caller names", async () => {
		const note = `x ${anchorMarkup("y", url("c1", "u2"))}`;
		const { service, convs } = setup();
		service.inspect(note, "Print.md");
		await vi.waitFor(() => expect(convs.get("c1")!.noteAnchors).toEqual([{ path: "Print.md", messageId: "u2", createdAt: expect.any(String) }]));
	});
});

describe("after an answer in an anchored chapter", () => {
	it("writes the chapter's summary, and with the setting on the note's footnote", async () => {
		const note = `x ${anchorMarkup("y", url("c1", "u1"))}\n`;
		const { service, convs, files } = setup({ files: { "N.md": note }, footnotes: true });
		convs.get("c1")!.noteAnchors = [{ path: "N.md", messageId: "u1", createdAt: "t" }];
		await service.afterAnswer("c1", "u1");
		expect(convs.get("c1")!.messages[0].chapterSummary?.text).toBe("Summary of Index clause?");
		expect(files.get("N.md")).toMatch(/==\[\^pythia-[0-9a-f]{8}\]\n\n\[\^pythia-[0-9a-f]{8}\]: “Rent cap › Index clause\?” \(Pythia, .+\) — Summary of Index clause\?\n$/);
	});

	it("with the setting off, the note is left alone", async () => {
		const note = `x ${anchorMarkup("y", url("c1", "u1"))}\n`;
		const { service, convs, files } = setup({ files: { "N.md": note } });
		convs.get("c1")!.noteAnchors = [{ path: "N.md", messageId: "u1", createdAt: "t" }];
		await service.afterAnswer("c1", "u1");
		expect(convs.get("c1")!.messages[0].chapterSummary).toBeDefined();
		expect(files.get("N.md")).toBe(note);
	});

	it("does nothing, and asks nothing, for a chapter no note links to", async () => {
		const { service, generateChapterSummary, generateSummary } = setup();
		await service.afterAnswer("c1", "u1");
		expect(generateChapterSummary).not.toHaveBeenCalled();
		expect(generateSummary).not.toHaveBeenCalled();
	});
});
