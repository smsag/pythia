import { MarkdownView, Notice, TFile, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation, Message, RewriteTarget } from "../models/types";
import { replaceRange, targetState } from "../services/rewriteTarget";
import { cleanOptimizedOutput } from "../services/promptOptimizerText";
import { t } from "../i18n";

export interface RewriteDeps {
	plugin: PythiaPlugin;
	getConversation(): Conversation | null;
	/** Put the caret back in the composer after arming — the next thing the user
	 *  does is say what to change. */
	focusInput(): void;
	/** Repaint the reference row, where the armed passage shows as a pill. */
	refreshPills(): void;
}

/**
 * Rewriting a passage of a note from the conversation (ADR-178).
 *
 * The user selects text in the editor, arms it, and keeps talking; an answer
 * produced while a target is armed is a *proposal*, and the card under it
 * writes it back over the captured range.
 *
 * Three rules, and they are the feature:
 *
 * 1. **The user chooses the target, not the model.** There is no tool for this.
 *    The range is captured from the editor at arming time, so nothing has to
 *    find the passage again — which is how the wrong paragraph gets overwritten.
 * 2. **Verify, then write.** `targetState` compares the range's current text
 *    with what was captured. Stale or gone means refuse and say so; the answer
 *    stays on screen to copy by hand.
 * 3. **The write is a separate, named action.** The answer arrives, nothing has
 *    changed in the note, and *Replace in note* is a distinct press —
 *    engineering principle: a write that can destroy content is its own step.
 */
export class RewriteController {
	constructor(private readonly d: RewriteDeps) {}

	async arm(target: RewriteTarget): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv) { new Notice(t("noActiveConvToSend")); return; }
		conv.pendingRewrite = target;
		await this.d.plugin.conversationStore.save(conv);
		this.d.refreshPills();
		this.d.focusInput();
		new Notice(t("rewriteArmed", { note: target.path }));
	}

	async disarm(): Promise<void> {
		const conv = this.d.getConversation();
		if (!conv?.pendingRewrite) return;
		conv.pendingRewrite = undefined;
		await this.d.plugin.conversationStore.save(conv);
		this.d.refreshPills();
	}

	/**
	 * The message actually sent while a target is armed: the instruction, the
	 * passage, and an order to return nothing but the replacement.
	 *
	 * The passage goes in the message rather than the system prompt so it stays
	 * in the history — a follow-up ("shorter") has to see what is being rewritten.
	 */
	decorate(text: string, conv: Conversation): string {
		const target = conv.pendingRewrite;
		if (!target) return text;
		const instruction = text.trim() || t("rewriteDefaultInstruction");
		return [
			instruction,
			"",
			`<rewrite_passage note="${target.path}">`,
			target.text,
			"</rewrite_passage>",
			"",
			t("rewriteOutputOnly"),
		].join("\n");
	}

	/** Record on the answer which passage it proposes to replace. */
	attach(conv: Conversation, msg: Message): void {
		if (conv.pendingRewrite) msg.rewriteTarget = { ...conv.pendingRewrite };
	}

	/** Paint (or repaint) the proposal card under an answer. */
	paint(row: HTMLElement, msg: Message): void {
		row.querySelector(".p-rewrite")?.remove();
		const target = msg.rewriteTarget;
		if (!target || msg.role !== "assistant" || !msg.content.trim()) return;

		const card = row.createDiv({ cls: "p-rewrite" });
		const head = card.createDiv({ cls: "p-rewrite-head" });
		setIcon(head.createSpan({ cls: "p-rewrite-icon" }), "pencil-line");
		head.createSpan({ cls: "p-rewrite-label", text: t("rewriteCardLabel") });
		card.createDiv({ cls: "p-rewrite-meta", text: target.path });

		const actions = card.createDiv({ cls: "p-rewrite-actions" });
		const replace = actions.createEl("button", { cls: "p-rewrite-btn", text: t("rewriteApply") });
		replace.addEventListener("click", () => void this.apply(msg, card));

		const copy = actions.createEl("button", { cls: "p-rewrite-btn p-rewrite-btn--quiet", text: t("copyBtn") });
		copy.addEventListener("click", () => {
			void navigator.clipboard.writeText(cleanOptimizedOutput(msg.content))
				.then(() => new Notice(t("copied")))
				.catch(() => new Notice(t("copyFailed")));
		});

		const discard = actions.createEl("button", { cls: "p-rewrite-btn p-rewrite-btn--quiet", text: t("rewriteDiscard") });
		discard.addEventListener("click", () => {
			msg.rewriteTarget = undefined;
			card.remove();
			void this.disarm();
		});
	}

	/**
	 * Write the answer over the captured range — after checking the range still
	 * holds what was captured. A stale or missing passage is refused, never
	 * approximated: the user keeps the answer and can paste it themselves.
	 */
	private async apply(msg: Message, card: HTMLElement): Promise<void> {
		const target = msg.rewriteTarget;
		if (!target) return;
		const file = this.d.plugin.app.vault.getAbstractFileByPath(target.path);
		if (!(file instanceof TFile)) { new Notice(t("rewriteNoteGone", { note: target.path })); return; }

		const replacement = cleanOptimizedOutput(msg.content);
		const view = await this.openEditorFor(file);

		// The open editor is preferred over a vault write: `replaceRange` there is
		// one undo step, which is the user's real safety net for a replaced passage.
		const content = view ? view.editor.getValue() : await this.d.plugin.app.vault.read(file);
		const state = targetState(content, target);
		if (state !== "ok") {
			new Notice(state === "stale" ? t("rewriteStale") : t("rewriteGone"), 10000);
			return;
		}

		if (view) view.editor.replaceRange(replacement, target.from, target.to);
		else await this.d.plugin.app.vault.modify(file, replaceRange(content, target.from, target.to, replacement));

		msg.rewriteTarget = undefined;
		card.remove();
		await this.disarm();
		new Notice(t("rewriteApplied", { note: target.path }));
	}

	/** The note's editor, opening it when it is not already on screen — an undo
	 *  the user can reach matters more than leaving the workspace untouched. */
	private async openEditorFor(file: TFile): Promise<MarkdownView | null> {
		const open = this.d.plugin.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === file.path);
		if (open) return open;
		try {
			const leaf = this.d.plugin.app.workspace.getLeaf(false);
			await leaf.openFile(file);
			return leaf.view instanceof MarkdownView ? leaf.view : null;
		} catch {
			return null; // Fall back to a vault write; the caller still verifies first.
		}
	}
}

