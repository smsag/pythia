import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The release files must agree on one version. package-lock.json drifted two
// releases behind (2.20.0 while 2.22.0 shipped) because nothing checked it;
// the Release workflow checks at publish time, this test at every commit.

const read = (f: string) => JSON.parse(readFileSync(resolve(__dirname, "..", f), "utf8"));

describe("version agreement", () => {
	it("manifest.json, package.json and package-lock.json name the same version, and versions.json lists it", () => {
		const version = read("manifest.json").version as string;
		const lock = read("package-lock.json");
		expect(read("package.json").version).toBe(version);
		expect(lock.version).toBe(version);
		expect(lock.packages[""].version).toBe(version);
		expect(read("versions.json")).toHaveProperty([version]);
	});
});
