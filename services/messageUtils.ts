/**
 * Shared utilities used by both LLM provider implementations.
 * Extracted from AnthropicService.ts and OpenAIProvider.ts (#6, #14).
 */

import { TITLE_MARKER, SUMMARY_MARKER, DEFINITION_MARKER, VARIANTS_MARKER } from "./promptConstants";
import type { PythiaSettings } from "../models/settings";
import type { Conversation } from "../models/types";
import { redactSecrets } from "./redact";

// ── Debug logging ─────────────────────────────────────────────────────────────

/** Verbose diagnostic trace, gated on the debugMode setting. Genuine errors should
 *  use console.warn/error directly instead — this is for opt-in noise only.
 *  String args are run through `redactSecrets` as a defense-in-depth net so a
 *  key can never reach the console via a stray debug line (object args, which
 *  the provider call-sites use, carry only metadata — never a key). */
export function debugLog(settings: PythiaSettings, ...args: unknown[]): void {
	if (settings.debugMode) {
		// eslint-disable-next-line no-console
		console.log("[Pythia]", ...args.map((a) => (typeof a === "string" ? redactSecrets(a) : a)));
	}
}

// ── Summary parsing ───────────────────────────────────────────────────────────

/**
 * Parses the structured TITLE / SUMMARY response produced by
 * `generateSummaryWithTitle`. Handles both same-line and next-line formats:
 *   TITLE: My Title
 *   SUMMARY: content here
 * or
 *   TITLE: My Title
 *   SUMMARY:
 *   content here
 */
export function parseTitleAndSummary(raw: string): { title: string; summary: string } {
	// Multiline anchors so ^ matches line boundaries, not just string start.
	const titleMatch   = raw.match(new RegExp(`^${TITLE_MARKER}:\\s*(.+)`, "im"));
	const summaryMatch = raw.match(new RegExp(`^${SUMMARY_MARKER}:\\s*([\\s\\S]*)`, "im"));
	const title   = titleMatch   ? titleMatch[1].trim()   : "";
	const summary = summaryMatch
		? summaryMatch[1].trim()
		// Fallback: strip the TITLE line and any SUMMARY: prefix that leaked through.
		: raw
			.replace(new RegExp(`^${TITLE_MARKER}:.*\\n?`, "im"), "")
			.replace(new RegExp(`^${SUMMARY_MARKER}:[ \\t]*`, "im"), "")
			.trim();
	return { title, summary };
}

// ── Glossary lookup parsing ───────────────────────────────────────────────────

/** Upper bound on stored variants. A term has a handful of real surface forms;
 *  a longer list means the model started inventing related words, and each one
 *  is a phrase that gets marked in every conversation. */
const MAX_VARIANTS = 8;

/**
 * Parses the structured DEFINITION / VARIANTS response produced by
 * `defineTerm` (ADR-136):
 *   DEFINITION:
 *   <two or three sentences>
 *   VARIANTS: Zählers | Zählern | counter
 *
 * Variants are separated by `|` because a surface form may contain spaces
 * ("sparse coding"). Commas are accepted as a fallback separator for the case
 * where the model ignores the format — but only when no `|` is present, so a
 * correctly formatted reply is never re-split.
 *
 * The definition falls back to the whole reply with the marker lines stripped:
 * a lookup that returns prose without markers is still a usable definition, and
 * losing it to a strict parser would be worse than losing the variants.
 */
