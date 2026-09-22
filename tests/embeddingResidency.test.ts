import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VisibleClock } from "../services/embedding/host/visibleClock";
import { EmbeddingResidency, IDLE_RELEASE_MS, ResidentProvider, installEmbeddingResidency } from "../services/embedding/residency";
import type { EmbeddingProvider } from "../services/embedding/EmbeddingProvider";
import { BuildGuard, foregroundDeaths, mayAutoBuild, markBuildStarted, parseBuildMarker, type BuildMarker } from "../services/embedding/buildGuard";

// ADR-202: what happens to indexing and to the loaded model when iOS puts
// Obsidian in the background.

afterEach(() => { vi.useRealTimers(); });

describe("VisibleClock — time the work could actually run", () => {
	it("stops while hidden and resumes where it was", () => {
		let t = 0;
		const c = new VisibleClock(() => t);
		t = 1_000;
		c.note(true);           // hidden at 1 s
		t = 601_000;            // ten minutes in the background
		expect(c.elapsed()).toBe(1_000);
		c.note(false);
		t = 603_000;
		expect(c.elapsed()).toBe(3_000);
	});

	it("repeated notes of the same state change nothing", () => {
		let t = 0;
		const c = new VisibleClock(() => t);
		c.note(true); t = 5_000; c.note(true); c.note(false); c.note(false);
		expect(c.elapsed()).toBe(0);
	});

	it("a timeout does NOT fire the moment the app returns after a long absence", () => {
		// The bug: a one-shot setTimeout that came due during the ten minutes in the
		// background fired immediately on resume, and a first download "timed out".
		vi.useFakeTimers();
		const c = new VisibleClock(() => Date.now());
		const fired = vi.fn();
		c.timeout(fired, 300_000);
		vi.advanceTimersByTime(10_000);
		c.note(true);
		vi.advanceTimersByTime(600_000);   // the background
		c.note(false);
		vi.advanceTimersByTime(2_000);
		expect(fired).not.toHaveBeenCalled();
		vi.advanceTimersByTime(290_000);    // 10 + 2 + 290 = 302 s visible
		expect(fired).toHaveBeenCalledTimes(1);
	});

	it("cancel stops it", () => {
		vi.useFakeTimers();
		const c = new VisibleClock(() => Date.now());
		const fired = vi.fn();
		const cancel = c.timeout(fired, 5_000);
		cancel();
		vi.advanceTimersByTime(60_000);
		expect(fired).not.toHaveBeenCalled();
	});
});

describe("every embedding deadline is measured on the visible clock (ADR-202)", () => {
	const read = (f: string): string => readFileSync(resolve(process.cwd(), "services/embedding/host", f), "utf8");

	it("the shared protocol client arms its timeouts on it (ADR-204)", () => {
		// Both backends' deadlines live here since the extraction, so this is the
		// one file that has to name the clock.
		const src = read("postMessageBackend.ts");
		expect(src).toContain("visibleClock.timeout(");
		expect(src).toContain("visibleClock.elapsed()");
	});

	for (const f of ["postMessageBackend.ts", "workerEmbeddingProvider.ts", "iframeEmbeddingProvider.ts"]) {
		it(`${f} has no wall-clock deadline left`, () => {
			const src = read(f);
			expect(src).not.toMatch(/Date\.now\(\)\s*-\s*started/);
			expect(src).not.toMatch(/clearTimeout\(\w+\.timeout\)/);
		});
	}
});

describe("the build guard does not count a background death (ADR-202)", () => {
	const m = (attempts: number, background?: boolean): BuildMarker => ({ attempts, startedAt: 0, modelId: "m", ...(background ? { background } : {}) });

	it("reads the flag, strictly", () => {
		expect(parseBuildMarker({ attempts: 1, background: true })?.background).toBe(true);
		expect(parseBuildMarker({ attempts: 1, background: "yes" })?.background).toBeUndefined();
	});

	it("a death while backgrounded is excused; one in the foreground is not", () => {
		expect(foregroundDeaths(m(2, true))).toBe(1);
		expect(foregroundDeaths(m(2))).toBe(2);
		expect(mayAutoBuild(m(2, true))).toBe(true);
		expect(mayAutoBuild(m(2))).toBe(false);
	});

	it("any number of iOS background kills never pauses the build", () => {
		let marker: BuildMarker | null = null;
		for (let i = 0; i < 10; i++) {
			marker = { ...markBuildStarted(marker, i, "m"), background: true }; // started, then backgrounded and killed
			expect(mayAutoBuild(marker)).toBe(true);
		}
	});

	it("two foreground crashes still pause, even with background kills between them", () => {
		let marker = markBuildStarted(null, 0, "m");                     // crash 1 (foreground)
		marker = { ...markBuildStarted(marker, 1, "m"), background: true }; // killed in background
		marker = markBuildStarted(marker, 2, "m");                       // crash 2 (foreground)
		expect(foregroundDeaths(marker)).toBe(2);
		expect(mayAutoBuild(marker)).toBe(false);
	});

	it("markBackground toggles a running build's marker and ignores an idle guard", () => {
		const box: { v: unknown } = { v: null };
		const g = new BuildGuard({ load: () => box.v, save: (x) => { box.v = x; } });
		g.markBackground(true);
		expect(box.v).toBeNull();
		g.start("m");
		g.markBackground(true);
		expect((box.v as BuildMarker).background).toBe(true);
		g.markBackground(false);
		expect((box.v as BuildMarker).background).toBeUndefined();
		expect((box.v as BuildMarker).attempts).toBe(1);
	});
});

