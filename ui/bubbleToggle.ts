import { setIcon } from "obsidian";
import { t } from "../i18n";

/** Messages longer than this start collapsed, with a show-more toggle. */
export const LONG_BUBBLE_CHARS = 280;

/**
 * The show-more / show-less control under a long user message. Moved out of
 * `sidebar.ts` unchanged (ADR-097's ratchet, ADR-218's session). The bubble is
 * rebuilt on every render, so the listener dies with it.
 */
export function appendBubbleToggle(row: HTMLElement, bubble: HTMLElement): void {
	const toggle = row.createEl("button", {
		cls: "pb pb-icon p-bubble-toggle",
		attr: { title: t("showMore") },
	});
	setIcon(toggle, "chevron-down");
	toggle.addEventListener("click", () => {
		const collapsed = bubble.hasClass("p-bubble-collapsed");
		bubble.toggleClass("p-bubble-collapsed", !collapsed);
		bubble.toggleClass("p-bubble-expanded", collapsed);
		setIcon(toggle, collapsed ? "chevron-up" : "chevron-down");
		toggle.title = collapsed ? t("showLess") : t("showMore");
	});
}
