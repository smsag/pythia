import { Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation, ComparisonCandidate, ToolCall } from "../models/types";
import type { ModelInfo } from "../models/knownModels";
import { abbreviateModel } from "../models/knownModels";
import { t } from "../i18n";
import { estimateCost, formatCost } from "../models/modelPricing";
import { formatClockTime } from "../services/messageUtils";
import { parseCitations } from "../services/citations";
import { describeErrorForLog } from "../services/redact";
import { ToolHandler } from "../services/ToolHandler";
import { acceptChartCall, spliceChartBlocks, type PendingChartBlock } from "../services/chartSpec";
import {
	startComparison,
	comparisonPrompt,
	addCandidate,
	removeCandidate,
	keepCandidate,
	cancelComparison,
} from "../services/comparison";
import { ModelSuggestModal } from "../suggest/ModelSuggest";

export interface ComparisonDeps {
	plugin: PythiaPlugin;
	getConversation(): Conversation | null;
	getMessagesEl(): HTMLElement;
	isStreaming(): boolean;
	/** The view's streaming state: disables the input, turns Send into Stop. A
	 *  candidate run is a stream like any other and must be stoppable the same way. */
	setStreamingState(streaming: boolean): void;
	/** Render markdown into `el` using the view as the owning Component. */
	renderMarkdown(md: string, el: HTMLElement): void;
	/** The comparison opened: the assistant row is gone and the conversation now
	 *  ends with `userMessageId`, so the view's incremental-render anchor moves. */
	onStarted(userMessageId: string): void;
	/** Full rebuild of the message list (after keep / discard). */
	rerender(): void;
	scrollToBottom(): void;
}

/**
 * The comparison card (ADR-160): one prompt, one answer per model, one tab
 * each, and a Keep button that turns the chosen tab into the assistant turn and
 * every other tab into a fork. Candidate runs are sequential — one stream at a
 * time, through the same router and streaming state as a normal send — so
 * nothing about the providers had to change: the conversation ends with the
 * user turn while the comparison is pending, which is exactly the shape the
 * send path expects.
 *
 * Note-writing tools are withheld from a candidate run (`writeMode: "none"`);
 * web search stays available when the conversation has research mode on. A
 * comparison is about the answer, and a second model writing into the vault
 * while the user is still choosing would be a side effect they never asked for.
 */
export class ComparisonController {
	private cardEl: HTMLElement | null = null;
	private activeId: string | null = null;
	private running: { id: string; textNode: Text } | null = null;

	constructor(private readonly d: ComparisonDeps) {}

	/** Open a comparison on the last exchange and offer a model to run. */
	start(userMessageId: string, assistantMessageId: string): void {
		const conv = this.d.getConversation();
		if (!conv) return;
		if (this.d.isStreaming()) { new Notice(t("compareBusy")); return; }
		const cmp = startComparison(conv, userMessageId, assistantMessageId);
		if (!cmp) return;
		void this.d.plugin.conversationStore.save(conv);
		this.d.getMessagesEl().querySelector(`[data-msg-id="${assistantMessageId}"]`)?.remove();
		this.activeId = cmp.candidates[0].id;
		this.d.onStarted(userMessageId);
		this.render();
		this.pickModel();
	}

	/** Offer every keyed model not already answering, then run the pick. */
	pickModel(): void {
		const conv = this.d.getConversation();
		const cmp = conv?.comparison;
		if (!conv || !cmp) return;
		const exclude = [conv.model, ...cmp.candidates.map((c) => c.model)];
		if (ModelSuggestModal.candidates((p) => this.d.plugin.hasApiKeyFor(p), exclude).length === 0) {
			new Notice(t("compareNoOtherModel"));
			return;
		}
		new ModelSuggestModal(
			this.d.plugin.app,
			(p) => this.d.plugin.hasApiKeyFor(p),
			exclude,
			(m) => void this.run(m),
		).open();
	}

