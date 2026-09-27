import { describe, it, expect } from "vitest";
import { isLeftoverEngineFile, removeLeftoverEngineFiles } from "../services/leftoverEngineFiles";

// ADR-237: the index, journal and Worker files Pythia's engine wrote before
// ADR-224 removed it, and nothing else in the plugin folder.

const DIR = ".obsidian/plugins/pythia";
const at = (name: string) => `${DIR}/${name}`;

function adapter(files: string[], failing: string[] = []) {
	const left = new Set(files);
	return {
		left,
		exists: async (p: string) => p === DIR,
		list: async () => ({ files: [...left], folders: [] }),
		remove: async (p: string) => {
			if (failing.includes(p)) throw new Error("EBUSY");
			left.delete(p);
		},
	};
}

describe("isLeftoverEngineFile (ADR-237)", () => {
	it("matches both indexes, their journals and the Worker bundle", () => {
		for (const name of [
			"vault-embeddings-xenova-paraphrase-multilingual-MiniLM-L12-v2.bin",
			"vault-embeddings-xenova-paraphrase-multilingual-MiniLM-L12-v2.journal.bin",
			"related-embeddings-xenova-all-MiniLM-L6-v2.bin",
			"related-embeddings-xenova-all-MiniLM-L6-v2.journal.bin",
			"embedding-worker-2.14.0-a1b2c3.mjs",
		]) {
			expect(isLeftoverEngineFile(at(name), DIR)).toBe(true);
		}
	});

	it("leaves Pythia's own files alone", () => {
		for (const name of ["data.json", "main.js", "manifest.json", "styles.css", "secrets.json"]) {
			expect(isLeftoverEngineFile(at(name), DIR)).toBe(false);
		}
	});

	it("matches only directly inside the plugin folder", () => {
		expect(isLeftoverEngineFile(`${DIR}/sub/vault-embeddings-x.bin`, DIR)).toBe(false);
		expect(isLeftoverEngineFile(".obsidian/plugins/schreibstube/semantic-notes-x.bin", DIR)).toBe(false);
		expect(isLeftoverEngineFile(".obsidian/plugins/pythia-old/vault-embeddings-x.bin", DIR)).toBe(false);
	});

	it("does not match a name that only starts like one", () => {
		expect(isLeftoverEngineFile(at("vault-embeddings-x.bin.bak"), DIR)).toBe(false);
		expect(isLeftoverEngineFile(at("my-vault-embeddings-x.bin"), DIR)).toBe(false);
	});
});

describe("removeLeftoverEngineFiles (ADR-237)", () => {
	it("removes the engine's files and keeps the rest", async () => {
		const a = adapter([at("data.json"), at("vault-embeddings-x.bin"), at("embedding-worker-1-f.mjs")]);
		const logs: string[] = [];
		const removed = await removeLeftoverEngineFiles(a, DIR, (m) => logs.push(m));
		expect(removed).toEqual([at("vault-embeddings-x.bin"), at("embedding-worker-1-f.mjs")]);
		expect([...a.left]).toEqual([at("data.json")]);
		expect(logs).toEqual(["removed 2 file(s) of the former embedding engine"]);
	});

	it("says which file it could not remove and carries on", async () => {
		const stuck = at("vault-embeddings-x.bin");
		const a = adapter([stuck, at("related-embeddings-x.bin")], [stuck]);
		const logs: string[] = [];
		const removed = await removeLeftoverEngineFiles(a, DIR, (m) => logs.push(m));
		expect(removed).toEqual([at("related-embeddings-x.bin")]);
		expect(logs[0]).toContain(stuck);
		expect(logs[0]).toContain("EBUSY");
	});

	it("is silent when there is nothing to remove", async () => {
		const logs: string[] = [];
		expect(await removeLeftoverEngineFiles(adapter([at("data.json")]), DIR, (m) => logs.push(m))).toEqual([]);
		expect(logs).toEqual([]);
	});

	it("does nothing when the folder is missing", async () => {
		const a = { ...adapter([]), exists: async () => false };
		expect(await removeLeftoverEngineFiles(a, DIR, () => {})).toEqual([]);
	});
});
