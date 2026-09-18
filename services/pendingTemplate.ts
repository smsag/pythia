import type { Conversation, PendingTemplate, PythiaTemplate } from "../models/types";

/**
 * A template applied to a conversation that is already running is a **one-shot**
 * (ADR-177): it shapes the next answer and is then gone.
 *
 * Applying used to write nine fields onto the conversation — prompt, provider,
 * model, max tokens, temperature, effort, resume mode, write mode, context
 * notes — permanently and with no record of what they were before. A template
 * meant as "do this one thing now" quietly became "run every later turn like
 * this", and a cheap model or a small token cap outlived the turn it was for.
 *
 * Nothing here is stored on the conversation. `applyPendingTemplate` layers the
 * snapshot over a clone for the duration of one send, which is engineering
 * principle 6 applied to a whole template rather than a single override.
 */

/** Snapshot what a template contributes to a turn, at the moment it is applied. */
export function armPendingTemplate(tpl: PythiaTemplate): PendingTemplate {
	return {
		id: tpl.id,
		name: tpl.name,
		systemPrompt: tpl.systemPrompt,
		provider: tpl.provider,
		model: tpl.model,
		maxTokens: tpl.maxTokens,
		temperature: tpl.temperature,
		effort: tpl.effort,
		writeMode: tpl.writeMode,
		outputFolder: tpl.outputFolder,
		contextNotes: tpl.contextNotes.length > 0 ? [...tpl.contextNotes] : undefined,
	};
}

/**
 * The conversation as this turn should be sent: the pending template's values
 * win, everything it does not set keeps the conversation's own.
 *
 * Returns the input unchanged when nothing is armed, and **never mutates** —
 * the clone shares `messages` (the provider only reads it) and is never saved.
 */
export function applyPendingTemplate(conv: Conversation): Conversation {
	const pending = conv.pendingTemplate;
	if (!pending) return conv;

	// Attached and template notes are one list for this turn, deduped, with the
	// conversation's own first — the user attached those deliberately.
	const notes = [...(conv.contextNotes ?? [])];
	for (const path of pending.contextNotes ?? []) {
		if (!notes.includes(path)) notes.push(path);
	}

	return {
		...conv,
		systemPrompt: pending.systemPrompt,
		// `templateId` is what the answer records and the sources row prints, so
		// the turn is attributed to the template that actually shaped it.
		templateId: pending.id,
		provider: pending.provider ?? conv.provider,
		model: pending.model ?? conv.model,
		maxTokens: pending.maxTokens ?? conv.maxTokens,
		temperature: pending.temperature ?? conv.temperature,
		effort: pending.effort ?? conv.effort,
		writeMode: pending.writeMode ?? conv.writeMode,
		outputFolder: pending.outputFolder ?? conv.outputFolder,
		contextNotes: notes,
	};
}
