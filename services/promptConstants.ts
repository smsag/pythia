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

export const SYSTEM_PROMPT_TAG = "system_prompt";
export const PREVIOUS_SUMMARY_TAG = "previous_conversation_summary";
export const ATTACHED_NOTE_TAG = "attached_note";
export const ATTACHED_NOTE_PATH_ATTR = "path";
export const ATTACHED_NOTE_EXCERPT_ATTR = "excerpt";

export const TITLE_MARKER = "TITLE";
export const SUMMARY_MARKER = "SUMMARY";

/** Fallback max-output-tokens when a conversation has no explicit override. */
export const DEFAULT_MAX_TOKENS = 4096;
