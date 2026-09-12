/**
 * Turn micro-labels (ADR-067/081/129).
 *
 * The mono 9px line above every message. User turns read `14:31` (with an
 * absolute date on the first turn of each new calendar day); assistant turns
 * read `SONNET 4.6 · 14:32 · ↑7.028 ↓125`, plus a template caption on the turn
 * where a template starts applying.
 *
 * Extracted from `sidebar.ts` under the ADR-097 ratchet. Everything here is a
 * pure function of (row, message, conversation) — no view state — which is what
 * makes the label rules unit-testable without mounting the view.
 */

import type { Conversation, Message, TokenUsage } from "../models/types";
import { formatClockTime } from "../services/messageUtils";
import { noteBasename } from "../services/pathUtils";
import { abbreviateModel } from "../models/knownModels";
import { t } from "../i18n";

/** Render the micro-label as the first child of a message row. No role captions
 *  (ADR-129) — the accent bubble vs. the plain body already tells the two apart.
 *  The model comes from the message (recorded at generation time) and falls back
 *  to the conversation's current model for legacy messages that predate the
 *  field; the template caption follows the same rule. */
export function renderTurnLabel(row: HTMLElement, msg: Message, conv: Conversation | null): void {
	const time = formatClockTime(msg.timestamp);
	const parts: string[] = [];
	let template: string | undefined;
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
		template = turnTemplateCaption(msg, conv);
		if (time) parts.push(time);
	}
	const label = row.createDiv({ cls: "p-turn-label", text: parts.join(" · ") });
	if (template) {
		// Its own span so it truncates independently of the rest of the label,
		// which must stay readable on a narrow sidebar.
		const name = noteBasename(template);
		label.createSpan({
			cls: "p-turn-template",
			text: ` · ${name.toUpperCase()}`,
			attr: { title: t("templateLabel", { name }) },
		});
	}
	if (msg.role === "assistant" && msg.tokenUsage) {
		appendTokensToTurnLabel(label, msg.tokenUsage);
	}
}

/** Append the input/output token counts inline to a turn label
 *  ("… · ↑7.028 ↓125"), replacing the old separate footer row. */
export function appendTokensToTurnLabel(label: HTMLElement, usage: TokenUsage): void {
	const fmt = (n: number) => n.toLocaleString();
	label.createSpan({
		cls: "p-turn-tokens",
		text: ` · ${t("tokenCount", { input: fmt(usage.inputTokens), output: fmt(usage.outputTokens) })}`,
		attr: { title: t("tokenCountTitle", { input: fmt(usage.inputTokens), output: fmt(usage.outputTokens) }) },
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

/** Absolute date for a turn label (`27 Aug 2026`, localized). Deliberately not
 *  the relative "Heute/Gestern" of `HistoryController.formatConvDate` — the label
 *  must stay correct when the conversation is reopened later. */
export function formatTurnDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