export function parseDefinitionAndVariants(raw: string): { definition: string; variants: string[] } {
	const variantsMatch = raw.match(new RegExp(`^${VARIANTS_MARKER}:[ \\t]*(.*)$`, "im"));
	// Split at the variants line rather than matching up to it: with the `m` flag a
	// trailing `$` anchors to the first line break, which would truncate a
	// multi-paragraph definition to its opening sentence.
	const head = variantsMatch?.index ? raw.slice(0, variantsMatch.index) : raw;
	const defMatch = head.match(new RegExp(`^${DEFINITION_MARKER}:\\s*([\\s\\S]*)`, "im"));

	const definition = (defMatch ? defMatch[1] : head
		.replace(new RegExp(`^${DEFINITION_MARKER}:[ \\t]*`, "im"), "")
		.replace(new RegExp(`^${VARIANTS_MARKER}:.*$`, "im"), "")
	).trim();

	const rawList = variantsMatch ? variantsMatch[1].trim() : "";
	const pieces = rawList.includes("|") ? rawList.split("|") : rawList.split(",");
	const seen = new Set<string>();
	const variants: string[] = [];
	for (const piece of pieces) {
		// Strip the decoration models add around list items: bullets, quotes,
		// a trailing period, and the "(plural)" style annotations.
		const cleaned = piece
			.replace(/\([^)]*\)/g, " ")
			.replace(/^[\s\-\u2013\u2014*\u2022\u201c\u201d\u2018\u2019"']+/, "")
			.replace(/[\s.;:\u201c\u201d\u2018\u2019"']+$/, "")
			.trim();
		if (cleaned.length < 2 || cleaned.length > 60) continue;
		if (/^(none|keine|n\/a|-)$/i.test(cleaned)) continue;
		const key = cleaned.toLocaleLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		variants.push(cleaned);
		if (variants.length >= MAX_VARIANTS) break;
	}
	return { definition, variants };
}

// ── Message normalisation ─────────────────────────────────────────────────────

/**
 * Coalesces adjacent same-role messages (APIs reject consecutive identical roles)
 * and drops leading messages that fail `isInvalidFirst`.
 *
 * The predicate differs by provider:
 *   Anthropic — `role => role !== "user"`  (messages must start with "user")
 *   OpenAI    — `role => role === "assistant"` ("system" is allowed at position 0)
 */
export function normalizeMessages<T extends { role: string; content: string }>(
	messages: T[],
	isInvalidFirst: (role: string) => boolean
): T[] {
	const result: T[] = [];
	for (const msg of messages) {
		if (result.length > 0 && result[result.length - 1].role === msg.role) {
			result[result.length - 1].content += "\n\n" + msg.content;
		} else {
			result.push({ ...msg } as T);
		}
	}
	while (result.length > 0 && isInvalidFirst(result[0].role)) {
		result.shift();
	}
	return result;
}

// ── History selection ─────────────────────────────────────────────────────────

/** How many recent messages to keep in hybrid resume mode — enough for the
 *  model to reference recent specifics (code, quotes, decisions) while the
 *  summary covers earlier context. 6 messages ≈ 3 user–assistant exchanges. */
const HYBRID_TAIL_COUNT = 6;

/**
 * Selects which prior messages to send to the API for a given resume mode.
 *
 * `"summary"` relies entirely on `summaryText` already injected into the
 * system prompt (see `ContextBuilder.buildSystemPrompt`) — sending the full
 * transcript on top of it would double-bill the same context and dilute the
 * model's attention. `"hybrid"` sends the summary (in the system prompt) plus
 * the last few messages so the model can still reference recent specifics.
 * `"full"` (the default) sends everything, unchanged.
 */
export function selectHistoryForSend<T>(
	messages: T[],
	resumeMode: "full" | "summary" | "hybrid" | undefined
): T[] {
	if (resumeMode === "summary") return [];
	if (resumeMode === "hybrid") return messages.slice(-HYBRID_TAIL_COUNT);
	return messages;
}

// ── Context window budget trimming ──────────────────────────────────────────

/**
 * Trims oldest messages from the front of `history` when the estimated total
 * tokens (system prompt + notes + history + output budget) would exceed
 * `contextWindow`. Returns a new array — never mutates the input.
 */
export function trimHistoryToBudget<T extends { content: string }>(
	history: T[],
	contextWindow: number,
	outputBudget: number,
	systemPromptTokens: number
): T[] {
	const available = contextWindow - outputBudget - systemPromptTokens;
	if (available <= 0) return history;

	let total = 0;
	for (const msg of history) total += estimateTokensFromText(msg.content);
	if (total <= available) return history;

	const trimmed = [...history];
	while (trimmed.length > 1 && total > available) {
		total -= estimateTokensFromText(trimmed[0].content);
		trimmed.shift();
	}
	return trimmed;
}

// ── Token estimation ─────────────────────────────────────────────────────────

/** Estimate token count from a file size in bytes (4 bytes ≈ 1 token). */
export function estimateTokensFromBytes(sizeBytes: number): string {
	const n = Math.round(sizeBytes / 4);
	return n >= 1000 ? `~${(n / 1000).toFixed(1)}k` : `~${n}`;
}

/** Format an ISO-8601 timestamp as a 24-hour clock label "HH:MM" for turn
 *  micro-labels (e.g. "14:31"). Locale-independent so the output is stable and
 *  testable; falls back to "" on an unparseable input. */
export function formatClockTime(iso: string | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	return `${hh}:${mm}`;
}

/** Absolute "12 Aug 2026 · 14:30"-style stamp for summary cards and the fork
 *  anchor meta line (localized). */
export function formatSummaryTimestamp(iso: string): string {
	const d = new Date(iso);
	const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
	const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	return `${date} · ${time}`;
}

/** Estimate token count from a text string. Uses a weighted heuristic: Latin
 *  characters average ~4 per token, but CJK/non-ASCII characters average ~1.5
 *  per token. Falls back to ÷4 for purely Latin text. */
/** The most recent message carrying token usage (the last completed assistant
 *  turn), or undefined when the conversation has none yet. Generic over the
 *  message shape so it stays free of the view's `Message` import. */
export function lastTokenUsageMessage<T extends { tokenUsage?: unknown }>(
	messages: readonly T[]
): T | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].tokenUsage) return messages[i];
	}
	return undefined;
}

