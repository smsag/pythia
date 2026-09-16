import type { Conversation, EffortLevel, OutputLanguage } from "../models/types";
import { parameterSupport } from "../models/knownModels";
import { languageLabelForLocale } from "../services/messageUtils";

/**
 * What the header's instruction segments show (ADR-165): the reasoning effort
 * and the answer language this conversation is actually sent with.
 *
 * Pure so the resolution — conversation override → global setting → model
 * support — is tested once and read by the header, never re-derived there.
 * `pinned` is true only when the conversation stores its own value; an
 * inherited value is shown resolved but is never written back (principle 6).
 */

export interface EffortState {
	/** The level sent with the request; null when neither the conversation nor
	 *  the settings name one (the API's own default applies). */
	level: EffortLevel | null;
	/** The conversation stores its own level. */
	pinned: boolean;
	/** The model accepts an effort parameter at all. */
	supported: boolean;
}

export function resolveEffortState(
	conv: Pick<Conversation, "provider" | "model" | "effort">,
	globalEffort: EffortLevel | undefined,
): EffortState {
	const supported = parameterSupport(conv.provider, conv.model).effort;
	return {
		level: conv.effort ?? globalEffort ?? null,
		// A pinned value on a model that ignores it is kept for a later switch back,
		// but it is not an instruction now — so it is not shown as one.
		pinned: supported && conv.effort !== undefined,
		supported,
	};
}

export interface LanguageState {
	/** The setting in force: the conversation's override or the global value. */
	setting: OutputLanguage;
	/** Short label for the header: `DE`, `EN`, … or `AUTO`. */
	code: string;
	/** The conversation stores its own setting. */
	pinned: boolean;
	/** The model receives a language instruction; false only for `auto`. */
	instructed: boolean;
}

export function resolveLanguageState(
	convLanguage: OutputLanguage | undefined,
	globalLanguage: OutputLanguage,
	obsidianLocale: string,
): LanguageState {
	const setting = convLanguage ?? globalLanguage;
	const pinned = convLanguage !== undefined;
	if (setting === "auto") return { setting, code: "AUTO", pinned, instructed: false };
	return { setting, code: languageCode(setting, obsidianLocale), pinned, instructed: true };
}

/** `obsidian` resolves to the UI locale's language, falling back to English
 *  exactly as the prompt does (`resolveLanguageLabel`). */
function languageCode(setting: Exclude<OutputLanguage, "auto">, obsidianLocale: string): string {
	if (setting !== "obsidian") return setting.toUpperCase();
	const base = (obsidianLocale || "").toLowerCase().trim().split("-")[0];
	return base && languageLabelForLocale(obsidianLocale) ? base.toUpperCase() : "EN";
}
