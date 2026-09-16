/**
 * Turn micro-labels (ADR-067/081/129).
 *
 * The mono 9px line above every message. User turns read `14:31` (with an
 * absolute date on the first turn of each new calendar day); assistant turns
 * read `SONNET 4.6 · 14:32 · ↑7.028 ↓125`. The template is NOT here — it rides
 * the sources row under the answer as a wikilink (ADR-140); `turnTemplateCaption`
 * still decides which turns show it.
 *
 * Extracted from `sidebar.ts` under the ADR-097 ratchet. Everything here is a
 * pure function of (row, message, conversation) — no view state — which is what
 * makes the label rules unit-testable without mounting the view.
 */

import type { Conversation, Message, TokenUsage } from "../models/types";
import { formatClockTime, formatDate } from "../services/messageUtils";
import { abbreviateModel } from "../models/knownModels";
import { estimateCost, formatCost, PRICING_AS_OF, type PriceOverrides } from "../models/modelPricing";
import { t } from "../i18n";

/** What a label may add beyond model and time. `showCost` is the user's
 *  setting; the model is needed to price the counts (ADR-163). */
export interface TurnLabelOptions { showCost?: boolean; priceOverrides?: PriceOverrides }

/** Render the micro-label as the first child of a message row. No role captions
 *  (ADR-129) — the accent bubble vs. the plain body already tells the two apart.
 *  The model comes from the message (recorded at generation time) and falls back
 *  to the conversation's current model for legacy messages that predate the
 *  field. */
export function renderTurnLabel(row: HTMLElement, msg: Message, conv: Conversation | null, opts: TurnLabelOptions = {}): void {
	const time = formatClockTime(msg.timestamp);
	const parts: string[] = [];
	if (msg.role === "user") {
		// Anchor the day: the first user turn of each new day (and the very first
		// message of the conversation) carries an absolute date, so time-only
		// labels stay unambiguous across multi-day conversations.
		if (isFirstMessageOfDay(msg, conv)) {
			const date = formatTurnDate(msg.timestamp);
			if (date) parts.push(date);
		}
		if (time) parts.push(time);
	} else {
		const model = msg.model ?? conv?.model;
		if (model) parts.push(abbreviateModel(model).toUpperCase());
		if (time) parts.push(time);
	}
	const label = row.createDiv({ cls: "p-turn-label", text: parts.join(" · ") });
	if (msg.role === "assistant" && msg.tokenUsage) {
		appendTokensToTurnLabel(label, msg.tokenUsage, opts.showCost ? (msg.model ?? conv?.model) : undefined, opts.priceOverrides);
	}
}

/** Append the input/output token counts inline to a turn label
 *  ("… · ↑7.028 ↓125"), replacing the old separate footer row. With
 *  `costModel` the estimated price follows ("… · ≈ $0.012", ADR-163); a model
 *  without a price row adds nothing rather than a wrong number. */
export function appendTokensToTurnLabel(label: HTMLElement, usage: TokenUsage, costModel?: string, overrides?: PriceOverrides): void {
	const fmt = (n: number) => n.toLocaleString();
	label.createSpan({
		cls: "p-turn-tokens",
		text: ` · ${t("tokenCount", { input: fmt(usage.inputTokens), output: fmt(usage.outputTokens) })}`,
		attr: { title: t("tokenCountTitle", { input: fmt(usage.inputTokens), output: fmt(usage.outputTokens) }) },
	});
	const cost = estimateCost(costModel, usage, overrides);
	if (cost === null) return;
	label.createSpan({
		cls: "p-turn-cost",
		text: ` · ≈ ${formatCost(cost)}`,
		attr: { title: t("costEstimateTitle", { date: PRICING_AS_OF }) },
	});
}

/** The template to caption an assistant turn with, or undefined when it would
 *  merely repeat the turn before it (ADR-129). A conversation's template is
 *  constant for most of its life, so captioning every answer would be noise —
 *  the caption marks the turn where a template *starts* applying: the first
 *  answer, and again wherever a second template takes over mid-conversation.
 *
 *  Legacy messages predate `Message.templateId` and fall back to the
 *  conversation's template on both sides of the comparison, so an old
 *  conversation still captions exactly its first answer. */
export function turnTemplateCaption(msg: Message, conv: Conversation | null): string | undefined {
	const convTemplate = conv?.templateId;
	const current = msg.templateId ?? convTemplate;
	if (!current) return undefined;
	const msgs = conv?.messages ?? [];
	// A streaming placeholder is not in the array yet (empty id) — every existing
	// message counts as "before" it.
	const idx = msg.id ? msgs.findIndex((m) => m.id === msg.id) : -1;
	const before = idx === -1 ? msgs : msgs.slice(0, idx);
	for (let i = before.length - 1; i >= 0; i--) {
		const prev = before[i];
		if (prev.role !== "assistant") continue;
		return (prev.templateId ?? convTemplate) === current ? undefined : current;
	}
	return current; // first assistant turn of the conversation
}

/** True when `msg` starts a new calendar day relative to the message before it
 *  (any role) — or is the first message of the conversation. Computed from the
 *  message array so it holds in both the full-rebuild and incremental-append
 *  render paths. */
export function isFirstMessageOfDay(msg: Message, conv: Conversation | null): boolean {
	const msgs = conv?.messages;
	if (!msgs) return false;
	const idx = msgs.findIndex((m) => m.id === msg.id);
	if (idx <= 0) return true; // first message (or not found) → anchor the date
	const dayKey = (iso: string): string | null => {
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? null
			: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
	};
	const cur = dayKey(msg.timestamp);
	const prev = dayKey(msgs[idx - 1].timestamp);
	if (cur === null || prev === null) return false; // no reliable date → no marker
	return cur !== prev;
}

/** Absolute date for a turn label (`27 Aug 2026`). Deliberately not the relative
 *  "Heute/Gestern" of `HistoryController.formatConvDate` — the label must stay
 *  correct when the conversation is reopened later. */
export function formatTurnDate(iso: string): string {
	return formatDate(iso);
}
