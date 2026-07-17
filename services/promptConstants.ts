/**
 * Shared literal contracts for prompt-shaped string construction.
 *
 * These values are referenced from more than one file, so a rename in one
 * place can otherwise silently desync from a hardcoded copy elsewhere:
 *   - the XML-ish wrapper tags are written by ContextBuilder.ts and referenced
 *     by name in ToolHandler.ts's tool-call descriptions (prose the LLM reads).
 *   - the TITLE/SUMMARY markers are written into the prompt by
 *     BaseProvider.generateSummaryWithTitle and read back by
 *     messageUtils.parseTitleAndSummary via regex.
 *
 * This module intentionally holds only cross-file literal contracts — it is
 * not a generic prompt-builder. Single-file duplication (e.g. the repeated
 * "reply with only the title" phrase inside BaseProvider.ts) stays local to
 * that file.
 */

import { isReasoningModel, isMistralReasoningModel } from "../models/knownModels";

export const SYSTEM_PROMPT_TAG = "system_prompt";
export const PREVIOUS_SUMMARY_TAG = "previous_conversation_summary";
export const ATTACHED_NOTE_TAG = "attached_note";
export const ATTACHED_NOTE_PATH_ATTR = "path";
export const ATTACHED_NOTE_EXCERPT_ATTR = "excerpt";

export const TITLE_MARKER = "TITLE";
export const SUMMARY_MARKER = "SUMMARY";

/** Fallback max-output-tokens when neither the conversation nor the global
 *  setting specifies one. */
export const DEFAULT_MAX_TOKENS = 8192;

/** Reasoning models (o-series) spend tokens from this same budget on internal
 *  reasoning before producing any visible output — too low a cap risks a
 *  silently truncated or empty reply, so these get a larger baseline. */
export const DEFAULT_MAX_TOKENS_REASONING = 16384;

export function resolveDefaultMaxTokens(model: string): number {
	return isReasoningModel(model) || isMistralReasoningModel(model)
		? DEFAULT_MAX_TOKENS_REASONING
		: DEFAULT_MAX_TOKENS;
}

/** Conservative cap on raw (pre-base64) PDF file size. Base64 inflates size
 *  ~37%, and Anthropic's request body cap is ~32MB total — 20MB raw leaves
 *  headroom for the ~27MB encoded payload plus system prompt, history, and
 *  tool definitions in the same request. Oversized PDFs are skipped, not
 *  truncated — a hard API limit, not a soft quality tradeoff, so this blocks
 *  rather than warns-and-sends (unlike maxAttachedNotesTokens). */
export const MAX_PDF_FILE_SIZE_BYTES = 20 * 1024 * 1024;
