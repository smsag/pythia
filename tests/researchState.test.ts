// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import "./helpers/viewHarness";
import { researchState } from "../ui/ResearchToggleController";
import { chipLabels } from "../ui/ToolCallController";
import { timeSensitiveCue } from "../services/webSearchHeuristics";
import { webCue } from "../services/sendPolicy";
import type { ToolCall } from "../models/types";

describe("researchState — the globe's four states (ADR-230)", () => {
	it("on only with a key; on without one is its own state", () => {
		expect(researchState(true, true, true)).toBe("on");
		expect(researchState(true, false, true)).toBe("noKey");
	});
	it("off with auto-search and a key says it may search by itself", () => {
		expect(researchState(false, true, true)).toBe("auto");
		expect(researchState(undefined, true, true)).toBe("auto");
	});
	it("off is off when auto-search is disabled or no key could run it", () => {
		expect(researchState(false, true, false)).toBe("off");
		expect(researchState(false, false, true)).toBe("off");
	});
});

describe("timeSensitiveCue / webCue — the word that armed a search (ADR-230)", () => {
	it("names a word cue, a declined stem, a year and a link", () => {
		expect(timeSensitiveCue("show me the current ecb rate", 2026)).toBe("current");
		expect(timeSensitiveCue("wie ist die aktuellste Lage", 2026)).toMatch(/^aktuell/);
		expect(timeSensitiveCue("plans for 2027", 2026)).toBe("2027");
		expect(webCue("summarise https://example.com/a", 2026)).toBe("link");
	});
	it("is null where wantsWeb is false, and ignores [[links]]", () => {
		expect(webCue("explain recursion", 2026)).toBeNull();
		expect(webCue("summarise [[Latest notes]]", 2026)).toBeNull();
	});
});

describe("chipLabels — an auto-armed search names its cue (ADR-230)", () => {
	const call = { id: "1", name: "web_search", input: { query: "ecb rate" } } as ToolCall;
	it("plain when the user switched search on", () => {
		expect(chipLabels(call).running).not.toContain("automatic");
	});
	it("names the cue on the running and done chips", () => {
		const labels = chipLabels(call, "current");
		expect(labels.running).toContain("“current”");
		expect(labels.done).toContain("“current”");
		expect(labels.done).toContain("ecb rate");
	});
});
