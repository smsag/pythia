import { Platform, type Workspace, type WorkspaceLeaf } from "obsidian";
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
	 *  which is always present. Extras accumulated from previous
	 *  hot-reloads (siblings in one tab group) are detached here. */
	initLeaf(): void {
		const { workspace } = this.plugin.app;
		const existing: WorkspaceLeaf[] = [];
		workspace.iterateAllLeaves((leaf) => {
			if (leaf.getViewState().type === PYTHIA_VIEW_TYPE) {
				existing.push(leaf);
			}
		});
		// Deduplicate hot-reload extras: they pile up as siblings in ONE tab group.
		// A second leaf the user opened elsewhere (a main-area tab, the other
		// sidebar) has another parent and is theirs to keep — the view supports
		// several leaves (activeConversationIds counts every one).
		const seenParents = new Set<unknown>();
		for (const leaf of existing) {
			if (seenParents.has(leaf.parent)) leaf.detach();
			else seenParents.add(leaf.parent);
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
		return this.viewOf(leaf);
	}

	/**
	 * The view showing `convId` — where a fork of it opens, and where the fork's
	 * pill opens its source (ADR-255 review). With two Pythia leaves the first
	 * one is not necessarily the one the user is in. Falls back to activateView.
	 */
	async viewShowing(convId: string): Promise<PythiaSidebarView> {
		const shown = loadedPythiaViews(this.plugin.app.workspace).find((v) => v.activeConversationId === convId);
		return shown ? this.revealed(shown) : this.activateView();
	}

	/**
	 * The view a palette command about "this conversation" acts on: the focused
	 * Pythia leaf, else the first loaded one, else the one activateView opens.
	 */
	async commandView(): Promise<PythiaSidebarView> {
		const { workspace } = this.plugin.app;
		const view = workspace.getActiveViewOfType(PythiaSidebarView) ?? loadedPythiaViews(workspace)[0];
		return view ? this.revealed(view) : this.activateView();
	}

	/** A loaded view the user may not see — a collapsed sidebar, a background tab,
	 *  a closed phone drawer — is brought forward first, as activateView does
	 *  (ADR-255 review 2: what a command does must happen where it can be seen). */
	private async revealed(view: PythiaSidebarView): Promise<PythiaSidebarView> {
		await this.plugin.app.workspace.revealLeaf(view.leaf);
		return view;
	}

	/** Pythia in the RIGHT SIDEBAR, whatever else is open: the command for a user
	 *  whose only Pythia leaf sits in the main area (or who closed the sidebar
	 *  one). An existing sidebar leaf is reused, never a second one beside it;
	 *  a leaf elsewhere is left where it is — it is the user's to keep.
	 *  The cursor lands in the composer on desktop; on a phone focusing would
	 *  raise the soft keyboard over the drawer, so it is left to the tap (ADR-152). */
	async openInSidebar(): Promise<PythiaSidebarView> {
		const { workspace } = this.plugin.app;
		let leaf = workspace
			.getLeavesOfType(PYTHIA_VIEW_TYPE)
			.find((l) => l.getRoot() === workspace.rightSplit);
		if (leaf && !(leaf.view instanceof PythiaSidebarView) && typeof leaf.loadIfDeferred === "function") {
			await leaf.loadIfDeferred();
		}
		if (!leaf) {
			leaf = workspace.getRightLeaf(false) ?? undefined;
			if (!leaf) throw new Error("Pythia: no right sidebar to open in");
			await leaf.setViewState({ type: PYTHIA_VIEW_TYPE, active: true });
		}
		// Awaited here, unlike activateView: revealing makes the leaf active, and a
		// focus set before that would be taken away again.
		await workspace.revealLeaf(leaf);
		const view = this.viewOf(leaf);
		if (!Platform.isMobile) view.focusComposer();
		return view;
	}

	private viewOf(leaf: WorkspaceLeaf): PythiaSidebarView {
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
