// Shared fixtures for the VaultRagService tests (split out when ADR-199's tests
// pushed the one file past the 600-line budget). The importing test file mocks
// "obsidian" itself; nothing here touches it.

import type { IndexStore } from "../../services/embedding/ConversationIndexService";
import type { EmbeddingProvider, EmbeddingBackend } from "../../services/embedding/EmbeddingProvider";
import { DEFAULT_EMBEDDING_MODEL_ID } from "../../models/embeddingModels";
import { DEFAULT_SETTINGS } from "../../models/settings";
import type { PythiaSettings } from "../../models/settings";
import type { Conversation } from "../../models/types";

export class FakeProvider implements EmbeddingProvider {
	readonly dim = 4;
	embedded: string[] = [];
	constructor(private readonly reported: EmbeddingBackend | null = "worker (blob)") {}
	async ready(): Promise<void> {}
	async embed(texts: string[]): Promise<Float32Array[]> {
		this.embedded.push(...texts);
		return texts.map(() => Float32Array.from([1, 0, 0, 0]));
	}
	isOffThread(): boolean { return true; }
	backend(): EmbeddingBackend | null { return this.reported; }
	unload(): void {}
}

export class MemStore implements IndexStore {
	buf: ArrayBuffer | null = null;
	async read(): Promise<ArrayBuffer | null> { return this.buf; }
	async write(b: ArrayBuffer): Promise<void> { this.buf = b; }
}

/** A vault of one very long note, so the chunk WIDTH is observable. */
export const fakeApp = (body: string) => ({
	vault: {
		getMarkdownFiles: () => [{ path: "Notes/long.md", stat: { mtime: 1 } }],
		cachedRead: async () => body,
		getAbstractFileByPath: () => null,
	},
	metadataCache: { getFileCache: () => ({ frontmatter: undefined }) },
});

export const settings = (over: Partial<PythiaSettings> = {}): PythiaSettings => ({
	...DEFAULT_SETTINGS,
	vaultContextEnabled: true,
	...over,
});

export const conv = { id: "c1" } as Conversation;

/** The model id and (no) guard every existing test ran under before ADR-199. */
export const DEPS = { modelId: () => DEFAULT_EMBEDDING_MODEL_ID };

/** Let the fire-and-forget `refresh()` inside `getRelevantNotes` finish. */
export const settle = async (): Promise<void> => {
	for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
};