class Inner implements EmbeddingProvider {
	readonly dim = 4;
	loads = 0;
	unloads = 0;
	failReady = false;
	release: (() => void) | null = null;
	async ready(): Promise<void> { this.loads++; if (this.failReady) throw new Error("RangeError: Out of memory"); }
	embed(texts: string[]): Promise<Float32Array[]> {
		return new Promise((r) => { this.release = () => r(texts.map(() => new Float32Array(4))); });
	}
	unload(): void { this.unloads++; }
}

const setup = (over: { mobile?: boolean; building?: boolean } = {}) => {
	let t = 0;
	const inner = new Inner();
	const background: boolean[] = [];
	const clock = new VisibleClock(() => t);
	const ref: { residency?: EmbeddingResidency } = {};
	const provider = new ResidentProvider(inner, () => ref.residency?.noteUse());
	const residency = new EmbeddingResidency({
		provider: () => provider, building: () => over.building ?? false, mobile: over.mobile ?? true,
		onBackground: (h) => background.push(h), log: () => {}, now: () => t, clock,
	});
	ref.residency = residency;
	return { inner, provider, residency, background, clock, advance: (ms: number) => { t += ms; } };
};

describe("EmbeddingResidency — the model on a phone (ADR-202)", () => {
	it("releases a loaded, idle model when Obsidian goes to the background", async () => {
		const { inner, provider, residency } = setup();
		await provider.ready();
		residency.onVisibility(true);
		expect(inner.unloads).toBe(1);
		expect(provider.loaded).toBe(false);
	});

	it("preloads it again when Obsidian comes back", async () => {
		const { inner, provider, residency } = setup();
		await provider.ready();
		residency.onVisibility(true);
		residency.onVisibility(false);
		await Promise.resolve(); await Promise.resolve();
		expect(inner.loads).toBe(2);
		expect(provider.loaded).toBe(true);
	});

	it("never releases under a running build or an in-flight embed", async () => {
		const building = setup({ building: true });
		await building.provider.ready();
		building.residency.onVisibility(true);
		expect(building.inner.unloads).toBe(0);

		const inflight = setup();
		await inflight.provider.ready();
		const pending = inflight.provider.embed(["x"]);
		inflight.residency.onVisibility(true);
		expect(inflight.inner.unloads).toBe(0);
		inflight.inner.release!();
		await pending;
	});

	it("does not release a model that never loaded — or one whose load FAILED", async () => {
		const never = setup();
		never.residency.onVisibility(true);
		expect(never.inner.unloads).toBe(0);

		// Releasing a failed load would reset the provider's memoized rejection and
		// retry an out-of-memory load behind the user's back.
		const failed = setup();
		failed.inner.failReady = true;
		await failed.provider.ready().catch(() => undefined);
		failed.residency.onVisibility(true);
		expect(failed.inner.unloads).toBe(0);
	});

	it("releases after IDLE_RELEASE_MS without use while visible, and not before", async () => {
		const { inner, provider, residency, advance } = setup();
		await provider.ready();
		advance(IDLE_RELEASE_MS - 1);
		residency.tick(false);
		expect(inner.unloads).toBe(0);
		advance(1);
		residency.tick(false);
		expect(inner.unloads).toBe(1);
	});

	it("use resets the idle clock", async () => {
		const { inner, provider, residency, advance } = setup();
		await provider.ready();
		advance(IDLE_RELEASE_MS - 10);
		const p = provider.embed(["x"]); inner.release!(); await p;
		advance(20);
		residency.tick(false);
		expect(inner.unloads).toBe(0);
	});

	it("the chat input preloads only a model this rule released — never a first download", async () => {
		const fresh = setup();
		fresh.residency.prewarm();
		expect(fresh.inner.loads).toBe(0);

		const { inner, provider, residency, advance } = setup();
		await provider.ready();
		advance(IDLE_RELEASE_MS);
		residency.tick(false);
		residency.prewarm();
		await Promise.resolve(); await Promise.resolve();
		expect(inner.loads).toBe(2);
	});

	it("arms the idle timer on a phone only — a desktop's tick has nothing to do", () => {
		const intervals: unknown[] = [];
		vi.stubGlobal("document", { hidden: false });
		vi.stubGlobal("window", { setInterval: () => 7 });
		try {
			const plugin = {
				registerDomEvent: () => {},
				registerInterval: (id: number) => { intervals.push(id); return id; },
			};
			const deps = { provider: () => null, building: () => false, onBackground: () => {}, log: () => {} };
			installEmbeddingResidency(plugin as never, { ...deps, mobile: false });
			expect(intervals).toHaveLength(0);
			installEmbeddingResidency(plugin as never, { ...deps, mobile: true });
			expect(intervals).toEqual([7]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("the desktop never releases, but still feeds the clock and the guard", async () => {
		const { inner, provider, residency, background, advance, clock } = setup({ mobile: false });
		await provider.ready();
		residency.onVisibility(true);
		advance(5_000);
		expect(clock.elapsed()).toBe(0);
		residency.onVisibility(false);
		advance(IDLE_RELEASE_MS);
		residency.tick(false);
		expect(inner.unloads).toBe(0);
		expect(background).toEqual([true, false]);
	});
});
