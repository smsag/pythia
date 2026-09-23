import { Setting, TFolder, type TextComponent } from "obsidian";
import type PythiaPlugin from "../../main";
import type { PythiaSettings } from "../../models/settings";
import { FolderSuggestModal } from "../../suggest/FolderSuggest";
import { bindNumberSetting, type NumberRule } from "../numberSetting";
import { section, overridable } from "./section";
import { t } from "../../i18n";

// The section grammar lives in ./section.ts so the embedding block can use it
// without pulling these plugin-bound helpers in; re-exported so a section module
// imports everything it needs from one place (ADR-209).
export { section, overridable };

/**
 * What every settings section is handed (ADR-209).
 *
 * The tab used to be one 528-line `display()`; it is now a shell that calls one
 * `render*Section` per section in order, and this is the only thing they share.
 * Three of the four fields exist because a section cannot reach the tab:
 *
 * - `saveSoon` — a typed field saves a beat after the last keystroke, because
 *   every save rewrites the whole data.json. Toggles and dropdowns save at once.
 * - `registerCommit` — a numeric field commits on blur (ADR-171), and closing the
 *   tab destroys the input before `blur` fires, so the tab flushes them itself.
 * - `refreshIndexStatus` — **every control that changes what the vault index is
 *   an index OF repaints the status row** (#367). That is the indexed folders,
 *   the note cap and the embedding model (`ui/embeddingSettings.ts`) *and* the
 *   two skip folders — the conversations and default-notes pickers, which live in
 *   other sections. Before ADR-209 those two had no way to reach the row, and
 *   moving where conversations are stored left it reading "Ready" with the one
 *   non-destructive action greyed out.
 */
export interface SettingsContext {
	plugin: PythiaPlugin;
	saveSoon: () => void;
	registerCommit: (commit: () => void) => void;
	refreshIndexStatus: () => void;
}

/** The settings a folder picker can set. */
export type FolderSettingKey = "templatesFolder" | "conversationsFolder" | "scratchFolder" | "archiveFolder";

/** The settings a plain on/off toggle can flip. */
export type BooleanSettingKey = { [K in keyof PythiaSettings]-?: PythiaSettings[K] extends boolean ? K : never }[keyof PythiaSettings];

/** One boolean setting: name, description, the key it flips. */
export function toggleRow(
	ctx: SettingsContext,
	containerEl: HTMLElement,
	name: string,
	desc: string,
	key: BooleanSettingKey,
): Setting {
	return new Setting(containerEl)
		.setName(name)
		.setDesc(desc)
		.addToggle((toggle) =>
			toggle.setValue(ctx.plugin.settings[key]).onChange(async (value) => {
				ctx.plugin.settings[key] = value;
				await ctx.plugin.saveSettings();
			})
		);
}

/**
 * One folder picker, showing the stored path beside the button.
 *
 * `afterPick` is how a folder that is part of the vault-index scope repaints the
 * status row (#367) — the picker itself knows nothing about the index.
 */
export function folderRow(
	ctx: SettingsContext,
	containerEl: HTMLElement,
	name: string,
	desc: string,
	key: FolderSettingKey,
	afterPick?: () => void,
): void {
	// eslint-disable-next-line prefer-const -- forward reference: assigned after the Setting that closes over it
	let displayEl: HTMLSpanElement;

	const setting = new Setting(containerEl)
		.setName(name)
		.setDesc(desc)
		.addButton((btn) => {
			btn.setButtonText(t("chooseFolderBtn"))
				.setCta()
				.onClick(() => {
					new FolderSuggestModal(ctx.plugin.app, async (folder: TFolder) => {
						const path = folder.isRoot() ? "/" : folder.path;
						ctx.plugin.settings[key] = path;
						await ctx.plugin.saveSettings();
						displayEl.setText(path);
						afterPick?.();
					}).open();
				});
		});

	displayEl = setting.controlEl.createEl("span", {
		cls: "pythia-folder-display",
		text: ctx.plugin.settings[key] || "—",
	});
}

/**
 * One numeric field, committed on blur or Enter and flushed by the tab (ADR-171).
 *
 * `bindNumberSetting`'s two overloads split on `allowEmpty`, which a shared helper
 * cannot know at compile time — one runtime function, so it is bound through a
 * signature covering both and the caller's `rule` decides what an empty box means.
 */
const bindAnyNumber = bindNumberSetting as (
	text: TextComponent,
	opts: { rule: NumberRule; read: () => number | undefined; write: (value: number | undefined) => void },
) => () => void;

export function numberRow(
	ctx: SettingsContext,
	containerEl: HTMLElement,
	name: string,
	desc: string,
	opts: {
		placeholder: string;
		rule: NumberRule;
		read: () => number | undefined;
		write: (value: number | undefined) => void;
	},
): Setting {
	return new Setting(containerEl)
		.setName(name)
		.setDesc(desc)
		.addText((text) => {
			text.setPlaceholder(opts.placeholder);
			ctx.registerCommit(bindAnyNumber(text, opts));
		});
}
