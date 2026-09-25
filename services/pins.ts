import type { Conversation, Pin, PinKind } from "../models/types";

/**
 * The rules for pinning answer content (ADR-216). Pure: the view decides where a
 * pin comes from, this decides whether it may be added and what it is called.
 */

/** At most this many pins per conversation. A sixth is refused, never rotated in. */
export const PIN_LIMIT = 5;
/** At most this many characters per pin. Longer is refused, never truncated: a
 *  half code block is worse than none. data.json is rewritten on every save, so
 *  pins are bytes every conversation carries (ADR-174). */
export const PIN_MAX_CHARS = 20_000;

export type PinRefusal = { reason: "limit"; limit: number } | { reason: "tooLong"; chars: number; max: number } | { reason: "empty" };

/** What to pin: everything but the id and date, which `addPin` assigns. */
export type PinDraft = Pick<Pin, "messageId" | "kind" | "source" | "occurrenceIndex">;

/**
 * Add a pin to the conversation, or say why not. Pinning the same thing twice
 * (same message, kind, source and occurrence) returns the existing pin rather
 * than a duplicate — a second press is not a second pin.
 */
export function addPin(conv: Conversation, draft: PinDraft, id: string, createdAt: string): Pin | PinRefusal {
	if (!draft.source.trim()) return { reason: "empty" };
	const existing = (conv.pins ?? []).find((p) =>
		p.messageId === draft.messageId && p.kind === draft.kind && p.source === draft.source && p.occurrenceIndex === draft.occurrenceIndex);
	if (existing) return existing;
	if (draft.source.length > PIN_MAX_CHARS) return { reason: "tooLong", chars: draft.source.length, max: PIN_MAX_CHARS };
	if ((conv.pins?.length ?? 0) >= PIN_LIMIT) return { reason: "limit", limit: PIN_LIMIT };
	const pin: Pin = { id, messageId: draft.messageId, kind: draft.kind, source: draft.source, createdAt };
	if (draft.occurrenceIndex !== undefined) pin.occurrenceIndex = draft.occurrenceIndex;
	conv.pins = [...(conv.pins ?? []), pin];
	return pin;
}

export function isRefusal(r: Pin | PinRefusal): r is PinRefusal {
	return "reason" in r;
}

/** Remove a pin; an emptied list is dropped, so the field stays absent. */
export function removePin(conv: Conversation, id: string): void {
	const pins = (conv.pins ?? []).filter((p) => p.id !== id);
	if (pins.length > 0) conv.pins = pins;
	else delete conv.pins;
}

/**
 * One line that says which pin this is, for the collapsed strip: the first line
 * of a text pin, the first line of CODE (not the fence) of a code or diagram
 * block, the title of a chart, the header row of a table.
 */
export function pinExcerpt(kind: PinKind, source: string, max = 80): string {
	const lines = source.split("\n").map((l) => l.trim());
	let line: string;
	if (kind === "code" || kind === "diagram") {
		line = lines.find((l, i) => i > 0 && l && !l.startsWith("```")) ?? "";
	} else if (kind === "chart") {
		const title = /"title"\s*:\s*"([^"]*)"/.exec(source)?.[1];
		line = title ?? "";
	} else if (kind === "table") {
		// Cells are split on UNESCAPED pipes and shown unescaped: `tableMarkdown`
		// backslash-escapes what Markdown would read as syntax, and the strip shows
		// text, not source.
		line = (lines.find((l) => l.startsWith("|")) ?? "")
			.replace(/^\||(?<!\\)\|$/g, "")
			.split(/(?<!\\)\|/)
			.map((c) => c.trim().replace(/\\(.)/g, "$1"))
			.filter(Boolean)
			.join(" · ");
	} else {
		line = lines.find((l) => l) ?? "";
	}
	return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
