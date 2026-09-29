import { Notice, type App } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation, Message, NoteWrite, ToolCall } from "../models/types";
import { t } from "../i18n";
import { declaresPythiaTemplate, ToolHandler } from "../services/ToolHandler";
import type { WebErrorKind, WebSource } from "../services/WebSearchService";
import { describeSearchFilters, parseSearchArgs, type FilterWords } from "../services/tavilyArgs";
import { parseCitations, resolveWebCitations, webDomain, type CitationSource } from "../services/citations";
import { debugLog } from "../services/messageUtils";
import { WebReadScope } from "../services/webReadScope";
import { parseNoteWrite, writesOnlyContent } from "../services/noteWrites";
import { fillNoteWriteChip } from "./noteLinks";
import { noteBasename } from "../services/pathUtils";
import { acceptChartCall, type PendingChartBlock } from "../services/chartSpec";
import { favoritePassages } from "../services/favoriteHighlights";
import { ABLAGE_MAX_CHARS } from "../services/ablage";
import type { ToolCallHandler } from "../services/LLMProvider";

export interface ToolCallDeps {
	app: App;
	plugin: PythiaPlugin;
	/** Where the chips go, and what they scroll. */
	messagesEl(): HTMLElement;
	/** The view's own listener registration, so a chip's buttons are torn down
	 *  with the view rather than leaking (hard rule 10). */
	registerDomEvent(el: HTMLElement, type: "click", cb: () => void): void;
	/** Bring a finished card fully into view (ADR-215). `force` = even when the
	 *  user has scrolled away: a card that blocks the answer must be seen. */
	reveal(card: HTMLElement, force: boolean): void;
}

/**
 * Everything that happens when the model calls a tool mid-answer.
 *
 * Extracted from `sidebar.ts` (ADR-097's ratchet, ADR-210's session), where it
 * was a 125-line closure inside `sendMessage`. The file sat at exactly its
 * grandfathered ceiling, so the chart work could not add a line to it — and the
 * ratchet's rule is that each extraction LOWERS the number. The behaviour here
 * is unchanged by the move.
 *
 * It also owns what a tool call leaves behind for the commit to pick up:
 * `webSources` (the real Tavily results, so the sources row is right regardless
 * of how the model chose to cite) and, since ADR-210, `chartBlocks`.
 */
export class ToolCallController {
	private webSources: WebSource[] = [];
	/** The account problems already announced in this send — once each (ADR-226). */
	private announced = new Set<WebErrorKind>();
	private chartBlocks: PendingChartBlock[] = [];
	private noteWrites: NoteWrite[] = [];
	private streamedChars = 0;

	constructor(private readonly d: ToolCallDeps) {}

	/**
	 * Start a send, and wrap the view's token sink so this controller can see how
	 * much of the answer has been emitted.
	 *
	 * That count is how a chart finds its place. BaseProvider's own `fullText` and
	 * the sink returned here consume the same stream, and `handleToolCalls` runs
	 * BETWEEN rounds — so at the moment a tool call fires, the characters emitted
	 * so far are exactly the text before it (ADR-210). Owning the counter here
	 * rather than in the view keeps "where we are in the answer" beside "what the
	 * call left behind", which are the same responsibility.
	 */
	begin(appendToken: (text: string) => void): (text: string) => void {
		this.webSources = [];
		this.announced.clear();
		this.chartBlocks = [];
		this.noteWrites = [];
		this.streamedChars = 0;
		return (text: string): void => {
			this.streamedChars += text.length;
			appendToken(text);
		};
	}

	/** The answer's sources: its markers resolved against the numbered results
	 *  this send fetched (ADR-226). A marker nothing fetched answers for is
	 *  dropped, and said in the debug log so a report can quote it. */
	resolveSources(text: string): CitationSource[] {
		const { sources, dropped } = resolveWebCitations(parseCitations(text), this.webSources);
		if (dropped.length > 0) debugLog(this.d.plugin.settings, "dropped web citations with no fetched result:", dropped);
		return sources;
	}


	/** The answer text for a turn that only wrote notes — "" when it wrote none
	 *  (ADR-218 addendum). Does not drain: `takeNoteWrites` still records them. */
	writesOnlyContent(): string {
		return writesOnlyContent(this.noteWrites);
	}

