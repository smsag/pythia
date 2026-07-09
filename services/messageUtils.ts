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

/**
 * Selects which prior messages to send to the API for a given resume mode.
 *
 * `"summary"` relies entirely on `summaryText` already injected into the
 * system prompt (see `ContextBuilder.buildSystemPrompt`) — sending the full
 * transcript on top of it would double-bill the same context and dilute the
 * model's attention. `"full"` (the default) sends everything, unchanged.
 */
export function selectHistoryForSend<T>(
	messages: T[],
	resumeMode: "full" | "summary" | undefined
): T[] {
	return resumeMode === "summary" ? [] : messages;
}

// ── Token estimation ─────────────────────────────────────────────────────────

/** Estimate token count from a file size in bytes (4 bytes ≈ 1 token). */
export function estimateTokensFromBytes(sizeBytes: number): string {
	const n = Math.round(sizeBytes / 4);
	return n >= 1000 ? `~${(n / 1000).toFixed(1)}k` : `~${n}`;
}

/** Estimate token count from a text string (4 characters ≈ 1 token for Latin;
 *  conservative — multibyte scripts produce larger byte counts so actual token
 *  cost will be higher than this estimate). */
export function estimateTokensFromText(text: string): number {
	return Math.round(text.length / 4);
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
