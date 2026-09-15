import { Notice, normalizePath, WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import { collectLayoutReport, formatLayoutReport } from "../ui/layoutReport";
import type PythiaPlugin from "../main";
import { PythiaSidebarView, PYTHIA_VIEW_TYPE } from "../sidebar";

/**
 * Sidebar leaf/view lifecycle extracted from `PythiaPlugin` (ADR-103,
 * engineering-review #121): first-install leaf creation, activation, and lookup.
 * Behaviour is identical to the inline plugin methods it replaced.
 */
export class ViewManager {
	constructor(private readonly plugin: PythiaPlugin) {}

	/** Called once on layout-ready. Creates the sidebar leaf on first install
	 *  (or after the user manually closed the tab). Obsidian then persists the
	 *  leaf in its workspace layout, so subsequent launches restore it without
	 *  hitting this branch.
	 *
	 *  We use iterateAllLeaves instead of getLeavesOfType because during a
	 *  hot-reload (BRAT update) the existing leaf's view hasn't been
	 *  re-instantiated yet, so getLeavesOfType returns 0 and a second leaf
	 *  would be created. iterateAllLeaves inspects the raw view-state type,
	 *  which is always present. Any extras accumulated from previous
	 *  hot-reloads are detached here to keep the sidebar clean. */
	initLeaf(): void {
		const { workspace } = this.plugin.app;
		const existing: WorkspaceLeaf[] = [];
		workspace.iterateAllLeaves((leaf) => {
			if (leaf.getViewState().type === PYTHIA_VIEW_TYPE) {
				existing.push(leaf);
			}
		});
		// Deduplicate: keep the first, detach any extras from hot-reloads.
		for (let i = 1; i < existing.length; i++) {
			existing[i].detach();
		}
		if (existing.length >= 1) return;
		void workspace.getRightLeaf(false)?.setViewState({ type: PYTHIA_VIEW_TYPE });
	}

	async activateView(): Promise<PythiaSidebarView> {
		const { workspace } = this.plugin.app;
		let leaf = workspace.getLeavesOfType(PYTHIA_VIEW_TYPE)[0] as
			| WorkspaceLeaf
			| undefined;
		if (!leaf || !(leaf.view instanceof PythiaSidebarView)) {
			// false = reuse the existing right-sidebar split rather than
			// creating a new horizontal split (which would produce a second icon).
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: PYTHIA_VIEW_TYPE, active: true });
		}
		void workspace.revealLeaf(leaf);
		return leaf.view as PythiaSidebarView;
	}

	getSidebarView(): PythiaSidebarView | null {
		const leaf = this.plugin.app.workspace.getLeavesOfType(PYTHIA_VIEW_TYPE)[0];
		return leaf ? (leaf.view as PythiaSidebarView) : null;
	}

	/** Write a layout report for the open panel into the scratch folder (ADR-148).
	 *
	 *  Deliberately a note rather than a console log or the clipboard: the strip
	 *  this exists to explain has only ever been seen on a phone, where there is
	 *  no console to read and a long clipboard is awkward to hand back. A note
	 *  syncs, opens, and can be pasted from at leisure. It is rewritten in place
	 *  on every run, so repeated diagnoses do not litter the vault. */
	async diagnoseLayout(): Promise<void> {
		const { app, settings } = this.plugin;
		const view = app.workspace.getLeavesOfType(PYTHIA_VIEW_TYPE)[0]?.view;
		const panel = view?.containerEl?.children[1] as HTMLElement | undefined;
		const composer = panel?.querySelector<HTMLElement>(".p-input-area");
		if (!panel || !composer) {
			new Notice(t("diagnoseNoPanel"));
			return;
		}
		const platform = `${navigator.userAgent} · dpr ${window.devicePixelRatio}`;
		const report = formatLayoutReport(
			collectLayoutReport(panel, composer, window, this.plugin.manifest.version, platform)
		);
		const path = normalizePath(`${settings.scratchFolder}/Pythia layout report.md`);
		const file = await this.plugin.noteWriter.writeNote(report, path);
		await app.workspace.getLeaf(true).openFile(file);
		new Notice(t("diagnoseWritten", { path }));
	}
}
