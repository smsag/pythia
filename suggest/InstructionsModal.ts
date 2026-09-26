import { App, Modal, Notice, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { noteBasename } from "../services/pathUtils";
import { omittedByResume } from "../services/messageUtils";
import { previewSystemPrompt, sendFullHistory } from "../services/sendPreview";
import { copyTextWithFeedback } from "../ui/clipboard";

/** What shapes a conversation's answers, read off the conversation and the
 *  settings — pure, so the dialog's facts are tested (ADR-232). */
export interface InstructionFacts {
	/** The template the conversation was created from, by name. */
	template: string | null;
	/** A template armed for the next answer only (ADR-177). */
	pendingTemplate: string | null;
	/** The conversation's own instructions (`systemPrompt`). */
	conversationPrompt: string;
	/** The user's standing instructions from the settings. */
	customInstructions: string;
	resumeMode: Conversation["resumeMode"];
	/** Messages the next send leaves out because of the resume mode (ADR-231). */
	omitted: number;
}

export function instructionFacts(conv: Conversation, customInstructions: string): InstructionFacts {
	return {
		template: conv.templateId ? noteBasename(conv.templateId) : null,
		pendingTemplate: conv.pendingTemplate?.name ?? null,
		conversationPrompt: conv.systemPrompt.trim(),
		customInstructions: customInstructions.trim(),
		resumeMode: conv.resumeMode,
		omitted: omittedByResume(conv),
	};
}

/**
 * "What Pythia sends" (ADR-232, engineering-review #258): the conversation's
 * instructions, the template they came from, the standing custom instructions,
 * the history the next send includes, and the whole system prompt as built —
 * read-only, with the one change it can make (back to full history) and a
 * pointer to where everything else is changed. Opened from the header menu and
 * from the context box's system-prompt line.
 */
export class InstructionsModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: PythiaPlugin,
		private readonly conv: Conversation,
		private readonly onChanged: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass("pythia-modal");
		this.modalEl.addClass("pythia-instructions-modal");
		const facts = instructionFacts(this.conv, this.plugin.settings.customInstructions ?? "");
		contentEl.createEl("h2", { text: t("instrTitle") });
		contentEl.createEl("p", { text: t("instrIntro"), cls: "pythia-modal-desc" });

		// Template — where the conversation's instructions came from.
		const tpl = this.section(t("instrTemplate"));
		tpl.createEl("p", { text: facts.template ?? t("instrNone") });
		if (facts.pendingTemplate) {
			tpl.createEl("p", { cls: "pythia-modal-hint", text: t("instrPending", { name: facts.pendingTemplate }) });
		}

		this.textSection(t("instrConversation"), facts.conversationPrompt, t("instrConversationHint"));
		this.textSection(t("instrCustom"), facts.customInstructions, t("instrCustomHint"));

		// History — the same fact the context box states (ADR-231).
		const hist = this.section(t("instrHistory"));
		if (facts.omitted === 0) {
			hist.createEl("p", { text: t("instrHistoryFull") });
		} else {
			hist.createEl("p", {
				text: facts.resumeMode === "summary"
					? t("ctxResumeSummary", { count: String(facts.omitted) })
					: t("ctxResumeHybrid", { count: String(facts.omitted) }),
			});
			const btn = hist.createEl("button", { cls: "pb pb-secondary", text: t("ctxSendFullHistory") });
			btn.addEventListener("click", async () => {
				await sendFullHistory(this.conv, this.plugin);
				new Notice(t("ctxFullHistoryOn"));
				this.onChanged();
				this.render();
			});
		}

		// The whole prompt as built, for the question the parts cannot answer.
		const full = previewSystemPrompt(this.conv, this.plugin.settings);
		const all = this.section(t("instrFull"));
		const copy = all.querySelector("h3")?.createEl("button", {
			cls: "pb pb-icon pythia-instructions-copy",
			attr: { "aria-label": t("instrCopy"), title: t("instrCopy") },
		});
		all.createEl("p", { cls: "pythia-modal-hint", text: t("instrFullHint") });
		all.createEl("pre", { cls: "pythia-instructions-text", text: full });
		if (!copy) return;
		setIcon(copy, "copy");
		copy.addEventListener("click", () => void copyTextWithFeedback(copy, full));
	}

	private section(label: string): HTMLElement {
		const el = this.contentEl.createDiv({ cls: "pythia-instructions-section" });
		el.createEl("h3", { text: label });
		return el;
	}

	private textSection(label: string, text: string, hint: string): void {
		const el = this.section(label);
		if (text) el.createEl("pre", { cls: "pythia-instructions-text", text });
		else el.createEl("p", { text: t("instrNone") });
		el.createEl("p", { cls: "pythia-modal-hint", text: hint });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
