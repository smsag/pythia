import { describe, it, expect } from "vitest";
import { selectIndexPaths } from "../services/embedding/indexScope";

const paths = [
	"Product Practice/a.md",
	"Product Practice/sub/b.md",
	"Insights/c.md",
	"Private/secret.md",
	"Pythia/Conversations/x.md",
	"Pythia/Scratch/y.md",
	"root.md",
];

describe("selectIndexPaths", () => {
	it("indexes the whole vault (minus skip folders) when no include is set", () => {
		const r = selectIndexPaths(paths, { include: [], skip: ["Pythia/Conversations", "Pythia/Scratch"], cap: 0 });
		expect(r.paths).toEqual([
			"Product Practice/a.md",
			"Product Practice/sub/b.md",
			"Insights/c.md",
			"Private/secret.md",
			"root.md",
		]);
		expect(r.capped).toBe(false);
		expect(r.total).toBe(5);
	});

	it("restricts to the include folders (and their subfolders)", () => {
		const r = selectIndexPaths(paths, { include: ["Product Practice"], skip: [], cap: 0 });
		expect(r.paths).toEqual(["Product Practice/a.md", "Product Practice/sub/b.md"]);
	});

	it("supports multiple include folders", () => {
		const r = selectIndexPaths(paths, { include: ["Product Practice", "Insights"], skip: [], cap: 0 });
		expect(r.paths).toEqual(["Product Practice/a.md", "Product Practice/sub/b.md", "Insights/c.md"]);
	});

	it("still excludes skip folders even when they fall under an include folder", () => {
		const r = selectIndexPaths(paths, { include: ["Pythia"], skip: ["Pythia/Conversations"], cap: 0 });
		expect(r.paths).toEqual(["Pythia/Scratch/y.md"]);
	});

	it("caps the selection and reports it, keeping the first N (ADR-120)", () => {
		const r = selectIndexPaths(paths, { include: [], skip: [], cap: 3 });
		expect(r.paths.length).toBe(3);
		expect(r.paths).toEqual(paths.slice(0, 3));
		expect(r.total).toBe(7);
		expect(r.capped).toBe(true);
	});

	it("does not flag capped when the count is within the cap", () => {
		const r = selectIndexPaths(paths, { include: [], skip: [], cap: 100 });
		expect(r.capped).toBe(false);
		expect(r.paths.length).toBe(7);
	});

	it("treats cap 0 as unlimited", () => {
		const r = selectIndexPaths(paths, { include: [], skip: [], cap: 0 });
		expect(r.capped).toBe(false);
		expect(r.paths.length).toBe(7);
	});

	it("does not match a folder name as a path prefix (Insights vs Insights-old)", () => {
		const r = selectIndexPaths(["Insights/c.md", "Insights-old/d.md"], { include: ["Insights"], skip: [], cap: 0 });
		expect(r.paths).toEqual(["Insights/c.md"]);
	});
});
