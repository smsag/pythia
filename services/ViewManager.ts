import type { Workspace, WorkspaceLeaf } from "obsidian";
import type PythiaPlugin from "../main";
import { PythiaSidebarView, PYTHIA_VIEW_TYPE } from "../sidebar";

/**
 * The Pythia views that are actually loaded. Since Obsidian 1.7.2 a leaf that
 * is not visible — a background tab, the phone's closed drawer — is *deferred*:
 * `getLeavesOfType` returns it, but its `view` is a placeholder `DeferredView`
 * with none of our methods until the leaf is revealed. Casting `leaf.view` to
 * our view type is therefore a lie that throws later
 * ("setActiveConversation is not a function", #342). Skipping a deferred leaf
 * loses nothing: when it loads, `onOpen` reads `plugin.conversations` afresh.
 * The ONE way to reach the views — never cast `leaf.view` again.
 */
export function loadedPythiaViews(workspace: Workspace): PythiaSidebarView[] {
	return workspace
		.getLeavesOfType(PYTHIA_VIEW_TYPE)
		.map((leaf) => leaf.view)
		.filter((view): view is PythiaSidebarView => view instanceof PythiaSidebarView);
}

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
		// A deferred leaf is still our leaf: load it rather than open a second one.
		// `loadIfDeferred` exists from 1.7.2, the version that introduced deferral.
		if (leaf && !(leaf.view instanceof PythiaSidebarView) && typeof leaf.loadIfDeferred === "function") {
			await leaf.loadIfDeferred();
		}
		if (!leaf || !(leaf.view instanceof PythiaSidebarView)) {
			// false = reuse the existing right-sidebar split rather than
			// creating a new horizontal split (which would produce a second icon).
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: PYTHIA_VIEW_TYPE, active: true });
		}
		void workspace.revealLeaf(leaf);
		const view = leaf.view;
		if (!(view instanceof PythiaSidebarView)) {
			// Loud rather than a cast: a caller would otherwise fail later on a
			// method the placeholder does not have (#342).
			throw new Error(`Pythia view did not load (got ${view.getViewType()})`);
		}
		return view;
	}

	/** The first loaded Pythia view, or null — a deferred leaf has nothing to repaint. */
	getSidebarView(): PythiaSidebarView | null {
		return loadedPythiaViews(this.plugin.app.workspace)[0] ?? null;
	}
}
