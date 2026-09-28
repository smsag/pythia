import { describe, it, expect, vi } from "vitest";
import { ViewManager } from "../services/ViewManager";
import { PYTHIA_VIEW_TYPE } from "../sidebar";

// initLeaf removes the duplicate leaves a hot reload leaves behind — and only
// those: a second Pythia leaf the user opened in another place is theirs.

function leaf(parent: object) {
	return { parent, getViewState: () => ({ type: PYTHIA_VIEW_TYPE }), detach: vi.fn() };
}

function manager(leaves: ReturnType<typeof leaf>[]) {
	const workspace = {
		iterateAllLeaves: (cb: (l: unknown) => void) => leaves.forEach(cb),
		getRightLeaf: vi.fn(),
	};
	return new ViewManager({ app: { workspace } } as never);
}

describe("ViewManager.initLeaf", () => {
	it("detaches hot-reload duplicates in the same tab group", () => {
		const sidebar = {};
		const leaves = [leaf(sidebar), leaf(sidebar), leaf(sidebar)];
		manager(leaves).initLeaf();
		expect(leaves.map((l) => l.detach.mock.calls.length)).toEqual([0, 1, 1]);
	});

	it("keeps a second leaf the user opened elsewhere", () => {
		const leaves = [leaf({}), leaf({})];
		manager(leaves).initLeaf();
		expect(leaves.every((l) => l.detach.mock.calls.length === 0)).toBe(true);
	});
});
