import { describe, it, expect } from "vitest";
import {
	buildNowEnabled, canBuildNow, describeVaultIndexStatus, isKeptByDesktop, stateFromFile, type VaultIndexState, type VaultIndexStatus,
} from "../services/embedding/indexStatus";
import { EmbeddingOutOfMemoryError, isOutOfMemoryError } from "../services/embedding/memoryError";
import { peekIndexMeta, serializeIndex } from "../services/embedding/embeddingIndex";
import { t } from "../i18n";

const base: VaultIndexStatus = {
	state: "notBuilt", count: 0, done: 0, total: 0, error: null, outOfMemory: false, marker: null,
	backend: null, modelId: "xenova-paraphrase-multilingual-MiniLM-L12-v2", modelSubstituted: false, enabledByDefault: true,
	keeper: null, writtenAt: null, onPhone: false,
};

describe("stateFromFile — what a persisted index means today (ADR-199)", () => {
	it("no file, or an empty one, is not built", () => {
		expect(stateFromFile(null, "s")).toBe("notBuilt");
		expect(stateFromFile({ count: 0, complete: true, scope: "s" }, "s")).toBe("notBuilt");
	});
	it("complete under this scope is ready; under another it is outdated", () => {
		expect(stateFromFile({ count: 3, complete: true, scope: "s" }, "s")).toBe("ready");
		expect(stateFromFile({ count: 3, complete: true, scope: "old" }, "s")).toBe("outdated");
	});
	it("rows from a build that never finished are partial — not ready (ADR-184)", () => {
		expect(stateFromFile({ count: 3, complete: false, scope: "s" }, "s")).toBe("partial");
	});
});

