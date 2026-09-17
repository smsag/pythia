import { describe, it, expect, vi } from "vitest";
import { shouldWarmIndex, warmIndex } from "../services/embedding/warmIndex";

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
		const readIndex = vi.fn(async () => new ArrayBuffer(8));
		return {
			log,
			sync,
			readIndex,
			d: { isMobile: false, conversationCount: 10, readIndex, sync, log, ...over },
		};
	};

	it("syncs when the guards pass", async () => {
		const { d, sync, log } = deps();
		await warmIndex(d);
		expect(sync).toHaveBeenCalledOnce();
		expect(log.mock.calls[0][0]).toContain("warm ok");
	});

	it("does not read the index at all on mobile", async () => {
		// The cheap guard must short-circuit before touching the disk.
		const { d, readIndex, sync } = deps({ isMobile: true });
		await warmIndex(d);
		expect(readIndex).not.toHaveBeenCalled();
		expect(sync).not.toHaveBeenCalled();
	});

	it("skips, and says so, when no index exists yet", async () => {
		const readIndex = vi.fn(async () => null);
		const { d, sync, log } = deps({ readIndex });
		await warmIndex({ ...d, readIndex });
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
