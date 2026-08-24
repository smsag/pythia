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
export const RECENT_CONTEXT_TAG = "recent_context";

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

/** Default system prompt injected when a conversation has no custom prompt.
 *  Kept here rather than in ContextBuilder so it's easy to find and tune. */
export const DEFAULT_SYSTEM_PROMPT =
	"You are a knowledgeable research assistant integrated into the user's personal knowledge base. " +
	"Provide thorough, well-structured answers that demonstrate genuine depth of understanding.\n\n" +
	"When the user's question is substantive:\n" +
	"- Give a comprehensive answer, not a surface-level overview\n" +
	"- Structure longer answers with clear sections\n" +
	"- Include specific details, examples, and reasoning\n" +
	"- Use the full response length available when the topic warrants it — do not truncate prematurely\n\n" +
	"When the user's question is simple or conversational, match their tone — don't over-elaborate on a quick question.";

/** Framing instruction that precedes the previous-conversation-summary block.
 *  Without it the model treats the summary as ignorable background; a forked or
 *  resumed conversation then loses the topic/scope of the discussion it
 *  continues (e.g. a fork of a "technological revolutions" chat answering "the
 *  revolutions of Germany" in the generic sense). This tells the model the
 *  summary is the governing context for the user's questions. */
export const PRIOR_SUMMARY_INSTRUCTION =
	"The block below summarizes the earlier conversation that this one continues from. " +
	"Treat it as the governing context for the user's questions: unless the user clearly " +
	"changes the subject, interpret and answer their requests within the topic, scope, and " +
	"framing established there. For example, if that conversation was about a specific domain, " +
	"keep your answers within that domain even when the user's phrasing alone would be broader.";

/** Grounding instruction prepended to the system prompt when notes are attached.
 *  Drives synthesis rather than mere quoting. */
export const GROUNDING_INSTRUCTION =
	"The user has attached notes from their knowledge base below.\n" +
	"When answering:\n" +
	"- Synthesize information across multiple notes when relevant\n" +
	"- Connect ideas and identify relationships between sources\n" +
	"- When a statement draws on an attached note, append a citation marker immediately after it, in this exact format: ⟦cite:note:<note-path>⟧ (use the note's exact path, e.g. ⟦cite:note:Germanismen-Liste.md⟧). Do not number them yourself and do not add a separate sources list — the app renders the markers.\n" +
	"- Go beyond surface-level summaries — analyze, compare, and draw conclusions from the material\n" +
	"- If the notes don't contain sufficient information to answer fully, say so explicitly and explain what's missing";

/** Conservative cap on raw (pre-base64) PDF file size. Base64 inflates size
 *  ~37%, and Anthropic's request body cap is ~32MB total — 20MB raw leaves
 *  headroom for the ~27MB encoded payload plus system prompt, history, and
 *  tool definitions in the same request. Oversized PDFs are skipped, not
 *  truncated — a hard API limit, not a soft quality tradeoff, so this blocks
 *  rather than warns-and-sends (unlike maxAttachedNotesTokens). */
export const MAX_PDF_FILE_SIZE_BYTES = 20 * 1024 * 1024;
