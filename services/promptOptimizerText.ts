/**
 * Pure text helpers for the prompt optimizer (no Obsidian dependency, so they're
 * unit-testable directly). See PromptOptimizerService for how they're used.
 */

/**
 * Appended to every optimizer request so the model returns ONLY the rewritten
 * prompt — the result is dropped straight into the input box (ADR-093), so any
 * preamble ("Sure! Here's…"), sign-off, or explanation is noise. Appended to the
 * user message (not sent as a system role) so it also works on models whose
 * utility path rejects a system message (e.g. OpenAI reasoning models).
 */
export const OUTPUT_ONLY_INSTRUCTION =
	"IMPORTANT — output ONLY the rewritten prompt itself, exactly as it should appear in the input box. " +
	"Do not add any preamble, sign-off, or explanation of what you changed; " +
	"do not open with phrases like \"Sure\", \"Certainly\", \"Of course\", or \"Here is/Here's\"; " +
	"do not close with a summary sentence; " +
	"do not wrap the prompt in quotes, code fences, or horizontal rules (---). " +
	"Return nothing but the prompt text.";

/**
 * Deterministic safety net for the optimizer output: even with
 * OUTPUT_ONLY_INSTRUCTION a chatty model can still wrap the prompt. Unwraps a
 * surrounding code fence, drops a single leading conversational preamble line
 * ("Sure! …:" — an optimized prompt never opens this way, so this is safe), and
 * strips leading/trailing standalone horizontal rules. Pure — unit-tested.
 */
export function cleanOptimizedOutput(text: string): string {
	let out = (text ?? "").trim();
	// Unwrap a surrounding ``` code fence.
	const fence = out.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
	if (fence) out = fence[1].trim();
	// Drop a leading conversational preamble line (must start with a known opener
	// AND end in a colon, so real prompt content is never removed).
	out = out.replace(/^(?:sure|certainly|of course|absolutely|great|here(?:'s| is))[^\n]*:[ \t]*(?:\n|$)/i, "").trim();
	// Strip leading/trailing standalone horizontal rules the model may still add.
	out = out
		.replace(/^(?:[-*_]{3,})[ \t]*(?:\n|$)/, "")
		.replace(/(?:\n|^)[ \t]*(?:[-*_]{3,})[ \t]*$/, "")
		.trim();
	return out;
}
