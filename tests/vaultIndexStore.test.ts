import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({ normalizePath: (p: string) => p }));

import { VaultIndexStore } from "../services/embedding/vaultIndexStore";

/** The path the store would write, for a plugin whose dir is `.obsidian/plugins/pythia`. */
const pathFor = async (modelId: string, prefix?: string): Promise<string> => {
	const written: string[] = [];
	const plugin = {
		manifest: { dir: ".obsidian/plugins/pythia", id: "pythia" },
		app: { vault: { configDir: ".obsidian", adapter: {
			exists: async () => true,
			readBinary: async () => new ArrayBuffer(0),
			writeBinary: async (p: string) => { written.push(p); },
			mkdir: async () => {},
		} } },
	};
	const store = new VaultIndexStore(plugin as never, modelId as never, prefix);
	await store.write(new ArrayBuffer(0));
	return written[0];
};

describe("VaultIndexStore — one index file per vector family (ADR-200)", () => {
	it("names the file by the family, so the variant and the full model share it", async () => {
		expect(await pathFor("xenova-paraphrase-multilingual-MiniLM-L12-v2-latin", "vault-embeddings"))
			.toBe(await pathFor("xenova-paraphrase-multilingual-MiniLM-L12-v2", "vault-embeddings"));
		expect(await pathFor("xenova-paraphrase-multilingual-MiniLM-L12-v2-latin", "vault-embeddings"))
			.toBe(".obsidian/plugins/pythia/vault-embeddings-xenova-paraphrase-multilingual-MiniLM-L12-v2.bin");
	});

	it("keeps different models and different prefixes apart", async () => {
		expect(await pathFor("xenova-all-MiniLM-L6-v2", "vault-embeddings")).not.toBe(await pathFor("xenova-paraphrase-multilingual-MiniLM-L12-v2", "vault-embeddings"));
		expect(await pathFor("xenova-all-MiniLM-L6-v2")).not.toBe(await pathFor("xenova-all-MiniLM-L6-v2", "vault-embeddings"));
	});
});
