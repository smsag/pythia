import { WorkspaceLeaf } from "obsidian";
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
}
