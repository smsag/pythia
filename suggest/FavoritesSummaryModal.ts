import { App, Component, MarkdownRenderer, Modal, Notice } from "obsidian";
import { t } from "../i18n";

/**
 * Displays a generated favorites summary (Key learnings + Action items) rendered
 * as Markdown, with Copy / Save-to-note / Regenerate actions. All modal logic
 * lives here (Hard rule #9 — no inline modal logic in sidebar.ts).
 */
export class FavoritesSummaryModal extends Modal {
	private readonly component = new Component();
	private bodyEl!: HTMLElement;

	constructor(
		app: App,
		private summaryText: string,
		private readonly onRegenerate: () => Promise<string>,
		private readonly onSaveToNote: (text: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("pythia-modal");
		this.modalEl.addClass("pythia-fav-summary-modal");
		this.component.load();
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t("favoritesSummaryTitle") });

		this.bodyEl = contentEl.createDiv({ cls: "pythia-fav-summary-body" });
		void this.renderBody();

		const buttons = contentEl.createDiv({ cls: "pythia-modal-buttons" });

		const copyBtn = buttons.createEl("button", { text: t("copyBtn") });
		copyBtn.addEventListener("click", () => {
			navigator.clipboard.writeText(this.summaryText).then(
				() => new Notice(t("copied")),
				() => new Notice(t("copyFailed")),
			);
		});

		const saveBtn = buttons.createEl("button", { text: t("saveToNoteBtn") });
		saveBtn.addEventListener("click", () => {
			void this.onSaveToNote(this.summaryText);
		});

		const regenBtn = buttons.createEl("button", {
			text: t("regenerateBtn"),
			cls: "mod-cta",
		});
		regenBtn.addEventListener("click", async () => {
			regenBtn.disabled = true;
			regenBtn.addClass("p-sparkle-loading");
			try {
				const fresh = await this.onRegenerate();
				if (fresh) {
					this.summaryText = fresh;
					await this.renderBody();
				}
			} finally {
				regenBtn.disabled = false;
				regenBtn.removeClass("p-sparkle-loading");
			}
		});
	}

	private async renderBody(): Promise<void> {
		this.bodyEl.empty();
		try {
			await MarkdownRenderer.render(
				this.app,
				this.summaryText,
				this.bodyEl,
				"",
				this.component,
			);
		} catch (e) {
			console.error("[Pythia] favorites summary render error:", e);
			this.bodyEl.setText(this.summaryText);
		}
	}

	onClose(): void {
		this.component.unload();
		this.contentEl.empty();
	}
}
