import { Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { ComparisonCandidate, Conversation, Message } from "../models/types";
import { abbreviateModel } from "../models/knownModels";
import { estimateCost, formatCost } from "../models/modelPricing";
import { t } from "../i18n";
import { formatClockTime, unwrapCodeFence } from "../services/messageUtils";
import { parseCitations, stripForeignCitations } from "../services/citations";
import { canSwitchAlternative, switchAlternative } from "../services/comparison";
import { paintCitations } from "./citationPainter";
import { renderSourcesRow } from "./sourcesRow";

export interface AnswerTabsDeps {
	plugin: PythiaPlugin;
	getConversation(): Conversation | null;
	isStreaming(): boolean;
	/** Render an answer's markdown into `el`, awaited — the tabs paint onto it. */
	renderAnswer(md: string, el: HTMLElement): Promise<void>;
	/** Code-block controls, favorites and merge links for an answer body, by the
	 *  id they were made on — the same painters the kept answer gets. */
	paintMarks(body: HTMLElement, id: string): void;
	/** Full rebuild of the message list (after a switch). */
	rerender(): void;
}

/** What the rows around a kept answer carry, hidden while another tab is shown:
 *  they belong to the kept answer, not to the one on screen. */
const KEPT_ONLY = ":scope > .p-sources, :scope > .p-note-write, :scope > .p-trunc, :scope > .p-rewrite";

/** A tab view → its render in flight, so a jump can wait for the marks. */
const rendered = new WeakMap<HTMLElement, Promise<void>>();

/**
 * The element an answer is drawn in, by id — a kept answer's row, or one of its
 * tabs, which is brought on screen first and awaited until its marks are
 * painted (ADR-223). Every jump to an answer (a favorite, a pin, a merge link,
 * a message) goes through this, or a jump to a tab not on screen finds nothing.
 * Null when no answer on screen has that id.
 */
export async function findAnswerEl(messagesEl: HTMLElement, id: string): Promise<HTMLElement | null> {
	const sel = `[data-msg-id="${CSS.escape(id)}"]`;
	const el = messagesEl.querySelector<HTMLElement>(sel);
	if (el) return el;
	const tab = messagesEl.querySelector<HTMLElement>(`.p-answer-tab[data-tab-id="${CSS.escape(id)}"]`);
	if (!tab) return null;
	tab.click();
	const view = messagesEl.querySelector<HTMLElement>(sel);
	if (view) await rendered.get(view);
	return view;
}

/**
 * The tabs a model comparison leaves on the answer it kept (ADR-219, revising
 * ADR-160's forks, which took the other answers out of sight).
 *
 * The kept tab comes first, marked with a check: it is the one the conversation
 * holds, the only one a model ever reads. Another tab shows that answer in place
 * — its text, citations, sources and marks — and, while this is still the last
 * answer, offers "Use this answer" (`switchAlternative`), the same last-answer
 * rule as Retry (ADR-162). Which tab is on screen is session state per answer,
 * never written.
 *
 * Drawn with the comparison card's own tab strip (`.p-compare-tabs`, `pb-tab`),
 * so an answer with tabs reads as the comparison it came from.
 */
export class AnswerTabsController {
	/** message id → the tab on screen, when it is not the kept one. */
	private readonly showing = new Map<string, string>();

	constructor(private readonly d: AnswerTabsDeps) {}

	/** Draw the strip above `aiBody` when `msg` has tabs. */
	paint(row: HTMLElement, aiBody: HTMLElement, msg: Message): void {
		const alternatives = msg.alternatives;
		if (msg.role !== "assistant" || !alternatives?.length) return;

		const strip = document.createElement("div");
		strip.className = "p-compare-tabs p-answer-tabs";
		strip.setAttribute("role", "tablist");
		aiBody.before(strip);
		const altView = document.createElement("div");
		altView.className = "p-answer-alt";
		altView.hidden = true;
		aiBody.after(altView);

		const tabs: { id: string; model: string; kept: boolean }[] = [
			{ id: msg.id, model: msg.model ?? "", kept: true },
			...alternatives.map((c) => ({ id: c.id, model: c.model, kept: false })),
		];
		const buttons = new Map<string, HTMLButtonElement>();
		for (const tab of tabs) {
			const btn = strip.createEl("button", {
				cls: `pb pb-tab p-compare-tab p-answer-tab${tab.kept ? " is-kept" : ""}`,
				attr: { role: "tab", "data-tab-id": tab.id, ...(tab.kept ? { "aria-current": "true", title: t("answerTabKept") } : {}) },
			});
			if (tab.kept) setIcon(btn.createSpan({ cls: "p-answer-tab-icon" }), "check");
			btn.appendText(abbreviateModel(tab.model));
			btn.addEventListener("click", () => select(tab.id));
			buttons.set(tab.id, btn);
		}

		const select = (id: string): void => {
			const alt = alternatives.find((c) => c.id === id);
			if (alt) this.showing.set(msg.id, id); else this.showing.delete(msg.id);
			for (const [tabId, btn] of buttons) {
				const on = tabId === (alt ? id : msg.id);
				btn.toggleClass("is-active", on);
				btn.setAttribute("aria-selected", String(on));
			}
			aiBody.hidden = !!alt;
			for (const el of Array.from(row.querySelectorAll<HTMLElement>(KEPT_ONLY))) el.hidden = !!alt;
			altView.hidden = !alt;
			altView.empty();
			// The tab on screen is found by its own id, like any answer: a selection
			// in it stars, links or pins THAT answer, and a jump can reach it (ADR-223).
			if (alt) altView.setAttribute("data-msg-id", alt.id); else altView.removeAttribute("data-msg-id");
			rendered.delete(altView);
			if (alt) this.renderAlternative(altView, msg, alt);
		};

		select(this.showing.get(msg.id) ?? msg.id);
	}

	private renderAlternative(view: HTMLElement, msg: Message, c: ComparisonCandidate): void {
		const app = this.d.plugin.app;
		const body = view.createDiv({ cls: "p-ai-body p-answer-alt-body" });
		const sources = c.sources ?? parseCitations(c.content);
		const done = this.d.renderAnswer(unwrapCodeFence(stripForeignCitations(c.content)), body).then(() => {
			this.d.paintMarks(body, c.id);
			paintCitations(app, body, sources);
		});
		rendered.set(view, done);
		void done;
		renderSourcesRow(app, view, sources);

		const parts = [abbreviateModel(c.model).toUpperCase(), c.timestamp ? formatClockTime(c.timestamp) : ""];
		if (c.tokenUsage) {
			parts.push(`↑${c.tokenUsage.inputTokens} ↓${c.tokenUsage.outputTokens}`);
			const usd = this.d.plugin.settings.showCost ? (c.cost?.usd ?? estimateCost(c.model, c.tokenUsage)) : null;
			if (usd !== null && usd !== undefined) parts.push(`≈ ${formatCost(usd)}`);
		}
		view.createDiv({ cls: "p-compare-meta p-answer-alt-meta", text: parts.filter(Boolean).join(" · ") });

		const conv = this.d.getConversation();
		if (!conv || this.d.isStreaming() || !canSwitchAlternative(conv, msg.id)) return;
		const use = view.createDiv({ cls: "p-compare-actions" }).createEl("button", {
			cls: "pb pb-secondary p-answer-use", text: t("answerTabUse"),
		});
		use.addEventListener("click", () => void this.use(msg.id, c));
	}

	/** Make `c` the answer the conversation holds (ADR-219). */
	private async use(messageId: string, c: ComparisonCandidate): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv || this.d.isStreaming()) return;
		if (!switchAlternative(conv, messageId, c.id)) {
			// The rule changed under the tap (a new turn, a comparison): say so.
			new Notice(t("answerTabSwitchRefused"));
			return;
		}
		this.showing.delete(messageId);
		await this.d.plugin.conversationStore.save(conv);
		this.d.rerender();
		new Notice(t("answerTabSwitched", { model: abbreviateModel(c.model) }));
	}
}
