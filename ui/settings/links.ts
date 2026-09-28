import { Setting } from "obsidian";
import { section, type SettingsContext } from "./context";
import { copyTextFromLabel } from "../clipboard";
import { pythiaLink } from "../../utils";
import { MAX_LINK_TEXT_CHARS } from "../../services/deepLink";
import { t } from "../../i18n";

/**
 * Links and shortcuts (ADR-241) — the links that open Pythia from outside
 * Obsidian, each one press away from the clipboard and ready to paste into a
 * macOS / iOS Shortcut's "Open URL" action.
 *
 * Its own section because no other remit covers it: nothing here is a setting,
 * it is how to reach the plugin, and it sits just before Troubleshooting so the
 * sections that govern answers stay together above it.
 *
 * The vault name is read when the tab renders, never stored: a renamed vault
 * gets the new name the next time the tab opens.
 */
export function renderLinksSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	section(containerEl, t("linksSection"), t("linksIntro"));
	const vault = ctx.plugin.app.vault.getName();
	linkRow(containerEl, t("linkOpenName"), t("linkOpenDesc"), pythiaLink(vault, "open"));
	linkRow(containerEl, t("linkNewName"), t("linkNewDesc"), pythiaLink(vault, "new"));
	linkRow(containerEl, t("linkAskName"), t("linkAskDesc", { max: MAX_LINK_TEXT_CHARS }), pythiaLink(vault, "ask"));
}

/** One link: what it does, the link itself (selectable), and a labelled
 *  "Copy link" button — a word, because an icon alone was easy to miss. */
function linkRow(containerEl: HTMLElement, name: string, desc: string, link: string): void {
	const row = new Setting(containerEl).setName(name).setDesc(desc);
	row.descEl.createDiv({ cls: "pythia-link-preview" }).createEl("code", { text: link });
	row.addButton((button) => {
		const label = t("linkCopyButton");
		button
			.setButtonText(label)
			.onClick(() => void copyTextFromLabel(button.buttonEl, link, label));
	});
}
