import { Editor, Notice } from "obsidian";
import type PythiaPlugin from "../main";
import type { EditorPos, RewriteTarget } from "../models/types";
import { TemplateSuggestModal } from "../suggest/TemplateSuggest";
import { RewritePresetModal, type RewriteChoice } from "../suggest/RewritePresetModal";
import { armPendingTemplate } from "../services/pendingTemplate";
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

	/**
	 * The passage as it is NOW: its text and its range, read together. Read
	 * apart — the text before a picker, the range after — they can disagree (a
	 * modal can collapse the editor's selection, on a phone above all), and the
	 * target would then be refused as stale at Replace in note.
	 */
	const captureTarget = (editor: Editor, path: string | undefined): RewriteTarget | null => {
		const text = editor.getSelection();
		const [range] = editor.listSelections();
		if (!path || !text || !range) return null;
		// Selections are reported anchor-first, which is backwards when dragged
		// upward; the range must be ordered before it can be verified or replaced.
		const [from, to] = orderPositions(range.anchor, range.head);
		return { path, from, to, text };
	};

	// Selection → the target of a rewrite in the conversation already open.
	const armRewrite = async (target: RewriteTarget): Promise<void> => {
		const view = await plugin.activateView();
		await view.rewrite.arm(target);
	};

	/**
	 * A preset arms the target AND sends at once (ADR-247): the instruction is the
	 * preset's, a template preset rides as a one-send layer (ADR-177). The answer
	 * is still a proposal — Replace in note stays its own press, one undo step.
	 * With no conversation open, one is made: a preset has nothing to discuss.
	 * Refused, before anything is armed, while the view cannot send; sent with
	 * `sendText`, which leaves the user's draft in the composer.
	 */
	const rewriteWith = async (target: RewriteTarget, choice: RewriteChoice): Promise<void> => {
		if (choice.kind === "own") { await armRewrite(target); return; }
		const view = await plugin.activateView();
		if (view.sendBlocked) { new Notice(t("rewritePresetBusy")); return; }
		let conv = view.getActiveConversation();
		if (!conv) {
			conv = await plugin.createConversation({ name: `Conversation ${todayISO()}` });
			await view.setActiveConversation(conv);
		}
		if (choice.kind === "template") conv.pendingTemplate = armPendingTemplate(choice.template);
		await view.rewrite.arm(target, { sending: true }); // saves the conversation
		view.refreshInstructions();
		await view.sendText(choice.kind === "preset"
			? choice.preset.instruction()
			: choice.template.autoPrompt ?? t("rewritePresetTemplateDo"));
	};

	const pickRewrite = async (target: RewriteTarget): Promise<void> => {
		const templates = await plugin.templateLoader.loadTemplates();
		new RewritePresetModal(plugin.app, templates, (choice) => void rewriteWith(target, choice)).open();
	};

	plugin.addCommand({
		id: "rewrite-selection-as",
		name: t("rewriteSelectionAs"),
		icon: PYTHIA_ICON_ID,
		editorCallback: (editor, ctx) => {
			const target = captureTarget(editor, ctx.file?.path);
			if (target) void pickRewrite(target);
		},
	});

	plugin.addCommand({
		id: "rewrite-selection",
		name: t("rewriteSelection"),
		icon: PYTHIA_ICON_ID,
		editorCallback: (editor, ctx) => {
			const target = captureTarget(editor, ctx.file?.path);
			if (target) void armRewrite(target);
		},
	});

	plugin.registerEvent(
		plugin.app.workspace.on("editor-menu", (menu, editor, ctx) => {
			// Captured as the menu opens, while the selection is certainly there.
			const target = captureTarget(editor, ctx.file?.path);
			if (!target) return;
			menu.addItem((item) => item
				.setTitle(t("rewriteSelection"))
				.setIcon(PYTHIA_ICON_ID)
				.onClick(() => void armRewrite(target)));
			menu.addItem((item) => item
				.setTitle(t("rewriteSelectionAs"))
				.setIcon(PYTHIA_ICON_ID)
				.onClick(() => void pickRewrite(target)));
		})
	);
}

function orderPositions(a: EditorPos, b: EditorPos): [EditorPos, EditorPos] {
	const aFirst = a.line === b.line ? a.ch <= b.ch : a.line < b.line;
	return aFirst ? [a, b] : [b, a];
}