export function estimateTokensFromText(text: string): number {
	if (text.length === 0) return 0;
	// eslint-disable-next-line no-control-regex
	const nonAscii = text.replace(/[\x00-\x7F]/g, "").length;
	const ascii = text.length - nonAscii;
	return Math.round(ascii / 4 + nonAscii / 1.5);
}

/** Buffer-free ArrayBuffer → base64 conversion — Node's Buffer is unavailable
 *  on Obsidian mobile (see main.ts's legacyDecrypt guard). Processes in chunks
 *  to avoid a call-stack overflow from String.fromCharCode(...hugeArray) on
 *  large files. */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	const CHUNK = 0x8000; // 32K — safe call-stack size for String.fromCharCode spread
	let binary = "";
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

// ── Output language helpers ───────────────────────────────────────────────────

/**
 * Maps ISO 639-1 locale codes (the stored setting value) to the English
 * language name used in LLM prompts.  Keeping these separate means UI label
 * translations never affect prompt content, and adding a language is one line.
 */
export const LANG_LABELS: Record<string, string> = {
	en: "English",
	de: "German",
};

/** Returns "\n\nRespond in <Language>." for a known locale code, or "" for auto. */
export function langInstruction(lang: string): string {
	const label = LANG_LABELS[lang];
	return label ? `\n\nRespond in ${label}.` : "";
}

/** Returns " in <Language>" for use inside format string placeholders, or "" for auto. */
export function langSuffix(lang: string): string {
	const label = LANG_LABELS[lang];
	return label ? ` in ${label}` : "";
}

// ── Favorites digest ────────────────────────────────────────────────────────────

/**
 * Build the text a favorites-summary LLM call summarizes. Favorites are the spans
 * the user hand-picked as the conversation's most important insights.
 *
 * Each favorite becomes a block pairing the question that prompted the insight
 * (the nearest preceding user turn, by `chapterName ?? content`) with the insight
 * itself (`fav.text`, or the whole message content for legacy message-level
 * favorites that carry no span). Blocks are ordered by their message's position in
 * the conversation so the digest follows the conversation's flow; favorites whose
 * `messageId` no longer resolves are skipped. Returns "" when nothing usable
 * remains — the caller uses that to skip the LLM call entirely.
 */
export function buildFavoritesDigest(conversation: Conversation): string {
	const favorites = conversation.favorites ?? [];
	if (favorites.length === 0) return "";

	const msgIndex = new Map(conversation.messages.map((m, i) => [m.id, i]));

	const usable = favorites
		.filter((f) => msgIndex.has(f.messageId))
		.sort((a, b) => (msgIndex.get(a.messageId)! - msgIndex.get(b.messageId)!));
	if (usable.length === 0) return "";

	const blocks = usable.map((fav, i) => {
		const idx = msgIndex.get(fav.messageId)!;
		const message = conversation.messages[idx];
		// Nearest preceding user turn gives the insight its question/context.
		let question = "";
		for (let j = idx; j >= 0; j--) {
			const m = conversation.messages[j];
			if (m.role === "user") {
				question = (m.chapterName ?? m.content).replace(/\s+/g, " ").trim();
				break;
			}
		}
		const insight = (fav.text ?? message.content).trim();
		const lines = [`## Highlight ${i + 1}`];
		if (question) lines.push(`Context (question): ${question}`);
		lines.push(`Insight: ${insight}`);
		return lines.join("\n");
	});

	return blocks.join("\n\n");
}

/**
 * Strip a redundant outer code fence. When the LLM has a syntax reference in
 * context it sometimes wraps the generated fence in a second, plain one (no
 * language tag); third-party markdown processors (e.g. Vizardry) then receive a
 * nested block they can't read. Removes only that exact shape — an unlabelled
 * fence whose entire body is a single labelled fence — so ordinary nested fences
 * in prose are left alone.
 *
 * Moved out of `sidebar.ts` (ADR-097 ratchet, ADR-130 session): pure string in,
 * pure string out, with no view state, so it belongs with the other message
 * helpers and is unit-testable on its own.
 */
export function unwrapCodeFence(text: string): string {
	return text.replace(
		/```[ \t]*\n(```[a-zA-Z][^\n]*\n[\s\S]*?\n[ \t]*```)[ \t]*\n[ \t]*```/g,
		"$1"
	);
}
