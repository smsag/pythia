import { App, Notice, TFile, setIcon } from "obsidian";
import type PythiaPlugin from "../main";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { estimateTokensFromBytes } from "../services/messageUtils";
import { noteBasename } from "../services/pathUtils";
import { referenceEntries, type RefEntry } from "./referenceEntries";
import { appendSourceIcon, REGENERATE_ICON } from "./icons";
import { DeleteFileModal } from "../suggest/DeleteFileModal";
import { NoteSuggestModal } from "../suggest/NoteSuggest";
import { makeKeyActivatable } from "./keyActivate";
import { noticeFailure } from "./failureNotice";
import { RenderSlot } from "./renderMarkdown";
import { seedSourceId } from "../services/favoritesFork";

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
	/** A fork's favorites snapshot changed here (↻, ×, +): the fork banner's line
	 *  follows (ADR-255). The banner is ForkController's; it repaints its own. */
	onForkedFavoritesChanged(): void;
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
	/** Owns the favorites pill's listeners, one render at a time — released on the
	 *  next render and on dispose (principle 8, hard rule 10). */
	private readonly pillEvents = new RenderSlot(() => undefined);

	constructor(private readonly d: ReferenceRowDeps) {}

	/** Build the row. `container` is the input area's parent. */
	mount(container: HTMLElement): void {
		this.sectionEl = container.createDiv({ cls: "p-ref-row" });
		this.pillsEl = this.sectionEl.createDiv({ cls: "p-pills" });
		this.sectionEl.style.display = "none";
	}

	/** View teardown: the pill's listeners end with the view. */
	dispose(): void {
		this.pillEvents.release();
	}

	/** Re-apply visibility without rebuilding — the input area collapsing. */
	updateVisibility(): void {
		this.sectionEl.style.display =
			this.hasEntries && !this.d.isInputCollapsed() ? "" : "none";
	}

	render(): void {
		this.d.refreshToolbarToggles();
		this.pillsEl.empty();
		this.pillEvents.renew();
		const conv = this.d.getConversation();

		if (!conv) {
			this.hasEntries = false;
			this.updateVisibility();
			return;
		}

		// The conversation the favorites came from — the parent, or further up when a
		// passage fork inherited them (ADR-255 review 2).
		const fromId = seedSourceId(conv);
		const seedSource = fromId ? this.d.plugin.conversationStore.getById(fromId) : undefined;
		const entries = referenceEntries(conv, this.d.plugin.getAutoContext(conv.id), seedSource);

		this.hasEntries = entries.length > 0;
		this.updateVisibility();
		// Keep the context inspector in sync with note add/remove.
		this.d.refreshContextInspector();
		if (entries.length === 0) return;

		for (const entry of entries) {
			if (entry.kind === "favorites") this.renderFavoritesPill(conv, entry);
			else this.renderPill(conv, entry);
		}
		this.renderAddButton(conv);
	}

	private renderPill(conv: Conversation, entry: Exclude<RefEntry, { kind: "favorites" }>): void {
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
		const openNote = (): void => {
			const f = this.d.app.vault.getAbstractFileByPath(entry.path);
			if (f instanceof TFile) {
				this.d.app.workspace.getLeaf(false).openFile(f)
					.catch((err: unknown) => noticeFailure("open note failed", err));
			} else new Notice(t("fileNotFound", { path: entry.path }));
		};
		label.addEventListener("click", openNote);
		makeKeyActivatable(label, openNote, "link");
		if (tokEst) ref.createEl("span", { cls: "p-wikilink-tokens", text: tokEst });
		if (entry.kind === "auto") return; // read-only: no remove/delete affordance

		const x = ref.createEl("button", {
			cls: "pb pb-icon is-inline p-wikilink-x",
			text: "×",
			attr: {
				"aria-label": entry.kind === "output"
					? t("deleteNoteAria", { name: displayName })
					: t("removeNoteAria", { name: displayName }),
			},
		});
		if (entry.kind !== "output") {
			x.addEventListener("click", () => {
				if (entry.kind === "template") conv.pendingTemplate = undefined;
				else if (entry.kind === "rewrite") conv.pendingRewrite = undefined;
				else {
					conv.contextNotes = conv.contextNotes.filter((n) => n !== entry.path);
					this.d.onContextNoteRemoved(entry.path);
				}
				this.render();
				this.d.plugin.conversationStore.save(conv)
					.catch((err: unknown) => noticeFailure("reference row: save failed", err, "saveFailed"));
			});
			return;
		}
		x.addEventListener("click", () => {
			new DeleteFileModal(this.d.app, fileName, async () => {
				const f = this.d.app.vault.getAbstractFileByPath(entry.path);
				try {
					if (f instanceof TFile) await this.d.app.vault.trash(f, true);
				} catch (err) {
					// The note is still there, so the pill stays: forgetting it would
					// leave a file nothing in Pythia points at any more.
					noticeFailure("reference row: trash failed", err);
					return;
				}
				conv[entry.field] = undefined;
				this.render();
				try {
					await this.d.plugin.conversationStore.save(conv);
				} catch (err) {
					noticeFailure("reference row: save failed", err, "saveFailed");
				}
			}).open();
		});
	}

	/**
	 * The favorites summary a fork carries (ADR-255): the name opens the source
	 * in this leaf, ↻ appears only while the source holds a newer summary and
	 * takes it on the tap — never on its own — and × switches it off: kept and
	 * no longer sent, with a control to send it again. Never deleted — once the
	 * source is gone it is the only copy (ADR-255 review). After either change
	 * the fork banner's line is repainted by its owner (`onForkedFavoritesChanged`).
	 */
	private renderFavoritesPill(conv: Conversation, entry: Extract<RefEntry, { kind: "favorites" }>): void {
		const ref = this.pillsEl.createEl("span", { cls: "p-wikilink p-wikilink--favorites" });
		if (entry.off) ref.addClass("is-off");
		appendSourceIcon(ref, "favorites");
		const label = ref.createEl("span", {
			text: entry.label,
			cls: "p-wikilink-name",
			attr: { title: t("favoritesSeedTooltip") },
		});
		const sourceId = entry.sourceId;
		if (sourceId) {
			const openSource = (): void => {
				const source = this.d.plugin.conversationStore.getById(sourceId);
				if (!source) { new Notice(t("forkSourceGone")); return; }
				// The leaf showing this fork, not the first Pythia leaf.
				this.d.plugin.viewShowing(conv.id)
					.then((view) => view.setActiveConversation(source))
					.catch((err: unknown) => noticeFailure("favorites pill: open source failed", err));
			};
			this.pillEvents.current?.registerDomEvent(label, "click", openSource);
			makeKeyActivatable(label, openSource, "link");
		}
		if (entry.off) ref.createEl("span", { cls: "p-wikilink-tokens", text: t("favoritesSeedOff") });
		if (entry.state === "outdated") {
			ref.createEl("span", { cls: "p-wikilink-tokens", text: t("forkSummaryStale") });
			const update = ref.createEl("button", {
				cls: "pb pb-icon is-inline is-stale p-wikilink-update",
				attr: { title: t("favoritesSeedUpdate"), "aria-label": t("favoritesSeedUpdate") },
			});
			setIcon(update, REGENERATE_ICON);
			this.pillEvents.current?.registerDomEvent(update, "click", () => this.changeSeed(() => this.d.plugin.updateForkedFavorites(conv.id)));
		}
		const toggle = ref.createEl("button", {
			cls: "pb pb-icon is-inline p-wikilink-x",
			attr: { "aria-label": entry.off ? t("favoritesSeedResume") : t("favoritesSeedRemoveAria") },
		});
		if (entry.off) {
			toggle.setAttribute("title", t("favoritesSeedResume"));
			setIcon(toggle, "plus");
		} else {
			toggle.setText("×");
		}
		this.pillEvents.current?.registerDomEvent(toggle, "click", () => this.changeSeed(() => this.d.plugin.setForkedFavoritesSent(conv.id, entry.off)));
	}

	/** Run one change to a fork's favorites snapshot, then repaint the row and
	 *  the banner line; a failure is a Notice, never a silent rejection. */
	private changeSeed(change: () => Promise<unknown>): void {
		change()
			.then(() => {
				this.render();
				this.d.onForkedFavoritesChanged();
			})
			.catch((err: unknown) => noticeFailure("favorites pill: change failed", err, "saveFailed"));
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
