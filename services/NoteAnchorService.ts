import { MarkdownView, TFile, type App } from "obsidian";
import type { Conversation } from "../models/types";
import type { PythiaSettings } from "../models/settings";
import type { LLMRouter } from "./LLMRouter";
import { getObsidianLocale, t } from "../i18n";
import { detectLanguage } from "./languageDetect";
import { describeErrorForLog } from "./redact";
import { findAnchors, reconcileNoteAnchors, type AnchorRef } from "./noteAnchors";
import {
	anchorStatus, anchorSummary, chapterFingerprint, chapterOf, cleanChapterSummary, needsRefresh,
	type AnchorStatus, type AnchorSummary,
} from "./chapterSummary";
import { applyEdits, inspectAnchors, noteFootnoteEdits, uniqueRefs, withExportFootnotes, type ExportInspection } from "./anchorFootnotes";

/**
 * Note anchors against the vault, the store and the model (ADR-249): the
 * records of which notes link where, the chapter summaries, the footnotes in a
 * note, and the API a print or export plugin calls. The rules are pure and live
 * in `noteAnchors.ts`, `chapterSummary.ts` and `anchorFootnotes.ts`; this class
 * only reads, asks and writes.
 */

/** At most this many summaries per refresh — a guard against a bug in a
 *  caller, not a security boundary: every plugin can read data.json anyway. */
export const REFRESH_LIMIT = 20;
/** Summaries written at once. */
const REFRESH_CONCURRENCY = 3;

export type RefreshFailure = "limit" | "empty" | "changed" | "unanswered" | "deleted" | "error";

export interface RefreshResult {
	refreshed: number;
	failed: { id: string; msg?: string; reason: RefreshFailure }[];
}

export interface RefreshOptions {
	signal?: AbortSignal;
	onProgress?: (done: number, total: number) => void;
}

/**
 * The API Pythia publishes as `plugin.api` (ADR-249), version 1. Schreibstube's
 * print preview reads it — feature-detected, exactly as Pythia reads
 * Schreibstube's — and any other print or export plugin may. Nothing in it
 * writes to a note: a print never changes what it prints.
 */
export interface PythiaApi {
	readonly version: 1;
	/** Cheap: no model, no write. `sourcePath` lets Pythia record the note's links. */
	inspectForExport(markdown: string, sourcePath?: string): ExportInspection;
	/** Model calls — only on a user's gesture in the caller. Never throws. */
	refreshSummaries(markdown: string, options?: RefreshOptions): Promise<RefreshResult>;
	/** Pure: a copy for print or export, footnotes added and renumbered. */
	withExportFootnotes(markdown: string): string;
}

export interface NoteAnchorHost {
	app: App;
	conversations(): Conversation[];
	getById(id: string): Conversation | undefined;
	save(conv: Conversation): Promise<void>;
	llm(): LLMRouter;
	settings(): PythiaSettings;
	/** Shown when a caller refreshes without a progress callback of its own. */
	notice(message: string): void;
	log(message: string, data?: unknown): void;
}

/** A chapter link the user copied in the panel, for "Link selection to…". Held
 *  for the session only: it is a gesture in progress, not data. */
export interface CopiedChapter {
	ref: AnchorRef;
	url: string;
	/** "Conversation › Chapter", for the menu entry. */
	name: string;
}

export class NoteAnchorService {
	copied: CopiedChapter | null = null;

	constructor(private readonly h: NoteAnchorHost) {}

	status(ref: AnchorRef): AnchorStatus { return anchorStatus(this.h.getById(ref.id), ref); }
	summary(ref: AnchorRef): AnchorSummary { return anchorSummary(this.h.getById(ref.id), ref); }

	/** The language a footnote without a summary is worded in: Obsidian's. */
	fallbackLanguage(): string { return getObsidianLocale().split("-")[0] || "en"; }

	inspect(markdown: string, sourcePath?: string): ExportInspection {
		if (sourcePath) void this.recordFromText(sourcePath, markdown);
		return inspectAnchors(markdown, (ref) => this.status(ref));
	}

