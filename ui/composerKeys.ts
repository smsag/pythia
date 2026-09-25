import type { Modifier, Scope } from "obsidian";
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

interface ComposerSendDeps {
	/** The composer's editable element — undefined until the view has built its UI. */
	input: () => HTMLElement | undefined;
	/** The `#` picker's keys, which win while its dropdown is open. */
	suggest: (e: KeyboardEvent) => boolean;
	send: () => void;
}

/**
 * The composer's send shortcut, from both of the places a key press arrives.
 *
 * Obsidian's keymap sees Cmd/Ctrl+Enter before the textarea, where a core hotkey
 * on Mod+Enter (open link in new tab, which runs against the last active
 * editor) can consume it. So the view's own scope — consulted before the app's
 * hotkeys — handles it while the composer has focus. The textarea's keydown
 * stays as the path when the keymap is not involved, and skips the event the
 * scope already sent, so one press never sends twice.
 */
export class ComposerSend {
	private scoped: KeyboardEvent | null = null;

	constructor(private readonly d: ComposerSendDeps) {}

	registerOn(scope: Scope): void {
		for (const mods of [["Mod"], ["Ctrl"]] as Modifier[][]) {
			scope.register(mods, "Enter", (e) => {
				const input = this.d.input();
				if (!input || input.ownerDocument.activeElement !== input) return true; // not ours
				this.scoped = e;
				return !this.handle(e); // false = handled: Obsidian stops here
			});
		}
	}

	readonly onKeydown = (e: KeyboardEvent): void => {
		if (e !== this.scoped) this.handle(e);
	};

	/** The `#` picker first, then the rule above. True when the press was used. */
	private handle(e: KeyboardEvent): boolean {
		if (this.d.suggest(e)) return true;
		if (composerKeyAction(e) !== "send") return false; // Enter is a line break (ADR-175)
		e.preventDefault();
		this.d.send();
		return true;
	}
}
