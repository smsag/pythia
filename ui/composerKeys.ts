import { t } from "../i18n";

/**
 * What a key press in the composer means (ADR-175).
 *
 * **Enter writes a line break. Cmd/Ctrl+Enter sends.** A prompt is a draft —
 * paragraphs, a pasted list, a second thought before sending — and Enter-sends
 * made the most-pressed key in the textarea the irreversible one, with the
 * newline hidden behind a modifier nobody is told about twice.
 *
 * Pure so the rule can be tested without a DOM, and so there is one place that
 * knows it: the handler in `sidebar.ts` only wires it up.
 */
export interface ComposerKey {
	key: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	/** True while an IME is composing — its own Enter must reach the textarea. */
	isComposing?: boolean;
}

export function composerKeyAction(e: ComposerKey): "send" | "insert" {
	if (e.key !== "Enter") return "insert";
	if (e.isComposing === true) return "insert";
	return e.metaKey === true || e.ctrlKey === true ? "send" : "insert";
}

/** The textarea's placeholder. The shortcut is named only where one exists —
 *  on a phone there is no modifier key and the hint would be noise in a field
 *  two words wide. */
export function composerPlaceholder(isMobile: boolean): string {
	return isMobile ? t("inputPlaceholderMobile") : t("inputPlaceholder");
}
