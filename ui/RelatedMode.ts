import { Notice } from "obsidian";
import type { Conversation } from "../models/types";
import { t } from "../i18n";
import { renderHistoryChip } from "./historyChip";

/**
 * "Related conversations" as a mode of the conversation panel (ADR-109).
 *
 * Extracted from `openHistoryView`, which had grown to ~350 lines holding some
 * forty closures (engineering-review #281). This is the seam ADR-109 drew
 * conceptually and never structurally: related mode shares the panel's list
 * element and its row renderer, but nothing else — it has its own state, its own
 * lifecycle, and its own failure modes.
 *
 * What it owns: the active source, the in-flight query and its cancellation, the
 * chip, and the three list states (loading, empty, results). What it borrows,
 * through `RelatedModeDeps`: the DOM it draws into and the panel's row renderer,
 * so a related row is the same row as a search row.
 */
export interface RelatedModeDeps {
	chipEl: HTMLElement;
	listEl: HTMLElement;
	/** Absent when the host cannot answer — the affordance is then not shown. */
	getRelated?(sourceId: string, signal?: AbortSignal): Promise<{ id: string; score: number }[]>;
	conversations(): Conversation[];
	/** Draw one row, exactly as the browse and search lists draw it. */
	makeRow(conv: Conversation, isFork: boolean): void;
	/** Reset the panel's keyboard-selection bookkeeping before a re-render. */
	resetRows(): void;
	paintSelection(): void;
	/** Redraw the chip area. The panel owns it because the widen chip (ADR-168)
	 *  shares the same slot. */
	renderChip(): void;
	/** Leave this mode and show the normal browse/search list again. */
	showNormalList(): void;
}

interface ActiveRelated {
	sourceId: string;
	sourceName: string;
	results: { id: string; score: number }[];
	loading: boolean;
}

export class RelatedMode {
	private active: ActiveRelated | null = null;
	/** The in-flight query. Cancelling matters because the query syncs the
	 *  embedding index first, and a cold build is minutes of work — on the iframe
	 *  fallback, minutes of UI thread (ADR-169). */
	private run: AbortController | null = null;

	constructor(private readonly d: RelatedModeDeps) {}

	isActive(): boolean {
		return this.active !== null;
	}

	/** Abort the in-flight query, if any. Safe to call when nothing is running. */
	cancel(): void {
		this.run?.abort();
		this.run = null;
	}

	/** Drop out of related mode WITHOUT redrawing — for callers that are about to
	 *  redraw anyway (typing, clearing the box). */
	clear(): void {
		this.cancel();
		this.active = null;
	}

	/** Leave related mode and restore the normal list. */
	exit(): void {
		this.clear();
		this.d.renderChip();
		this.d.showNormalList();
	}

	/** Draw the chip for this mode. Returns false when the mode is inactive, so
	 *  the panel can fall through to its own chip. */
	renderChip(): boolean {
		if (!this.active) return false;
		renderHistoryChip(this.d.chipEl, {
			label: t("relatedChip", { name: this.active.sourceName }),
			tooltip: t("relatedClearTooltip"),
			onClear: () => this.exit(),
		});
		return true;
	}

	/** Render whichever of the three states applies: loading, empty, results. */
	render(): void {
		this.d.listEl.empty();
		this.d.resetRows();
		this.d.renderChip();
		if (!this.active) return;
		if (this.active.loading) {
			this.d.listEl.createDiv({ cls: "p-nav-empty", text: t("relatedLoading") });
			return;
		}
		const byId = new Map(this.d.conversations().map((c) => [c.id, c]));
		let shown = 0;
		for (const r of this.active.results) {
			const conv = byId.get(r.id);
			if (!conv) continue; // deleted since the query ran
			this.d.makeRow(conv, !!conv.forkedFromId && byId.has(conv.forkedFromId));
			shown++;
		}
		if (shown === 0) this.d.listEl.createDiv({ cls: "p-nav-empty", text: t("relatedEmpty") });
		this.d.paintSelection();
	}

	/** Enter the mode for `conv` and run the query. */
	async enter(conv: Conversation): Promise<void> {
		if (!this.d.getRelated) return;
		this.cancel();
		const run = new AbortController();
		this.run = run;
		this.active = { sourceId: conv.id, sourceName: conv.name, results: [], loading: true };
		this.render();
		try {
			const results = await this.d.getRelated(conv.id, run.signal);
			// Guard the source: a second `enter` while this one was in flight must win.
			if (this.active?.sourceId === conv.id) {
				this.active.results = results;
				this.active.loading = false;
				this.render();
			}
		} catch (e) {
			// An abort is this panel's own doing — the user left, and there is
			// nothing to report. Anything else is a real failure and says so.
			if (run.signal.aborted) return;
			new Notice(t("relatedFailed", { error: e instanceof Error ? e.message : String(e) }));
			this.active = null;
			this.d.renderChip();
			this.d.showNormalList();
		} finally {
			if (this.run === run) this.run = null;
		}
	}
}
