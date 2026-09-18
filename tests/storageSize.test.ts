import { describe, it, expect } from "vitest";
import {
	formatBytes,
	storageLevel,
	STORAGE_HIGH_BYTES,
	STORAGE_WARN_BYTES,
} from "../services/storageSize";

const MB = 1024 * 1024;

describe("storageLevel", () => {
	it("is quiet for the sizes a normal vault reaches", () => {
		expect(storageLevel(0)).toBe("ok");
		expect(storageLevel(4.5 * MB)).toBe("ok");   // ~200 conversations
		expect(storageLevel(11 * MB)).toBe("ok");    // ~500
	});

	it("warns from the threshold, inclusive", () => {
		expect(storageLevel(STORAGE_WARN_BYTES - 1)).toBe("ok");
		expect(storageLevel(STORAGE_WARN_BYTES)).toBe("warn");
		expect(storageLevel(30 * MB)).toBe("warn");
	});

	it("escalates once the whole-file rewrite has roughly doubled", () => {
		expect(storageLevel(STORAGE_HIGH_BYTES - 1)).toBe("warn");
		expect(storageLevel(STORAGE_HIGH_BYTES)).toBe("high");
		expect(storageLevel(200 * MB)).toBe("high");
	});
});

describe("formatBytes", () => {
	it("scales the unit and keeps one decimal only where it carries information", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(2048)).toBe("2.0 KB");
		expect(formatBytes(64 * 1024)).toBe("64 KB");
		expect(formatBytes(4.5 * MB)).toBe("4.5 MB");
		expect(formatBytes(45 * MB)).toBe("45 MB");
		expect(formatBytes(2 * 1024 * MB)).toBe("2.0 GB");
	});

	it("says nothing rather than a wrong number when the size is unknown", () => {
		expect(formatBytes(NaN)).toBe("—");
		expect(formatBytes(-1)).toBe("—");
	});
});