	/** Re-run the comparison's prompt on `model` as a new candidate. */
	async run(model: ModelInfo): Promise<void> {
		const conv = this.d.getConversation();
		const prompt = conv ? comparisonPrompt(conv) : undefined;
		if (!conv || !conv.comparison || !prompt) return;
		if (this.d.isStreaming()) { new Notice(t("compareBusy")); return; }

		const candidate: ComparisonCandidate = {
			id: crypto.randomUUID(),
			provider: model.provider,
			model: model.id,
			content: "",
			timestamp: new Date().toISOString(),
			...(conv.templateId ? { templateId: conv.templateId } : {}),
		};
		addCandidate(conv, candidate);
		this.activeId = candidate.id;
		const textNode = document.createTextNode("");
		this.running = { id: candidate.id, textNode };
		this.d.setStreamingState(true);
		this.render();

		// Same conversation, another model, no note-writing tools. `messages`
		// already ends with the prompt (the original answer became candidate 0).
		const armed: Conversation = { ...conv, provider: model.provider, model: model.id, writeMode: "none" };
		const allowed = ToolHandler.allowedToolNames("none", conv.researchMode ?? false);
		// A candidate may draw a chart — one model reaching for one and another not
		// is part of what a comparison is for. Same accept path as the send, so the
		// two cannot answer a tool call differently (ADR-210).
		const charts: PendingChartBlock[] = [];
		const onToolCall = (call: ToolCall): Promise<string> =>
			call.name === "render_chart"
				? Promise.resolve(acceptChartCall(call.input, textNode.data.length, charts))
				: call.name === "web_search" || call.name === "read_url"
				? this.d.plugin.toolHandler.execute(call, allowed)
				: Promise.resolve("Error: note-writing tools are not available during a model comparison. Answer in the conversation instead.");

		try {
			await this.d.plugin.llmRouter.streamMessage(
				armed,
				prompt.content,
				[...(prompt.attachedNotes ?? conv.contextNotes ?? [])],
				(text) => { textNode.data += text; this.d.scrollToBottom(); },
				(fullText, tokenUsage) => {
					candidate.content = spliceChartBlocks(fullText, charts);
					if (tokenUsage) candidate.tokenUsage = tokenUsage;
					const sources = parseCitations(fullText);
					if (sources.length) candidate.sources = sources;
				},
				(error) => {
					console.error("[Pythia] comparison run failed:", describeErrorForLog(error));
					new Notice(t("compareFailed", { model: abbreviateModel(model.id), error: error.message }), 8000);
				},
				onToolCall,
			);
		} catch (error) {
			console.error("[Pythia] comparison run failed:", describeErrorForLog(error));
			new Notice(t("compareFailed", { model: abbreviateModel(model.id), error: error instanceof Error ? error.message : String(error) }), 8000);
		} finally {
			this.running = null;
			this.d.setStreamingState(false);
			if (!candidate.content) {
				// Nothing to compare: an empty tab would only be confusing.
				removeCandidate(conv, candidate.id);
				this.activeId = conv.comparison?.candidates[0]?.id ?? null;
			}
			await this.d.plugin.conversationStore.save(conv);
			this.render();
		}
	}

	/** Paint (or repaint) the card at the end of the message list. */
	render(): void {
		this.cardEl?.remove();
		this.cardEl = null;
		const conv = this.d.getConversation();
		const cmp = conv?.comparison;
		if (!conv || !cmp) return;
		const active = cmp.candidates.find((c) => c.id === this.activeId) ?? cmp.candidates[0];
		if (!active) return;
		this.activeId = active.id;

		const card = this.d.getMessagesEl().createDiv({ cls: "p-compare" });
		this.cardEl = card;

		const header = card.createDiv({ cls: "p-compare-header" });
		setIcon(header.createSpan({ cls: "p-compare-icon" }), "git-compare");
		header.createSpan({ cls: "p-compare-label", text: t("compareTitle") });

		const tabs = card.createDiv({ cls: "p-compare-tabs", attr: { role: "tablist" } });
		for (const c of cmp.candidates) {
			const isRunning = this.running?.id === c.id;
			const tab = tabs.createEl("button", {
				cls: `pb pb-tab p-compare-tab${c.id === active.id ? " is-active" : ""}`,
				text: abbreviateModel(c.model) + (isRunning ? " …" : ""),
				attr: { role: "tab", "aria-selected": String(c.id === active.id) },
			});
			tab.addEventListener("click", () => { this.activeId = c.id; this.render(); });
		}

		const body = card.createDiv({ cls: "p-compare-body p-ai-body" });
		if (this.running?.id === active.id) {
			body.addClass("pythia-streaming");
			body.appendChild(this.running.textNode);
		} else {
			this.d.renderMarkdown(active.content, body);
		}

		const meta = card.createDiv({ cls: "p-compare-meta" });
		const parts = [abbreviateModel(active.model).toUpperCase(), formatClockTime(active.timestamp)];
		if (active.tokenUsage) {
			parts.push(`↑${active.tokenUsage.inputTokens} ↓${active.tokenUsage.outputTokens}`);
			const cost = this.d.plugin.settings.showCost ? estimateCost(active.model, active.tokenUsage) : null;
			if (cost !== null) parts.push(`≈ ${formatCost(cost)}`);
		}
		meta.setText(parts.filter(Boolean).join(" · "));

		const actions = card.createDiv({ cls: "p-compare-actions" });
		const running = this.running !== null;
		const keepBtn = actions.createEl("button", { cls: "pb pb-primary p-compare-keep", text: t("compareKeep") });
		keepBtn.disabled = running;
		keepBtn.addEventListener("click", () => void this.keep(active.id));
		const addBtn = actions.createEl("button", { cls: "pb pb-secondary p-compare-add", text: t("compareAddModel") });
		addBtn.disabled = running;
		addBtn.addEventListener("click", () => this.pickModel());
		const discardBtn = actions.createEl("button", { cls: "pb pb-quiet p-compare-discard", text: t("compareDiscard") });
		discardBtn.disabled = running;
		discardBtn.addEventListener("click", () => void this.discard());
	}

	/** Keep `candidateId` as the assistant turn; fork the rest. */
	async keep(candidateId: string): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv || this.running) return;
		const result = keepCandidate(conv, candidateId);
		if (!result) return;
		for (const spec of result.forks) {
			await this.d.plugin.conversationService.createComparisonFork(conv, spec);
		}
		await this.d.plugin.conversationStore.save(conv);
		this.cardEl = null;
		this.activeId = null;
		this.d.rerender();
		new Notice(t("compareKept", { model: abbreviateModel(result.kept.model ?? ""), n: String(result.forks.length) }));
	}

	/** Put the original answer back. */
	async discard(): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv || this.running) return;
		if (!cancelComparison(conv)) return;
		await this.d.plugin.conversationStore.save(conv);
		this.cardEl = null;
		this.activeId = null;
		this.d.rerender();
		new Notice(t("compareDiscarded"));
	}
}
