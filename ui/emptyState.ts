import { setIcon } from "obsidian";
import { t } from "../i18n";

/**
 * The two empty surfaces of the chat area, as pure `(container) => void`
 * renderers: no view state, so they are unit-testable without mounting the
 * view (extracted from `sidebar.ts` under the ADR-097 ratchet).
 */

/** No conversation at all: the hint to start one from the palette. */
export function renderNoConversation(container: HTMLElement): void {
	const empty = container.createDiv({ cls: "pythia-empty" });
	empty.createEl("p", { text: t("noActiveConversationHint") });
	empty.createEl("p", { text: t("startFromPaletteHint"), cls: "pythia-empty-hint" });
}

/** Minimal centered welcome for an empty conversation (F6): accent sparkle,
 *  a heading, and three mono keycap hints. */
export function renderWelcome(container: HTMLElement): void {
	const wrap = container.createDiv({ cls: "p-welcome" });
	const spark = wrap.createDiv({ cls: "p-welcome-spark" });
	setIcon(spark, "sparkles");
	wrap.createDiv({ cls: "p-welcome-title", text: t("emptyHeading") });
	const hints = wrap.createDiv({ cls: "p-welcome-hints" });
	const addHint = (cap: string, label: string) => {
		const row = hints.createDiv({ cls: "p-welcome-hint" });
		row.createEl("span", { cls: "p-keycap", text: cap });
		row.createEl("span", { text: label });
	};
	addHint("#", t("emptyHintAttach"));
	addHint("⌘P", t("emptyHintCommands"));
	addHint("⇧↵", t("emptyHintNewline"));
}