describe("describeVaultIndexStatus — every state says what it is and what to do", () => {
	const states: VaultIndexState[] = ["notBuilt", "loading", "building", "ready", "partial", "outdated", "failed", "paused"];

	it("gives every state its own headline", () => {
		const headlines = states.map((state) => describeVaultIndexStatus({ ...base, state, error: "boom" }).headline);
		expect(new Set(headlines).size).toBe(states.length);
		for (const h of headlines) expect(h).not.toMatch(/\{\{/); // every variable filled
	});

	it("carries the numbers into the text", () => {
		expect(describeVaultIndexStatus({ ...base, state: "building", done: 7, total: 51 }).headline).toContain("7");
		expect(describeVaultIndexStatus({ ...base, state: "building", done: 7, total: 51 }).headline).toContain("51");
		expect(describeVaultIndexStatus({ ...base, state: "ready", count: 51 }).headline).toContain("51");
		expect(describeVaultIndexStatus({ ...base, state: "failed", error: "download failed" }).headline).toContain("download failed");
	});

	it("names out-of-memory as such instead of quoting the raw error", () => {
		const d = describeVaultIndexStatus({ ...base, state: "failed", outOfMemory: true, error: "RangeError: Out of memory" });
		expect(d.headline).toBe(t("vaultIndexStateOutOfMemory"));
	});

	it("the loading headline names the model's download size", () => {
		expect(describeVaultIndexStatus({ ...base, state: "loading" }).headline).toContain("120");
		expect(describeVaultIndexStatus({ ...base, state: "loading", modelId: "xenova-paraphrase-multilingual-MiniLM-L12-v2-latin" }).headline).toContain("75");
	});

	it("the paused headline counts the builds that died", () => {
		const d = describeVaultIndexStatus({ ...base, state: "paused", marker: { attempts: 2, startedAt: 0, modelId: "" } });
		expect(d.headline).toContain("2");
	});

	it("the detail line names the model, marks a phone's substitute, the engine, and an off default", () => {
		expect(describeVaultIndexStatus(base).detail).toBe(t("vaultIndexDetailModel", { model: "Multilingual" }));
		const phone = describeVaultIndexStatus({
			...base, modelId: "xenova-all-MiniLM-L6-v2", modelSubstituted: true, backend: "worker (blob)", enabledByDefault: false,
		}).detail;
		expect(phone).toContain(t("vaultIndexDetailModelMobile", { model: "English" }));
		expect(phone).toContain("worker (blob)");
		expect(phone).toContain(t("vaultIndexDetailOff"));
	});

	it("Build now is offered for everything short of a live or finished build", () => {
		expect(states.filter(canBuildNow).sort()).toEqual(["failed", "notBuilt", "outdated", "partial", "paused"]);
	});
});

describe("isOutOfMemoryError (ADR-199)", () => {
	it("recognises the shapes seen on iOS and emitted by the runtimes", () => {
		for (const msg of [
			"no available backend found. ERR: [wasm] RangeError: Out of memory",
			"RangeError: Array buffer allocation failed",
			"Aborted(OOM)",
			"Cannot enlarge memory arrays to size 2147483648 bytes",
		]) expect(isOutOfMemoryError(new Error(msg))).toBe(true);
		expect(isOutOfMemoryError(new EmbeddingOutOfMemoryError("x"))).toBe(true);
	});

	it("does not mistake a refusal or a network error for memory", () => {
		for (const msg of ["Unsupported device: wasm", "Not allowed to load local resource: blob:", "Failed to fetch", "ROOM not found"]) {
			expect(isOutOfMemoryError(new Error(msg))).toBe(false);
		}
	});
});

describe("peekIndexMeta — the header, without the vectors (ADR-199)", () => {
	it("reads count, completeness and scope", () => {
		const items = [{ id: "a", contentHash: "h", chunks: [Int8Array.from([1, 2])] }];
		expect(peekIndexMeta(serializeIndex(items, 2, { complete: true, scope: "s" }))).toEqual({ count: 1, complete: true, scope: "s" });
	});

	it("returns null for anything that is not a current index file", () => {
		expect(peekIndexMeta(new ArrayBuffer(3))).toBeNull();
		expect(peekIndexMeta(new ArrayBuffer(64))).toBeNull(); // wrong magic
		const buf = serializeIndex([], 2, { complete: true, scope: "s" });
		new DataView(buf).setUint8(4, 1); // a v1 file
		expect(peekIndexMeta(buf)).toBeNull();
	});
});

describe("a phone holding a desktop's index says so, and how to take it over (ADR-220)", () => {
	const held: VaultIndexStatus = { ...base, state: "ready", count: 40, onPhone: true, keeper: "desktop", writtenAt: Date.UTC(2026, 8, 20, 12) };

	it("names the desktop and when it last wrote the index, and offers Build now", () => {
		const { detail } = describeVaultIndexStatus(held);
		expect(detail).toContain(t("vaultIndexDetailKeptByDesktop", { date: "20 Sep 2026" }));
		expect(buildNowEnabled(held)).toBe(true); // "ready" alone would grey it out
	});

	it("still says it without a date, for a file that carries none", () => {
		expect(describeVaultIndexStatus({ ...held, writtenAt: null }).detail).toContain(t("vaultIndexDetailKeptByDesktopUndated"));
	});

	it("says nothing on a desktop, on a phone that keeps the index itself, or on an unsigned one", () => {
		for (const s of [{ ...held, onPhone: false }, { ...held, keeper: "mobile" as const }, { ...held, keeper: null }]) {
			expect(isKeptByDesktop(s)).toBe(false);
			expect(buildNowEnabled(s)).toBe(false);
			expect(describeVaultIndexStatus(s).detail).not.toContain(t("vaultIndexDetailKeptByDesktopUndated").slice(0, 12));
		}
	});

	it("only for an index there is: not while one loads, builds or failed", () => {
		for (const state of ["notBuilt", "loading", "building", "failed", "paused"] as const) {
			expect(isKeptByDesktop({ ...held, state })).toBe(false);
		}
		for (const state of ["ready", "partial", "outdated"] as const) expect(isKeptByDesktop({ ...held, state })).toBe(true);
	});
});
