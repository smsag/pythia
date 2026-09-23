import { App, Notice, TFile } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { estimateTokensFromBytes } from "../services/messageUtils";
import { noteBasename } from "../services/pathUtils";
import { referenceEntries } from "./referenceEntries";
import { appendSourceIcon } from "./icons";
import { DeleteFileModal } from "../suggest/DeleteFileModal";
import { NoteSuggestModal } from "../suggest/NoteSuggest";

export interface ReferenceRowDeps {
	app: App;
	plugin: PythiaPlugin;
	getConversation(): Conversation | null;
	/** The row hides with the input area, so the controller cannot decide its own
	 *  visibility alone. */
	isInputCollapsed(): boolean;
	/** Every template arm or clear repaints this row. */
	refreshToolbarToggles(): void;
	/** The inspector lists the same notes, so it follows every add and remove. */
	refreshContextInspector(): void;
	/** A note removed here may have been attached from the composer, where its
	 *  `[[link]]` is still sitting (ADR-211). The two handles stay in step. */
	onContextNoteRemoved(path: string): void;
}

/**
 * The pill strip above the composer: attached notes, auto-retrieved notes, the
 * armed template, a rewrite target, and the notes this conversation wrote.
 *
 * Extracted from `sidebar.ts` (ADR-097's ratchet, ADR-211's session), where it
 * was an 83-line method. The behaviour is unchanged by the move, with one
 * addition it is now the right home for: removing a pill also clears the note's
 * token out of the composer, which is why `onContextNoteRemoved` exists.
 */
export class ReferenceRowController {
	private sectionEl!: HTMLElement;
	private pillsEl!: HTMLElement;
	private hasEntries = false;

	constructor(private readonly d: ReferenceRowDeps) {}

	/** Build the row. `container` is the input area's parent. */
	mount(container: HTMLElement): void {
		this.sectionEl = container.createDiv({ cls: "p-ref-row" });
		this.pillsEl = this.sectionEl.createDiv({ cls: "p-pills" });
		this.sectionEl.style.display = "none";
	}

	/** Re-apply visibility without rebuilding — the input area collapsing. */
	updateVisibility(): void {
		this.sectionEl.style.display =
			this.hasEntries && !this.d.isInputCollapsed() ? "" : "none";
	}

	render(): void {
		this.d.refreshToolbarToggles();
		this.pillsEl.empty();
		const conv = this.d.getConversation();

		if (!conv) {
			this.hasEntries = false;
			this.updateVisibility();
			return;
		}

		const entries = referenceEntries(conv, this.d.plugin.getAutoContext(conv.id));

		this.hasEntries = entries.length > 0;
		this.updateVisibility();
		// Keep the context inspector in sync with note add/remove.
		this.d.refreshContextInspector();
		if (entries.length === 0) return;

		for (const entry of entries) this.renderPill(conv, entry);
		this.renderAddButton(conv);
	}

	private renderPill(conv: Conversation, entry: ReturnType<typeof referenceEntries>[number]): void {
		const fileName = entry.path.split("/").pop() ?? entry.path; // with extension, for the delete prompt
		const displayName = "label" in entry ? entry.label : noteBasename(entry.path);
		const file = this.d.app.vault.getAbstractFileByPath(entry.path);
		const tokEst = file instanceof TFile ? estimateTokensFromBytes(file.stat.size) : null;

		// Reference: <source icon> name ~tokens × (ADR-193)
		const ref = this.pillsEl.createEl("span", { cls: "p-wikilink" });
		// Auto-retrieved pills are read-only and visually distinct (no × — they
		// are ephemeral per-turn context, not persistent conversation context).
		if (entry.kind === "auto") ref.addClass("p-wikilink--auto");
		if (entry.kind === "template" || entry.kind === "rewrite") ref.addClass("p-wikilink--template");
		appendSourceIcon(ref, entry.kind === "context" ? "note" : entry.kind);
		const labelTitle = entry.kind === "auto" ? `${entry.path} — ${t("vaultContextAutoPill")}` : entry.path;
		const label = ref.createEl("span", { text: displayName, cls: "p-wikilink-name", attr: { title: labelTitle } });
		label.addEventListener("click", async () => {
			const f = this.d.app.vault.getAbstractFileByPath(entry.path);
			if (f instanceof TFile) await this.d.app.workspace.getLeaf(false).openFile(f);
			else new Notice(t("fileNotFound", { path: entry.path }));
		});
		if (tokEst) ref.createEl("span", { cls: "p-wikilink-tokens", text: tokEst });
		if (entry.kind === "auto") return; // read-only: no remove/delete affordance

		const x = ref.createEl("button", { cls: "pb pb-icon is-inline p-wikilink-x", text: "×" });
		if (entry.kind !== "output") {
			x.addEventListener("click", async () => {
				if (entry.kind === "template") conv.pendingTemplate = undefined;
				else if (entry.kind === "rewrite") conv.pendingRewrite = undefined;
				else {
					conv.contextNotes = conv.contextNotes.filter((n) => n !== entry.path);
					this.d.onContextNoteRemoved(entry.path);
				}
				await this.d.plugin.conversationStore.save(conv);
				this.render();
			});
			return;
		}
		x.addEventListener("click", () => {
			new DeleteFileModal(this.d.app, fileName, async () => {
				const f = this.d.app.vault.getAbstractFileByPath(entry.path);
				if (f instanceof TFile) await this.d.app.vault.trash(f, true);
				conv[entry.field] = undefined;
				await this.d.plugin.conversationStore.save(conv);
				this.render();
			}).open();
		});
	}

	private renderAddButton(conv: Conversation): void {
		const addBtn = this.pillsEl.createEl("button", {
			cls:  "pb pb-link pythia-pill-add",
			attr: { title: t("addContextNoteTooltip") },
			text: t("addNoteInline"),
		});
		addBtn.addEventListener("click", () => {
			new NoteSuggestModal(this.d.app, (file) => {
				if (!conv.contextNotes.includes(file.path)) {
					conv.contextNotes.push(file.path);
					void this.d.plugin.conversationStore.save(conv);
					this.render();
				}
			}).open();
		});
	}
}
