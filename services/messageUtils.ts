/**
 * Shared utilities used by both LLM provider implementations.
 * Extracted from AnthropicService.ts and OpenAIProvider.ts (#6, #14).
 */

import { TITLE_MARKER, SUMMARY_MARKER } from "./promptConstants";
import type { PythiaSettings } from "../models/settings";

// ── Debug logging ─────────────────────────────────────────────────────────────

/** Verbose diagnostic trace, gated on the debugMode setting. Genuine errors should
 *  use console.warn/error directly instead — this is for opt-in noise only. */
export function debugLog(settings: PythiaSettings, ...args: unknown[]): void {
	if (settings.debugMode) {
		// eslint-disable-next-line no-console
		console.log("[Pythia]", ...args);
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

/** Estimate token count from a text string. Uses a weighted heuristic: Latin
 *  characters average ~4 per token, but CJK/non-ASCII characters average ~1.5
 *  per token. Falls back to ÷4 for purely Latin text. */
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