	exportCopy(markdown: string): string {
		return withExportFootnotes(markdown, (ref) => this.summary(ref), this.fallbackLanguage());
	}

	/** Every summary in `markdown` that is missing or outdated, written again. */
	refreshSummaries(markdown: string, options: RefreshOptions = {}): Promise<RefreshResult> {
		return this.refresh(uniqueRefs(markdown).filter((ref) => needsRefresh(this.status(ref))), options);
	}

	/**
	 * Write the summaries for `refs`, a few at a time. Never throws: every
	 * target that was not written is in `failed`, with the reason. Stops starting
	 * new ones once `signal` aborts; one already asked for still lands.
	 */
	async refresh(refs: AnchorRef[], { signal, onProgress }: RefreshOptions = {}): Promise<RefreshResult> {
		const result: RefreshResult = { refreshed: 0, failed: [] };
		const work = refs.slice(0, REFRESH_LIMIT);
		for (const ref of refs.slice(REFRESH_LIMIT)) result.failed.push({ ...ref, reason: "limit" });
		if (work.length === 0) return result;
		if (!onProgress) this.h.notice(t("refreshingForExport", { count: String(work.length) }));
		let done = 0;
		let next = 0;
		const worker = async (): Promise<void> => {
			while (next < work.length && !signal?.aborted) {
				const ref = work[next++];
				const outcome = await this.refreshOne(ref);
				if (outcome === "ok") result.refreshed++;
				else result.failed.push({ ...ref, reason: outcome });
				onProgress?.(++done, work.length);
			}
		};
		await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, work.length) }, worker));
		return result;
	}

	/** One summary. After the model answers, the chapter is read again by id and
	 *  must still be the chapter that was summarized (principle 7). */
	async refreshOne(ref: AnchorRef): Promise<"ok" | Exclude<RefreshFailure, "limit">> {
		const conv = this.h.getById(ref.id);
		if (!conv) return "deleted";
		try {
			if (ref.msg) {
				const chapter = chapterOf(conv, ref.msg);
				if (!chapter) return "deleted";
				if (!chapter.answer) return "unanswered";
				const fingerprint = chapterFingerprint(chapter);
				const text = cleanChapterSummary(await this.h.llm().generateChapterSummary(
					chapter.user.content, chapter.answer.content, conv.provider, conv));
				if (!text) return "empty";
				const live = this.h.getById(ref.id);
				const now = live ? chapterOf(live, ref.msg) : null;
				if (!live || !now || chapterFingerprint(now) !== fingerprint) return "changed";
				const language = detectLanguage(text);
				now.user.chapterSummary = { text, fingerprint, createdAt: new Date().toISOString(), ...(language ? { language } : {}) };
				await this.h.save(live);
				return "ok";
			}
			if (conv.messages.length === 0) return "unanswered";
			const text = (await this.h.llm().generateSummary(conv)).trim();
			if (!text) return "empty";
			const live = this.h.getById(ref.id);
			if (!live) return "deleted";
			live.summaryText = text;
			live.summaryUpdatedAt = new Date().toISOString();
			await this.h.save(live);
			return "ok";
		} catch (err) {
			this.h.log("note link summary failed", describeErrorForLog(err));
			return "error";
		}
	}

	/**
	 * Put every anchor's footnote in `file` in place and make it current. In an
	 * open editor the edits go in as one transaction — one undo step, and the
	 * text around them untouched; otherwise through `vault.process`, which reads
	 * and writes in one step. True when something changed.
	 */
	async updateNote(file: TFile): Promise<boolean> {
		const resolve = (ref: AnchorRef): AnchorSummary => this.summary(ref);
		const lang = this.fallbackLanguage();
		const view = this.h.app.workspace.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === file.path);
		if (view) {
			const editor = view.editor;
			const edits = noteFootnoteEdits(editor.getValue(), resolve, lang);
			if (edits.length === 0) return false;
			editor.transaction({
				changes: edits.map((e) => ({ from: editor.offsetToPos(e.start), to: editor.offsetToPos(e.end), text: e.text })),
			});
			return true;
		}
		let changed = false;
		await this.h.app.vault.process(file, (text) => {
			const edits = noteFootnoteEdits(text, resolve, lang);
			if (edits.length === 0) return text;
			changed = true;
			return applyEdits(text, edits);
		});
		return changed;
	}

	/** The records for the note at `path` made to match `text` (what it holds now). */
	async recordFromText(path: string, text: string): Promise<void> {
		const known = this.h.conversations().some((c) => c.noteAnchors?.some((a) => a.path === path));
		if (!known && !text.includes("obsidian://pythia")) return;
		const refs = findAnchors(text).map((a) => a.ref);
		const changed = reconcileNoteAnchors(this.h.conversations(), path, refs, new Date().toISOString());
		for (const id of changed) {
			const conv = this.h.getById(id);
			if (conv) await this.h.save(conv);
		}
	}

	/** A note Pythia just wrote (ADR-250): read fresh from disk, so the records
	 *  hold what the whole note says, not only the block written into it. */
	async recordFromPath(path: string): Promise<void> {
		const file = this.h.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || file.extension !== "md") return;
		try {
			await this.recordFromText(path, await this.h.app.vault.read(file));
		} catch (err) {
			this.h.log("could not read a written note for its Pythia links", describeErrorForLog(err));
		}
	}

	/**
	 * A note or folder was deleted: every record at or under `path` goes. A
	 * deleted document must not keep protecting its conversations from the
	 * history limit forever (ADR-250).
	 */
	async forget(path: string): Promise<void> {
		const gone = (p: string): boolean => p === path || p.startsWith(`${path}/`);
		for (const conv of this.h.conversations()) {
			const list = conv.noteAnchors ?? [];
			const kept = list.filter((a) => !gone(a.path));
			if (kept.length === list.length) continue;
			if (kept.length > 0) conv.noteAnchors = kept; else delete conv.noteAnchors;
			await this.h.save(conv);
		}
	}

	async recordFromFile(file: TFile): Promise<void> {
		if (file.extension !== "md") return;
		try {
			await this.recordFromText(file.path, await this.h.app.vault.cachedRead(file));
		} catch (err) {
			this.h.log("could not read a note for its Pythia links", describeErrorForLog(err));
		}
	}

	/**
	 * An answer committed in `userMessageId`'s chapter. When a note links to that
	 * chapter, its summary is written — the hover card needs it either way — and,
	 * with the footnote setting on, the footnote in each linking note follows. A
	 * link to the whole conversation gets the conversation's first summary once;
	 * after that the conversation summary is refreshed only when asked.
	 */
	async afterAnswer(conversationId: string, userMessageId: string): Promise<void> {
		const conv = this.h.getById(conversationId);
		const anchors = conv?.noteAnchors ?? [];
		const chapterPaths = anchors.filter((a) => a.messageId === userMessageId).map((a) => a.path);
		const wholePaths = anchors.filter((a) => !a.messageId).map((a) => a.path);
		if (!conv || chapterPaths.length + wholePaths.length === 0) return;

		const refs: AnchorRef[] = [];
		if (chapterPaths.length > 0) refs.push({ id: conversationId, msg: userMessageId });
		if (wholePaths.length > 0 && !conv.summaryText?.trim()) refs.push({ id: conversationId });
		const result = await this.refresh(refs, { onProgress: () => {} });
		if (result.failed.length > 0) this.h.log("note link summary not written", result.failed);

		if (!this.h.settings().anchorFootnotes) return;
		for (const path of new Set([...chapterPaths, ...wholePaths])) {
			const file = this.h.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			try {
				await this.updateNote(file);
			} catch (err) {
				this.h.log("could not update the footnotes in a linking note", describeErrorForLog(err));
			}
		}
	}

	/** The API object: a stable facade over this service (ADR-249). */
	api(): PythiaApi {
		return Object.freeze({
			version: 1 as const,
			inspectForExport: (markdown: string, sourcePath?: string) => this.inspect(markdown, sourcePath),
			refreshSummaries: (markdown: string, options?: RefreshOptions) => this.refreshSummaries(markdown, options),
			withExportFootnotes: (markdown: string) => this.exportCopy(markdown),
		});
	}
}
