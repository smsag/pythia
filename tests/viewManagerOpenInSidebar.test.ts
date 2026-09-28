// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { ViewManager } from "../services/ViewManager";
import { Platform } from "obsidian";
import { PythiaSidebarView } from "../sidebar";

// The "Open in right sidebar" command: reuse a Pythia leaf already in the right
// sidebar, otherwise open one there — even when a Pythia leaf sits in the main
// area, which is left where it is.

const liveView = () => {
	const view = Object.create(PythiaSidebarView.prototype) as PythiaSidebarView;
	Object.assign(view, { focusComposer: vi.fn() });
	return view;
};

function leafIn(root: object, view: unknown = liveView()) {
	const l = {
		view,
		getRoot: () => root,
		setViewState: vi.fn(async () => { l.view = liveView(); }),
	};
	return l;
}

function manager(leaves: ReturnType<typeof leafIn>[], rightLeaf: ReturnType<typeof leafIn> | null) {
	const rightSplit = {};
	const workspace = {
		rightSplit,
		rootSplit: {},
		getLeavesOfType: () => leaves,
		getRightLeaf: vi.fn(() => rightLeaf),
		revealLeaf: vi.fn(async () => {}),
	};
	return { vm: new ViewManager({ app: { workspace } } as never), workspace };
}

describe("ViewManager.openInSidebar", () => {
	it("reuses the Pythia leaf already in the right sidebar", async () => {
		const right = {};
		const { vm, workspace } = manager([], null);
		workspace.rightSplit = right;
		const existing = leafIn(right);
		workspace.getLeavesOfType = () => [leafIn(workspace.rootSplit), existing];

		const view = await vm.openInSidebar();
		expect(view).toBe(existing.view);
		expect(workspace.getRightLeaf).not.toHaveBeenCalled();
		expect(workspace.revealLeaf).toHaveBeenCalledWith(existing);
		expect(view.focusComposer).toHaveBeenCalledTimes(1);
	});

	it("focuses only after the reveal settles, and not on a phone", async () => {
		const right = {};
		const existing = leafIn(right);
		const { vm, workspace } = manager([existing], null);
		workspace.rightSplit = right;
		const order: string[] = [];
		workspace.revealLeaf = vi.fn(async () => { order.push("reveal"); });
		(existing.view as PythiaSidebarView).focusComposer = vi.fn(() => { order.push("focus"); });

		await vm.openInSidebar();
		expect(order).toEqual(["reveal", "focus"]);

		Platform.isMobile = true;
		try {
			const view = await vm.openInSidebar();
			expect(view.focusComposer).toHaveBeenCalledTimes(1);   // still only the desktop call
		} finally {
			Platform.isMobile = false;
		}
	});

	it("opens a new sidebar leaf when Pythia is only in the main area", async () => {
		const main = leafIn({});
		const fresh = leafIn({}, null);
		const { vm, workspace } = manager([main], fresh);

		const view = await vm.openInSidebar();
		expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(fresh.setViewState).toHaveBeenCalledWith({ type: "pythia", active: true });
		expect(view).toBe(fresh.view);
		expect(main.setViewState).not.toHaveBeenCalled();
	});

	it("says so when there is no right sidebar", async () => {
		const { vm } = manager([], null);
		await expect(vm.openInSidebar()).rejects.toThrow(/no right sidebar/);
	});
});
