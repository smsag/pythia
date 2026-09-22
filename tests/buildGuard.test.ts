import { describe, it, expect, vi } from "vitest";
import {
	BuildGuard, MAX_INTERRUPTED_BUILDS, markBuildStarted, mayAutoBuild, parseBuildMarker, vaultBuildGuard,
	type BuildMarker,
} from "../services/embedding/buildGuard";

// ADR-199: the only witness to a build the OS killed is a marker written before it.

describe("parseBuildMarker — a stored marker is untrusted (principle 1)", () => {
	it("accepts a well-formed marker", () => {
		expect(parseBuildMarker({ attempts: 2, startedAt: 5, modelId: "m" })).toEqual({ attempts: 2, startedAt: 5, modelId: "m" });
	});

	it("reads anything malformed as 'no marker', so the build can still start", () => {
		for (const raw of [null, undefined, "2", 2, [], {}, { attempts: 0 }, { attempts: -1 }, { attempts: 1.5 }, { attempts: "2" }]) {
			expect(parseBuildMarker(raw)).toBeNull();
		}
	});

	it("repairs the optional fields rather than refusing the count", () => {
		expect(parseBuildMarker({ attempts: 3, startedAt: "x", modelId: 7 })).toEqual({ attempts: 3, startedAt: 0, modelId: "" });
	});
});

describe("mayAutoBuild — two deaths in a row, then wait", () => {
	it("allows the first build and the one after a single interruption", () => {
		expect(mayAutoBuild(null)).toBe(true);
		expect(mayAutoBuild({ attempts: 1, startedAt: 0, modelId: "" })).toBe(true);
	});

	it("stops at MAX_INTERRUPTED_BUILDS, which is two", () => {
		expect(MAX_INTERRUPTED_BUILDS).toBe(2);
		expect(mayAutoBuild({ attempts: 2, startedAt: 0, modelId: "" })).toBe(false);
		expect(mayAutoBuild({ attempts: 9, startedAt: 0, modelId: "" })).toBe(false);
	});

	it("counts consecutive starts", () => {
		const one = markBuildStarted(null, 10, "a");
		const two = markBuildStarted(one, 20, "b");
		expect(one).toEqual({ attempts: 1, startedAt: 10, modelId: "a" });
		expect(two).toEqual({ attempts: 2, startedAt: 20, modelId: "b" });
	});
});

describe("BuildGuard", () => {
	const mem = () => {
		const box: { v: unknown } = { v: null };
		return { box, guard: new BuildGuard({ load: () => box.v, save: (m) => { box.v = m; } }, () => 42) };
	};

	it("start → crash → start → crash pauses; end resets", () => {
		const { box, guard } = mem();
		guard.start("m");
		expect(guard.mayAutoBuild()).toBe(true); // one interruption is tolerated
		guard.start("m");
		expect(guard.mayAutoBuild()).toBe(false);
		expect(guard.marker()).toEqual({ attempts: 2, startedAt: 42, modelId: "m" });
		guard.end();
		expect(box.v).toBeNull();
		expect(guard.mayAutoBuild()).toBe(true);
	});

	it("a storage that throws on read does not block the build", () => {
		const guard = new BuildGuard({ load: () => { throw new Error("denied"); }, save: () => {} });
		expect(guard.mayAutoBuild()).toBe(true);
	});

	it("a storage that throws on write says the breaker is blind (principle 2)", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const guard = new BuildGuard({ load: () => null, save: () => { throw new Error("quota"); } });
		guard.start("m");
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("crash-loop protection is off"), expect.any(Error));
		warn.mockRestore();
	});

	it("vaultBuildGuard keeps the marker in Obsidian's per-device localStorage under one key", () => {
		const saved = new Map<string, unknown>();
		const app = { loadLocalStorage: (k: string) => saved.get(k) ?? null, saveLocalStorage: (k: string, v: unknown) => { saved.set(k, v); } };
		const guard = vaultBuildGuard(app);
		guard.start("m");
		expect([...saved.keys()]).toEqual(["pythia-vault-index-build"]);
		expect((saved.get("pythia-vault-index-build") as BuildMarker).attempts).toBe(1);
	});
});
