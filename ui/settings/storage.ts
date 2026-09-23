import { renderConversationCapSetting } from "../conversationCapSetting";
import { folderRow, numberRow, section, toggleRow, type SettingsContext } from "./context";
import { t } from "../../i18n";

/**
 * History and storage (ADR-206): how many conversations Pythia keeps, where their
 * notes go, and what that costs.
 *
 * The order is the story the section tells — where conversations are kept, the two
 * caps, and then what happens when a cap bites. The archive folder sits directly
 * under the toggle that writes to it rather than in a folder section elsewhere
 * (ADR-172: archiving happens before the delete, and the folder is part of that
 * rule, not a filing preference).
 *
 * The conversations folder is one of the vault index's two skip folders, so it
 * repaints the index status row (#367).
 */
export function renderStorageSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	section(containerEl, t("storageSection"), t("storageIntro"));
	const { plugin } = ctx;

	folderRow(ctx, containerEl, t("convsFolderName"), t("convsFolderDesc"), "conversationsFolder", ctx.refreshIndexStatus);

	numberRow(ctx, containerEl, t("messageCapName"), t("messageCapDesc"), {
		// Empty = no limit, the same convention as the conversation cap (ADR-172).
		placeholder: t("noLimitPlaceholder"),
		rule: { min: 0, allowEmpty: true },
		read: () => (plugin.settings.maxMessagesPerSession > 0 ? plugin.settings.maxMessagesPerSession : undefined),
		write: (n) => { plugin.settings.maxMessagesPerSession = n ?? 0; ctx.saveSoon(); },
	});

	// The history limit owns its own confirm dialog and the data.json size readout.
	renderConversationCapSetting(containerEl, plugin, {
		register: ctx.registerCommit,
		saveSoon: ctx.saveSoon,
	});

	toggleRow(ctx, containerEl, t("archiveBeforeEvictionName"), t("archiveBeforeEvictionDesc"), "archiveBeforeEviction");
	folderRow(ctx, containerEl, t("archiveFolderName"), t("archiveFolderDesc"), "archiveFolder");
}
