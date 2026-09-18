import { Editor, Notice } from "obsidian";
import type PythiaPlugin from "../main";
import type { EditorPos } from "../models/types";
import { TemplateSuggestModal } from "../suggest/TemplateSuggest";
import { todayISO } from "../utils";
import { PYTHIA_ICON_ID } from "./pluginIcon";
import { t } from "../i18n";

/**
 * Everything you can do with a selection in the editor (ADR-178).
 *
 * Three entry points that read the same gesture — send it, send it through a
 * template, or rewrite it in place — so they live together rather than three
 * screens apart in `main.ts`, which is what let the first two drift into
 * near-copies of each other.
 */
export function registerEditorSelectionEntries(plugin: PythiaPlugin): void {
	const withSelection = (fn: (editor: Editor, selection: string) => void | Promise<void>) =>
		(editor: Editor): void => {
			const selection = editor.getSelection();
			if (selection) void fn(editor, selection);
		};

	// Selection → a new blank conversation, sent straight away.
	plugin.addCommand({
		id: "send-selection-to-pythia",
		name: t("sendSelectionToPythia"),
		icon: PYTHIA_ICON_ID,
		editorCallback: withSelection(async (_editor, selection) => {
			const conv = await plugin.createConversation({ name: `Conversation ${todayISO()}` });
			const view = await plugin.activateView();
			await view.setActiveConversation(conv);
			view.triggerAutoPrompt(selection);
		}),
	});

	// Selection → a new conversation shaped by a template, sent straight away.
	plugin.addCommand({
		id: "send-selection-to-pythia-with-template",
		name: t("sendSelectionToPythiaWithTemplate"),
		icon: PYTHIA_ICON_ID,
		editorCallback: withSelection(async (_editor, selection) => {
			const templates = await plugin.templateLoader.loadTemplates();
			if (templates.length === 0) {
				new Notice(t("noTemplatesFound", { folder: plugin.settings.templatesFolder }));
				return;
			}
			const activeFile = plugin.app.workspace.getActiveFile();
			new TemplateSuggestModal(plugin.app, templates, async (tpl) => {
				const { contextNotes, outputFolder } = plugin.conversationService.resolveTemplateContext(tpl, activeFile);
				const conv = await plugin.createConversationFromTemplate(tpl, contextNotes, outputFolder);
				const view = await plugin.activateView();
				await view.setActiveConversation(conv);
				view.triggerAutoPrompt(selection);
			}).open();
		}),
	});

	// Selection → the target of a rewrite in the conversation already open.
	const armRewrite = async (editor: Editor, selection: string, path: string | undefined): Promise<void> => {
		if (!path) return;
		const [range] = editor.listSelections();
		if (!range) return;
		// Selections are reported anchor-first, which is backwards when dragged
		// upward; the range must be ordered before it can be verified or replaced.
		const [from, to] = orderPositions(range.anchor, range.head);
		const view = await plugin.activateView();
		await view.rewrite.arm({ path, from, to, text: selection });
	};

	plugin.addCommand({
		id: "rewrite-selection",
		name: t("rewriteSelection"),
		icon: PYTHIA_ICON_ID,
		editorCallback: (editor, ctx) => {
			const selection = editor.getSelection();
			if (selection) void armRewrite(editor, selection, ctx.file?.path);
		},
	});

	plugin.registerEvent(
		plugin.app.workspace.on("editor-menu", (menu, editor, ctx) => {
			const selection = editor.getSelection();
			if (!selection) return;
			menu.addItem((item) => item
				.setTitle(t("rewriteSelection"))
				.setIcon(PYTHIA_ICON_ID)
				.onClick(() => void armRewrite(editor, selection, ctx.file?.path)));
		})
	);
}

function orderPositions(a: EditorPos, b: EditorPos): [EditorPos, EditorPos] {
	const aFirst = a.line === b.line ? a.ch <= b.ch : a.line < b.line;
	return aFirst ? [a, b] : [b, a];
}
