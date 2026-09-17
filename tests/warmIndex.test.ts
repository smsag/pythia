import { describe, it, expect, vi } from "vitest";
import { shouldWarmIndex, canWarmBeforeIndexCheck, warmIndex, scheduleWarm } from "../services/embedding/warmIndex";

describe("canWarmBeforeIndexCheck — the half answerable without the disk", () => {
	it("agrees with shouldWarmIndex on everything but the index itself", () => {
		// One rule, two entry points: the cheap guard must never disagree with the
		// full one, or the warm bails for a reason the full check would allow.
		for (const isMobile of [true, false]) {
			for (const conversationCount of [0, 1, 2, 10]) {
				const cheap = canWarmBeforeIndexCheck({ isMobile, conversationCount });
				expect(shouldWarmIndex({ isMobile, conversationCount, hasIndex: true })).toBe(cheap);
				expect(shouldWarmIndex({ isMobile, conversationCount, hasIndex: false })).toBe(false);
			}
		}
	});
});

describe("shouldWarmIndex (ADR-169)", () => {
	const base = { isMobile: false, conversationCount: 10, hasIndex: true };

	it("warms a desktop vault that already has an index", () => {
		expect(shouldWarmIndex(base)).toBe(true);
	});

	it("never warms without an existing index", () => {
		// A missing .bin means the model has never been downloaded; starting a
		// ~100 MB download nobody asked for, at launch, is not a warm.
		expect(shouldWarmIndex({ ...base, hasIndex: false })).toBe(false);
	});

	it("never warms on mobile", () => {
		// The iframe fallback runs inference on the UI thread, which is what mobile
		// gets wherever blob: Workers are blocked (ADR-126).
		expect(shouldWarmIndex({ ...base, isMobile: true })).toBe(false);
	});

	it("does not warm a vault too small to have a pair", () => {
		expect(shouldWarmIndex({ ...base, conversationCount: 1 })).toBe(false);
		expect(shouldWarmIndex({ ...base, conversationCount: 0 })).toBe(false);
		expect(shouldWarmIndex({ ...base, conversationCount: 2 })).toBe(true);
	});
});

describe("warmIndex", () => {
	const deps = (over: Partial<Parameters<typeof warmIndex>[0]> = {}) => {
		const log = vi.fn();
		const sync = vi.fn(async () => undefined);
		const hasIndex = vi.fn(async () => true);
		return {
			log,
			sync,
			hasIndex,
			d: { isMobile: false, conversationCount: 10, hasIndex, sync, log, ...over },
		};
	};

	it("syncs when the guards pass", async () => {
		const { d, sync, log } = deps();
		await warmIndex(d);
		expect(sync).toHaveBeenCalledOnce();
		expect(log.mock.calls[0][0]).toContain("warm ok");
	});

	it("does not touch the disk at all on mobile", async () => {
		// The cheap half of the rule must short-circuit before the adapter call.
		const { d, hasIndex, sync } = deps({ isMobile: true });
		await warmIndex(d);
		expect(hasIndex).not.toHaveBeenCalled();
		expect(sync).not.toHaveBeenCalled();
	});

	it("skips, and says so, when no index exists yet", async () => {
		const hasIndex = vi.fn(async () => false);
		const { d, sync, log } = deps({ hasIndex });
		await warmIndex({ ...d, hasIndex });
		expect(sync).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalledWith("related: warm skipped (no index yet)");
	});

	it("swallows a failure into the log and never throws", async () => {
		// Nothing here was user-requested, so nothing here interrupts — but silence
		// is only acceptable because it is logged (principle 2).
		const sync = vi.fn(async () => { throw new Error("model gone"); });
		const { d, log } = deps({ sync });
		await expect(warmIndex({ ...d, sync })).resolves.toBeUndefined();
		expect(log).toHaveBeenCalledWith("related: warm failed", { error: "model gone" });
	});
});

describe("scheduleWarm", () => {
	it("runs after the delay and registers its own cancellation", () => {
		vi.useFakeTimers();
		const run = vi.fn();
		const cleanups: (() => void)[] = [];
		scheduleWarm({ run, register: (c) => cleanups.push(c), delayMs: 100 });

		expect(run).not.toHaveBeenCalled();
		expect(cleanups).toHaveLength(1);        // teardown is registered, not hoped for
		vi.advanceTimersByTime(100);
		expect(run).toHaveBeenCalledOnce();
		vi.useRealTimers();
	});

	it("does not run once the registered cleanup has fired", () => {
		// A plugin disabled inside the delay must not warm a torn-down instance.
		vi.useFakeTimers();
		const run = vi.fn();
		const cleanups: (() => void)[] = [];
		scheduleWarm({ run, register: (c) => cleanups.push(c), delayMs: 100 });
		for (const c of cleanups) c();
		vi.advanceTimersByTime(1000);
		expect(run).not.toHaveBeenCalled();
		vi.useRealTimers();
	});
});