	/**
	 * The assistant turn to keep when the stream failed after a note was written:
	 * the note exists, so its record must too. Drains the writes. null when this
	 * send wrote nothing.
	 */
	writesOnlyMessage(model: string | undefined): Message | null {
		const content = writesOnlyContent(this.noteWrites);
		if (!content) return null;
		return {
			id: crypto.randomUUID(),
			role: "assistant",
			content,
			timestamp: new Date().toISOString(),
			...(model ? { model } : {}),
			...this.takeNoteWrites(),
		};
	}

	/** The notes written during this send, as the message field — spread into
	 *  the committed answer so its chips outlive the turn (ADR-218). */
	takeNoteWrites(): { noteWrites?: NoteWrite[] } {
		const writes = this.noteWrites;
		this.noteWrites = [];
		return writes.length > 0 ? { noteWrites: writes } : {};
	}

	/** The charts accepted during this send, each with the point in the answer it
	 *  belongs at. Spliced in at commit by `spliceChartBlocks`. */
	takeChartBlocks(): PendingChartBlock[] {
		return this.chartBlocks;
	}

	/**
	 * The `onToolCall` handler for one send.
	 *
	 * `researchActive` is passed rather than read off the conversation because an
	 * auto-armed search is a per-send override that is never persisted (ADR-099).
	 * `autoCue` is the word that armed it, named on every search chip of this
	 * answer so an unasked search is never anonymous (ADR-230).
	 */
	handler(conv: Conversation, researchActive: boolean, autoCue: string | null = null): ToolCallHandler {
		// Built here, once per send, after the outgoing message joined `messages`:
		// the links read_url may read in this answer (ADR-217 addendum).
		const readScope = WebReadScope.forConversation(conv);
		return async (call: ToolCall, signal?: AbortSignal): Promise<string> => {
			// A chart writes nothing, so there is nothing to confirm and no chip to
			// show — the chart itself is the feedback, and it appears the moment the
			// answer commits. Validation is instantaneous, so a spinner would only
			// ever flash (ADR-210).
			if (call.name === "render_chart") {
				return acceptChartCall(call.input, this.streamedChars, this.chartBlocks);
			}
			if (call.name === "web_search" || call.name === "read_url") return this.runSearch(call, conv, researchActive, readScope, autoCue);
			if (call.name === "stage_text") return this.runStage(call, conv, researchActive);
			return this.runWrite(call, conv, researchActive, signal);
		};
	}

	/** web_search and read_url are read-only — run directly with a live status
	 *  chip, no write-confirmation prompt (that would make research unusable). */
	private async runSearch(call: ToolCall, conv: Conversation, researchActive: boolean, readScope: WebReadScope, autoCue: string | null): Promise<string> {
		const messagesEl = this.d.messagesEl();
		const labels = chipLabels(call, autoCue);
		const searchChip = messagesEl.createDiv({ cls: "pythia-tool-call" });
		searchChip.createSpan({ cls: "pythia-tool-call-label", text: labels.running });
		this.d.reveal(searchChip, false); // a status: follow it only if following the answer

		const allowed = ToolHandler.allowedToolNames(conv.writeMode ?? "all", researchActive);
		let failed = true;
		try {
			// Numbered on from the results already in this answer, so every number
			// the model may cite names one page (ADR-226).
			const result = await this.d.plugin.toolHandler.executeWeb(call, allowed, readScope, this.webSources.length + 1);
			failed = !!result.error;
			if (result.error) this.announce(result.error);
			// The real results — a read page too — as data, for the sources row.
			this.webSources.push(...result.sources);
			// A link a result returned may be read later in this answer.
			if (!failed) readScope.addResults(result.sources);
			return result.text;
		} finally {
			// Always settles, even if the call threw: a chip left on "Searching…"
			// says something is still happening when nothing is.
			searchChip.empty();
			searchChip.addClass(failed ? "pythia-tool-call--error" : "pythia-tool-call--done");
			searchChip.createSpan({ cls: "pythia-tool-call-label", text: failed ? labels.failed : labels.done });
		}
	}

