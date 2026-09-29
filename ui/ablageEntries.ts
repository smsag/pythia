import { type Editor, Notice } from "obsidian";
import type PythiaPlugin from "../main";
import { ablagePreview } from "../services/ablage";
import { citationsToFootnotes } from "../services/noteFootnotes";
import { PYTHIA_ICON_ID } from "./pluginIcon";
import { t } from "../i18n";

/**
 * Where the Ablage is emptied (ADR-246): the editor's context menu, and a
 * command for a hotkey or a phone. Both insert at the cursor — replacing the
 * selection, if there is one — as ONE undo step, and empty the slot.
 */
export function registerAblageEntries(plugin: PythiaPlugin): void {
	plugin.addCommand({
		id: "insert-from-ablage",
		name: t("ablageInsert"),
		icon: PYTHIA_ICON_ID,
		editorCallback: (editor) => {
			const item = plugin.ablage.item;
			if (!item) { new Notice(t("ablageIsEmpty")); return; }
			void insertFromAblage(plugin, editor, item.createdAt);
		},
	});

	plugin.registerEvent(
		plugin.app.workspace.on("editor-menu", (menu, editor) => {
			const item = plugin.ablage.item;
			if (!item) return;
			// The menu names what it will insert, so a stale Ablage is never a surprise.
			menu.addItem((entry) => entry
				.setTitle(t("ablageInsertNamed", { preview: ablagePreview(item.text) }))
				.setIcon("clipboard-paste")
				.onClick(() => void insertFromAblage(plugin, editor, item.createdAt)));
		})
	);
}

/**
 * Insert the item the user was shown, never another: a put or an insert
 * elsewhere between the menu opening and the click changes `createdAt`, and
 * then nothing is inserted and the user is told why.
 *
 * The text goes in first, synchronously, then the slot is emptied — so an
 * await never stands between the check and the write (principle 7). Its web
 * citations become footnotes numbered around the note's own (ADR-238).
 */
export async function insertFromAblage(plugin: PythiaPlugin, editor: Editor, createdAt: string): Promise<void> {
	const item = plugin.ablage.item;
	if (!item || item.createdAt !== createdAt) { new Notice(t("ablageChanged")); return; }
	editor.replaceSelection(citationsToFootnotes(item.text, item.sources ?? [], editor.getValue()));
	await plugin.ablage.take(createdAt);
	new Notice(t("ablageInserted"));
}
