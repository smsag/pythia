import type { App } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation, ToolCall } from "../models/types";
import { t } from "../i18n";
import { ToolHandler } from "../services/ToolHandler";
import { parseWebSourcesFromResult } from "../services/WebSearchService";
import { describeSearchFilters, parseSearchArgs, type FilterWords } from "../services/tavilyArgs";
import { webDomain } from "../services/citations";
import { noteBasename } from "../services/pathUtils";
import { acceptChartCall, type PendingChartBlock } from "../services/chartSpec";

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
	private webSources: { title: string; url: string }[] = [];
	private chartBlocks: PendingChartBlock[] = [];
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
		this.chartBlocks = [];
		this.streamedChars = 0;
		return (text: string): void => {
			this.streamedChars += text.length;
			appendToken(text);
		};
	}

	/** The web results captured during this send. */
	takeWebSources(): { title: string; url: string }[] {
		return this.webSources;
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
	 */
	handler(conv: Conversation, researchActive: boolean): (call: ToolCall) => Promise<string> {
		return async (call: ToolCall): Promise<string> => {
			// A chart writes nothing, so there is nothing to confirm and no chip to
			// show — the chart itself is the feedback, and it appears the moment the
			// answer commits. Validation is instantaneous, so a spinner would only
			// ever flash (ADR-210).
			if (call.name === "render_chart") {
				return acceptChartCall(call.input, this.streamedChars, this.chartBlocks);
			}
			if (call.name === "web_search" || call.name === "read_url") return this.runSearch(call, conv, researchActive);
			return this.runWrite(call, conv, researchActive);
		};
	}

	/** web_search and read_url are read-only — run directly with a live status
	 *  chip, no write-confirmation prompt (that would make research unusable). */
	private async runSearch(call: ToolCall, conv: Conversation, researchActive: boolean): Promise<string> {
		const messagesEl = this.d.messagesEl();
		const labels = chipLabels(call);
		const searchChip = messagesEl.createDiv({ cls: "pythia-tool-call" });
		searchChip.createSpan({ cls: "pythia-tool-call-label", text: labels.running });
		this.d.reveal(searchChip, false); // a status: follow it only if following the answer

		const allowed = ToolHandler.allowedToolNames(conv.writeMode ?? "all", researchActive);
		const result = await this.d.plugin.toolHandler.execute(call, allowed);

		searchChip.empty();
		if (result.startsWith("Error")) {
			searchChip.addClass("pythia-tool-call--error");
			searchChip.createSpan({ cls: "pythia-tool-call-label", text: labels.failed });
		} else {
			searchChip.addClass("pythia-tool-call--done");
			searchChip.createSpan({ cls: "pythia-tool-call-label", text: labels.done });
			// Capture the real Tavily sources — a read page too — for the sources row.
			this.webSources.push(...parseWebSourcesFromResult(result));
		}
		return result;
	}

	private async runWrite(call: ToolCall, conv: Conversation, researchActive: boolean): Promise<string> {
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
			this.d.registerDomEvent(actionBtn, "click", () => resolve(true));
			this.d.registerDomEvent(cancelBtn, "click", () => resolve(false));
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

		const allowed = ToolHandler.allowedToolNames(conv.writeMode ?? "all", researchActive);
		const result = await this.d.plugin.toolHandler.execute(call, allowed, conv.contextNotes);

		if (result.startsWith("Error")) {
			chipEl.addClass("pythia-tool-call--error");
			chipEl.createSpan({ cls: "pythia-tool-call-label", text: result });
			return result;
		}

		chipEl.addClass("pythia-tool-call--done");
		const link = chipEl.createEl("a", {
			cls:  "pythia-tool-call-link",
			text: isRewrite ? t("rewrittenNote", { name: noteName })
				: isPrepend  ? t("prependedNote", { name: noteName })
				:              t("createdNote",   { name: noteName }),
		});
		link.addEventListener("click", (e) => {
			e.preventDefault();
			void this.d.app.workspace.openLinkText(noteName, "");
		});
		return result;
	}
}

/** The chip's three states for a web tool call. The filters are described by
 *  the same builder the no-results message uses (ADR-217); an argument the
 *  handler will reject still gets a readable label, never a crash. */
function chipLabels(call: ToolCall): { running: string; done: string; failed: string } {
	if (call.name === "read_url") {
		const raw = typeof call.input["url"] === "string" ? call.input["url"] : "";
		const site = webDomain(raw) || raw;
		return {
			running: t("readingUrlLabel", { site }),
			done: t("readUrlLabel", { site }),
			failed: t("readUrlFailedLabel", { site }),
		};
	}
	const query = typeof call.input["query"] === "string" ? call.input["query"] : "";
	const parsed = parseSearchArgs(call.input);
	const filters = parsed.ok ? describeSearchFilters(parsed.value, localFilterWords()) : "";
	const withFilters = (label: string) => (filters ? t("searchFilteredLabel", { label, filters }) : label);
	return {
		running: withFilters(t("searchingLabel", { query })),
		done: withFilters(t("searchedLabel", { query })),
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
		excluding: (n) => t("searchFilterExcluding", { n }),
	};
}
