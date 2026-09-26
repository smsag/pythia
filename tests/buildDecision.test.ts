import { describe, it, expect } from "vitest";
import { shouldCatchUp, decideBuild, type BuildFacts } from "../services/embedding/buildDecision";

// The head of a vault-index build, as a table (ADR-203). Every row is a state the
// phone actually reached during the iOS reload work.

const idle: BuildFacts = { syncing: false, complete: false, mayAutoBuild: true, loadFailed: false };

describe("decideBuild — what stops a build", () => {
	it("a build already running stops everything, the user's press included", () => {
		expect(decideBuild({}, { ...idle, syncing: true })).toEqual({ run: false, blocked: "busy" });
		expect(decideBuild({ manual: true, force: true }, { ...idle, syncing: true }))
			.toEqual({ run: false, blocked: "busy" });
	});

	it("a complete index stops an automatic build and yields to `force`", () => {
		expect(decideBuild({}, { ...idle, complete: true })).toEqual({ run: false, blocked: "complete" });
		expect(decideBuild({ force: true }, { ...idle, complete: true })).toEqual({ run: true, reloadProvider: false });
	});

	it("the crash-loop guard stops an automatic build, never the user's (ADR-199)", () => {
		expect(decideBuild({}, { ...idle, mayAutoBuild: false })).toEqual({ run: false, blocked: "paused" });
		expect(decideBuild({ manual: true, force: true }, { ...idle, mayAutoBuild: false }))
			.toEqual({ run: true, reloadProvider: false });
	});

	it("a load that failed in this session stops an automatic build (#358)", () => {
		// The provider memoizes its rejection, so the retry cannot do anything but
		// fail again — and each attempt used to leave another interrupted-build
		// marker, which is how ONE failed load became "the last 2 builds died".
		expect(decideBuild({}, { ...idle, loadFailed: true })).toEqual({ run: false, blocked: "loadFailed" });
		expect(decideBuild({ force: true }, { ...idle, loadFailed: true })).toEqual({ run: false, blocked: "loadFailed" });
	});
});

describe("decideBuild — when the provider is reloaded (#357/#359)", () => {
	it("a press after a failed LOAD reloads it", () => {
		expect(decideBuild({ manual: true, force: true }, { ...idle, loadFailed: true }))
			.toEqual({ run: true, reloadProvider: true });
	});

	it("a press after a build that failed with a HEALTHY model does not (#359)", () => {
		// Five bad embeds or a failed write leave the model loaded and good; dropping
		// it costs a full Worker teardown and model reparse for nothing.
		expect(decideBuild({ manual: true, force: true }, idle)).toEqual({ run: true, reloadProvider: false });
	});

	it("an automatic build never reloads the provider", () => {
		expect(decideBuild({ force: true }, idle)).toEqual({ run: true, reloadProvider: false });
	});
});

describe("shouldCatchUp — the launch catch-up obeys an automatic build's brakes (ADR-221)", () => {
	const ok = { mobile: false, ran: false, syncing: false, mayAutoBuild: true, loadFailed: false };

	it("runs on a desktop that has not caught up this session", () => {
		expect(shouldCatchUp(ok)).toBe(true);
	});

	it.each([
		["a phone, which holds a desktop's index rather than keeping it", { mobile: true }],
		["a second time in one session", { ran: true }],
		["while a build is running", { syncing: true }],
		["past the crash-loop pause (ADR-199)", { mayAutoBuild: false }],
		["after the model failed to load this session (ADR-203)", { loadFailed: true }],
	])("never runs on %s", (_why, over) => {
		expect(shouldCatchUp({ ...ok, ...over })).toBe(false);
	});
});
