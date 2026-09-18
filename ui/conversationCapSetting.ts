import { Setting, TextComponent } from "obsidian";
import type PythiaPlugin from "../main";
import { archiveFolderOf } from "../services/conversationArchive";
import { ConversationCapModal } from "../suggest/ConversationCapModal";
import { bindNumberSetting } from "./numberSetting";
import { formatBytes, storageLevel } from "../services/storageSize";
import { t } from "../i18n";

/**
 * The conversation history limit, the one settings field whose value removes
 * content (ADR-171/172). It owns three rules the rest of the settings tab does
 * not need to know about:
 *
 * 1. **Empty is "no limit".** `maxConversations === 0` is the stored form; the
 *    field shows an empty box for it. A number the user has to know means
 *    "unlimited" is a magic value — `capFieldValue` and the `read` below are the
 *    only two places the two representations meet.
 * 2. **A value that would evict asks first**, naming the count and whether the
 *    conversations are archived to the vault or deleted.
 * 3. **Cancel restores the stored limit** in the field, so a dismissed dialog
 *    never leaves a number on screen that is not in force.
 */

/** The cap as the field shows it: an empty box is "no limit". */
export function capFieldValue(cap: number): string {
	return cap > 0 ? String(cap) : "";
}

export interface CapSettingDeps {
	/** Hand the field's commit function to the tab, which flushes it on close. */
	register: (commit: () => void) => void;
	saveSoon: () => void;
}

export function renderConversationCapSetting(
	containerEl: HTMLElement,
	plugin: PythiaPlugin,
	deps: CapSettingDeps,
): void {
	const setting = new Setting(containerEl)
		.setName(t("maxConversationsName"))
		.setDesc(t("maxConversationsDesc"))
		.addText((text) => {
			text.setPlaceholder(t("noLimitPlaceholder"));
			deps.register(bindNumberSetting(text, {
				rule: { min: 0, allowEmpty: true },
				read: () => (plugin.settings.maxConversations > 0 ? plugin.settings.maxConversations : undefined),
				write: (n) => applyCap(plugin, deps, n ?? 0, text),
			}));
		});

	renderStorageReadout(setting, plugin);
}

/**
 * What the limit is actually for, in the one number nothing else shows: the size
 * of `data.json` (ADR-174). Pythia rewrites the whole file after every message,
 * so this — not the conversation count — is what decides when the design starts
 * to hurt. Always shown; it turns into a warning past `STORAGE_WARN_BYTES`.
 *
 * `stat` is async and the settings tab renders synchronously, so the line is
 * appended when the answer arrives. A size that cannot be read prints nothing
 * rather than a zero: an invented number here would be read as reassurance.
 */
function renderStorageReadout(setting: Setting, plugin: PythiaPlugin): void {
	void (async () => {
		const bytes = await plugin.pluginDataStore.dataFileBytes();
		if (bytes === null || !setting.descEl.isConnected) return;
		const level = storageLevel(bytes);
		const vars = { size: formatBytes(bytes), count: String(plugin.conversations.length) };
		setting.descEl.createDiv({
			cls: level === "ok" ? "pythia-storage-line" : "pythia-storage-line mod-warning",
			text: level === "ok" ? t("storageSizeLine", vars) : t("storageWarnLine", vars),
		});
	})();
}

function applyCap(plugin: PythiaPlugin, deps: CapSettingDeps, cap: number, text: TextComponent): void {
	const doomed = plugin.pendingEvictionCount(cap);
	const store = (): void => { plugin.settings.maxConversations = cap; };
	if (doomed === 0) {
		store();
		deps.saveSoon();
		text.setValue(capFieldValue(cap));
		return;
	}
	const folder = plugin.settings.archiveBeforeEviction ? archiveFolderOf(plugin.settings) : null;
	new ConversationCapModal(
		plugin.app,
		doomed,
		cap,
		folder,
		() => {
			store();
			text.setValue(capFieldValue(cap));
			// saveConversations is the only save that applies the cap.
			void plugin.saveConversations();
		},
		() => text.setValue(capFieldValue(plugin.settings.maxConversations)),
	).open();
}