	/**
	 * stage_text fills the Ablage (ADR-246). No note is written, so there is
	 * nothing to confirm: the user's insert, later, is the gesture. The web
	 * results so far travel with the text, so its citations become footnotes
	 * numbered around the target note's own when it is inserted.
	 */
	private async runStage(call: ToolCall, conv: Conversation, researchActive: boolean): Promise<string> {
		if (!ToolHandler.allowedToolNames(conv.writeMode ?? "all", researchActive).has("stage_text")) {
			return `Error: tool "stage_text" is not allowed in the current write mode.`;
		}
		const content = call.input["content"];
		if (typeof content !== "string") return "Error: 'content' must be a string.";
		if (declaresPythiaTemplate(content)) {
			return "Error: text for the Ablage cannot be a Pythia prompt template. Remove the template frontmatter.";
		}
		const chipEl = this.d.messagesEl().createDiv({ cls: "pythia-tool-call" });
		const sources = this.webSources.map(({ n, title, url }) => ({ n, title, url }));
		const put = await this.d.plugin.ablage.put(content, { conversationId: conv.id, ...(sources.length > 0 ? { sources } : {}) });
		const ok = put === "ok";
		chipEl.addClass(ok ? "pythia-tool-call--done" : "pythia-tool-call--error");
		const label = ok ? t("ablageStaged") : put === "empty" ? t("ablageEmptyText") : t("ablageTooLong");
		chipEl.createSpan({ cls: "pythia-tool-call-label", text: label });
		this.d.reveal(chipEl, false);
		if (!ok) {
			return put === "empty" ? "Error: 'content' is empty." : `Error: the text is too long for the Ablage (over ${ABLAGE_MAX_CHARS} characters). Shorten it, or write a note instead.`;
		}
		// Said once here, not only in the chip: a turn with no words is dropped at
		// commit, and the chip with it — the item is still in the Ablage.
		new Notice(t("ablageStagedNotice"));
		return "Placed in the Ablage. The user inserts it into a note from the editor's context menu (Insert from Ablage). Do not repeat the full text in your answer unless asked.";
	}

	/** A rejected key or a used-up plan is fixed by the user, in settings or at
	 *  Tavily — the model's paraphrase is not a report. Said once per send. */
	private announce(kind: WebErrorKind): void {
		if (kind !== "auth" && kind !== "quota") return;
		if (this.announced.has(kind)) return;
		this.announced.add(kind);
		// Literal t() calls, so the dead-key check in tests/i18n.test.ts sees them.
		new Notice(kind === "auth" ? t("webSearchKeyRejected") : t("webSearchQuotaReached"), 10000);
	}

