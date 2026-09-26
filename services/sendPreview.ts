import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import type { PythiaSettings } from "../models/settings";
import { getObsidianLocale } from "../i18n";
import { resolveLanguageLabel } from "./messageUtils";
import { buildSystemPrompt } from "./ContextBuilder";

/** The system prompt as the next send builds it, before notes and web results
 *  join it — the ONE preview, shared by the context box's token estimate and
 *  the "What Pythia sends" dialog (ADR-232). The language directive is part of
 *  what is really sent, so it is included (ADR-148). */
export function previewSystemPrompt(
	conv: Conversation,
	settings: Pick<PythiaSettings, "customInstructions" | "outputLanguage">,
): string {
	return buildSystemPrompt(conv, settings.customInstructions, {
		languageLabel: resolveLanguageLabel(conv.outputLanguage ?? settings.outputLanguage, getObsidianLocale()),
	});
}

/** Back to the whole history: the resume mode and its boundary both go, so no
 *  later resume point is half-remembered (ADR-231). */
export async function sendFullHistory(conv: Conversation, plugin: Pick<PythiaPlugin, "conversationStore">): Promise<void> {
	conv.resumeMode = "full";
	delete conv.resumedAfterId;
	await plugin.conversationStore.save(conv);
}