	private async runWrite(call: ToolCall, conv: Conversation, researchActive: boolean, signal?: AbortSignal): Promise<string> {
		const messagesEl = this.d.messagesEl();
		const rawPath = typeof call.input["path"] === "string" ? call.input["path"] : call.name;
		const noteName = noteBasename(rawPath);
		const isRewrite = call.name === "rewrite_note";
		const isPrepend = call.name === "prepend_note";

		const chipEl = messagesEl.createDiv({ cls: "pythia-tool-call" });

		// Path guard: rewrite/prepend may only target context notes. Mirrored from
		// ToolHandler, which holds the authoritative check.
		if (isRewrite || isPrepend) {
			const targetPath = typeof call.input["path"] === "string" ? call.input["path"] : "";
			if (!conv.contextNotes.includes(targetPath)) {
				chipEl.addClass("pythia-tool-call--error");
				chipEl.createSpan({
					cls: "pythia-tool-call-label",
					text: t("toolPathNotInContext", { path: targetPath }),
				});
				this.d.reveal(chipEl, false);
				return `Error: path "${targetPath}" is not in context notes. You may only modify notes that were explicitly provided as context.`;
			}
		}

		// Confirm chip — ask before writing.
		chipEl.createSpan({
			cls:  "pythia-tool-call-label",
			text: isRewrite ? t("confirmRewriteNote", { name: noteName })
				: isPrepend  ? t("confirmPrependNote", { name: noteName })
				:              t("confirmCreateNote",  { name: noteName }),
		});
		// The whole path, not only the name: where a note lands is what the user
		// is agreeing to (a templates or glossary folder is not a neutral place).
		if (!isRewrite && !isPrepend && rawPath !== call.name) {
			chipEl.createSpan({ cls: "pythia-tool-call-path", text: rawPath });
		}

		const actionsEl = chipEl.createDiv({ cls: "pythia-tool-call-actions" });
		const actionLabel = isRewrite ? t("confirmRewriteBtn")
			: isPrepend ? t("confirmPrependBtn")
			: t("confirmCreateBtn");

		const confirmed = await new Promise<boolean>((resolve) => {
			const actionBtn = actionsEl.createEl("button", {
				cls:  "pb pb-primary pythia-tool-call-btn pythia-tool-call-btn--action",
				text: actionLabel,
			});
			const cancelBtn = actionsEl.createEl("button", {
				cls: "pb pb-quiet pythia-tool-call-btn", text: t("cancelBtn"),
			});
			// Stop while the chip waits is a decline, never a later write: the
			// buttons go dead at once and the promise settles as "no". The provider
			// then ends the loop on the aborted signal (ToolCancelledError).
			const onAbort = (): void => {
				actionBtn.disabled = true;
				cancelBtn.disabled = true;
				resolve(false);
			};
			const settle = (value: boolean): void => {
				if (signal?.aborted) return; // already declined by the stop
				signal?.removeEventListener("abort", onAbort);
				resolve(value);
			};
			this.d.registerDomEvent(actionBtn, "click", () => settle(true));
			this.d.registerDomEvent(cancelBtn, "click", () => settle(false));
			if (signal?.aborted) { onAbort(); return; }
			signal?.addEventListener("abort", onAbort, { once: true });
			// Only now, with the label and both buttons in it, does the card have its
			// height. The answer waits on it, so it is shown even to a user who has
			// scrolled up (ADR-215).
			this.d.reveal(chipEl, true);
		});

		chipEl.empty();

		if (!confirmed) {
			chipEl.addClass("pythia-tool-call--cancelled");
			chipEl.createSpan({ cls: "pythia-tool-call-label", text: t("toolCallCancelled") });
			return "User declined. Please output the content directly in this conversation instead of saving it to a file.";
		}

		// A confirm that raced the stop still writes nothing.
		if (signal?.aborted) {
			chipEl.addClass("pythia-tool-call--cancelled");
			chipEl.createSpan({ cls: "pythia-tool-call-label", text: t("toolCallCancelled") });
			return "User stopped the answer. Nothing was written.";
		}

		const allowed = ToolHandler.allowedToolNames(conv.writeMode ?? "all", researchActive);
		// The results fetched so far, so the note's web citations become footnotes
		// that name those pages (ADR-238), and the favorites, so a passage the user
		// starred stays marked in the note (ADR-239).
		const result = await this.d.plugin.toolHandler.execute(call, allowed, conv.contextNotes, undefined, {
			webSources: this.webSources,
			favorites: favoritePassages(conv),
		});

		if (result.startsWith("Error")) {
			chipEl.addClass("pythia-tool-call--error");
			chipEl.createSpan({ cls: "pythia-tool-call-label", text: result });
			return result;
		}

		// The path the vault used, read from the result; the call's own argument
		// is only the fallback for a result in an unexpected shape.
		const write = parseNoteWrite(call.name, result)
			?? { path: rawPath, action: isRewrite ? "rewritten" : isPrepend ? "prepended" : "created" };
		this.noteWrites.push(write);
		fillNoteWriteChip(this.d.app, chipEl, write);
		return result;
	}
}

/** The chip's three states for a web tool call. The filters are described by
 *  the same builder the no-results message uses (ADR-217); an argument the
 *  handler will reject still gets a readable label, never a crash. An
 *  auto-armed send names its cue on the chip (ADR-230). */
export function chipLabels(call: ToolCall, autoCue: string | null = null): { running: string; done: string; failed: string } {
	const auto = (label: string) => (autoCue ? t("searchAutoLabel", { label, cue: autoCue }) : label);
	if (call.name === "read_url") {
		const raw = typeof call.input["url"] === "string" ? call.input["url"] : "";
		const site = webDomain(raw) || raw;
		return {
			running: auto(t("readingUrlLabel", { site })),
			done: auto(t("readUrlLabel", { site })),
			failed: t("readUrlFailedLabel", { site }),
		};
	}
	const query = typeof call.input["query"] === "string" ? call.input["query"] : "";
	const parsed = parseSearchArgs(call.input);
	const filters = parsed.ok ? describeSearchFilters(parsed.value, localFilterWords()) : "";
	const withFilters = (label: string) => (filters ? t("searchFilteredLabel", { label, filters }) : label);
	return {
		running: auto(withFilters(t("searchingLabel", { query }))),
		done: auto(withFilters(t("searchedLabel", { query }))),
		failed: t("searchFailedLabel"),
	};
}

function localFilterWords(): FilterWords {
	return {
		topic: { news: t("searchFilterNews"), finance: t("searchFilterFinance") },
		timeRange: {
			day: t("searchFilterDay"),
			week: t("searchFilterWeek"),
			month: t("searchFilterMonth"),
			year: t("searchFilterYear"),
		},
		sites: (n) => t("searchFilterSites", { n }),
		excluding: (what) => t("searchFilterExcluding", { what }),
	};
}
